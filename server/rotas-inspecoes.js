// HospCheck — rotas de inspeção: rascunho automático, foto obrigatória pela câmera,
// conclusão somente após confirmação do servidor, retificações auditadas e histórico imutável.
import { Router } from 'express';
import { db, agoraISO, novoId, ehDataValida, hojeSP } from './db.js';
import { pode } from './auth.js';
import { salvarAnexo, anexosDe } from './arquivos.js';
import { proximaInspecao } from './regras.js';

export const rotasInspeccoes = Router();

// Abre (ou retoma) um rascunho de inspeção para um equipamento
rotasInspeccoes.post('/inspecoes/rascunho', (req, res) => {
  if (!pode(req.usuario.perfil, 'inspecao.realizar'))
    return res.status(403).json({ erro: 'Perfil não pode realizar inspeções.' });
  const { equipamento_id } = req.body || {};
  const eq = db.prepare('SELECT * FROM equipamentos WHERE id = ? AND hospital_id = ?').get(equipamento_id, req.usuario.hospital_id);
  if (!eq) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  if (eq.status === 'desativado') return res.status(400).json({ erro: 'Equipamento desativado não pode ser inspecionado.' });

  const existente = db.prepare(`SELECT * FROM inspecoes WHERE equipamento_id = ? AND status = 'rascunho' ORDER BY criado_em DESC LIMIT 1`).get(eq.id);
  const modeloId = eq.checklist_modelo_id || db.prepare(`SELECT id FROM modelos_checklist WHERE hospital_id = ? AND ativo = 1 ORDER BY versao DESC LIMIT 1`).get(eq.hospital_id)?.id;
  const modelo = db.prepare('SELECT * FROM modelos_checklist WHERE id = ?').get(modeloId);
  if (!modelo) return res.status(400).json({ erro: 'Nenhum modelo de checklist configurado para este equipamento.' });

  let insp = existente;
  if (!insp) {
    const id = novoId(), agora = agoraISO();
    db.prepare(`INSERT INTO inspecoes (id,hospital_id,equipamento_id,modelo_id,modelo_versao,usuario_id,status,agendada_para,data_inicio,criado_em,atualizado_em)
                VALUES (?,?,?,?,?,?, 'rascunho', ?,?,?,?)`)
      .run(id, eq.hospital_id, eq.id, modelo.id, modelo.versao, req.usuario.id, hojeSP(), agora, agora, agora);
    insp = db.prepare('SELECT * FROM inspecoes WHERE id = ?').get(id);
  } else if (insp.modelo_id !== modelo.id) {
    // Modelo mudou depois do rascunho: recria o rascunho com o modelo vigente, preservando o antigo no histórico.
    const id = novoId(), agora = agoraISO();
    db.prepare(`INSERT INTO inspecoes (id,hospital_id,equipamento_id,modelo_id,modelo_versao,usuario_id,status,agendada_para,data_inicio,criado_em,atualizado_em)
                VALUES (?,?,?,?,?,?, 'rascunho', ?,?,?,?)`)
      .run(id, eq.hospital_id, eq.id, modelo.id, modelo.versao, req.usuario.id, hojeSP(), agora, agora, agora);
    insp = db.prepare('SELECT * FROM inspecoes WHERE id = ?').get(id);
  }

  const itens = db.prepare('SELECT * FROM itens_checklist WHERE modelo_id = ? AND ativo = 1 ORDER BY ordem').all(modelo.id);
  const respostas = db.prepare('SELECT * FROM respostas_inspecao WHERE inspecao_id = ?').all(insp.id);
  const fotos = anexosDe({ inspecao_id: insp.id }).filter(a => a.tipo === 'foto');
  res.json({ inspecao: insp, equipamento: eq, modelo, itens, respostas, fotos,
    foto_obrigatoria: true, minimo_fotos: 1 });
});

