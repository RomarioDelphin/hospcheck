// HospCheck — dashboard real, filtros, relatórios PDF (reais) e exportação CSV/Excel
import { Router } from 'express';
import { db, hojeSP, addDias, addMeses, diffDias } from './db.js';
import { pode } from './auth.js';
import { resumoEquipamento, gerarAlertas } from './regras.js';
import { anexosDe } from './arquivos.js';
import { pdfEquipamento, pdfLista, brl, dataBR } from './pdf.js';

export const rotasRelatorios = Router();

function periodoPadrao(query) {
  const hoje = hojeSP();
  const ate = query.ate || hoje;
  const desde = query.desde || addDias(ate, -90);
  return { desde, ate };
}

// Filtro comum: período, setor, equipamento, responsável, status
function filtroEquipamentos(req) {
  const q = req.query;
  const cl = ['e.hospital_id = ?'], vals = [req.usuario.hospital_id];
  if (q.setor_id) { cl.push('e.setor_id = ?'); vals.push(q.setor_id); }
  if (q.equipamento_id) { cl.push('e.id = ?'); vals.push(q.equipamento_id); }
  if (q.responsavel_id) { cl.push('e.responsavel_id = ?'); vals.push(q.responsavel_id); }
  if (q.status) { cl.push('e.status = ?'); vals.push(q.status); }
  if (q.somente_ativos !== 'nao') cl.push('e.ativo = 1');
  return { cl, vals };
}

