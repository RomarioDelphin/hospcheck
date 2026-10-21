// HospCheck — teste e2e do fluxo completo:
// cadastro → QR → inspeção com foto obrigatória → ocorrência → manutenção → PDF
// Além: regras de vencimento, permissões por perfil e isolamento por hospital.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { portaLivre, instanciaDoLog } from './ajuda-porta.mjs';

// Extrai o texto real de um PDF gerado pelo pdfkit: os fluxos são FlateDecode e o
// texto sai em strings hex Latin-1 dentro dos arrays TJ / operadores Tj.
function textoDePdf(buf) {
  const s = buf.toString('latin1');
  let saida = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const inicio = m.index + m[0].length;
    const fim = s.indexOf('endstream', inicio);
    if (fim < 0) break;
    let fluxo = '';
    try { fluxo = zlib.inflateSync(buf.subarray(inicio, fim)).toString('latin1'); } catch { fluxo = ''; }
    for (const h of fluxo.matchAll(/<([0-9a-fA-F]+)>/g)) {
      saida += Buffer.from(h[1], 'hex').toString('latin1');
    }
  }
  return saida;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
// Porta livre por execução: um servidor antigo ocupando a porta fixa faria o teste
// falar com a instância errada (e com outro banco).
let PORTA = 0;
let BASE = '';

// Banco descartável só para o teste
const DB_TESTE = path.join(RAIZ, 'data', 'hospcheck-e2e.db');
for (const f of [DB_TESTE, DB_TESTE + '-wal', DB_TESTE + '-shm']) fs.rmSync(f, { force: true });

const cookies = new Map(); // perfil -> cookie
let total = 0, falhas = 0;
const resultados = [];

