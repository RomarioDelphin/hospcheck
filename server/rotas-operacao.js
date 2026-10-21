// HospCheck — rotas de ocorrências, manutenções e calibrações (agendas independentes)
import { Router } from 'express';
import { db, agoraISO, novoId, ehDataValida } from './db.js';
import { pode } from './auth.js';
import { salvarAnexo, anexosDe } from './arquivos.js';

export const rotasOperacao = Router();

// ---------- Ocorrências ----------
rotasOperacao.get('/ocorrencias', (req, res) => {
  const { equipamento_id, status, prioridade, responsavel_id } = req.query;
  const cl = ['o.hospital_id = ?'], vals = [req.usuario.hospital_id];
  if (equipamento_id) { cl.push('o.equipamento_id = ?'); vals.push(equipamento_id); }
  if (status) { cl.push('o.status = ?'); vals.push(status); }
  if (prioridade) { cl.push('o.prioridade = ?'); vals.push(prioridade); }
  if (responsavel_id) { cl.push('o.responsavel_id = ?'); vals.push(responsavel_id); }
  res.json(db.prepare(`SELECT o.*, e.nome AS equipamento_nome, e.codigo, u.nome AS responsavel_nome,
      (SELECT COUNT(*) FROM anexos a WHERE a.ocorrencia_id = o.id) AS anexos
    FROM ocorrencias o JOIN equipamentos e ON e.id = o.equipamento_id
    LEFT JOIN usuarios u ON u.id = o.responsavel_id
    WHERE ${cl.join(' AND ')} ORDER BY CASE o.prioridade WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, o.criado_em DESC`)
    .all(...vals));
});

rotasOperacao.post('/ocorrencias', (req, res) => {
  if (!pode(req.usuario.perfil, 'ocorrencia.abrir') && !pode(req.usuario.perfil, 'ocorrencia.gerir'))
    return res.status(403).json({ erro: 'Sem permissão para abrir ocorrências.' });
  const b = req.body || {};
  const eq = db.prepare('SELECT * FROM equipamentos WHERE id = ? AND hospital_id = ?').get(b.equipamento_id, req.usuario.hospital_id);
  if (!eq) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  if (!b.titulo?.trim() || !b.descricao?.trim()) return res.status(400).json({ erro: 'Título e descrição são obrigatórios.' });
  if (!b.providencia?.trim()) return res.status(400).json({ erro: 'Informe a providência a ser adotada (obrigatório).' });
  const prioridade = b.prioridade || 'media';
  if (!['baixa', 'media', 'alta', 'critica'].includes(prioridade)) return res.status(400).json({ erro: 'Prioridade inválida.' });
  if (b.prazo && !ehDataValida(b.prazo)) return res.status(400).json({ erro: 'Prazo inválido.' });
  const id = novoId(), agora = agoraISO();
  db.prepare(`INSERT INTO ocorrencias (id,hospital_id,equipamento_id,inspecao_id,titulo,descricao,providencia,prioridade,
               responsavel_id,prazo,status,criado_por,criado_em,atualizado_em)
               VALUES (?,?,?,?,?,?,?,?,?,?, 'aberta', ?,?,?)`)
    .run(id, eq.hospital_id, eq.id, b.inspecao_id || null, b.titulo.trim(), b.descricao.trim(), b.providencia.trim(),
      prioridade, b.responsavel_id || eq.responsavel_id || null, b.prazo || null, req.usuario.id, agora, agora);
  req.auditar('criar', 'ocorrencia', id, null, { titulo: b.titulo, prioridade });
  res.status(201).json(db.prepare('SELECT * FROM ocorrencias WHERE id = ?').get(id));
});

