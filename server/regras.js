// HospCheck — regras de negócio: vencimentos, status, alertas e permissões de ação
import { db, hojeSP, addDias, addMeses, diffDias, agoraISO, novoId } from './db.js';

// Próxima inspeção: usa a agenda de inspeção (independente de calibração/manutenção)
export function proximaInspecao(equipamentoId, periodicidade, dataInicial) {
  const ultima = db.prepare(`SELECT data_conclusao FROM inspecoes
    WHERE equipamento_id = ? AND status = 'concluida' AND data_conclusao IS NOT NULL
    ORDER BY data_conclusao DESC LIMIT 1`).get(equipamentoId);
  const base = ultima ? ultima.data_conclusao.slice(0, 10) : dataInicial;
  let proxima;
  if (periodicidade === 'semanal') proxima = addDias(base, 7);
  else if (periodicidade === 'quinzenal') proxima = addDias(base, 15);
  else proxima = addMeses(base, 1);
  return { base, proxima, ultima_em: ultima ? ultima.data_conclusao.slice(0, 10) : null };
}

export function proximaCalibracao(equipamentoId) {
  const ultima = db.prepare(`SELECT data, validade FROM calibracoes
    WHERE equipamento_id = ? ORDER BY validade DESC LIMIT 1`).get(equipamentoId);
  if (!ultima) return { proxima: null, ultima_em: null, resultado_ultima: null };
  return { proxima: ultima.validade, ultima_em: ultima.data, resultado_ultima: ultima.resultado };
}

export function proximaManutencao(equipamentoId) {
  const ultima = db.prepare(`SELECT data, proxima_data FROM manutencoes
    WHERE equipamento_id = ? AND proxima_data IS NOT NULL ORDER BY proxima_data DESC LIMIT 1`).get(equipamentoId);
  const ag = db.prepare(`SELECT data_base, intervalo_meses FROM agendas
    WHERE equipamento_id = ? AND tipo = 'manutencao' AND ativo = 1`).get(equipamentoId);
  if (ultima?.proxima_data) return { proxima: ultima.proxima_data, ultima_em: ultima.data };
  if (ag) {
    const base = ultima?.data || ag.data_base;
    return { proxima: addMeses(base, ag.intervalo_meses || 6), ultima_em: ultima?.data || null };
  }
  return { proxima: null, ultima_em: null };
}

const ROTULO_STATUS_INSPECCAO = { em_dia: 'Em dia', proxima: 'Próxima', vencida: 'Vencida', nunca: 'Nunca inspecionado' };
export function situacaoInspeccao(equip, hoje = hojeSP()) {
  const p = proximaInspecao(equip.id, equip.periodicidade, equip.data_inicial);
  if (!p.ultima_em) {
    const dias = diffDias(hoje, p.proxima);
    return { ...p, situacao: dias < 0 ? 'vencida' : (dias <= 2 ? 'proxima' : 'nunca'), dias_restantes: dias,
      rotulo: ROTULO_STATUS_INSPECCAO[dias < 0 ? 'vencida' : (dias <= 2 ? 'proxima' : 'nunca')],
      atraso_dias: dias < 0 ? Math.abs(dias) : 0 };
  }
  const dias = diffDias(hoje, p.proxima);
  const sit = dias < 0 ? 'vencida' : (dias <= 2 ? 'proxima' : 'em_dia');
  return { ...p, situacao: sit, dias_restantes: dias, rotulo: ROTULO_STATUS_INSPECCAO[sit],
    atraso_dias: dias < 0 ? Math.abs(dias) : 0 };
}

export function situacaoCalibracao(equip, hoje = hojeSP()) {
  const p = proximaCalibracao(equip.id);
  if (!p.proxima) return { ...p, situacao: 'sem_registro', rotulo: 'Sem calibração', dias_restantes: null, atraso_dias: 0 };
  const dias = diffDias(hoje, p.proxima);
  const sit = dias < 0 ? 'vencida' : (dias <= 15 ? 'proxima' : 'em_dia');
  const rot = { vencida: 'Calibração vencida', proxima: 'Calibração próxima', em_dia: 'Calibração em dia' }[sit];
  return { ...p, situacao: sit, rotulo: rot, dias_restantes: dias, atraso_dias: dias < 0 ? Math.abs(dias) : 0 };
}

