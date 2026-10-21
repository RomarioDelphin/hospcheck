// HospCheck — dados de DEMONSTRAÇÃO (fictícios, sem pacientes nem pessoas reais)
// Roda automaticamente na primeira inicialização e pode ser re-executado com `npm run seed -- --forcar`
import { db, agoraISO, novoId, hojeSP, addDias, addMeses } from './db.js';
import { hashSenha, novoUsuario } from './auth.js';

export function jaTemDados() {
  const r = db.prepare('SELECT COUNT(*) AS n FROM hospitais').get();
  return r.n > 0;
}

function senhaDe(perfil) { return `Demo@${perfil}2026`; }

export function semear({ forcar = false } = {}) {
  if (jaTemDados()) {
    if (!forcar) return { ok: true, pulado: true };
    db.exec('DELETE FROM auditoria; DELETE FROM sessoes;');
    db.exec(`DELETE FROM respostas_inspecao; DELETE FROM inspecoes; DELETE FROM ocorrencias;
             DELETE FROM manutencoes; DELETE FROM calibracoes; DELETE FROM agendas;
             DELETE FROM itens_checklist; DELETE FROM modelos_checklist;
             DELETE FROM anexos; DELETE FROM equipamentos; DELETE FROM setores;
             DELETE FROM usuarios; DELETE FROM hospitais;`);
  }

  const agora = agoraISO();
  const hoje = hojeSP();
  const HOSP_ID = novoId();
  db.prepare(`INSERT INTO hospitais (id,nome,nome_fantasia,cnpj,endereco,telefone,fuso,antecedencia_inspecao_dias,
               antecedencia_calibracao_dias,antecedencia_manutencao_dias,dados_demo,criado_em,atualizado_em)
               VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`)
    .run(HOSP_ID, 'Hospital São Lucas (Demonstração)', 'HospCheck Demo',
      '00.000.000/0001-00', 'Av. das Nações, 100 — Cidade Demonstrativa/SP', '(11) 4000-0000',
      'America/Sao_Paulo', 2, 15, 7, agora, agora);

  // ---- Setores ----
  const setores = {};
  for (const [nome, andar] of [['UTI Adulto', 'Térreo'], ['Pronto-Socorro', 'Térreo'],
    ['Centro Cirúrgico', '1º'], ['Pediatria', '2º'], ['Enfermaria Geral', '3º']]) {
    const id = novoId();
    db.prepare('INSERT INTO setores (id,hospital_id,nome,andar,ativo,criado_em,atualizado_em) VALUES (?,?,?,?,1,?,?)')
      .run(id, HOSP_ID, nome, andar, agora, agora);
    setores[nome] = id;
  }

  // ---- Usuários (fictícios; senhas listadas apenas na tela de login da demonstração) ----
  const perfis = [
    ['Ana Admin (Demo)', 'admin', 'administrador'],
    ['Gustavo Gestor (Demo)', 'gestor', 'gestor'],
    ['Irene Inspetora (Demo)', 'inspetor', 'inspetor'],
    ['Marcos Manutenção (Demo)', 'manutencao', 'manutencao'],
    ['Carla Consulta (Demo)', 'consulta', 'consulta']
  ];
  const usuarios = {};
  for (const [nome, apelido, perfil] of perfis) {
    const u = novoUsuario({
      hospital_id: HOSP_ID, nome, email: `${apelido}@demo.hospcheck.local`,
      senha: senhaDe(perfil), perfil, telefone: '(11) 90000-0000'
    });
    usuarios[perfil] = u.id;
  }

  // ---- Modelos de checklist (versionados) ----
  function criarModelo(nome, tipo, itens) {
    const mid = novoId();
    db.prepare(`INSERT INTO modelos_checklist (id,hospital_id,nome,tipo_equipamento,versao,ativo,criado_por,criado_em,atualizado_em)
                VALUES (?,?,?,?,1,1,?,?,?)`).run(mid, HOSP_ID, nome, tipo, usuarios.administrador, agora, agora);
    itens.forEach((it, i) => {
      db.prepare(`INSERT INTO itens_checklist (id,modelo_id,ordem,enunciado,exige_justificativa,exige_medicao,unidade,ativo)
                  VALUES (?,?,?,?,?,?,?,1)`)
        .run(novoId(), mid, i + 1, it.e, it.j ? 1 : 0, it.m ? 1 : 0, it.u || null);
    });
    return mid;
  }

  const modeloMonitor = criarModelo('Checklist Monitor Multiparâmetros', 'Monitor Multiparâmetros', [
    { e: 'Gabinete limpo e sem avarias visíveis', m: false },
    { e: 'Ligamento e autoteste sem erros', m: false },
    { e: 'Temperatura ambiente de operação', m: true, u: '°C' },
    { e: 'Cabeceiras, cabos e sensores íntegros', j: true },
    { e: 'Tensão da bateria interna', m: true, u: 'V', j: true },
    { e: 'Alarmes sonoros e luminosos funcionando', j: true },
    { e: 'Aterramento e aterramento de equipamento confere', m: false },
    { e: 'Data/hora correta no equipamento', m: false }
  ]);
  const modeloVentilador = criarModelo('Checklist Ventilador Pulmonar', 'Ventilador Pulmonar', [
    { e: 'Filtros e válvulas limpos e trocados', j: true },
    { e: 'Circuito inspiratório montado corretamente', m: false },
    { e: 'Pressão máxima de segurança testada', m: true, u: 'cmH₂O', j: true },
    { e: 'Percentual de O₂ medido', m: true, u: '%' },
    { e: 'Fluxo inspiratório dentro da faixa', m: true, u: 'L/min' },
    { e: 'Alarmes de alta/ baixa pressão funcionando', j: true },
    { e: 'Rodas e freios operacionais', m: false }
  ]);
  const modeloAutoclave = criarModelo('Checklist Autoclave', 'Autoclave', [
    { e: 'Câmara e porta limpas, sem resíduos', j: true },
    { e: 'Ciclo de esterilização completado', m: false },
    { e: 'Temperatura máxima do ciclo', m: true, u: '°C', j: true },
    { e: 'Tempo de exposição ao vapor', m: true, u: 'min' },
    { e: 'Válvula de alívio operacional', j: true },
    { e: 'Registro de impressão do ciclo anexado', m: false }
  ]);
  const modeloGenerico = criarModelo('Checklist Geral de Equipamento', 'Genérico', [
    { e: 'Identificação e etiqueta legíveis', m: false },
    { e: 'Estado de conservação aparente', j: true },
    { e: 'Funcionamento normal na operação', j: true },
    { e: 'Cabo de força e plugue íntegros', j: true },
    { e: 'Segurança elétrica verificada', m: false }
  ]);

  // ---- Equipamentos ----
  const equipamentos = [];
  function criarEquip(e) {
    const id = novoId();
    db.prepare(`INSERT INTO equipamentos (id,hospital_id,codigo,nome,tipo,marca,modelo,serie,patrimonio,setor_id,
                 localizacao,responsavel_id,status,periodicidade,data_inicial,checklist_modelo_id,ativo,criado_por,criado_em,atualizado_em)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`)
      .run(id, HOSP_ID, e.codigo, e.nome, e.tipo, e.marca, e.modelo, e.serie, e.patrimonio,
        setores[e.setor], e.local, e.responsavel, e.status, e.periodicidade, e.data_inicial,
        e.checklist, usuarios.administrador, agora, agora);
    equipamentos.push({ id, ...e });
    return id;
  }

  const E = {};
  E.MON = criarEquip({ codigo: 'EQ-0001', nome: 'Monitor Multiparâmetros Bedside 01', tipo: 'Monitor Multiparâmetros',
    marca: 'MedDemo', modelo: 'MD-2200', serie: 'SN-DEMO-1001', patrimonio: 'PAT-1001', setor: 'UTI Adulto',
    local: 'Leito 03', responsavel: usuarios.inspetor, status: 'operacional', periodicidade: 'semanal',
    data_inicial: addDias(hoje, -70), checklist: modeloMonitor });
  E.VEN = criarEquip({ codigo: 'EQ-0002', nome: 'Ventilador Pulmonar ICU 02', tipo: 'Ventilador Pulmonar',
    marca: 'RespDemo', modelo: 'RV-900', serie: 'SN-DEMO-1002', patrimonio: 'PAT-1002', setor: 'UTI Adulto',
    local: 'Leito 07', responsavel: usuarios.inspetor, status: 'operacional', periodicidade: 'quinzenal',
    data_inicial: addDias(hoje, -60), checklist: modeloVentilador });
  E.AUT = criarEquip({ codigo: 'EQ-0003', nome: 'Autoclave Bancada 01', tipo: 'Autoclave',
    marca: 'SterDemo', modelo: 'ST-18L', serie: 'SN-DEMO-1003', patrimonio: 'PAT-1003', setor: 'Centro Cirúrgico',
    local: 'Esterilização', responsavel: usuarios.gestor, status: 'manutencao', periodicidade: 'semanal',
    data_inicial: addDias(hoje, -90), checklist: modeloAutoclave });
  E.DES = criarEquip({ codigo: 'EQ-0004', nome: 'Desfibrilador Portátil 01', tipo: 'Desfibrilador',
    marca: 'CarDemo', modelo: 'CD-300', serie: 'SN-DEMO-1004', patrimonio: 'PAT-1004', setor: 'Pronto-Socorro',
    local: 'Sala de Reanimação', responsavel: usuarios.gestor, status: 'operacional', periodicidade: 'mensal',
    data_inicial: addDias(hoje, -120), checklist: modeloGenerico });
  E.BOM = criarEquip({ codigo: 'EQ-0005', nome: 'Bomba de Infusão 01', tipo: 'Bomba de Infusão',
    marca: 'InfuDemo', modelo: 'IB-500', serie: 'SN-DEMO-1005', patrimonio: 'PAT-1005', setor: 'Pediatria',
    local: 'Leito 12', responsavel: usuarios.inspetor, status: 'restricao', periodicidade: 'quinzenal',
    data_inicial: addDias(hoje, -45), checklist: modeloGenerico });
  E.RAI = criarEquip({ codigo: 'EQ-0006', nome: 'Raio-X Portátil 01', tipo: 'Equipo de Imagem',
    marca: 'RayDemo', modelo: 'RX-50', serie: 'SN-DEMO-1006', patrimonio: 'PAT-1006', setor: 'Pronto-Socorro',
    local: ' Sala 4', responsavel: usuarios.gestor, status: 'interditado', periodicidade: 'mensal',
    data_inicial: addDias(hoje, -200), checklist: modeloGenerico });
  E.MON2 = criarEquip({ codigo: 'EQ-0007', nome: 'Monitor Multiparâmetros Leito 09', tipo: 'Monitor Multiparâmetros',
    marca: 'MedDemo', modelo: 'MD-2200', serie: 'SN-DEMO-1007', patrimonio: 'PAT-1007', setor: 'Enfermaria Geral',
    local: 'Leito 09', responsavel: usuarios.inspetor, status: 'operacional', periodicidade: 'quinzenal',
    data_inicial: addDias(hoje, -30), checklist: modeloMonitor });
  E.INS = criarEquip({ codigo: 'EQ-0008', nome: 'Incubadora Neonatal 01', tipo: 'Incubadora',
    marca: 'NeoDemo', modelo: 'NB-10', serie: 'SN-DEMO-1008', patrimonio: 'PAT-1008', setor: 'Pediatria',
    local: 'UTI Neonatal', responsavel: usuarios.gestor, status: 'operacional', periodicidade: 'semanal',
    data_inicial: addDias(hoje, -40), checklist: modeloGenerico });

  // ---- Agendas independentes (inspeção, calibração e manutenção) ----
  for (const eq of equipamentos) {
    const intervaloDias = eq.periodicidade === 'semanal' ? 7 : eq.periodicidade === 'quinzenal' ? 15 : null;
    const intervaloMeses = eq.periodicidade === 'mensal' ? 1 : null;
    db.prepare(`INSERT INTO agendas (id,hospital_id,equipamento_id,tipo,ativo,intervalo_dias,intervalo_meses,data_base,criado_em,atualizado_em)
                VALUES (?,?,?,'inspecao',1,?,?,?,?,?)`)
      .run(novoId(), HOSP_ID, eq.id, intervaloDias, intervaloMeses, eq.data_inicial, agora, agora);
    // Calibração: a cada 12 meses, independente do checklist
    db.prepare(`INSERT INTO agendas (id,hospital_id,equipamento_id,tipo,ativo,intervalo_dias,intervalo_meses,data_base,criado_em,atualizado_em)
                VALUES (?,?,?,'calibracao',1,NULL,12,?,?,?)`)
      .run(novoId(), HOSP_ID, eq.id, eq.data_inicial, agora, agora);
    // Manutenção preventiva: a cada 6 meses, independente do checklist
    db.prepare(`INSERT INTO agendas (id,hospital_id,equipamento_id,tipo,ativo,intervalo_dias,intervalo_meses,data_base,observacao,criado_em,atualizado_em)
                VALUES (?,?,?,'manutencao',1,NULL,6,?,?,?,?)`)
      .run(novoId(), HOSP_ID, eq.id, eq.data_inicial, 'Preventiva programada de fábrica/contrato', agora, agora);
  }

  // ---- Inspeções históricas (respeitando periodicidade e atrasos) ----
  function inspecao(eqId, modeloId, versao, dataISO, usuarioId, respostasManual, concluida = true) {
    const id = novoId();
    const naoConf = respostasManual.filter(r => r.valor === 'nao_conforme').length;
    db.prepare(`INSERT INTO inspecoes (id,hospital_id,equipamento_id,modelo_id,modelo_versao,usuario_id,status,
                 agendada_para,data_inicio,data_conclusao,resultado,nao_conforme_count,observacao_geral,criado_em,atualizado_em)
                 VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?)`)
      .run(id, HOSP_ID, eqId, modeloId, versao, usuarioId, concluida ? 'concluida' : 'rascunho',
        dataISO, dataISO + 'T08:00:00.000Z', concluida ? dataISO + 'T08:30:00.000Z' : null,
        concluida ? (naoConf > 0 ? 'nao_conforme' : 'conforme') : null, naoConf, null, agora, agora);
    respostasManual.forEach((r, i) => {
      db.prepare(`INSERT INTO respostas_inspecao (id,inspecao_id,item_id,enunciado,valor,justificativa,observacao,medicao_num,medicao_unidade)
                  VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(novoId(), id, r.item_id, r.enunciado, r.valor, r.justificativa || null, r.observacao || null,
          r.medicao_num ?? null, r.medicao_unidade || null);
    });
    return id;
  }

  function itens(modeloId) {
    return db.prepare('SELECT id,enunciado,ordem FROM itens_checklist WHERE modelo_id = ? AND ativo = 1 ORDER BY ordem').all(modeloId);
  }

  function preencher(modeloId, valores) {
    const its = itens(modeloId);
    return its.map((it, i) => ({
      item_id: it.id, enunciado: it.enunciado,
      valor: valores[i]?.v || 'conforme',
      justificativa: valores[i]?.j || null,
      observacao: valores[i]?.o || null,
      medicao_num: valores[i]?.m ?? null,
      medicao_unidade: valores[i]?.u || null
    }));
  }

  // EQ-0001: em dia (inspeção há 5 dias, semanal → vence em 2 dias)
  for (const diasAtras of [34, 27, 20, 12, 5]) {
    inspecao(E.MON, modeloMonitor, 1, addDias(hoje, -diasAtras), usuarios.inspetor,
      preencher(modeloMonitor, [{ v: 'conforme', m: 22.5, u: '°C' }]));
  }
  // EQ-0007: vencida (quinzenal, última há 21 dias → atraso de 6 dias)
  for (const diasAtras of [50, 36, 21]) {
    inspecao(E.MON2, modeloMonitor, 1, addDias(hoje, -diasAtras), usuarios.inspetor,
      preencher(modeloMonitor, [{ v: 'conforme', m: 23.1, u: '°C' }]));
  }
  // EQ-0002 (quinzenal): última há 10 dias → próxima em 5 dias (próxima)
  for (const diasAtras of [40, 25, 10]) {
    const rs = preencher(modeloVentilador, [
      { v: 'conforme' }, { v: 'conforme' }, { m: 45, u: 'cmH₂O' },
      { v: 'conforme' }, { m: 21.3, u: 'V' }, { v: 'conforme' }, { v: 'conforme' }
    ]);
    inspecao(E.VEN, modeloVentilador, 1, addDias(hoje, -diasAtras), usuarios.inspetor, rs);
  }
  // EQ-0003 (semanal): última há 9 dias → vencida com não conformidade
  const rsAut = preencher(modeloAutoclave, [
    { v: 'nao_conforme', j: 'Resíduo aderente na borracha de vedação da porta.', o: 'Limpeza e substituição da vedação solicitadas.' },
    { v: 'conforme' }, { m: 132, u: '°C' }, { m: 18, u: 'min' },
    { v: 'conforme' }, { v: 'conforme' }
  ]);
  const inspAut = inspecao(E.AUT, modeloAutoclave, 1, addDias(hoje, -9), usuarios.inspetor, rsAut);
  // EQ-0005 (quinzenal): atrasada
  for (const diasAtras of [30, 16]) {
    inspecao(E.BOM, modeloGenerico, 1, addDias(hoje, -diasAtras), usuarios.inspetor, preencher(modeloGenerico, [{}]));
  }
  // EQ-0004 (mensal): em dia (há 12 dias)
  for (const mesAtras of [3, 2, 1]) {
    inspecao(E.DES, modeloGenerico, 1, addMeses(hoje, -mesAtras).replace(/-\d{2}$/, '-05'), usuarios.inspetor, preencher(modeloGenerico, [{}]));
  }
  inspecao(E.DES, modeloGenerico, 1, addDias(hoje, -12), usuarios.inspetor, preencher(modeloGenerico, [{}]));
  // EQ-0008 (semanal): em dia há 3 dias
  for (const diasAtras of [31, 24, 17, 10, 3]) {
    inspecao(E.INS, modeloGenerico, 1, addDias(hoje, -diasAtras), usuarios.inspetor, preencher(modeloGenerico, [{}]));
  }
  // Rascunho em aberto (mostra o fluxo de "não concluir antes da confirmação do servidor")
  inspecao(E.MON2, modeloMonitor, 1, hoje, usuarios.inspetor, [], false);

  // ---- Ocorrência vinda da não conformidade da autoclave ----
  const ocId = novoId();
  db.prepare(`INSERT INTO ocorrencias (id,hospital_id,equipamento_id,inspecao_id,titulo,descricao,providencia,prioridade,
               responsavel_id,prazo,status,criado_por,criado_em,atualizado_em)
               VALUES (?,?,?,?,?,?,?,?,?,?, 'aberta', ?,?,?)`)
    .run(ocId, HOSP_ID, E.AUT, inspAut,
      'Vedação da porta da autoclave com resíduo',
      'Durante a inspeção foi identificado resíduo aderente na borracha de vedação da porta da autoclave, comprometendo a estanqueidade do ciclo.',
      'Substituir a borracha de vedação, limpar a câmara e retestar o ciclo antes de liberar o uso.',
      'alta', usuarios.manutencao, addDias(hoje, 2), usuarios.inspetor, agora, agora);

  // Ocorrência crítica antiga pendente
  db.prepare(`INSERT INTO ocorrencias (id,hospital_id,equipamento_id,titulo,descricao,providencia,prioridade,
               responsavel_id,prazo,status,criado_por,criado_em,atualizado_em)
               VALUES (?,?,?,?,?,?,?,?,?, 'aberta', ?,?,?)`)
    .run(novoId(), HOSP_ID, E.RAI,
      'Equipo interditado — falha no cabeçote de emissão',
      'Falha recorrente no cabeçote de emissão detectada na última manutenção corretiva. Equipamento interditado até a troca do componente.',
      'Aguardar peças do fornecedor; manter interdição até liberação técnica documentada.',
      'critica', usuarios.manutencao, addDias(hoje, -3), usuarios.gestor, agora, agora);

  // ---- Manutenções (valores em centavos) ----
  function manut(eqId, tipo, dataISO, empresa, prof, descricao, pecas, mao, outros, proxima) {
    const total = pecas + mao + outros;
    db.prepare(`INSERT INTO manutencoes (id,hospital_id,equipamento_id,tipo,data,empresa,profissional,descricao,
                 pecas_centavos,mao_obra_centavos,outros_centavos,total_centavos,proxima_data,criado_por,criado_em,atualizado_em)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(novoId(), HOSP_ID, eqId, tipo, dataISO, empresa, prof, descricao, pecas, mao, outros, total, proxima,
        usuarios.gestor, agora, agora);
  }
  manut(E.MON, 'preventiva', addDias(hoje, -40), 'Demo Manutenções Ltda.', 'Rafael Técnico (Demo)',
    'Limpeza geral, verificação de cabeçotes e teste de bateria.', 0, 180000, 0, addDias(hoje, 80));
  manut(E.VEN, 'corretiva', addDias(hoje, -12), 'Demo Manutenções Ltda.', 'Rafael Técnico (Demo)',
    'Substituição da célula de O₂ e recalibração do sensor de fluxo.', 320000, 250000, 15000, addDias(hoje, 168));
  manut(E.AUT, 'preventiva', addDias(hoje, -95), 'SterDemo Assistência', 'Paula Técnica (Demo)',
    'Troca de válvulas, testes de pressão e limpeza de condensado.', 450000, 320000, 0, addDias(hoje, 85));
  manut(E.RAI, 'corretiva', addDias(hoje, -20), 'RayDemo Assistência', 'Bruno Técnico (Demo)',
    'Diagnóstico de falha no cabeçote; troca de placa de alta tensão (em estoque).', 1200000, 600000, 0, null);
  manut(E.BOM, 'preventiva', addDias(hoje, -5), 'Demo Manutenções Ltda.', 'Rafael Técnico (Demo)',
    'Teste de taxa de infusão com balança patrocinada e troca de teclado.', 25000, 140000, 0, addDias(hoje, 175));

  // ---- Calibrações ----
  function calib(eqId, dataISO, validade, resultado, empresa, resp, custo, obs) {
    db.prepare(`INSERT INTO calibracoes (id,hospital_id,equipamento_id,data,validade,resultado,empresa,responsavel,
                 custo_centavos,observacao,criado_por,criado_em,atualizado_em)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(novoId(), HOSP_ID, eqId, dataISO, validade, resultado, empresa, resp, custo, obs, usuarios.gestor, agora, agora);
  }
  // Monitor: calibrado há 11 meses, validade 12 → vence em 1 mês (próxima)
  calib(E.MON, addMeses(hoje, -11), addMeses(hoje, 1), 'aprovada', 'MetroDemo Calibrações', 'Sofia Metrologista (Demo)', 480000, 'Certificado CD-2025-001 (demonstração).');
  // Monitor 2: calibração vencida (venceu há 20 dias)
  calib(E.MON2, addDias(hoje, -385), addDias(hoje, -20), 'aprovada', 'MetroDemo Calibrações', 'Sofia Metrologista (Demo)', 470000, 'Certificado CD-2024-118 (demonstração).');
  // Ventilador: calibrado há 3 meses, validade 12
  calib(E.VEN, addMeses(hoje, -3), addMeses(hoje, 9), 'aprovada', 'MetroDemo Calibrações', 'Sofia Metrologista (Demo)', 690000, 'Certificado CD-2025-042 (demonstração).');
  // Desfibrilador: aprovado há 6 meses, validade 12
  calib(E.DES, addMeses(hoje, -6), addMeses(hoje, 6), 'aprovada', 'MetroDemo Calibrações', 'Sofia Metrologista (Demo)', 390000, 'Certificado CD-2025-077 (demonstração).');
  // Bomba de infusão: condicional, vence em breve
  calib(E.BOM, addDias(hoje, -350), addDias(hoje, 14), 'condicional', 'MetroDemo Calibrações', 'Sofia Metrologista (Demo)', 210000, 'Aprovada com restrição — reteste em até 30 dias (demonstração).');
  // Autoclave: reprovada na última
  calib(E.AUT, addDias(hoje, -60), addDias(hoje, 305), 'reprovada', 'SterDemo Metrologia', 'Ivo Metrologista (Demo)', 350000, 'Reprovada em temperatura máxima; recalibração agendada (demonstração).');
  // Incubadora calibrada, próxima em 7 meses
  calib(E.INS, addMeses(hoje, -5), addMeses(hoje, 7), 'aprovada', 'NeoDemo Metrologia', 'Ivo Metrologista (Demo)', 260000, 'Certificado ND-2025-010 (demonstração).');

  // Auditoria inicial
  db.prepare(`INSERT INTO auditoria (id,hospital_id,usuario_id,usuario_nome,acao,entidade,entidade_id,criado_em)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(novoId(), HOSP_ID, usuarios.administrador, 'Ana Admin (Demo)', 'semear_demonstracao', 'sistema', null, agora);

  return { ok: true, hospital_id: HOSP_ID, equipamentos: equipamentos.length, usuarios: Object.keys(usuarios).length };
}