rotasOperacao.patch('/ocorrencias/:id', (req, res) => {
  if (!pode(req.usuario.perfil, 'ocorrencia.gerir')) return res.status(403).json({ erro: 'Sem permissão.' });
  const o = db.prepare('SELECT * FROM ocorrencias WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!o) return res.status(404).json({ erro: 'Ocorrência não encontrada.' });
  const b = req.body || {};
  if (b.status && !['aberta', 'em_andamento', 'resolvida', 'cancelada'].includes(b.status)) return res.status(400).json({ erro: 'Status inválido.' });
  if (b.prioridade && !['baixa', 'media', 'alta', 'critica'].includes(b.prioridade)) return res.status(400).json({ erro: 'Prioridade inválida.' });
  if (b.prazo && !ehDataValida(b.prazo)) return res.status(400).json({ erro: 'Prazo inválido.' });
  if (b.status === 'resolvida' && !b.resolucao_descricao?.trim())
    return res.status(400).json({ erro: 'Para resolver, descreva a solução aplicada.' });
  const sets = [], vals = [];
  for (const c of ['titulo', 'descricao', 'providencia', 'prioridade', 'responsavel_id', 'prazo', 'status', 'resolucao_descricao']) {
    if (b[c] !== undefined) { sets.push(`${c} = ?`); vals.push(b[c] || null); }
  }
  if (b.status === 'resolvida') {
    sets.push('resolvida_em = ?', 'resolvida_por = ?'); vals.push(agoraISO(), req.usuario.id);
    if (!b.evidencia_anexo_id) return res.status(400).json({ erro: 'Resolução exige anexar evidência (foto/comprovante/laudo).' });
    const ev = db.prepare('SELECT * FROM anexos WHERE id = ? AND hospital_id = ?').get(b.evidencia_anexo_id, req.usuario.hospital_id);
    if (!ev) return res.status(400).json({ erro: 'Evidência inválida.' });
    sets.push('evidencia_anexo_id = ?'); vals.push(ev.id);
  }
  if (!sets.length) return res.status(400).json({ erro: 'Nada a atualizar.' });
  sets.push('atualizado_em = ?'); vals.push(agoraISO(), o.id);
  db.prepare(`UPDATE ocorrencias SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  req.auditar('atualizar', 'ocorrencia', o.id, o, b);
  res.json(db.prepare('SELECT * FROM ocorrencias WHERE id = ?').get(o.id));
});

// Anexos de evidência (ocorrência)
rotasOperacao.post('/ocorrencias/:id/anexos', (req, res) => {
  const o = db.prepare('SELECT * FROM ocorrencias WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!o) return res.status(404).json({ erro: 'Ocorrência não encontrada.' });
  const b = req.body || {};
  try {
    const a = salvarAnexo({ hospital_id: req.usuario.hospital_id,
      tipo: ['foto', 'comprovante', 'laudo'].includes(b.tipo) ? b.tipo : 'evidencia',
      base64: b.base64, nome_original: b.nome_original, mime: b.mime, legenda: b.legenda,
      equipamento_id: o.equipamento_id, ocorrencia_id: o.id, enviado_por: req.usuario.id });
    req.auditar('anexar_evidencia', 'ocorrencia', o.id, null, { anexo: a.id });
    res.status(201).json({ ok: true, anexo: a });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

// ---------- Manutenções ----------
const CENTAVOS = (valor, { jaEmCentavos = false } = {}) => {
  if (valor === null || valor === undefined || valor === '') return 0;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) return NaN;
  // Aceita tanto valores já em centavos (campo *_centavos) quanto em reais (campo simples).
  return jaEmCentavos ? Math.round(n) : Math.round(n * 100);
};

rotasOperacao.get('/manutencoes', (req, res) => {
  const { equipamento_id, tipo, desde, ate } = req.query;
  const cl = ['m.hospital_id = ?'], vals = [req.usuario.hospital_id];
  if (equipamento_id) { cl.push('m.equipamento_id = ?'); vals.push(equipamento_id); }
  if (tipo) { cl.push('m.tipo = ?'); vals.push(tipo); }
  if (desde) { cl.push('date(m.data) >= date(?)'); vals.push(desde); }
  if (ate) { cl.push('date(m.data) <= date(?)'); vals.push(ate); }
  res.json(db.prepare(`SELECT m.*, e.nome AS equipamento_nome, e.codigo,
      (SELECT COUNT(*) FROM anexos a WHERE a.manutencao_id = m.id) AS anexos
    FROM manutencoes m JOIN equipamentos e ON e.id = m.equipamento_id
    WHERE ${cl.join(' AND ')} ORDER BY m.data DESC`).all(...vals));
});

rotasOperacao.post('/manutencoes', (req, res) => {
  if (!pode(req.usuario.perfil, 'manutencao.registrar')) return res.status(403).json({ erro: 'Sem permissão para registrar manutenções.' });
  const b = req.body || {};
  const eq = db.prepare('SELECT * FROM equipamentos WHERE id = ? AND hospital_id = ?').get(b.equipamento_id, req.usuario.hospital_id);
  if (!eq) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  if (!['preventiva', 'corretiva'].includes(b.tipo)) return res.status(400).json({ erro: 'Tipo inválido (preventiva ou corretiva).' });
  if (!ehDataValida(b.data)) return res.status(400).json({ erro: 'Data inválida.' });
  if (!b.descricao?.trim()) return res.status(400).json({ erro: 'Descrição é obrigatória.' });
  if (b.proxima_data && !ehDataValida(b.proxima_data)) return res.status(400).json({ erro: 'Próxima data inválida.' });
  // Converte cada campo: aceita o valor já em centavos (campo *_centavos) ou em reais (campo simples).
  const conv = (emCentavos, emReais) => emCentavos !== undefined && emCentavos !== null && emCentavos !== ''
    ? CENTAVOS(emCentavos, { jaEmCentavos: true }) : CENTAVOS(emReais);
  const pecas = conv(b.pecas_centavos, b.pecas);
  const mao = conv(b.mao_obra_centavos, b.mao_obra);
  const outros = conv(b.outros_centavos, b.outros);
  if ([pecas, mao, outros].some(Number.isNaN)) return res.status(400).json({ erro: 'Valores monetários inválidos (use números ≥ 0).' });
  const total = pecas + mao + outros;
  const id = novoId(), agora = agoraISO();
  db.prepare(`INSERT INTO manutencoes (id,hospital_id,equipamento_id,tipo,data,empresa,profissional,descricao,
               pecas_centavos,mao_obra_centavos,outros_centavos,total_centavos,proxima_data,criado_por,criado_em,atualizado_em)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, eq.hospital_id, eq.id, b.tipo, b.data, b.empresa || null, b.profissional || null, b.descricao.trim(),
      pecas, mao, outros, total, b.proxima_data || null, req.usuario.id, agora, agora);
  req.auditar('criar', 'manutencao', id, null, { equipamento: eq.codigo, tipo: b.tipo, total_centavos: total });
  res.status(201).json(db.prepare('SELECT * FROM manutencoes WHERE id = ?').get(id));
});

rotasOperacao.post('/manutencoes/:id/anexos', (req, res) => {
  const m = db.prepare('SELECT * FROM manutencoes WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!m) return res.status(404).json({ erro: 'Manutenção não encontrada.' });
  const b = req.body || {};
  try {
    const a = salvarAnexo({ hospital_id: req.usuario.hospital_id,
      tipo: ['comprovante', 'laudo', 'foto'].includes(b.tipo) ? b.tipo : 'comprovante',
      base64: b.base64, nome_original: b.nome_original, mime: b.mime, legenda: b.legenda,
      equipamento_id: m.equipamento_id, manutencao_id: m.id, enviado_por: req.usuario.id });
    res.status(201).json({ ok: true, anexo: a });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

rotasOperacao.delete('/manutencoes/:id', (req, res) => {
  if (!pode(req.usuario.perfil, 'manutencao.registrar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const m = db.prepare('SELECT * FROM manutencoes WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!m) return res.status(404).json({ erro: 'Manutenção não encontrada.' });
  db.prepare('DELETE FROM manutencoes WHERE id = ?').run(m.id);
  req.auditar('excluir', 'manutencao', m.id, m, null);
  res.json({ ok: true });
});

// ---------- Calibrações ----------
rotasOperacao.get('/calibracoes', (req, res) => {
  const { equipamento_id, resultado, desde, ate } = req.query;
  const cl = ['c.hospital_id = ?'], vals = [req.usuario.hospital_id];
  if (equipamento_id) { cl.push('c.equipamento_id = ?'); vals.push(equipamento_id); }
  if (resultado) { cl.push('c.resultado = ?'); vals.push(resultado); }
  if (desde) { cl.push('date(c.data) >= date(?)'); vals.push(desde); }
  if (ate) { cl.push('date(c.data) <= date(?)'); vals.push(ate); }
  res.json(db.prepare(`SELECT c.*, e.nome AS equipamento_nome, e.codigo,
      (SELECT COUNT(*) FROM anexos a WHERE a.calibracao_id = c.id) AS anexos
    FROM calibracoes c JOIN equipamentos e ON e.id = c.equipamento_id
    WHERE ${cl.join(' AND ')} ORDER BY c.data DESC`).all(...vals));
});

rotasOperacao.post('/calibracoes', (req, res) => {
  if (!pode(req.usuario.perfil, 'calibracao.registrar')) return res.status(403).json({ erro: 'Sem permissão para registrar calibrações.' });
  const b = req.body || {};
  const eq = db.prepare('SELECT * FROM equipamentos WHERE id = ? AND hospital_id = ?').get(b.equipamento_id, req.usuario.hospital_id);
  if (!eq) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  if (!ehDataValida(b.data)) return res.status(400).json({ erro: 'Data inválida.' });
  if (!ehDataValida(b.validade)) return res.status(400).json({ erro: 'Validade inválida.' });
  if (b.validade < b.data) return res.status(400).json({ erro: 'A validade não pode ser anterior à data da calibração.' });
  if (!['aprovada', 'reprovada', 'condicional'].includes(b.resultado)) return res.status(400).json({ erro: 'Resultado inválido.' });
  const custo = b.custo_centavos !== undefined && b.custo_centavos !== null && b.custo_centavos !== ''
    ? CENTAVOS(b.custo_centavos, { jaEmCentavos: true }) : CENTAVOS(b.custo);
  if (Number.isNaN(custo)) return res.status(400).json({ erro: 'Custo inválido.' });
  const id = novoId(), agora = agoraISO();
  db.prepare(`INSERT INTO calibracoes (id,hospital_id,equipamento_id,data,validade,resultado,empresa,responsavel,
               custo_centavos,observacao,criado_por,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, eq.hospital_id, eq.id, b.data, b.validade, b.resultado, b.empresa || null, b.responsavel || null,
      custo, b.observacao || null, req.usuario.id, agora, agora);
  // Uma calibração registrada NUNCA renova a agenda de inspeção — agendas são independentes.
  req.auditar('criar', 'calibracao', id, null, { equipamento: eq.codigo, resultado: b.resultado });
  res.status(201).json(db.prepare('SELECT * FROM calibracoes WHERE id = ?').get(id));
});

rotasOperacao.post('/calibracoes/:id/anexos', (req, res) => {
  const c = db.prepare('SELECT * FROM calibracoes WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!c) return res.status(404).json({ erro: 'Calibração não encontrada.' });
  const b = req.body || {};
  try {
    const a = salvarAnexo({ hospital_id: req.usuario.hospital_id,
      tipo: b.tipo === 'certificado' ? 'certificado' : 'certificado',
      base64: b.base64, nome_original: b.nome_original, mime: b.mime, legenda: b.legenda || 'Certificado de calibração',
      equipamento_id: c.equipamento_id, calibracao_id: c.id, enviado_por: req.usuario.id });
    db.prepare('UPDATE calibracoes SET certificado_anexo_id = ? WHERE id = ?').run(a.id, c.id);
    res.status(201).json({ ok: true, anexo: a });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

rotasOperacao.delete('/calibracoes/:id', (req, res) => {
  if (!pode(req.usuario.perfil, 'calibracao.registrar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const c = db.prepare('SELECT * FROM calibracoes WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!c) return res.status(404).json({ erro: 'Calibração não encontrada.' });
  db.prepare('DELETE FROM calibracoes WHERE id = ?').run(c.id);
  req.auditar('excluir', 'calibracao', c.id, c, null);
  res.json({ ok: true });
});

// ---------- Agendas (independentes) ----------
rotasOperacao.get('/agendas', (req, res) => {
  const linhas = db.prepare(`SELECT a.*, e.nome AS equipamento_nome, e.codigo, e.periodicidade
    FROM agendas a JOIN equipamentos e ON e.id = a.equipamento_id
    WHERE a.hospital_id = ? AND e.ativo = 1 ORDER BY e.nome, a.tipo`).all(req.usuario.hospital_id);
  res.json(linhas);
});

rotasOperacao.patch('/agendas/:id', (req, res) => {
  if (!pode(req.usuario.perfil, 'config.editar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const a = db.prepare('SELECT * FROM agendas WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!a) return res.status(404).json({ erro: 'Agenda não encontrada.' });
  const { ativo, intervalo_dias, intervalo_meses, data_base } = req.body || {};
  const sets = [], vals = [];
  if (ativo !== undefined) { sets.push('ativo = ?'); vals.push(ativo ? 1 : 0); }
  if (intervalo_dias !== undefined) { if (intervalo_dias !== null && (!Number.isInteger(intervalo_dias) || intervalo_dias < 1)) return res.status(400).json({ erro: 'Intervalo inválido.' }); sets.push('intervalo_dias = ?'); vals.push(intervalo_dias); }
  if (intervalo_meses !== undefined) { if (intervalo_meses !== null && (!Number.isInteger(intervalo_meses) || intervalo_meses < 1)) return res.status(400).json({ erro: 'Intervalo inválido.' }); sets.push('intervalo_meses = ?'); vals.push(intervalo_meses); }
  if (data_base !== undefined) { if (!ehDataValida(data_base)) return res.status(400).json({ erro: 'Data base inválida.' }); sets.push('data_base = ?'); vals.push(data_base); }
  if (!sets.length) return res.status(400).json({ erro: 'Nada a atualizar.' });
  sets.push('atualizado_em = ?'); vals.push(agoraISO(), a.id);
  db.prepare(`UPDATE agendas SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  req.auditar('atualizar', 'agenda', a.id, a, req.body);
  res.json(db.prepare('SELECT * FROM agendas WHERE id = ?').get(a.id));
});

// ---------- Alertas ----------
rotasOperacao.get('/alertas', async (req, res) => {
  const { gerarAlertas } = await import('./regras.js');
  res.json(gerarAlertas(req.usuario.hospital_id));
});

// Anexo genérico (equipamento, sem inspeção)
rotasOperacao.post('/equipamentos/:id/anexos', (req, res) => {
  const eq = db.prepare('SELECT * FROM equipamentos WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!eq) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  if (!pode(req.usuario.perfil, 'equipamento.editar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const b = req.body || {};
  try {
    // foto_principal é uma FOTO do equipamento (antes era gravada como 'laudo')
    const tipoAnexo = b.tipo === 'foto_principal' ? 'foto' : (['foto', 'laudo'].includes(b.tipo) ? b.tipo : 'laudo');
    const a = salvarAnexo({ hospital_id: req.usuario.hospital_id, tipo: tipoAnexo,
      base64: b.base64, nome_original: b.nome_original, mime: b.mime, legenda: b.legenda,
      equipamento_id: eq.id, enviado_por: req.usuario.id });
    if (b.tipo === 'foto_principal') db.prepare('UPDATE equipamentos SET foto_arquivo_id = ? WHERE id = ?').run(a.id, eq.id);
    res.status(201).json({ ok: true, anexo: a });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

// Servir arquivo privado (nunca público; exige sessão e mesmo hospital)
export async function servirArquivo(req, res) {
  const a = db.prepare('SELECT * FROM anexos WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  if (a.hospital_id !== req.usuario.hospital_id) return res.status(403).json({ erro: 'Acesso negado.' });
  const { caminhoSeguro } = await import('./arquivos.js');
  const fs = await import('node:fs');
  const p = caminhoSeguro(a);
  if (!p || !fs.existsSync(p)) return res.status(404).json({ erro: 'Arquivo ausente no armazenamento.' });
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  // Documentos privados não podem ficar em cache público
  res.setHeader('Cache-Control', 'private, no-store');
  if (a.mime === 'application/pdf') res.setHeader('Content-Disposition', `inline; filename="${(a.nome_original || 'arquivo').replace(/[^\w.\-]/g, '_')}"`);
  fs.createReadStream(p).pipe(res);
}