export function situacaoManutencao(equip, hoje = hojeSP()) {
  const p = proximaManutencao(equip.id);
  if (!p.proxima) return { ...p, situacao: 'sem_programacao', rotulo: 'Sem programação', dias_restantes: null, atraso_dias: 0 };
  const dias = diffDias(hoje, p.proxima);
  const sit = dias < 0 ? 'vencida' : (dias <= 7 ? 'proxima' : 'programada');
  const rot = { vencida: 'Manutenção vencida', proxima: 'Manutenção próxima', programada: 'Manutenção programada' }[sit];
  return { ...p, situacao: sit, rotulo: rot, dias_restantes: dias, atraso_dias: dias < 0 ? Math.abs(dias) : 0 };
}

export function equipamentoCompleto(eqId) {
  return db.prepare(`SELECT e.*, s.nome AS setor_nome, s.andar AS setor_andar, u.nome AS responsavel_nome,
      f.id AS foto_id
    FROM equipamentos e
    LEFT JOIN setores s ON s.id = e.setor_id
    LEFT JOIN usuarios u ON u.id = e.responsavel_id
    LEFT JOIN anexos f ON f.id = e.foto_arquivo_id
    WHERE e.id = ?`).get(eqId);
}

export function resumoEquipamento(eq, hoje = hojeSP()) {
  const insp = situacaoInspeccao(eq, hoje);
  const cal = situacaoCalibracao(eq, hoje);
  const man = situacaoManutencao(eq, hoje);
  const ocor = db.prepare(`SELECT COUNT(*) AS n FROM ocorrencias WHERE equipamento_id = ? AND status IN ('aberta','em_andamento')`).get(eq.id).n;
  const ocorCrit = db.prepare(`SELECT COUNT(*) AS n FROM ocorrencias WHERE equipamento_id = ? AND status IN ('aberta','em_andamento') AND prioridade = 'critica'`).get(eq.id).n;
  const gastos = db.prepare(`SELECT COALESCE(SUM(total_centavos),0) AS m, COALESCE((SELECT SUM(custo_centavos) FROM calibracoes WHERE equipamento_id = e.id),0) AS c
      FROM manutencoes mn, equipamentos e WHERE e.id = mn.equipamento_id AND mn.equipamento_id = ?`).get(eq.id);
  return { inspeccao: insp, calibracao: cal, manutencao: man, ocorrencias_abertas: ocor, ocorrencias_criticas: ocorCrit,
    gasto_manutencao_centavos: gastos.m, gasto_calibracao_centavos: gastos.c,
    gasto_total_centavos: (gastos.m || 0) + (gastos.c || 0) };
}

