// Verificação do modo produção: master romario/romario, troca obrigatória de senha,
// redefinição por administrador, ausência de logins/dados de demonstração.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { portaLivre, instanciaDoLog } from './ajuda-porta.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(RAIZ + '/package.json');
const { chromium } = require('playwright-core');
// Porta livre por execução + banco descartável próprio.
let PORTA = 0;
let BASE = '';
const DB = '/tmp/hosp-prod.db';
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });

let total = 0, falhas = 0;
const check = (nome, cond, detalhe = '') => {
  total++; if (!cond) falhas++;
  console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${!cond && detalhe ? ` — ${detalhe}` : ''}`);
};

// Porta livre por execução: evita falar com um servidor antigo que ocupe a porta fixa.
PORTA = await portaLivre();
BASE = `http://127.0.0.1:${PORTA}`;

const srv = spawn('node', ['server/index.js'], {
  cwd: RAIZ,
  env: { ...process.env, PORT: String(PORTA), TZ: 'America/Sao_Paulo', HOSPCHECK_DB: DB }, // SEM HC_SEED_DEMO
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
srv.stdout.on('data', d => log += d);
srv.stderr.on('data', d => log += d);

let cookie = '';
async function api(metodo, rota, corpo) {
  const opts = { method: metodo, headers: { 'Content-Type': 'application/json' } };
  if (cookie) opts.headers.Cookie = cookie;
  if (corpo !== undefined) opts.body = JSON.stringify(corpo);
  const r = await fetch(BASE + rota, opts);
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json, headers: r.headers };
}

try {
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 250));
    try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {}
  }

  console.log('\n== A. Provisionamento de produção (sem HC_SEED_DEMO) ==');
  const health = await api('GET', '/api/health');
  check('Respostas vêm do servidor recém-iniciado (instância conferida)',
    (health.headers?.get?.('x-hospcheck-instancia') || '') === (instanciaDoLog(log) || 'x'),
    `header=${health.headers?.get?.('x-hospcheck-instancia')} log=${instanciaDoLog(log)}`);
  check('/api/health responde e está em modo produção', health.status === 200 && health.json?.modo === 'producao',
    JSON.stringify(health.json));
  check('nenhum dado de demonstração foi semeado', (health.json?.usuarios_ativos ?? 0) === 1,
    `usuarios_ativos=${health.json?.usuarios_ativos}`);
  check('log do servidor informa criação do master', /acesso master criado \(romario\)/.test(log), log.slice(0, 200));

  console.log('\n== B. Master romario/romario e bloqueio até trocar a senha ==');
  const login = await api('POST', '/api/auth/entrar', { email: 'romario', senha: 'romario' });
  check('login romario/romario funciona', login.status === 200, JSON.stringify(login.json));
  check('login sinaliza troca de senha obrigatória', login.json?.usuario?.deve_trocar_senha === 1);
  check('master é administrador do hospital de produção', login.json?.usuario?.perfil === 'administrador' &&
    login.json?.usuario?.dados_demo === 0, JSON.stringify(login.json?.usuario));

  const bloqueado = await api('GET', '/api/equipamentos');
  check('API bloqueada enquanto a senha não é trocada', bloqueado.status === 403 &&
    bloqueado.json?.codigo === 'SENHA_TROCA_OBRIGATORIA', JSON.stringify(bloqueado.json));

  const senhaErrada = await api('POST', '/api/auth/senha', { senha_atual: 'errada', nova_senha: 'Romario@2026' });
  check('troca rejeita senha atual incorreta', senhaErrada.status === 400, JSON.stringify(senhaErrada.json));
  const senhaCurta = await api('POST', '/api/auth/senha', { senha_atual: 'romario', nova_senha: '123' });
  check('troca rejeita senha nova com menos de 8 caracteres', senhaCurta.status === 400, JSON.stringify(senhaCurta.json));

  console.log('\n== C. Navegador: login sem demo e troca obrigatória na 1ª entrada ==');
  const nav = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message.slice(0, 120)));
  await page.goto(BASE + '/entrar', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  check('tela de login sem bloco de credenciais de exemplo',
    (await page.locator('.credenciais-demo').count()) === 0 && (await page.locator('text=Demo@').count()) === 0);
  check('login aceita usuário (não exige e-mail)',
    (await page.locator('#email').getAttribute('type')) === 'text');
  await page.fill('#email', 'romario');
  await page.fill('#senha', 'romario');
  await page.click('button[type=submit]');
  await page.waitForTimeout(1800);
  check('master é levado direto para a troca de senha', page.url().endsWith('/trocar-senha'), page.url());
  check('tela de troca explica a obrigatoriedade', (await page.locator('text=troca de senha obrigatória').count()) > 0);
  await page.fill('#senha-atual', 'romario');
  await page.fill('#senha-nova', 'Romario@2026');
  await page.fill('#senha-confirma', 'Romario@2026');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2600);
  check('após trocar a senha, entra no painel', new URL(page.url()).pathname === '/', page.url());
  check('painel de produção não exibe tarja de demonstração', (await page.locator('.aviso--demo').count()) === 0);
  await page.screenshot({ path: RAIZ + '/capturas/prod-painel-master.png' });

  console.log('\n== D. Pós-troca: master cria usuário e redefine senha ==');
  const relogin = await api('POST', '/api/auth/entrar', { email: 'romario', senha: 'Romario@2026' });
  check('senha antiga não entra mais', (await api('POST', '/api/auth/entrar', { email: 'romario', senha: 'romario' })).status === 401);
  check('nova senha entra e libera a API', relogin.status === 200 && relogin.json?.usuario?.deve_trocar_senha === 0);
  const lista = await api('GET', '/api/equipamentos');
  check('base de produção começa vazia (sem equipamentos fictícios)', lista.status === 200 && Array.isArray(lista.json) && lista.json.length === 0,
    JSON.stringify(lista.json).slice(0, 120));
  const usuarios = await api('GET', '/api/usuarios');
  check('nenhum usuário @demo.hospcheck.local cadastrado',
    usuarios.status === 200 && usuarios.json.every(u => !u.email.includes('@demo.hospcheck.local')),
    (usuarios.json || []).map(u => u.email).join(','));

  const criar = await api('POST', '/api/usuarios', {
    nome: 'Técnico Teste', email: 'tecnico@hospital.local', senha: 'Inicial@123', perfil: 'inspetor'
  });
  check('master cria outro usuário pela API', criar.status === 201, JSON.stringify(criar.json));
  const loginTecnico = await api('POST', '/api/auth/entrar', { email: 'tecnico@hospital.local', senha: 'Inicial@123' });
  check('usuário criado entra com a senha inicial', loginTecnico.status === 200);

  // volta a sessão para o master (o cookie do teste é único)
  await api('POST', '/api/auth/entrar', { email: 'romario', senha: 'Romario@2026' });
  const reset = await api('PATCH', `/api/usuarios/${criar.json.id}`, { senha: 'Provisoria@456' });
  check('administrador redefine a senha do usuário', reset.status === 200 &&
    reset.json?.deve_trocar_senha === 1, JSON.stringify(reset.json));
  const loginProvisorio = await api('POST', '/api/auth/entrar', { email: 'tecnico@hospital.local', senha: 'Provisoria@456' });
  check('redefinição força troca no próximo acesso', loginProvisorio.status === 200 &&
    loginProvisorio.json?.usuario?.deve_trocar_senha === 1);
  const apiBloqueada = await api('GET', '/api/equipamentos');
  check('usuário com senha provisória fica bloqueado até trocar', apiBloqueada.status === 403 &&
    apiBloqueada.json?.codigo === 'SENHA_TROCA_OBRIGATORIA');
  const trocaTecnico = await api('POST', '/api/auth/senha', { senha_atual: 'Provisoria@456', nova_senha: 'Definitiva@789' });
  check('usuário troca a própria senha e é liberado', trocaTecnico.status === 200 &&
    (await api('GET', '/api/equipamentos')).status === 200);

  await page.goto(BASE + '/mais', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  check('atalho "Trocar minha senha" disponível para o usuário', (await page.locator('text=Trocar minha senha').count()) > 0);
  await page.screenshot({ path: RAIZ + '/capturas/prod-mais-trocar-senha.png' });
  check('sem erros de JavaScript no fluxo', erros.length === 0, JSON.stringify(erros));
  await nav.close();
} catch (e) {
  console.error('ERRO FATAL:', e.stack || e.message);
  falhas++;
} finally {
  srv.kill();
}

console.log(`\n═══ Produção: ${total - falhas}/${total} OK, ${falhas} falha(s) ═══`);
if (falhas) console.log('LOG SERVIDOR:', log.split('\n').slice(-5).join(' | '));
process.exit(falhas ? 1 : 0);
