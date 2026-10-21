// HospCheck — rotas de equipamentos: CRUD, ficha, QR Code real e etiqueta imprimível
import { Router } from 'express';
import { db, agoraISO, novoId, ehDataValida } from './db.js';
import { pode } from './auth.js';
import { resumoEquipamento, situacaoInspeccao, situacaoCalibracao, situacaoManutencao } from './regras.js';
import { urlEstavelEquipamento, qrDataUrl } from './qr.js';
import { anexosDe } from './arquivos.js';
import { dataBR, brl, pdfLista } from './pdf.js';

export const rotasEquipamentos = Router();

const STATUS = ['operacional', 'restricao', 'interditado', 'manutencao', 'desativado'];
const PERIODOS = ['semanal', 'quinzenal', 'mensal'];

function listarEquipamentos(hospitalId, q = {}) {
  const cl = ['e.hospital_id = ?'], vals = [hospitalId];
  if (q.busca) { cl.push('(e.nome LIKE ? OR e.codigo LIKE ? OR e.serie LIKE ? OR e.patrimonio LIKE ?)'); const like = `%${q.busca}%`; vals.push(like, like, like, like); }
  if (q.setor_id) { cl.push('e.setor_id = ?'); vals.push(q.setor_id); }
  if (q.status) { cl.push('e.status = ?'); vals.push(q.status); }
  if (q.responsavel_id) { cl.push('e.responsavel_id = ?'); vals.push(q.responsavel_id); }
  if (q.tipo) { cl.push('e.tipo = ?'); vals.push(q.tipo); }
  if (q.somente_ativos !== 'nao') cl.push('e.ativo = 1');
  return db.prepare(`SELECT e.*, s.nome AS setor_nome, u.nome AS responsavel_nome
    FROM equipamentos e LEFT JOIN setores s ON s.id = e.setor_id
    LEFT JOIN usuarios u ON u.id = e.responsavel_id
    WHERE ${cl.join(' AND ')} ORDER BY e.nome`).all(...vals);
}

rotasEquipamentos.get('/equipamentos', (req, res) => {
  const lista = listarEquipamentos(req.usuario.hospital_id, req.query).map(e => ({
    ...e, situacao: resumoEquipamento(e)
  }));
  // Filtro por situação de vencimento (em_dia | proxima | vencida)
  const f = req.query.situacao;
  const filtrada = f ? lista.filter(e => e.situacao.inspeccao.situacao === f) : lista;
  res.json(filtrada);
});

rotasEquipamentos.get('/equipamentos/opcoes', (req, res) => {
  const tipos = db.prepare('SELECT DISTINCT tipo FROM equipamentos WHERE hospital_id = ? AND ativo = 1 ORDER BY tipo').all(req.usuario.hospital_id).map(r => r.tipo);
  const setores = db.prepare('SELECT id,nome FROM setores WHERE hospital_id = ? AND ativo = 1 ORDER BY nome').all(req.usuario.hospital_id);
  const usuarios = db.prepare('SELECT id,nome,perfil FROM usuarios WHERE hospital_id = ? AND ativo = 1 ORDER BY nome').all(req.usuario.hospital_id);
  res.json({ tipos, setores, usuarios, status: STATUS, periodicidades: PERIODOS });
});

function buscarEquipamento(req) {
  return db.prepare(`SELECT e.*, s.nome AS setor_nome, s.andar AS setor_andar, u.nome AS responsavel_nome
    FROM equipamentos e LEFT JOIN setores s ON s.id = e.setor_id
    LEFT JOIN usuarios u ON u.id = e.responsavel_id
    WHERE e.hospital_id = ? AND (e.id = ? OR e.codigo = ?)`).get(req.usuario.hospital_id, req.params.id, req.params.id);
}