// Autosave de respostas (rascunho) — nunca marca como concluída
rotasInspeccoes.patch('/inspecoes/:id/rascunho', (req, res) => {
  const insp = db.prepare('SELECT * FROM inspecoes WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!insp) return res.status(404).json({ erro: 'Inspeção não encontrada.' });
  if (insp.status !== 'rascunho') return res.status(400).json({ erro: 'Inspeção já concluída não pode ser alterada (use retificação auditada).' });
  if (!pode(req.usuario.perfil, 'inspecao.realizar')) return res.status(403).json({ erro: 'Sem permissão.' });

  const { respostas, observacao_geral } = req.body || {};
  if (Array.isArray(respostas)) {
    for (const r of respostas) {
      if (!r.item_id) continue;
      if (r.valor && !['conforme', 'nao_conforme', 'nao_se_aplica'].includes(r.valor)) continue;
      db.prepare(`INSERT INTO respostas_inspecao (id,inspecao_id,item_id,enunciado,valor,justificativa,observacao,medicao_num,medicao_unidade)
                  VALUES (?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(inspecao_id,item_id) DO UPDATE SET valor=excluded.valor, justificativa=excluded.justificativa,
                    observacao=excluded.observacao, medicao_num=excluded.medicao_num, medicao_unidade=excluded.medicao_unidade`)
        .run(novoId(), insp.id, r.item_id, r.enunciado || '', r.valor || null, r.justificativa || null,
          r.observacao || null, r.medicao_num ?? null, r.medicao_unidade || null);
    }
  }
  if (observacao_geral !== undefined) {
    db.prepare('UPDATE inspecoes SET observacao_geral = ? WHERE id = ?').run(observacao_geral || null, insp.id);
  }
  db.prepare('UPDATE inspecoes SET atualizado_em = ? WHERE id = ?').run(agoraISO(), insp.id);
  const fotos = anexosDe({ inspecao_id: insp.id }).filter(a => a.tipo === 'foto');
  res.json({ ok: true, rascunho_salvo_em: agoraISO(), fotos_confirmadas: fotos.length });
});

// Upload de foto/camera (capture environment) ou upload de arquivo — vinculado à inspeção
rotasInspeccoes.post('/inspecoes/:id/anexos', (req, res) => {
  const insp = db.prepare('SELECT * FROM inspecoes WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!insp) return res.status(404).json({ erro: 'Inspeção não encontrada.' });
  if (insp.status !== 'rascunho') return res.status(400).json({ erro: 'Só é possível anexar a inspeções em rascunho.' });
  const b = req.body || {};
  const tiposPermitidos = ['foto', 'laudo'];
  if (!tiposPermitidos.includes(b.tipo)) return res.status(400).json({ erro: 'Tipo de anexo inválido para inspeção (foto ou laudo).' });
  if (b.tipo === 'laudo') {
    // Laudo PDF é opcional e NUNCA substitui a foto obrigatória
  }
  try {
    const a = salvarAnexo({
      hospital_id: req.usuario.hospital_id, tipo: b.tipo, base64: b.base64,
      nome_original: b.nome_original, mime: b.mime, legenda: b.legenda,
      equipamento_id: insp.equipamento_id, inspecao_id: insp.id, enviado_por: req.usuario.id
    });
    req.auditar('anexar_foto', 'inspecao', insp.id, null, { anexo: a.id, tipo: b.tipo, bytes: a.tamanho });
    const fotos = anexosDe({ inspecao_id: insp.id }).filter(x => x.tipo === 'foto');
    res.status(201).json({ ok: true, anexo: a, fotos_confirmadas: fotos.length });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

rotasInspeccoes.delete('/inspecoes/:id/anexos/:anexoId', (req, res) => {
  const insp = db.prepare('SELECT * FROM inspecoes WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!insp) return res.status(404).json({ erro: 'Inspeção não encontrada.' });
  if (insp.status !== 'rascunho') return res.status(400).json({ erro: 'Inspeção já concluída é imutável.' });
  const a = db.prepare('SELECT * FROM anexos WHERE id = ? AND inspecao_id = ?').get(req.params.anexoId, insp.id);
  if (!a) return res.status(404).json({ erro: 'Anexo não encontrado.' });
  db.prepare('DELETE FROM anexos WHERE id = ?').run(a.id);
  req.auditar('remover_anexo', 'inspecao', insp.id, a, null);
  res.json({ ok: true });
});

// Conclusão: valida TODAS as respostas e a foto obrigatória no SERVIDOR.
// Só responde "concluída" depois de gravar e reler do banco (confirmação de dados/fotos).
rotasInspeccoes.post('/inspecoes/:id/concluir', (req, res) => {
  const insp = db.prepare('SELECT * FROM inspecoes WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!insp) return res.status(404).json({ erro: 'Inspeção não encontrada.' });
  if (insp.status !== 'rascunho') return res.status(400).json({ erro: 'Inspeção já concluída.' });
  if (!pode(req.usuario.perfil, 'inspecao.realizar')) return res.status(403).json({ erro: 'Sem permissão.' });

  const itens = db.prepare('SELECT * FROM itens_checklist WHERE modelo_id = ? AND ativo = 1 ORDER BY ordem').all(insp.modelo_id);
  const respBanco = db.prepare('SELECT * FROM respostas_inspecao WHERE inspecao_id = ?').all(insp.id);
  const mapa = Object.fromEntries(respBanco.map(r => [r.item_id, r]));

  const pendentes = [];
  const semJustificativa = [];
  const semMedicao = [];
  for (const it of itens) {
    const r = mapa[it.id];
    if (!r || !r.valor) { pendentes.push(it.enunciado); continue; }
    // Toda não conformidade exige descrição (justificativa), independentemente do item.
    if (r.valor === 'nao_conforme' && !r.justificativa?.trim()) semJustificativa.push(it.enunciado);
    if (it.exige_medicao && (r.medicao_num === null || r.medicao_num === undefined || r.medicao_num === '')) semMedicao.push(it.enunciado);
  }
  if (pendentes.length) return res.status(400).json({ erro: 'Há itens sem resposta.', pendentes });
  if (semJustificativa.length) return res.status(400).json({ erro: 'Não conformidade exige justificativa.', pendentes: semJustificativa });
  if (semMedicao.length) return res.status(400).json({ erro: 'Itens com medição numérica obrigatória estão sem valor.', pendentes: semMedicao });

  // Foto obrigatória: ao menos UMA foto enviada e CONFIRMADA no servidor (não confia no cliente)
  const fotos = db.prepare(`SELECT * FROM anexos WHERE inspecao_id = ? AND tipo = 'foto'`).all(insp.id);
  if (fotos.length < 1) {
    return res.status(400).json({ erro: 'É obrigatório registrar ao menos uma foto atual pela câmera ou upload antes de concluir.',
      codigo: 'FOTO_OBRIGATORIA', fotos_confirmadas: 0 });
  }

  const naoConf = respBanco.filter(r => r.valor === 'nao_conforme');
  const temNna = itens.some(it => mapa[it.id]?.valor === 'nao_se_aplica');
  const resultado = naoConf.length ? 'nao_conforme' : (temNna && respBanco.every(r => r.valor !== 'conforme') ? 'nao_se_aplica' : 'conforme');
  const agora = agoraISO();

  db.prepare(`UPDATE inspecoes SET status='concluida', data_conclusao=?, resultado=?, nao_conforme_count=?, atualizado_em=? WHERE id=?`)
    .run(agora, resultado, naoConf.length, agora, insp.id);

  // Cada não conformidade gera uma OCORRÊNCIA com prioridade, responsável, prazo, status e evidência de solução
  const ocorrenciasCriadas = [];
  for (const r of naoConf) {
    const oid = novoId();
    const eq = db.prepare('SELECT responsavel_id FROM equipamentos WHERE id = ?').get(insp.equipamento_id);
    const prazo = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO ocorrencias (id,hospital_id,equipamento_id,inspecao_id,titulo,descricao,providencia,prioridade,
                 responsavel_id,prazo,status,criado_por,criado_em,atualizado_em)
                 VALUES (?,?,?,?,?,?,?,?,?,?, 'aberta', ?,?,?)`)
      .run(oid, insp.hospital_id, insp.equipamento_id, insp.id,
        `Não conformidade: ${r.enunciado.slice(0, 90)}`,
        r.justificativa || r.enunciado,
        r.observacao || 'Providência a definir pelo responsável técnico.',
        'alta', eq?.responsavel_id || null, prazo, req.usuario.id, agora, agora);
    ocorrenciasCriadas.push(oid);
    req.auditar('ocorrencia_automatica', 'ocorrencia', oid, null, { inspecao: insp.id, item: r.item_id });
  }

  // Releitura do servidor = confirmação real (não depende do que o cliente diz)
  const confirmada = db.prepare('SELECT * FROM inspecoes WHERE id = ?').get(insp.id);
  const fotosConfirmadas = db.prepare(`SELECT COUNT(*) AS n FROM anexos WHERE inspecao_id = ? AND tipo = 'foto'`).get(insp.id).n;
  req.auditar('concluir_inspecao', 'inspecao', insp.id, { status: 'rascunho' },
    { status: 'concluida', resultado, nao_conformidades: naoConf.length, fotos: fotosConfirmadas });
  const prox = proximaInspecao(insp.equipamento_id,
    db.prepare('SELECT periodicidade FROM equipamentos WHERE id = ?').get(insp.equipamento_id).periodicidade,
    db.prepare('SELECT data_inicial FROM equipamentos WHERE id = ?').get(insp.equipamento_id).data_inicial);

  res.json({ ok: true, confirmado_pelo_servidor: true, status: confirmada.status,
    data_conclusao: confirmada.data_conclusao, resultado, nao_conformidades: naoConf.length,
    fotos_confirmadas: fotosConfirmadas, ocorrencias_geradas: ocorrenciasCriadas, proxima_inspeccao: prox.proxima });
});

// Retificação auditada de inspeção concluída (histórico permanece imutável; a correção fica registrada)
rotasInspeccoes.post('/inspecoes/:id/retificar', (req, res) => {
  if (!pode(req.usuario.perfil, 'inspecao.retificar'))
    return res.status(403).json({ erro: 'Apenas administrador/gestor podem retificar uma inspeção.' });
  const insp = db.prepare('SELECT * FROM inspecoes WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!insp) return res.status(404).json({ erro: 'Inspeção não encontrada.' });
  if (insp.status === 'rascunho') return res.status(400).json({ erro: 'Rascunho pode ser editado diretamente.' });
  const { motivo, respostas, observacao_geral } = req.body || {};
  if (!motivo?.trim()) return res.status(400).json({ erro: 'Informe o motivo da retificação (obrigatório para auditoria).' });

  const antes = { inspecao: insp, respostas: db.prepare('SELECT * FROM respostas_inspecao WHERE inspecao_id = ?').all(insp.id) };
  const agora = agoraISO();
  if (Array.isArray(respostas)) {
    for (const r of respostas) {
      if (!r.item_id) continue;
      db.prepare(`UPDATE respostas_inspecao SET valor=?, justificativa=?, observacao=?, medicao_num=?, medicao_unidade=?
                  WHERE inspecao_id=? AND item_id=?`)
        .run(r.valor || null, r.justificativa || null, r.observacao || null, r.medicao_num ?? null, r.medicao_unidade || null, insp.id, r.item_id);
    }
  }
  if (observacao_geral !== undefined) db.prepare('UPDATE inspecoes SET observacao_geral=? WHERE id=?').run(observacao_geral || null, insp.id);
  const naoConf = db.prepare(`SELECT COUNT(*) AS n FROM respostas_inspecao WHERE inspecao_id=? AND valor='nao_conforme'`).get(insp.id).n;
  db.prepare(`UPDATE inspecoes SET status='retificada', nao_conforme_count=?, retificada_por=?, retificada_em=?, retificacao_motivo=?, atualizado_em=? WHERE id=?`)
    .run(naoConf, req.usuario.id, agora, motivo.trim(), agora, insp.id);
  const depois = { inspecao: db.prepare('SELECT * FROM inspecoes WHERE id=?').get(insp.id),
    respostas: db.prepare('SELECT * FROM respostas_inspecao WHERE inspecao_id = ?').all(insp.id) };
  req.auditar('retificar_inspecao', 'inspecao', insp.id, antes, depois);
  res.json({ ok: true, retificada: true, motivo: motivo.trim(), nao_conformidades: naoConf });
});

// Listagem/histórico
rotasInspeccoes.get('/inspecoes', (req, res) => {
  const { equipamento_id, desde, ate, status, limite } = req.query;
  const cl = ['i.hospital_id = ?'], vals = [req.usuario.hospital_id];
  if (equipamento_id) { cl.push('i.equipamento_id = ?'); vals.push(equipamento_id); }
  if (status) { cl.push('i.status = ?'); vals.push(status); }
  if (desde) { cl.push('date(i.data_inicio) >= date(?)'); vals.push(desde); }
  if (ate) { cl.push('date(i.data_inicio) <= date(?)'); vals.push(ate); }
  vals.push(Math.min(Number(limite) || 300, 1000));
  res.json(db.prepare(`SELECT i.*, e.nome AS equipamento_nome, e.codigo, u.nome AS usuario_nome,
      (SELECT COUNT(*) FROM anexos a WHERE a.inspecao_id = i.id AND a.tipo='foto') AS fotos
    FROM inspecoes i JOIN equipamentos e ON e.id = i.equipamento_id
    JOIN usuarios u ON u.id = i.usuario_id
    WHERE ${cl.join(' AND ')} ORDER BY i.data_inicio DESC LIMIT ?`).all(...vals));
});

rotasInspeccoes.get('/inspecoes/:id', (req, res) => {
  const insp = db.prepare(`SELECT i.*, e.nome AS equipamento_nome, e.codigo, u.nome AS usuario_nome
    FROM inspecoes i JOIN equipamentos e ON e.id = i.equipamento_id JOIN usuarios u ON u.id = i.usuario_id
    WHERE i.id = ? AND i.hospital_id = ?`).get(req.params.id, req.usuario.hospital_id);
  if (!insp) return res.status(404).json({ erro: 'Inspeção não encontrada.' });
  res.json({ inspecao: insp,
    itens: db.prepare('SELECT * FROM itens_checklist WHERE modelo_id = ? AND ativo = 0 ORDER BY ordem').all(insp.modelo_id)
      .concat(db.prepare('SELECT * FROM itens_checklist WHERE modelo_id = ? AND ativo = 1 ORDER BY ordem').all(insp.modelo_id)),
    respostas: db.prepare('SELECT * FROM respostas_inspecao WHERE inspecao_id = ?').all(insp.id),
    anexos: anexosDe({ inspecao_id: insp.id }) });
});