// ---------- Alertas ----------
export function gerarAlertas(hospitalId, hoje = hojeSP()) {
  const ant = db.prepare('SELECT * FROM hospitais WHERE id = ?').get(hospitalId);
  const antInsp = ant?.antecedencia_inspecao_dias ?? 2;
  const antCal = ant?.antecedencia_calibracao_dias ?? 15;
  const antMan = ant?.antecedencia_manutencao_dias ?? 7;

  const eqs = db.prepare(`SELECT e.*, s.nome AS setor_nome FROM equipamentos e
    LEFT JOIN setores s ON s.id = e.setor_id WHERE e.hospital_id = ? AND e.ativo = 1`).all(hospitalId);

  const alertas = [];
  for (const eq of eqs) {
    const insp = situacaoInspeccao(eq, hoje);
    if (insp.situacao === 'vencida') {
      alertas.push(mk('inspecao_vencida', 'critico', `Inspeção vencida — ${eq.nome}`,
        `Última inspeção em ${insp.ultima_em || 'nunca'}; vencida há ${insp.atraso_dias} dia(s). Vencimento: ${insp.proxima}.`, eq, insp.proxima, insp.atraso_dias, antInsp));
    } else if (insp.situacao === 'proxima' && insp.dias_restantes <= antInsp) {
      alertas.push(mk('inspecao_proxima', 'atencao', `Inspeção próxima — ${eq.nome}`,
        `Vence em ${insp.dias_restantes} dia(s) (${insp.proxima}).`, eq, insp.proxima, 0, antInsp));
    }
    const cal = situacaoCalibracao(eq, hoje);
    if (cal.situacao === 'vencida') {
      alertas.push(mk('calibracao_vencida', 'critico', `Calibração vencida — ${eq.nome}`,
        `Venceu em ${cal.proxima}, há ${cal.atraso_dias} dia(s).`, eq, cal.proxima, cal.atraso_dias, antCal));
    } else if (cal.situacao === 'proxima' && cal.dias_restantes <= antCal) {
      alertas.push(mk('calibracao_proxima', 'atencao', `Calibração próxima — ${eq.nome}`,
        `Vence em ${cal.dias_restantes} dia(s) (${cal.proxima}).`, eq, cal.proxima, 0, antCal));
    }
    const man = situacaoManutencao(eq, hoje);
    if (man.situacao === 'vencida') {
      alertas.push(mk('manutencao_vencida', 'critico', `Manutenção vencida — ${eq.nome}`,
        `Programada para ${man.proxima}; atrasada há ${man.atraso_dias} dia(s).`, eq, man.proxima, man.atraso_dias, antMan));
    } else if (man.situacao === 'proxima' && man.dias_restantes <= antMan) {
      alertas.push(mk('manutencao_programada', 'informativo', `Manutenção programada — ${eq.nome}`,
        `Prevista para ${man.proxima} (${man.dias_restantes} dia(s)).`, eq, man.proxima, 0, antMan));
    }
    if (eq.status === 'interditado') {
      alertas.push(mk('interditado', 'critico', `Equipamento interditado — ${eq.nome}`,
        `Interdito no setor ${eq.setor_nome || '—'}. Uso proibido até liberação formal.`, eq, null, 0, 0));
    }
  }

  const ocs = db.prepare(`SELECT o.*, e.nome AS equipamento_nome, e.codigo, e.id AS eqid, s.nome AS setor_nome, u.nome AS resp_nome
    FROM ocorrencias o JOIN equipamentos e ON e.id = o.equipamento_id
    LEFT JOIN setores s ON s.id = e.setor_id LEFT JOIN usuarios u ON u.id = o.responsavel_id
    WHERE o.hospital_id = ? AND o.status IN ('aberta','em_andamento')`).all(hospitalId);
  for (const o of ocs) {
    const atrasada = o.prazo && o.prazo < hoje;
    alertas.push({
      id: o.id, tipo: 'ocorrencia', nivel: o.prioridade === 'critica' ? 'critico' : (o.prioridade === 'alta' || atrasada ? 'atencao' : 'informativo'),
      titulo: `${o.prioridade === 'critica' ? 'CRÍTICA — ' : ''}Ocorrência aberta — ${o.titulo}`,
      mensagem: `${o.equipamento_nome} (${o.codigo}) — responsável: ${o.resp_nome || 'não definido'}${o.prazo ? `; prazo ${o.prazo}${atrasada ? ' (ATRASADA)' : ''}` : ''}.`,
      equipamento_id: o.eqid, equipamento_nome: o.equipamento_nome, setor: o.setor_nome,
      referencia: o.prazo, atraso_dias: atrasada ? diffDias(o.prazo, hoje) : 0
    });
  }

  const ordem = { critico: 0, atencao: 1, informativo: 2 };
  alertas.sort((a, b) => (ordem[a.nivel] - ordem[b.nivel]) || ((a.atraso_dias || 0) < (b.atraso_dias || 0) ? 1 : -1));
  return {
    gerado_em: agoraISO(), hoje,
    antecedencias: { inspecao_dias: antInsp, calibracao_dias: antCal, manutencao_dias: antMan },
    total: alertas.length,
    criticos: alertas.filter(a => a.nivel === 'critico').length,
    atencao: alertas.filter(a => a.nivel === 'atencao').length,
    alertas
  };

  function mk(tipo, nivel, titulo, mensagem, eq, referencia, atraso, ant) {
    return { id: `${tipo}:${eq.id}`, tipo, nivel, titulo, mensagem, equipamento_id: eq.id,
      equipamento_nome: eq.nome, setor: eq.setor_nome, referencia, atraso_dias: atraso || 0, antecedencia_dias: ant };
  }
}

// Resumo diário por e-mail — a rotina roda no servidor; sem provedor configurado ela
// registra "pendente" e NÃO simula envio.
export function montarResumoEmail(hospitalId) {
  const a = gerarAlertas(hospitalId);
  const linhas = a.alertas.map(x => `• [${x.nivel.toUpperCase()}] ${x.titulo}\n   ${x.mensagem}`);
  return {
    assunto: `HospCheck — ${a.total} alerta(s) operacional(is) (${a.criticos} crítico(s))`,
    corpo: `Resumo diário HospCheck — data ${a.hoje}\n\n` +
      (linhas.length ? linhas.join('\n\n') : 'Nenhum alerta ativo.') +
      `\n\nAlertas críticos: ${a.criticos} | Atenção: ${a.atencao} | Total: ${a.total}`,
    total: a.total, criticos: a.criticos
  };
}