rotasEquipamentos.get('/equipamentos/:id', (req, res) => {
  const e = buscarEquipamento(req);
  if (!e) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  const inspecoes = db.prepare(`SELECT i.id,i.status,i.resultado,i.data_inicio,i.data_conclusao,i.nao_conforme_count,
      i.observacao_geral,i.modelo_versao,u.nome AS usuario_nome,m.nome AS modelo_nome,
      (SELECT COUNT(*) FROM anexos a WHERE a.inspecao_id = i.id AND a.tipo = 'foto') AS fotos
    FROM inspecoes i JOIN usuarios u ON u.id = i.usuario_id
    LEFT JOIN modelos_checklist m ON m.id = i.modelo_id
    WHERE i.equipamento_id = ? ORDER BY i.data_inicio DESC`).all(e.id);
  res.json({
    equipamento: e,
    resumo: resumoEquipamento(e),
    url_estavel: urlEstavelEquipamento(req, e.id),
    url_por_codigo: urlEstavelEquipamento(req, e.codigo),
    historico: {
      inspecoes,
      manutencoes: db.prepare('SELECT * FROM manutencoes WHERE equipamento_id = ? ORDER BY data DESC').all(e.id),
      calibracoes: db.prepare('SELECT * FROM calibracoes WHERE equipamento_id = ? ORDER BY data DESC').all(e.id),
      ocorrencias: db.prepare(`SELECT o.*, u.nome AS responsavel_nome FROM ocorrencias o
        LEFT JOIN usuarios u ON u.id = o.responsavel_id WHERE o.equipamento_id = ? ORDER BY o.criado_em DESC`).all(e.id)
    },
    anexos: anexosDe({ equipamento_id: e.id }),
    total_gasto_centavos: db.prepare(`SELECT COALESCE((SELECT SUM(total_centavos) FROM manutencoes WHERE equipamento_id = ?),0)
      + COALESCE((SELECT SUM(custo_centavos) FROM calibracoes WHERE equipamento_id = ?),0) AS t`).get(e.id, e.id).t
  });
});