rotasRelatorios.get('/dashboard', (req, res) => {
  const { desde, ate } = periodoPadrao(req.query);
  const { cl, vals } = filtroEquipamentos(req);
  const eqs = db.prepare(`SELECT e.*, s.nome AS setor_nome, u.nome AS responsavel_nome
    FROM equipamentos e LEFT JOIN setores s ON s.id = e.setor_id
    LEFT JOIN usuarios u ON u.id = e.responsavel_id WHERE ${cl.join(' AND ')} ORDER BY e.nome`).all(...vals);
  const hoje = hojeSP();

  let emDia = 0, proximas = 0, vencidas = 0, nunca = 0;
  const porSetor = {};
  const alertasCalc = gerarAlertas(req.usuario.hospital_id, hoje);
  const mapaAlerta = new Map(alertasCalc.alertas.filter(a => a.tipo.startsWith('inspecao')).map(a => [a.equipamento_id, a]));

  for (const e of eqs) {
    const s = resumoEquipamento(e, hoje);
    e._resumo = s;
    if (s.inspeccao.situacao === 'em_dia') emDia++;
    else if (s.inspeccao.situacao === 'proxima') proximas++;
    else if (s.inspeccao.situacao === 'vencida') vencidas++;
    else nunca++;
    const nome = e.setor_nome || 'Sem setor';
    porSetor[nome] = porSetor[nome] || { setor: nome, total: 0, em_dia: 0, vencidas: 0, proximas: 0 };
    porSetor[nome].total++;
    if (s.inspeccao.situacao === 'em_dia') porSetor[nome].em_dia++;
    else if (s.inspeccao.situacao === 'vencidas' || s.inspeccao.situacao === 'vencida') porSetor[nome].vencidas++;
    else if (s.inspeccao.situacao === 'proxima') porSetor[nome].proximas++;
  }

  const ids = eqs.map(e => e.id);
  const inIds = ids.length ? ` AND equipamento_id IN (${ids.map(() => '?').join(',')})` : '';
  const gastosMes = db.prepare(`SELECT COALESCE(SUM(total_centavos),0) AS t FROM manutencoes
      WHERE hospital_id = ? AND date(data) >= date(?) AND date(data) <= (?)${inIds}`)
    .get(req.usuario.hospital_id, desde, ate, ...ids);
  const gastosCal = db.prepare(`SELECT COALESCE(SUM(custo_centavos),0) AS t FROM calibracoes
      WHERE hospital_id = ? AND date(data) >= date(?) AND date(data) <= (?)${inIds}`)
    .get(req.usuario.hospital_id, desde, ate, ...ids);

  // Evolução mensal dos gastos (12 meses)
  const evolucao = [];
  for (let i = 11; i >= 0; i--) {
    const mes = addMeses(hoje, -i).slice(0, 7);
    const m = db.prepare(`SELECT COALESCE(SUM(total_centavos),0) AS t FROM manutencoes
      WHERE hospital_id = ? AND substr(data,1,7) = ?${ids.length ? ` AND equipamento_id IN (${ids.map(() => '?').join(',')})` : ''}`)
      .get(req.usuario.hospital_id, mes, ...ids).t;
    const c = db.prepare(`SELECT COALESCE(SUM(custo_centavos),0) AS t FROM calibracoes
      WHERE hospital_id = ? AND substr(data,1,7) = ?${ids.length ? ` AND equipamento_id IN (${ids.map(() => '?').join(',')})` : ''}`)
      .get(req.usuario.hospital_id, mes, ...ids).t;
    evolucao.push({ mes, manutencao_centavos: m, calibracao_centavos: c, total_centavos: m + c });
  }

  // Equipamentos de maior custo
  const maiorCusto = ids.length ? db.prepare(`SELECT e.id, e.nome, e.codigo,
      COALESCE((SELECT SUM(total_centavos) FROM manutencoes m WHERE m.equipamento_id = e.id),0) AS manutencao_centavos,
      COALESCE((SELECT SUM(custo_centavos) FROM calibracoes c WHERE c.equipamento_id = e.id),0) AS calibracao_centavos
    FROM equipamentos e WHERE e.id IN (${ids.map(() => '?').join(',')})
    ORDER BY (manutencao_centavos + calibracao_centavos) DESC LIMIT 8`).all(...ids) : [];

  // Pontualidade: inspeções concluídas até o vencimento no período (cálculo em JS, sobre o histórico)
  const inspPeriodo = ids.length ? db.prepare(`SELECT i.id, i.equipamento_id, i.data_inicio,
      e.periodicidade, e.data_inicial,
      (SELECT MAX(i2.data_inicio) FROM inspecoes i2 WHERE i2.equipamento_id = i.equipamento_id
        AND i2.status = 'concluida' AND i2.data_inicio < i.data_inicio) AS anterior
    FROM inspecoes i JOIN equipamentos e ON e.id = i.equipamento_id
    WHERE i.hospital_id = ? AND i.status = 'concluida'
      AND date(i.data_inicio) >= date(?) AND date(i.data_inicio) <= (?)${inIds}
    ORDER BY i.equipamento_id, i.data_inicio`).all(req.usuario.hospital_id, desde, ate, ...ids) : [];

  let pontual = 0;
  for (const i of inspPeriodo) {
    const base = (i.anterior || i.data_inicial).slice(0, 10);
    let vencimento;
    if (i.periodicidade === 'semanal') vencimento = addDias(base, 7);
    else if (i.periodicidade === 'quinzenal') vencimento = addDias(base, 15);
    else vencimento = addMeses(base, 1);
    if (i.data_inicio.slice(0, 10) <= vencimento) pontual++;
  }
  const totalInsp = inspPeriodo.length;
  const atrasadas = totalInsp - pontual;
  const pontualidade = totalInsp ? Math.round((pontual / totalInsp) * 1000) / 10 : null;

  const ocorrenciasAbertas = db.prepare(`SELECT COUNT(*) AS n FROM ocorrencias WHERE hospital_id = ?
      AND status IN ('aberta','em_andamento')${ids.length ? ` AND equipamento_id IN (${ids.map(() => '?').join(',')})` : ''}`)
    .get(req.usuario.hospital_id, ...ids).n;
  const ocorrenciasCriticas = db.prepare(`SELECT COUNT(*) AS n FROM ocorrencias WHERE hospital_id = ?
      AND status IN ('aberta','em_andamento') AND prioridade = 'critica'${ids.length ? ` AND equipamento_id IN (${ids.map(() => '?').join(',')})` : ''}`)
    .get(req.usuario.hospital_id, ...ids).n;
  const calibracoesVencidas = eqs.filter(e => e._resumo.calibracao.situacao === 'vencida').length;
  const calibracoesProximas = eqs.filter(e => e._resumo.calibracao.situacao === 'proxima').length;
  const interditados = eqs.filter(e => e.status === 'interditado').length;
  const emManutencao = eqs.filter(e => e.status === 'manutencao').length;
  const manutProgramadas = eqs.filter(e => e._resumo.manutencao.situacao === 'proxima' || e._resumo.manutencao.situacao === 'vencida').length;

  res.json({
    periodo: { desde, ate }, total_equipamentos: eqs.length,
    ativos_operacionais: eqs.filter(e => e.status === 'operacional').length,
    restricoes: eqs.filter(e => e.status === 'restricao').length,
    inspecoes: { em_dia: emDia, proximas, vencidas, nunca },
    calibracoes: { vencidas: calibracoesVencidas, proximas: calibracoesProximas },
    manutencao: { programadas: manutProgramadas, em_andamento: emManutencao },
    ocorrencias: { abertas: ocorrenciasAbertas, criticas: ocorrenciasCriticas },
    interditados,
    gastos: { manutencao_centavos: gastosMes.t || 0, calibracao_centavos: gastosCal.t || 0,
      total_centavos: (gastosMes.t || 0) + (gastosCal.t || 0) },
    pontualidade_pct: pontualidade,
    inspecoes_no_periodo: totalInsp, inspecoes_atrasadas: atrasadas,
    por_setor: Object.values(porSetor),
    evolucao_gastos: evolucao,
    maior_custo: maiorCusto.map(m => ({ ...m, total_centavos: m.manutencao_centavos + m.calibracao_centavos })),
    alertas: { total: alertasCalc.total, criticos: alertasCalc.criticos, atencao: alertasCalc.atencao },
    equipamentos: eqs.map(e => ({ ...e, resumo: e._resumo })).slice(0, 200)
  });
});