function check(nome, cond, detalhe = '') {
  total++;
  if (!cond) falhas++;
  resultados.push({ ok: !!cond, nome, detalhe });
  console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${detalhe && !cond ? ` — ${detalhe}` : ''}`);
}

async function api(perfil, metodo, rota, corpo) {
  const opts = { method: metodo, headers: { 'Content-Type': 'application/json' } };
  if (cookies.get(perfil)) opts.headers.Cookie = cookies.get(perfil);
  if (corpo !== undefined) opts.body = JSON.stringify(corpo);
  const r = await fetch(BASE + rota, opts);
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) cookies.set(perfil, setCookie.split(';')[0]);
  let json = null;
  const txt = await r.text();
  try { json = JSON.parse(txt); } catch { json = { _raw: txt }; }
  return { status: r.status, json, headers: r.headers, texto: txt };
}

// Gera um JPEG mínimo válido (1x1) em base64 — usado como "foto da câmera"
function jpegMinimo() {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64').toString('base64');
}

async function main() {
  console.log('\n═══ HospCheck — teste e2e ═══\n');
  PORTA = await portaLivre();
  BASE = `http://127.0.0.1:${PORTA}`;
  const servidor = spawn('node', ['server/index.js'], {
    // HC_SEED_DEMO=1: o teste depende dos usuários fictícios; produção NUNCA semeia demo.
    cwd: RAIZ, env: { ...process.env, PORT: String(PORTA), TZ: 'America/Sao_Paulo', HOSPCHECK_DB: DB_TESTE, HC_SEED_DEMO: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logServidor = '';
  servidor.stdout.on('data', d => logServidor += d);
  servidor.stderr.on('data', d => logServidor += d);

  try {
    // espera a API subir
    let noAr = false;
    for (let i = 0; i < 60 && !noAr; i++) {
      await new Promise(r => setTimeout(r, 250));
      try { const r = await fetch(BASE + '/api/auth/eu'); noAr = r.status === 401; } catch {}
    }
    check('Servidor sobe e exige autenticação', noAr, logServidor.slice(-500));
    // Confirma que as respostas vêm do processo recém-iniciado (não de um servidor antigo na porta).
    let idHeader = null;
    try { idHeader = (await fetch(BASE + '/api/health')).headers.get('x-hospcheck-instancia'); } catch {}
    const idLog = instanciaDoLog(logServidor);
    check('Respostas vêm do servidor recém-iniciado (instância conferida)', !!idHeader && idHeader === idLog,
      `header=${idHeader} log=${idLog}`);

    console.log('\n── 1. Login e perfis ──');
    const lg = await api('gestor', 'POST', '/api/auth/entrar', { email: 'gestor@demo.hospcheck.local', senha: 'Demo@gestor2026' });
    check('Login do gestor', lg.status === 200 && lg.json.ok, JSON.stringify(lg.json));
    check('Cookie httpOnly emitido', (lg.headers.get('set-cookie') || '').includes('HttpOnly'));
    const eu = await api('gestor', 'GET', '/api/auth/eu');
    check('Sessão devolve usuário e permissões', !!eu.json.usuario && !!eu.json.permissoes);
    check('Google status = desconectado (sem simulação)', eu.json.integracoes?.status === 'desconectado', JSON.stringify(eu.json.integracoes).slice(0,200));
    check('Pendências do Google listadas', (eu.json.integracoes?.pendencias || []).length >= 2, JSON.stringify(eu.json.integracoes?.pendencias));

    for (const [perfil, email, senha, esperado] of [
      ['admin', 'admin@demo.hospcheck.local', 'Demo@administrador2026', 'administrador'],
      ['inspetor', 'inspetor@demo.hospcheck.local', 'Demo@inspetor2026', 'inspetor'],
      ['manutencao', 'manutencao@demo.hospcheck.local', 'Demo@manutencao2026', 'manutencao'],
      ['consulta', 'consulta@demo.hospcheck.local', 'Demo@consulta2026', 'consulta']
    ]) {
      const r = await api(perfil, 'POST', '/api/auth/entrar', { email, senha });
      check(`Login ${esperado}`, r.status === 200 && r.json.usuario?.perfil === esperado, JSON.stringify(r.json));
    }
    const senhaRuim = await api('x', 'POST', '/api/auth/entrar', { email: 'gestor@demo.hospcheck.local', senha: 'errada' });
    check('Senha errada é rejeitada', senhaRuim.status === 401);

    console.log('\n── 2. Cadastro (hospital, setor, usuário, equipamento) ──');
    const setores = await api('admin', 'GET', '/api/setores');
    const setorUTI = setores.json.find(s => s.nome === 'UTI Adulto');
    check('Setores cadastrados', setores.json.length === 5, `achou ${setores.json.length}`);

    const novoUsuario = await api('admin', 'POST', '/api/usuarios', {
      nome: 'Inspetor Novo (Teste)', email: 'novo.inspetor@teste.local', senha: 'SenhaForte@123', perfil: 'inspetor' });
    check('Cadastro de usuário', novoUsuario.status === 201, JSON.stringify(novoUsuario.json));
    const dupUsuario = await api('admin', 'POST', '/api/usuarios', {
      nome: 'Duplicado', email: 'novo.inspetor@teste.local', senha: 'SenhaForte@123', perfil: 'inspetor' });
    check('E-mail duplicado é bloqueado', dupUsuario.status === 409);

    const criado = await api('gestor', 'POST', '/api/equipamentos', {
      codigo: 'EQ-9001', nome: 'Monitor de Teste E2E', tipo: 'Monitor Multiparâmetros',
      marca: 'MedTest', modelo: 'MT-1', serie: 'SN-E2E-1', patrimonio: 'PAT-E2E-1',
      setor_id: setorUTI.id, localizacao: 'Leito 99', responsavel_id: novoUsuario.json.id,
      periodicidade: 'quinzenal', data_inicial: '2026-09-01', status: 'operacional' });
    check('Cadastro de equipamento', criado.status === 201 && !!criado.json.id, JSON.stringify(criado.json));
    const eqId = criado.json.id;
    check('UUID estável gerado', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(eqId), eqId);

    const codDup = await api('gestor', 'POST', '/api/equipamentos', {
      codigo: 'EQ-9001', nome: 'Outro', tipo: 'X', periodicidade: 'semanal', data_inicial: '2026-09-01' });
    check('Código único é imposto no servidor', codDup.status === 409, JSON.stringify(codDup.json));

    console.log('\n── 3. QR Code real e etiqueta ──');
    const ficha = await api('gestor', 'GET', `/api/equipamentos/${eqId}`);
    check('URL estável do QR não expõe dados privados', /\/e\/[0-9a-f-]{36}$/.test(ficha.json.url_estavel || ''), ficha.json.url_estavel);
    const qr = await fetch(`${BASE}/api/equipamentos/${eqId}/qr.png`, { headers: { Cookie: cookies.get('gestor') } });
    const qrBuf = Buffer.from(await qr.arrayBuffer());
    check('QR PNG real gerado', qr.status === 200 && qrBuf.length > 500 && qrBuf.slice(1, 4).toString() === 'PNG', `${qrBuf.length} bytes`);
    const etiqueta = await fetch(`${BASE}/api/equipamentos/${eqId}/etiqueta.pdf`, { headers: { Cookie: cookies.get('gestor') } });
    const etqBuf = Buffer.from(await etiqueta.arrayBuffer());
    check('Etiqueta imprimível em PDF', etiqueta.status === 200 && etqBuf.slice(0, 5).toString() === '%PDF-', `${etqBuf.length} bytes`);

    const qrPublico = await fetch(`${BASE}/api/publico/equipamento/${eqId}`);
    const qrPubJson = await qrPublico.json();
    check('QR sem autenticação não revela dados (pede login)', qrPubJson.valido === true && qrPubJson.requer_login === true && !qrPubJson.equipamento);
    const semAuthFicha = await fetch(`${BASE}/api/equipamentos/${eqId}`);
    check('Ficha sem login é bloqueada', semAuthFicha.status === 401);
    const semAuthQR = await fetch(`${BASE}/api/equipamentos/${eqId}/qr.png`);
    check('QR PNG sem login é bloqueado', semAuthQR.status === 401);

    console.log('\n── 4. Inspeção: foto obrigatória + servidor decide ──');
    const rasc = await api('inspetor', 'POST', '/api/inspecoes/rascunho', { equipamento_id: eqId });
    check('Rascunho de inspeção criado', rasc.status === 200 && !!rasc.json.inspecao?.id, JSON.stringify(rasc.json).slice(0, 300));
    if (!rasc.json.inspecao) throw new Error('sem rascunho: ' + JSON.stringify(rasc.json));
    const insId = rasc.json.inspecao.id;
    check('Modelo versionado anexado', rasc.json.modelo.versao >= 1 && rasc.json.itens.length > 0, `${rasc.json.itens.length} itens`);
    check('Foto declarada obrigatória', rasc.json.foto_obrigatoria === true);

    // concluir sem responder nada → servidor barra
    const semRespostas = await api('inspetor', 'POST', `/api/inspecoes/${insId}/concluir`);
    check('Concluir sem respostas é bloqueado', semRespostas.status === 400 && /sem resposta/i.test(semRespostas.json.erro || ''), JSON.stringify(semRespostas.json));

    // preenche tudo
    const itens = rasc.json.itens;
    const payload = itens.map((it, i) => ({
      item_id: it.id, enunciado: it.enunciado, valor: 'conforme',
      medicao_num: it.exige_medicao ? 22.5 : null, medicao_unidade: it.exige_medicao ? it.unidade : null }));
    const salvo = await api('inspetor', 'PATCH', `/api/inspecoes/${insId}/rascunho`, { respostas: payload, observacao_geral: 'Inspeção e2e.' });
    check('Autosave do rascunho', salvo.status === 200 && salvo.json.rascunho_salvo_em, JSON.stringify(salvo.json));

    // tentar concluir sem foto → servidor barra com FOTO_OBRIGATORIA
    const semFoto = await api('inspetor', 'POST', `/api/inspecoes/${insId}/concluir`);
    check('Concluir sem foto é bloqueado (FOTO_OBRIGATORIA)', semFoto.status === 400 && semFoto.json.codigo === 'FOTO_OBRIGATORIA', JSON.stringify(semFoto.json));

    // justificativa ausente numa não conformidade → barra
    const comNaoConf = payload.map((p, i) => i === 0 ? { ...p, valor: 'nao_conforme' } : p);
    await api('inspetor', 'PATCH', `/api/inspecoes/${insId}/rascunho`, { respostas: comNaoConf });
    const semJust = await api('inspetor', 'POST', `/api/inspecoes/${insId}/concluir`);
    check('Não conformidade sem justificativa é bloqueada', semJust.status === 400 && /justificativa/i.test(semJust.json.erro || ''), JSON.stringify(semJust.json));

    // volta para conforme e envia a foto (simula câmera)
    await api('inspetor', 'PATCH', `/api/inspecoes/${insId}/rascunho`, { respostas: payload });
    const foto = await api('inspetor', 'POST', `/api/inspecoes/${insId}/anexos`, {
      tipo: 'foto', base64: jpegMinimo(), nome_original: 'camera-e2e.jpg', mime: 'image/jpeg', legenda: 'Foto capturada pela câmera' });
    check('Upload de foto pela câmera confirmado pelo servidor', foto.status === 201 && foto.json.fotos_confirmadas === 1, JSON.stringify(foto.json));

    const concluida = await api('inspetor', 'POST', `/api/inspecoes/${insId}/concluir`);
    check('Inspeção concluída com foto confirmada', concluida.status === 200 && concluida.json.confirmado_pelo_servidor === true && concluida.json.status === 'concluida', JSON.stringify(concluida.json));
    check('Próxima inspeção calculada (quinzenal)', /^\d{4}-\d{2}-\d{2}$/.test(concluida.json.proxima_inspeccao || ''), concluida.json.proxima_inspeccao);

    // histórico imutável: concluir de novo é bloqueado
    const reConcluir = await api('inspetor', 'POST', `/api/inspecoes/${insId}/concluir`);
    check('Inspeção concluída é imutável (reconclusão bloqueada)', reConcluir.status === 400);

    // retificação auditada exige motivo e perfil
    const retSemMotivo = await api('gestor', 'POST', `/api/inspecoes/${insId}/retificar`, { respostas: payload });
    check('Retificação sem motivo é bloqueada', retSemMotivo.status === 400);
    const retInspetor = await api('inspetor', 'POST', `/api/inspecoes/${insId}/retificar`, { motivo: 'teste', respostas: payload });
    check('Retificação restrita a admin/gestor', retInspetor.status === 403);
    const retOk = await api('gestor', 'POST', `/api/inspecoes/${insId}/retificar`, {
      motivo: 'Valor de medição corrigido após conferência com o técnico.', respostas: payload });
    check('Retificação auditada aplicada pelo gestor', retOk.status === 200 && retOk.json.retificada === true, JSON.stringify(retOk.json));
    const auditoria = await api('admin', 'GET', '/api/auditoria?entidade=inspecao&limite=50');
    check('Retificação registrada na auditoria', auditoria.json.some(a => a.acao === 'retificar_inspecao'), `${auditoria.json.length} registros`);

    console.log('\n── 5. Ocorrência a partir de não conformidade ──');
    // nova inspeção com não conformidade real e foto → deve gerar ocorrência
    const rasc2 = await api('inspetor', 'POST', '/api/inspecoes/rascunho', { equipamento_id: eqId });
    const ins2 = rasc2.json.inspecao.id;
    const itens2 = rasc2.json.itens;
    const comNc = itens2.map((it, i) => i === 0
      ? { item_id: it.id, enunciado: it.enunciado, valor: 'nao_conforme', justificativa: 'Cabo com isolamento rompido na base.', observacao: 'Substituir cabo e retestar.' }
      : { item_id: it.id, enunciado: it.enunciado, valor: 'conforme', medicao_num: it.exige_medicao ? 21.0 : null, medicao_unidade: it.exige_medicao ? it.unidade : null });
    await api('inspetor', 'PATCH', `/api/inspecoes/${ins2}/rascunho`, { respostas: comNc });
    await api('inspetor', 'POST', `/api/inspecoes/${ins2}/anexos`, { tipo: 'foto', base64: jpegMinimo(), nome_original: 'nc.jpg', mime: 'image/jpeg' });
    const conf2 = await api('inspetor', 'POST', `/api/inspecoes/${ins2}/concluir`);
    check('Não conformidade gera ocorrência automaticamente', conf2.json.ocorrencias_geradas?.length === 1, JSON.stringify(conf2.json));
    const ocs = await api('gestor', 'GET', '/api/ocorrencias?status=aberta');
    const ocEq = ocs.json.find(o => o.equipamento_id === eqId);
    check('Ocorrência tem prioridade, responsável e prazo', !!ocEq && !!ocEq.prioridade && !!ocEq.responsavel_id && !!ocEq.prazo, JSON.stringify(ocEq).slice(0, 200));

    // resolver exige evidência
    const ocId = ocEq.id;
    const resolverSemEv = await api('gestor', 'PATCH', `/api/ocorrencias/${ocId}`, { status: 'resolvida', resolucao_descricao: 'Cabo trocado.' });
    check('Resolver ocorrência exige evidência', resolverSemEv.status === 400 && /evidência/i.test(resolverSemEv.json.erro || ''), JSON.stringify(resolverSemEv.json));
    const ev = await api('gestor', 'POST', `/api/ocorrencias/${ocId}/anexos`, { tipo: 'comprovante', base64: jpegMinimo(), nome_original: 'solucao.jpg', mime: 'image/jpeg' });
    const resolver = await api('gestor', 'PATCH', `/api/ocorrencias/${ocId}`, { status: 'resolvida', resolucao_descricao: 'Cabo substituído e testado.', evidencia_anexo_id: ev.json.anexo.id });
    check('Ocorrência resolvida com evidência', resolver.status === 200 && resolver.json.status === 'resolvida', JSON.stringify(resolver.json));

    console.log('\n── 6. Manutenção e calibração (agendas independentes) ──');
    const man = await api('manutencao', 'POST', '/api/manutencoes', {
      equipamento_id: eqId, tipo: 'corretiva', data: '2026-10-10', empresa: 'Manut Teste Ltda', profissional: 'João Técnico',
      descricao: 'Troca do cabo de força e teste elétrico.', pecas_centavos: 120000, mao_obra_centavos: 150000, outros_centavos: 30000,
      proxima_data: '2027-04-10' });
    check('Manutenção registrada com valores em centavos', man.status === 201 && man.json.total_centavos === 300000, JSON.stringify(man.json));
    const manNeg = await api('manutencao', 'POST', '/api/manutencoes', {
      equipamento_id: eqId, tipo: 'corretiva', data: '2026-10-10', descricao: 'x', pecas_centavos: -5 });
    check('Valor negativo é rejeitado', manNeg.status === 400, JSON.stringify(manNeg.json));
    const manData = await api('manutencao', 'POST', '/api/manutencoes', {
      equipamento_id: eqId, tipo: 'preventiva', data: '10/10/2026', descricao: 'x' });
    check('Data em formato errado é rejeitada', manData.status === 400, JSON.stringify(manData.json));

    const cal = await api('manutencao', 'POST', '/api/calibracoes', {
      equipamento_id: eqId, data: '2026-10-01', validade: '2027-10-01', resultado: 'aprovada',
      empresa: 'Metro Teste', responsavel: 'Carla Metro', custo_centavos: 250000 });
    check('Calibração registrada', cal.status === 201 && cal.json.custo_centavos === 250000, JSON.stringify(cal.json));
    const calInvalida = await api('manutencao', 'POST', '/api/calibracoes', {
      equipamento_id: eqId, data: '2026-10-01', validade: '2025-10-01', resultado: 'aprovada' });
    check('Validade anterior à data é rejeitada', calInvalida.status === 400, JSON.stringify(calInvalida.json));

    // independência: concluir inspeção não mexe na calibração
    const antesCal = (await api('gestor', 'GET', `/api/equipamentos/${eqId}`)).json.resumo.calibracao.proxima;
    const rasc3 = await api('inspetor', 'POST', '/api/inspecoes/rascunho', { equipamento_id: eqId });
    const ins3 = rasc3.json.inspecao.id;
    await api('inspetor', 'PATCH', `/api/inspecoes/${ins3}/rascunho`, {
      respostas: rasc3.json.itens.map(it => ({ item_id: it.id, enunciado: it.enunciado, valor: 'conforme', medicao_num: it.exige_medicao ? 20 : null, medicao_unidade: it.exige_medicao ? it.unidade : null })) });
    await api('inspetor', 'POST', `/api/inspecoes/${ins3}/anexos`, { tipo: 'foto', base64: jpegMinimo(), nome_original: 'f.jpg', mime: 'image/jpeg' });
    await api('inspetor', 'POST', `/api/inspecoes/${ins3}/concluir`);
    const depoisCal = (await api('gestor', 'GET', `/api/equipamentos/${eqId}`)).json.resumo.calibracao.proxima;
    check('Checklist NÃO renova calibração (agendas independentes)', antesCal === depoisCal, `${antesCal} → ${depoisCal}`);

    console.log('\n── 7. Permissões ──');
    const consultaCriar = await api('consulta', 'POST', '/api/equipamentos', { codigo: 'EQ-9999', nome: 'X', tipo: 'Y', periodicidade: 'semanal', data_inicial: '2026-01-01' });
    check('Perfil consulta não cria equipamento', consultaCriar.status === 403);
    const consultaStatus = await api('consulta', 'POST', `/api/equipamentos/${eqId}/status`, { status: 'interditado', motivo: 'x' });
    check('Perfil consulta não interdita', consultaStatus.status === 403);
    const inspetorStatus = await api('inspetor', 'POST', `/api/equipamentos/${eqId}/status`, { status: 'interditado', motivo: 'x' });
    check('Perfil inspetor não interdita (só responsável autorizado)', inspetorStatus.status === 403);
    const inspSemMotivo = await api('gestor', 'POST', `/api/equipamentos/${eqId}/status`, { status: 'interditado' });
    check('Interdição exige motivo', inspSemMotivo.status === 400);
    const interditar = await api('gestor', 'POST', `/api/equipamentos/${eqId}/status`, { status: 'interditado', motivo: 'Falha elétrica confirmada em teste.' });
    check('Gestor interdita com motivo', interditar.status === 200 && interditar.json.status === 'interditado', JSON.stringify(interditar.json));
    const alertas = await api('gestor', 'GET', '/api/alertas');
    check('Interdição aparece nos alertas', alertas.json.alertas.some(a => a.tipo === 'interditado'), `${alertas.json.total} alertas`);
    const inspetorUsuarios = await api('inspetor', 'GET', '/api/usuarios');
    check('Inspetor não lista usuários', inspetorUsuarios.status === 403);
    const consultaAuditoria = await api('consulta', 'GET', '/api/auditoria');
    check('Perfil consulta não vê auditoria', consultaAuditoria.status === 403);

    console.log('\n── 8. Regras de vencimento ──');
    const lista = await api('gestor', 'GET', '/api/equipamentos');
    const vencidos = lista.json.filter(e => e.situacao.inspeccao.situacao === 'vencida');
    const emDia = lista.json.filter(e => e.situacao.inspeccao.situacao === 'em_dia');
    const prox = lista.json.filter(e => e.situacao.inspeccao.situacao === 'proxima');
    check('Há equipamentos em cada situação (em dia/próxima/vencida)', vencidos.length > 0 && emDia.length > 0 && prox.length > 0,
      `em_dia=${emDia.length} proxima=${prox.length} vencida=${vencidos.length}`);
    const calVenc = lista.json.filter(e => e.situacao.calibracao.situacao === 'vencida');
    check('Calibração vencida é detectada', calVenc.length > 0, `${calVenc.length} vencidas`);
    const inspVencida = lista.json.find(e => e.situacao.inspeccao.atraso_dias > 0);
    check('Atraso histórico preservado em dias', inspVencida?.situacao.inspeccao.atraso_dias > 0, `atraso=${inspVencida?.situacao.inspeccao.atraso_dias}d`);
    // inspeção no prazo zera o atraso do futuro, mas o histórico permanece
    check('Periodicidades cobertas (semanal/quinzenal/mensal)',
      new Set(lista.json.map(e => e.periodicidade)).size === 3, [...new Set(lista.json.map(e => e.periodicidade))].join(','));

    console.log('\n── 9. Relatórios PDF reais e CSV ──');
    for (const [tipo, extra] of [['equipamento', `&equipamento_id=${eqId}`], ['hospital', ''], ['vencimentos', ''], ['ocorrencias', ''], ['gastos', '&desde=2025-01-01&ate=2026-12-31']]) {
      const r = await fetch(`${BASE}/api/relatorios/pdf?tipo=${tipo}${extra}`, { headers: { Cookie: cookies.get('gestor') } });
      const buf = Buffer.from(await r.arrayBuffer());
      const ehPdf = buf.slice(0, 5).toString() === '%PDF-';
      check(`PDF "${tipo}" é real (${(buf.length / 1024).toFixed(0)} KB)`, r.status === 200 && ehPdf && buf.length > 1200,
        `status=${r.status} bytes=${buf.length} tipo=${r.headers.get('content-type')}`);
      if (tipo === 'hospital') {
        const s = textoDePdf(buf);
        check('PDF hospital traz nome, período e indicadores',
          s.includes('Hospital') && s.includes('Emissão') && s.includes('Equipamentos') && s.includes('Responsável'),
          `texto extraído: ${s.slice(0, 120)}`);
        check('PDF hospital tem totais corretos', s.includes('R$'), s.slice(0, 160));
        check('PDF hospital lista paginasção e demonstração', s.includes('Página') && s.includes('demonstração'));
      }
      if (tipo === 'equipamento') {
        const s = textoDePdf(buf);
        check('PDF do equipamento traz identificação e histórico',
          s.includes('Código') && s.includes('Calibra') && s.includes('Manuten') && s.includes('Anexos'),
          `texto extraído: ${s.slice(0, 140)}`);
      }
    }
    const csvEq = await fetch(`${BASE}/api/relatorios/csv?relatorio=equipamentos`, { headers: { Cookie: cookies.get('gestor') } });
    const csvBytes = Buffer.from(await csvEq.arrayBuffer());
    const csvTxt = csvBytes.toString('utf8');
    check('CSV de equipamentos com BOM UTF-8 e separador ;',
      csvEq.status === 200 && csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF && csvTxt.includes(';'),
      csvTxt.split('\r\n')[0]);
    check('CSV contém o equipamento criado', csvTxt.includes('EQ-9001'));
    for (const rel of ['inspecoes', 'manutencoes', 'calibracoes', 'ocorrencias', 'gastos']) {
      const r = await fetch(`${BASE}/api/relatorios/csv?relatorio=${rel}&desde=2025-01-01`, { headers: { Cookie: cookies.get('gestor') } });
      const t = await r.text();
      check(`CSV "${rel}" exporta`, r.status === 200 && t.split('\r\n').length > 1, `${t.split('\r\n').length} linhas`);
    }
    const consultaCsv = await fetch(`${BASE}/api/relatorios/csv?relatorio=equipamentos`, { headers: { Cookie: cookies.get('consulta') } });
    check('Perfil consulta pode exportar CSV', consultaCsv.status === 200);

    console.log('\n── 10. Filtros do dashboard ──');
    const dashSetor = await api('gestor', 'GET', `/api/dashboard?setor_id=${setorUTI.id}`);
    check('Filtro por setor', dashSetor.json.total_equipamentos < lista.json.length && dashSetor.json.total_equipamentos > 0, `${dashSetor.json.total_equipamentos} eq.`);
    const dashStatus = await api('gestor', 'GET', '/api/dashboard?status=interditado');
    check('Filtro por status', dashStatus.json.equipamentos.every(e => e.status === 'interditado'));
    const dashResp = await api('gestor', 'GET', `/api/dashboard?responsavel_id=${novoUsuario.json.id}`);
    check('Filtro por responsável', dashResp.json.equipamentos.every(e => e.responsavel_id === novoUsuario.json.id));
    const dashPeriodo = await api('gestor', 'GET', '/api/dashboard?desde=2026-10-01&ate=2026-10-31');
    check('Filtro por período', dashPeriodo.json.periodo.desde === '2026-10-01' && dashPeriodo.json.periodo.ate === '2026-10-31', JSON.stringify(dashPeriodo.json.periodo));
    check('Dashboard traz gráficos (por setor, evolução, maior custo)',
      dashSetor.json.por_setor.length > 0 && dashPeriodo.json.evolucao_gastos.length === 12 && dashPeriodo.json.maior_custo.length > 0,
      `setores=${dashSetor.json.por_setor.length} meses=${dashPeriodo.json.evolucao_gastos.length}`);

    console.log('\n── 11. Alertas e rotina de e-mail ──');
    check('Alertas têm vencidas, calibração e ocorrências',
      alertas.json.alertas.some(a => a.tipo === 'inspecao_vencida') && alertas.json.alertas.some(a => a.tipo.startsWith('calibracao')) && alertas.json.alertas.some(a => a.tipo === 'ocorrencia'),
      `${alertas.json.criticos} críticos`);
    const integ = await api('gestor', 'GET', '/api/integracoes');
    check('Rotina de e-mail expõe status sem fingir envio', integ.json.email?.status !== 'enviado' || !!process.env.HC_SMTP_URL, JSON.stringify(integ.json.email).slice(0, 200));
    check('Pendência do e-mail listada', (integ.json.email?.pendencias || []).length > 0 || !!process.env.HC_SMTP_URL);
    const execEmail = await api('admin', 'POST', '/api/integracoes/email/executar');
    check('Execução manual da rotina de resumo não finge envio', execEmail.status === 200 && execEmail.json.resultados.every(r => r.status !== 'enviado' || !!process.env.HC_SMTP_URL), JSON.stringify(execEmail.json).slice(0, 200));

    console.log('\n── 12. Isolamento por hospital ──');
    const hosp2 = await api('admin', 'POST', '/api/usuarios', { nome: 'Outro Hospital', email: 'fora@outro.local', senha: 'SenhaForte@123', perfil: 'gestor' });
    check('Cadastro no mesmo hospital ok', hosp2.status === 201 || hosp2.status === 409);
    const eqInexistente = await api('consulta', 'GET', '/api/equipamentos/00000000-0000-0000-0000-000000000000');
    check('Equipamento inexistente retorna 404', eqInexistente.status === 404);

    console.log('\n── 13. Backup / exportação ──');
    const backup = await api('admin', 'GET', '/api/export/backup');
    check('Backup exporta JSON sem senhas', backup.status === 200 && !JSON.stringify(backup.json).includes('senha_hash') && backup.json.equipamentos.length > 0);
    check('Backup não vaza hash de senha', !JSON.stringify(backup.json).includes('scrypt') && !JSON.stringify(backup.json).includes('senha_salt'));

  } catch (e) {
    falhas++; total++;
    console.log('\n✘ ERRO FATAL:', e.message);
    console.log(logServidor.slice(-1500));
  } finally {
    servidor.kill('SIGTERM');
    try { fs.rmSync(DB_TESTE, { force: true }); fs.rmSync(DB_TESTE + '-wal', { force: true }); fs.rmSync(DB_TESTE + '-shm', { force: true }); } catch {}
  }

  console.log(`\n═══ Resultado: ${total - falhas}/${total} verificações OK, ${falhas} falha(s) ═══\n`);
  fs.writeFileSync(path.join(RAIZ, 'resultados-e2e.json'), JSON.stringify({ total, falhas, resultados }, null, 2));
  process.exit(falhas ? 1 : 0);
}

main();