rotasEquipamentos.post('/equipamentos', (req, res) => {
  if (!pode(req.usuario.perfil, 'equipamento.criar')) return res.status(403).json({ erro: 'Sem permissão para criar equipamentos.' });
  const b = req.body || {};
  if (!b.nome?.trim() || !b.codigo?.trim() || !b.tipo?.trim())
    return res.status(400).json({ erro: 'Nome, código e tipo são obrigatórios.' });
  if (!ehDataValida(b.data_inicial)) return res.status(400).json({ erro: 'Data inicial inválida (AAAA-MM-DD).' });
  if (!PERIODOS.includes(b.periodicidade)) return res.status(400).json({ erro: 'Periodicidade inválida.' });
  if (b.status && !STATUS.includes(b.status)) return res.status(400).json({ erro: 'Status inválido.' });
  const dup = db.prepare('SELECT id FROM equipamentos WHERE hospital_id = ? AND lower(codigo) = lower(?)').get(req.usuario.hospital_id, b.codigo.trim());
  if (dup) return res.status(409).json({ erro: `Já existe equipamento com o código "${b.codigo.trim()}".` });
  if (b.setor_id) {
    const s = db.prepare('SELECT id FROM setores WHERE id = ? AND hospital_id = ?').get(b.setor_id, req.usuario.hospital_id);
    if (!s) return res.status(400).json({ erro: 'Setor inválido.' });
  }
  const id = novoId(), agora = agoraISO();
  db.prepare(`INSERT INTO equipamentos (id,hospital_id,codigo,nome,tipo,marca,modelo,serie,patrimonio,setor_id,localizacao,
      responsavel_id,status,periodicidade,data_inicial,ativo,criado_por,criado_em,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.usuario.hospital_id, b.codigo.trim(), b.nome.trim(), b.tipo.trim(), b.marca || null, b.modelo || null,
      b.serie || null, b.patrimonio || null, b.setor_id || null, b.localizacao || null, b.responsavel_id || null,
      b.status || 'operacional', b.periodicidade, b.data_inicial, 1, req.usuario.id, agora, agora);
  // Agenda de inspeção segue a periodicidade; calibração e manutenção recebem agendas independentes.
  const dias = b.periodicidade === 'semanal' ? 7 : b.periodicidade === 'quinzenal' ? 15 : null;
  db.prepare(`INSERT INTO agendas (id,hospital_id,equipamento_id,tipo,ativo,intervalo_dias,intervalo_meses,data_base,criado_em,atualizado_em)
              VALUES (?,?,?,'inspecao',1,?,?,?,?,?)`).run(novoId(), req.usuario.hospital_id, id, dias, b.periodicidade === 'mensal' ? 1 : null, b.data_inicial, agora, agora);
  db.prepare(`INSERT INTO agendas (id,hospital_id,equipamento_id,tipo,ativo,intervalo_dias,intervalo_meses,data_base,criado_em,atualizado_em)
              VALUES (?,?,?,'calibracao',1,NULL,12,?,?,?)`).run(novoId(), req.usuario.hospital_id, id, b.data_inicial, agora, agora);
  db.prepare(`INSERT INTO agendas (id,hospital_id,equipamento_id,tipo,ativo,intervalo_dias,intervalo_meses,data_base,criado_em,atualizado_em)
              VALUES (?,?,?,'manutencao',1,NULL,6,?,?,?)`).run(novoId(), req.usuario.hospital_id, id, b.data_inicial, agora, agora);
  req.auditar('criar', 'equipamento', id, null, { codigo: b.codigo, nome: b.nome });
  res.status(201).json(db.prepare('SELECT * FROM equipamentos WHERE id = ?').get(id));
});

rotasEquipamentos.patch('/equipamentos/:id', (req, res) => {
  const e = buscarEquipamento(req); if (!e) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  const b = req.body || {};
  const trocouStatus = b.status && b.status !== e.status;
  if (trocouStatus && !pode(req.usuario.perfil, 'equipamento.status'))
    return res.status(403).json({ erro: 'Apenas perfis autorizados (administrador/gestor) podem liberar ou interditar um equipamento.' });
  if (!trocouStatus && !pode(req.usuario.perfil, 'equipamento.editar'))
    return res.status(403).json({ erro: 'Sem permissão para editar equipamentos.' });
  if (b.status && !STATUS.includes(b.status)) return res.status(400).json({ erro: 'Status inválido.' });
  if (b.periodicidade && !PERIODOS.includes(b.periodicidade)) return res.status(400).json({ erro: 'Periodicidade inválida.' });
  if (b.data_inicial && !ehDataValida(b.data_inicial)) return res.status(400).json({ erro: 'Data inicial inválida.' });
  if (b.codigo && b.codigo.trim().toLowerCase() !== e.codigo.toLowerCase()) {
    const dup = db.prepare('SELECT id FROM equipamentos WHERE hospital_id = ? AND lower(codigo) = lower(?) AND id <> ?')
      .get(req.usuario.hospital_id, b.codigo.trim(), e.id);
    if (dup) return res.status(409).json({ erro: 'Já existe equipamento com este código.' });
  }
  const mapa = { codigo: 'codigo', nome: 'nome', tipo: 'tipo', marca: 'marca', modelo: 'modelo', serie: 'serie',
    patrimonio: 'patrimonio', setor_id: 'setor_id', localizacao: 'localizacao', responsavel_id: 'responsavel_id',
    status: 'status', periodicidade: 'periodicidade', data_inicial: 'data_inicial', ativo: 'ativo' };
  const sets = [], vals = [];
  for (const [k, col] of Object.entries(mapa)) if (b[k] !== undefined) { sets.push(`${col} = ?`); vals.push(b[k] === null ? null : (typeof b[k] === 'string' ? b[k].trim() : b[k])); }
  if (!sets.length) return res.status(400).json({ erro: 'Nada a atualizar.' });
  sets.push('atualizado_em = ?'); vals.push(agoraISO(), e.id);
  db.prepare(`UPDATE equipamentos SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  if (b.periodicidade && b.periodicidade !== e.periodicidade) {
    const dias = b.periodicidade === 'semanal' ? 7 : b.periodicidade === 'quinzenal' ? 15 : null;
    db.prepare(`UPDATE agendas SET intervalo_dias = ?, intervalo_meses = ?, atualizado_em = ? WHERE equipamento_id = ? AND tipo = 'inspecao'`)
      .run(dias, b.periodicidade === 'mensal' ? 1 : null, agoraISO(), e.id);
  }
  if (trocouStatus) req.auditar(`status_${e.status}_para_${b.status}`, 'equipamento', e.id, { status: e.status }, { status: b.status, motivo: b.motivo || null });
  else req.auditar('atualizar', 'equipamento', e.id, e, b);
  res.json(db.prepare('SELECT * FROM equipamentos WHERE id = ?').get(e.id));
});

// Liberação/interdição explícita com justificativa obrigatória
rotasEquipamentos.post('/equipamentos/:id/status', (req, res) => {
  if (!pode(req.usuario.perfil, 'equipamento.status'))
    return res.status(403).json({ erro: 'Apenas administrador/gestor podem liberar ou interditar equipamentos.' });
  const e = buscarEquipamento(req); if (!e) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  const { status, motivo } = req.body || {};
  if (!STATUS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  if ((status === 'interditado' || status === 'operacional') && !motivo?.trim())
    return res.status(400).json({ erro: 'Informe o motivo/justificativa da interdição ou liberação.' });
  db.prepare('UPDATE equipamentos SET status = ?, atualizado_em = ? WHERE id = ?').run(status, agoraISO(), e.id);
  req.auditar(`status_${e.status}_para_${status}`, 'equipamento', e.id, { status: e.status }, { status, motivo });
  res.json({ ok: true, status, anterior: e.status });
});

// ---------- QR Code real ----------
rotasEquipamentos.get('/equipamentos/:id/qr.png', async (req, res) => {
  const e = buscarEquipamento(req); if (!e) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  const url = urlEstavelEquipamento(req, e.id);
  const QRCode = (await import('qrcode')).default;
  const buf = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: Number(req.query.tamanho) || 480,
    color: { dark: '#0B3D6B', light: '#FFFFFF' } });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(buf);
});