// ---------- Relatórios PDF ----------
function descricaoFiltros(req, periodo) {
  const partes = [`período ${dataBR(periodo.desde)} a ${dataBR(periodo.ate)}`];
  if (req.query.setor_id) {
    const s = db.prepare('SELECT nome FROM setores WHERE id = ?').get(req.query.setor_id);
    partes.push(`setor ${s?.nome || req.query.setor_id}`);
  }
  if (req.query.responsavel_id) {
    const u = db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(req.query.responsavel_id);
    partes.push(`responsável ${u?.nome || req.query.responsavel_id}`);
  }
  if (req.query.status) partes.push(`status ${req.query.status}`);
  if (req.query.situacao) partes.push(`situação ${req.query.situacao}`);
  return partes.join(' • ');
}

rotasRelatorios.get('/relatorios/pdf', (req, res) => {
  if (!pode(req.usuario.perfil, 'relatorio.gerar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const hospital = db.prepare('SELECT * FROM hospitais WHERE id = ?').get(req.usuario.hospital_id);
  const periodo = periodoPadrao(req.query);
  const filtros = descricaoFiltros(req, periodo);
  const tipo = req.query.tipo || 'hospital';
  const { cl, vals } = filtroEquipamentos(req);

  if (tipo === 'equipamento') {
    const eq = db.prepare(`SELECT e.*, s.nome AS setor_nome, u.nome AS responsavel_nome FROM equipamentos e
      LEFT JOIN setores s ON s.id = e.setor_id LEFT JOIN usuarios u ON u.id = e.responsavel_id WHERE e.id = ? AND e.hospital_id = ?`)
      .get(req.query.equipamento_id, req.usuario.hospital_id);
    if (!eq) return res.status(404).json({ erro: 'Informe equipamento_id válido.' });
    const doc = pdfEquipamento({
      hospital, equipamento: eq, resumo: resumoEquipamento(eq), filtros,
      historico: {
        inspecoes: db.prepare(`SELECT i.*, u.nome AS usuario_nome FROM inspecoes i JOIN usuarios u ON u.id=i.usuario_id
          WHERE i.equipamento_id = ? ORDER BY i.data_inicio DESC`).all(eq.id),
        manutencoes: db.prepare('SELECT * FROM manutencoes WHERE equipamento_id = ? ORDER BY data DESC').all(eq.id),
        calibracoes: db.prepare('SELECT * FROM calibracoes WHERE equipamento_id = ? ORDER BY data DESC').all(eq.id),
        ocorrencias: db.prepare(`SELECT o.*, u.nome AS responsavel_nome FROM ocorrencias o LEFT JOIN usuarios u ON u.id=o.responsavel_id
          WHERE o.equipamento_id = ? ORDER BY o.criado_em DESC`).all(eq.id)
      },
      anexos: anexosDe({ equipamento_id: eq.id }),
      // base dos links de NF/recibos/comprovantes impressos no PDF
      origem: `${req.protocol}://${req.get('host')}`
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="hospcheck-equipamento-${eq.codigo}.pdf"`);
    doc.pipe(res); doc.end(); return;
  }

  const eqs = db.prepare(`SELECT e.*, s.nome AS setor_nome, u.nome AS responsavel_nome FROM equipamentos e
    LEFT JOIN setores s ON s.id = e.setor_id LEFT JOIN usuarios u ON u.id = e.responsavel_id
    WHERE ${cl.join(' AND ')} ORDER BY e.nome`).all(...vals);
  const hoje = hojeSP();

  if (tipo === 'setor' || tipo === 'hospital') {
    const titulo = tipo === 'setor' && req.query.setor_id
      ? `Relatório do Setor ${db.prepare('SELECT nome FROM setores WHERE id=?').get(req.query.setor_id)?.nome || ''}`
      : 'Relatório Geral do Hospital';
    const linhas = eqs.map(e => {
      const r = resumoEquipamento(e, hoje);
      return [e.codigo, e.nome, e.setor_nome || '—', e.responsavel_nome || '—', e.status,
        dataBR(r.inspeccao.proxima), r.inspeccao.rotulo, dataBR(r.calibracao.proxima), brl(r.gasto_total_centavos)];
    });
    const totais = eqs.reduce((acc, e) => acc + resumoEquipamento(e, hoje).gasto_total_centavos, 0);
    const doc = pdfLista({
      hospital, titulo, filtros, cabecalhos: ['Código', 'Equipamento', 'Setor', 'Responsável', 'Status', 'Próx. inspeção', 'Situação', 'Calibração', 'Gasto total'],
      larguras: [52, 150, 90, 90, 62, 62, 62, 62, 70],
      indic: [
        { valor: eqs.length, rotulo: 'Equipamentos' },
        { valor: eqs.filter(e => resumoEquipamento(e, hoje).inspeccao.situacao === 'em_dia').length, rotulo: 'Inspeções em dia' },
        { valor: eqs.filter(e => resumoEquipamento(e, hoje).inspeccao.situacao === 'vencida').length, rotulo: 'Inspeções vencidas' },
        { valor: brl(totais), rotulo: 'Gasto total no recorte' }
      ],
      linhas,
      nota: `Totais derivados de valores em centavos e convertidos para BRL. Equipamentos listados: ${eqs.length}. Soma de gastos (manutenção + calibração): ${brl(totais)}.`
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="hospcheck-${tipo}.pdf"`);
    doc.pipe(res); doc.end(); return;
  }

  if (tipo === 'vencimentos') {
    const linhas = eqs.map(e => {
      const r = resumoEquipamento(e, hoje);
      return [e.codigo, e.nome, e.setor_nome || '—', e.periodicidade, dataBR(r.inspeccao.proxima),
        r.inspeccao.rotulo + (r.inspeccao.atraso_dias ? ` (${r.inspeccao.atraso_dias}d)` : ''),
        dataBR(r.calibracao.proxima), r.calibracao.rotulo, dataBR(r.manutencao.proxima), r.manutencao.rotulo];
    });
    const doc = pdfLista({
      hospital, titulo: 'Relatório de Vencimentos', filtros,
      cabecalhos: ['Código', 'Equipamento', 'Setor', 'Period.', 'Próx. inspeção', 'Situação', 'Calibração', 'Situação', 'Manutenção', 'Situação'],
      larguras: [48, 120, 70, 45, 62, 78, 62, 70, 62, 70],
      indic: [
        { valor: eqs.filter(e => resumoEquipamento(e, hoje).inspeccao.situacao === 'vencida').length, rotulo: 'Inspeções vencidas' },
        { valor: eqs.filter(e => resumoEquipamento(e, hoje).calibracao.situacao === 'vencida').length, rotulo: 'Calibrações vencidas' },
        { valor: eqs.filter(e => resumoEquipamento(e, hoje).manutencao.situacao === 'vencida').length, rotulo: 'Manutenções vencidas' },
        { valor: eqs.length, rotulo: 'Total' }
      ],
      linhas,
      nota: 'Checklist de inspeção NÃO renova calibração: agendas são independentes.'
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="hospcheck-vencimentos.pdf"');
    doc.pipe(res); doc.end(); return;
  }

  if (tipo === 'ocorrencias') {
    const cl2 = ['o.hospital_id = ?'], vals2 = [req.usuario.hospital_id];
    if (req.query.equipamento_id) { cl2.push('o.equipamento_id = ?'); vals2.push(req.query.equipamento_id); }
    if (req.query.status) { cl2.push('o.status = ?'); vals2.push(req.query.status); }
    if (req.query.prioridade) { cl2.push('o.prioridade = ?'); vals2.push(req.query.prioridade); }
    const ocs = db.prepare(`SELECT o.*, e.nome AS equipamento_nome, e.codigo, u.nome AS responsavel_nome
      FROM ocorrencias o JOIN equipamentos e ON e.id = o.equipamento_id
      LEFT JOIN usuarios u ON u.id = o.responsavel_id WHERE ${cl2.join(' AND ')} ORDER BY o.criado_em DESC`).all(...vals2);
    const doc = pdfLista({
      hospital, titulo: 'Relatório de Ocorrências', filtros,
      cabecalhos: ['Data', 'Equipamento', 'Título', 'Prioridade', 'Status', 'Responsável', 'Prazo'],
      larguras: [58, 110, 150, 58, 58, 70, 58],
      indic: [
        { valor: ocs.length, rotulo: 'Ocorrências' },
        { valor: ocs.filter(o => o.status === 'aberta' || o.status === 'em_andamento').length, rotulo: 'Pendentes' },
        { valor: ocs.filter(o => o.prioridade === 'critica').length, rotulo: 'Críticas' },
        { valor: ocs.filter(o => o.status === 'resolvida').length, rotulo: 'Resolvidas' }
      ],
      linhas: ocs.map(o => [dataBR(o.criado_em), `${o.codigo} ${o.equipamento_nome}`, o.titulo, o.prioridade, o.status, o.responsavel_nome || '—', dataBR(o.prazo)])
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="hospcheck-ocorrencias.pdf"');
    doc.pipe(res); doc.end(); return;
  }

  if (tipo === 'gastos') {
    const ms = db.prepare(`SELECT m.*, e.nome AS equipamento_nome, e.codigo FROM manutencoes m
      JOIN equipamentos e ON e.id = m.equipamento_id WHERE m.hospital_id = ?
      AND date(m.data) >= date(?) AND date(m.data) <= date(?) ORDER BY m.data DESC`).all(req.usuario.hospital_id, periodo.desde, periodo.ate);
    const cs = db.prepare(`SELECT c.*, e.nome AS equipamento_nome, e.codigo FROM calibracoes c
      JOIN equipamentos e ON e.id = c.equipamento_id WHERE c.hospital_id = ?
      AND date(c.data) >= date(?) AND date(c.data) <= date(?) ORDER BY c.data DESC`).all(req.usuario.hospital_id, periodo.desde, periodo.ate);
    const totalM = ms.reduce((s, m) => s + m.total_centavos, 0);
    const totalC = cs.reduce((s, c) => s + c.custo_centavos, 0);
    const doc = pdfLista({
      hospital, titulo: 'Relatório de Gastos', filtros,
      cabecalhos: ['Data', 'Tipo', 'Equipamento', 'Empresa/Profissional', 'Peças', 'Mão de obra', 'Outros', 'Total'],
      larguras: [55, 55, 130, 120, 55, 62, 50, 68],
      indic: [
        { valor: brl(totalM), rotulo: 'Manutenções' },
        { valor: brl(totalC), rotulo: 'Calibrações' },
        { valor: brl(totalM + totalC), rotulo: 'Total do período' },
        { valor: ms.length + cs.length, rotulo: 'Registros' }
      ],
      linhas: [
        ...ms.map(m => [dataBR(m.data), `Manut. ${m.tipo}`, `${m.codigo} ${m.equipamento_nome}`, `${m.empresa || '—'}/${m.profissional || '—'}`,
          brl(m.pecas_centavos), brl(m.mao_obra_centavos), brl(m.outros_centavos), brl(m.total_centavos)]),
        ...cs.map(c => [dataBR(c.data), 'Calibração', `${c.codigo} ${c.equipamento_nome}`, `${c.empresa || '—'}/${c.responsavel || '—'}`,
          '—', '—', brl(c.custo_centavos), brl(c.custo_centavos)])
      ],
      nota: `TOTAL MANUTENÇÕES: ${brl(totalM)} | TOTAL CALIBRAÇÕES: ${brl(totalC)} | TOTAL GERAL: ${brl(totalM + totalC)}`
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="hospcheck-gastos.pdf"');
    doc.pipe(res); doc.end(); return;
  }

  res.status(400).json({ erro: 'Tipo de relatório inválido (equipamento|setor|hospital|vencimentos|ocorrencias|gastos).' });
});

// ---------- Exportação CSV / Excel ----------
rotasRelatorios.get('/relatorios/csv', (req, res) => {
  if (!pode(req.usuario.perfil, 'exportar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const relatorio = req.query.relatorio || 'equipamentos';
  const { desde, ate } = periodoPadrao(req.query);
  const hid = req.usuario.hospital_id;
  let cabecalhos, linhas, nomeArq;

  if (relatorio === 'equipamentos') {
    const { cl, vals } = filtroEquipamentos(req);
    const eqs = db.prepare(`SELECT e.*, s.nome AS setor_nome, u.nome AS responsavel_nome FROM equipamentos e
      LEFT JOIN setores s ON s.id = e.setor_id LEFT JOIN usuarios u ON u.id = e.responsavel_id
      WHERE ${cl.join(' AND ')} ORDER BY e.nome`).all(...vals);
    cabecalhos = ['UUID', 'Codigo', 'Nome', 'Tipo', 'Marca', 'Modelo', 'Serie', 'Patrimonio', 'Setor', 'Localizacao', 'Responsavel', 'Status', 'Periodicidade', 'Data inicial'];
    linhas = eqs.map(e => [e.id, e.codigo, e.nome, e.tipo, e.marca, e.modelo, e.serie, e.patrimonio, e.setor_nome, e.localizacao, e.responsavel_nome, e.status, e.periodicidade, e.data_inicial]);
    nomeArq = 'equipamentos';
  } else if (relatorio === 'inspecoes') {
    const { cl, vals } = filtroEquipamentos(req);
    const ids = eqsIds(cl, vals);
    const insp = db.prepare(`SELECT i.*, e.codigo, e.nome AS equipamento_nome, u.nome AS inspetor FROM inspecoes i
      JOIN equipamentos e ON e.id = i.equipamento_id JOIN usuarios u ON u.id = i.usuario_id
      WHERE i.hospital_id = ? AND date(i.data_inicio) >= date(?) AND date(i.data_inicio) <= date(?)${ids.length ? ` AND i.equipamento_id IN (${ids.map(() => '?').join(',')})` : ''}
      ORDER BY i.data_inicio DESC`).all(hid, desde, ate, ...ids);
    cabecalhos = ['Codigo', 'Equipamento', 'Data inicio', 'Data conclusao', 'Status', 'Resultado', 'Inspetor', 'Nao conformidades', 'Fotos'];
    linhas = insp.map(i => [i.codigo, i.equipamento_nome, i.data_inicio, i.data_conclusao, i.status, i.resultado, i.inspetor, i.nao_conforme_count,
      db.prepare(`SELECT COUNT(*) AS n FROM anexos WHERE inspecao_id = ? AND tipo='foto'`).get(i.id).n]);
    nomeArq = 'inspecoes';
  } else if (relatorio === 'manutencoes') {
    const ms = db.prepare(`SELECT m.*, e.codigo, e.nome AS equipamento_nome FROM manutencoes m
      JOIN equipamentos e ON e.id = m.equipamento_id WHERE m.hospital_id = ?
      AND date(m.data) >= date(?) AND date(m.data) <= date(?) ORDER BY m.data DESC`).all(hid, desde, ate);
    cabecalhos = ['Data', 'Tipo', 'Codigo', 'Equipamento', 'Empresa', 'Profissional', 'Descricao', 'Pecas (centavos)', 'Mao de obra (centavos)', 'Outros (centavos)', 'Total (centavos)', 'Total (BRL)', 'Proxima data'];
    linhas = ms.map(m => [m.data, m.tipo, m.codigo, m.equipamento_nome, m.empresa, m.profissional, m.descricao,
      m.pecas_centavos, m.mao_obra_centavos, m.outros_centavos, m.total_centavos, (m.total_centavos / 100).toFixed(2), m.proxima_data]);
    nomeArq = 'manutencoes';
  } else if (relatorio === 'calibracoes') {
    const cs = db.prepare(`SELECT c.*, e.codigo, e.nome AS equipamento_nome FROM calibracoes c
      JOIN equipamentos e ON e.id = c.equipamento_id WHERE c.hospital_id = ?
      AND date(c.data) >= date(?) AND date(c.data) <= date(?) ORDER BY c.data DESC`).all(hid, desde, ate);
    cabecalhos = ['Data', 'Validade', 'Resultado', 'Codigo', 'Equipamento', 'Empresa', 'Responsavel', 'Custo (centavos)', 'Custo (BRL)'];
    linhas = cs.map(c => [c.data, c.validade, c.resultado, c.codigo, c.equipamento_nome, c.empresa, c.responsavel, c.custo_centavos, (c.custo_centavos / 100).toFixed(2)]);
    nomeArq = 'calibracoes';
  } else if (relatorio === 'ocorrencias') {
    const os = db.prepare(`SELECT o.*, e.codigo, e.nome AS equipamento_nome, u.nome AS responsavel FROM ocorrencias o
      JOIN equipamentos e ON e.id = o.equipamento_id LEFT JOIN usuarios u ON u.id = o.responsavel_id
      WHERE o.hospital_id = ? ORDER BY o.criado_em DESC`).all(hid);
    cabecalhos = ['Data', 'Codigo', 'Equipamento', 'Titulo', 'Descricao', 'Providencia', 'Prioridade', 'Status', 'Responsavel', 'Prazo', 'Resolvida em'];
    linhas = os.map(o => [o.criado_em, o.codigo, o.equipamento_nome, o.titulo, o.descricao, o.providencia, o.prioridade, o.status, o.responsavel, o.prazo, o.resolvida_em]);
    nomeArq = 'ocorrencias';
  } else if (relatorio === 'gastos') {
    const ms = db.prepare(`SELECT m.*, e.codigo, e.nome AS equipamento_nome FROM manutencoes m
      JOIN equipamentos e ON e.id = m.equipamento_id WHERE m.hospital_id = ?
      AND date(m.data) >= date(?) AND date(m.data) <= date(?) ORDER BY m.data DESC`).all(hid, desde, ate);
    cabecalhos = ['Data', 'Tipo registro', 'Tipo', 'Codigo', 'Equipamento', 'Empresa', 'Profissional', 'Total (centavos)', 'Total (BRL)'];
    linhas = ms.map(m => [m.data, 'manutencao', m.tipo, m.codigo, m.equipamento_nome, m.empresa, m.profissional, m.total_centavos, (m.total_centavos / 100).toFixed(2)]);
    const cs = db.prepare(`SELECT c.*, e.codigo, e.nome AS equipamento_nome FROM calibracoes c
      JOIN equipamentos e ON e.id = c.equipamento_id WHERE c.hospital_id = ?
      AND date(c.data) >= date(?) AND date(c.data) <= date(?) ORDER BY c.data DESC`).all(hid, desde, ate);
    for (const c of cs) linhas.push([c.data, 'calibracao', c.resultado, c.codigo, c.equipamento_nome, c.empresa, c.responsavel, c.custo_centavos, (c.custo_centavos / 100).toFixed(2)]);
    nomeArq = 'gastos';
  } else {
    return res.status(400).json({ erro: 'Relatório inválido (equipamentos|inspecoes|manutencoes|calibracoes|ocorrencias|gastos).' });
  }

  req.auditar('exportar_csv', 'relatorio', relatorio, null, { linhas: linhas.length });
  const sep = ';'; // compatível com Excel pt-BR
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cabecalhos.map(esc).join(sep), ...linhas.map(l => l.map(esc).join(sep))].join('\r\n');
  // BOM UTF-8 para o Excel reconhecer acentos
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hospcheck-${nomeArq}-${Date.now()}.csv"`);
  res.send('•' + csv);
});

function eqsIds(cl, vals) {
  return db.prepare(`SELECT e.id FROM equipamentos e WHERE ${cl.join(' AND ')}`).all(...vals).map(r => r.id);
}