// Etiqueta imprimível (PDF) com nome, código, hospital e QR
rotasEquipamentos.get('/equipamentos/:id/etiqueta.pdf', async (req, res) => {
  const e = buscarEquipamento(req); if (!e) return res.status(404).json({ erro: 'Equipamento não encontrado.' });
  const h = db.prepare('SELECT * FROM hospitais WHERE id = ?').get(req.usuario.hospital_id);
  const url = urlEstavelEquipamento(req, e.id);
  const QRCode = (await import('qrcode')).default;
  const { default: PDFDocument } = await import('pdfkit');
  const doc = new PDFDocument({ size: [280, 190], margin: 12 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="etiqueta-${e.codigo}.pdf"`);
  doc.pipe(res);
  doc.rect(4, 4, 272, 182).lineWidth(2).stroke('#0B3D6B');
  doc.fillColor('#0B3D6B').font('Helvetica-Bold').fontSize(11).text(h.nome, 14, 16, { width: 170 });
  doc.fillColor('#12856B').font('Helvetica-Bold').fontSize(16).text(e.nome, 14, 34, { width: 170 });
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(12).text(`Código: ${e.codigo}`, 14, 62, { width: 170 });
  doc.font('Helvetica').fontSize(9).fillColor('#333')
    .text(`${e.setor_nome ? e.setor_nome + ' — ' : ''}${e.localizacao || ''}`, 14, 78, { width: 170 })
    .text(`Patrimônio: ${e.patrimonio || '—'}`, 14, 92, { width: 170 })
    .text(`Leia o QR para abrir a ficha`, 14, 106, { width: 170 });
  doc.fontSize(6.5).fillColor('#666').text(url, 14, 150, { width: 170 });
  const png = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: 130, color: { dark: '#0B3D6B', light: '#FFFFFF' } });
  doc.image(png, 195, 40, { width: 130 });
  doc.end();
});

// Resolução de URL estável /e/:id — pública apenas para confirmar existência; dados exigem login
export function resolverEquipamentoPublico(req, res) {
  const alvo = req.params.id;
  const eq = db.prepare('SELECT id, codigo, nome, ativo FROM equipamentos WHERE id = ? OR (hospital_id = ? AND codigo = ?)')
    .get(alvo, req.query.hospital_id || '', alvo);
  if (!eq) return res.status(404).json({ erro: 'QR não corresponde a nenhum equipamento.', codigo: 'NAO_ENCONTRADO' });
  // Não expõe dados privados: apenas sinaliza que é válido e que login é necessário.
  res.json({ valido: true, requer_login: true, destino: `/equipamentos/${eq.id}` });
}
