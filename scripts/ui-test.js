// HospCheck — verificação da interface real no navegador (viewport mobile 360px e desktop).
// Confere: ausência de rolagem horizontal, login preservando destino (fluxo QR), dashboard,
// ficha com QR, inspeção com foto obrigatória e bloqueios por perfil na UI.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { portaLivre, instanciaDoLog } from './ajuda-porta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
// Porta livre por execução: evita falar com um servidor antigo que ocupe a porta fixa.
let PORTA = 0;
let BASE = '';
const MOBILE = { width: 390, height: 844 };

let total = 0, falhas = 0;
const check = (nome, cond, detalhe = '') => {
  total++;
  if (!cond) falhas++;
  console.log(`${cond ? '  ✔' : '  ✘'} ${nome}${detalhe && !cond ? ` — ${detalhe}` : ''}`);
};

async function semRolagemHorizontal(page, rotulo) {
  const r = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    corpo: document.body.scrollWidth
  }));
  check(`${rotulo}: sem rolagem horizontal (360–430px)`,
    r.scroll <= r.client + 1 && r.corpo <= r.client + 1,
    `scrollWidth=${r.scroll} clientWidth=${r.client} body=${r.corpo}`);
  return r;
}

async function main() {
  console.log('\n═══ HospCheck — verificação de interface ═══\n');
  PORTA = await portaLivre();
  BASE = `http://127.0.0.1:${PORTA}`;
  const DB = path.join(RAIZ, 'data', 'hospcheck-ui.db');
  for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });

  const servidor = spawn('node', ['server/index.js'], {
    // HC_SEED_DEMO=1: o teste usa os usuários fictícios; produção nunca semeia demonstração.
    cwd: RAIZ, env: { ...process.env, PORT: String(PORTA), TZ: 'America/Sao_Paulo', HOSPCHECK_DB: DB, HC_SEED_DEMO: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  servidor.stdout.on('data', d => log += d);
  servidor.stderr.on('data', d => log += d);

  const navegador = await chromium.launch({ args: ['--no-sandbox'] });
  const errosConsole = [];
  const falhasHttp = []; // { url, status } de toda resposta >= 400

  try {
    let noAr = false;
    for (let i = 0; i < 80 && !noAr; i++) {
      await new Promise(r => setTimeout(r, 250));
      try { noAr = (await fetch(BASE + '/api/auth/eu')).status === 401; } catch {}
    }
    check('Servidor sobe com o build servido', noAr, log.slice(-400));
    let idHeader = null;
    try { idHeader = (await fetch(BASE + '/api/health')).headers.get('x-hospcheck-instancia'); } catch {}
    const idLog = instanciaDoLog(log);
    check('Respostas vêm do servidor recém-iniciado (instância conferida)', !!idHeader && idHeader === idLog,
      `header=${idHeader} log=${idLog}`);

    const ctx = await navegador.newContext({ viewport: MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errosConsole.push(m.text()); });
    page.on('pageerror', e => errosConsole.push('pageerror: ' + e.message));
    page.on('response', r => { if (r.status() >= 400) falhasHttp.push({ url: r.url(), status: r.status() }); });

    console.log('\n── 1. Login mobile ──');
    await page.goto(`${BASE}/entrar`, { waitUntil: 'domcontentloaded' });
    check('Tela de login renderiza', await page.locator('text=HospCheck').first().isVisible());
    await semRolagemHorizontal(page, 'Login');
    check('Botão de entrada é grande (alvo de toque ≥ 48px)', await page.evaluate(() => {
      const b = document.querySelector('button[type=submit]');
      return b ? b.getBoundingClientRect().height >= 48 : false;
    }));
    // Produção: a tela de login NÃO pode expor logins/senhas de exemplo.
    check('Login não expõe credenciais de demonstração', (await page.locator('.credenciais-demo').count()) === 0 &&
      (await page.locator('text=Demo@').count()) === 0);

    console.log('\n── 2. Fluxo QR → login preservando destino → ficha ──');
    // Busca um equipamento real pela API para montar o destino exato do QR
    const cookie = await page.evaluate(async () => {
      const r = await fetch('/api/auth/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'gestor@demo.hospcheck.local', senha: 'Demo@gestor2026' }) });
      return r.headers.get('set-cookie');
    });
    const sess = await ctx.request.get(`${BASE}/api/equipamentos`);
    const equipamentos = await sess.json();
    const alvo = equipamentos[0];
    check('API devolve equipamentos para o teste de QR', !!alvo?.id, JSON.stringify(equipamentos).slice(0, 120));
    void cookie;

    // Abre a URL estável do QR sem sessão: deve cair no login preservando o destino
    await ctx.clearCookies();
    await page.goto(`${BASE}/e/${alvo.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const urlAposQR = page.url();
    check('QR sem sessão leva ao login', urlAposQR.includes('/entrar'), urlAposQR);
    check('Destino do QR preservado na URL de login',
      decodeURIComponent(urlAposQR).includes(`/e/${alvo.id}`), urlAposQR);

    // Entrar pela UI deve voltar ao destino do QR
    await page.fill('#email', 'gestor@demo.hospcheck.local');
    await page.fill('#senha', 'Demo@gestor2026');
    await page.click('button[type=submit]');
    await page.waitForTimeout(1400);
    check('Após login, abre a ficha do equipamento do QR',
      page.url().includes(`/equipamentos/${alvo.id}`), page.url());
    check('Ficha mostra o nome do equipamento',
      (await page.locator('.ficha-cabecalho__nome').innerText()).includes(alvo.nome.slice(0, 8)),
      await page.locator('.ficha-cabecalho__nome').innerText());
    await semRolagemHorizontal(page, 'Ficha do equipamento');

    const qrImg = page.locator('.qr-caixa img').first();
    await qrImg.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    check('QR Code visível na ficha', (await qrImg.count()) > 0);
    const qrCarregado = await page.evaluate(() => {
      const img = document.querySelector('.qr-caixa img');
      return img ? img.complete && img.naturalWidth > 100 : false;
    });
    check('Imagem do QR realmente carregada (não é placeholder)', qrCarregado);

    console.log('\n── 3. Dashboard mobile ──');
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    check('Dashboard renderiza métricas', (await page.locator('.metrica').count()) >= 8,
      `${await page.locator('.metrica').count()} métricas`);
    check('Cartões de métrica são clicáveis', (await page.locator('.metrica--clicavel').count()) >= 4);
    check('Gráfico por setor presente', (await page.locator('.grafico-barras').count()) >= 1);
    check('Gráfico SVG de evolução de gastos presente', (await page.locator('svg[role=img]').count()) >= 1);
    check('Etiqueta de demonstração visível', (await page.locator('.aviso--demo').count()) >= 1);
    await semRolagemHorizontal(page, 'Dashboard');

    // Clique num cartão métrico leva à lista filtrada
    const cartao = page.locator('.metrica--clicavel').first();
    await cartao.click();
    await page.waitForTimeout(900);
    check('Cartão métrico navega para a lista de equipamentos', page.url().includes('/equipamentos'), page.url());

    console.log('\n── 4. Barra de navegação inferior (mobile) ──');
    const barra = page.locator('.barra-inferior');
    check('Barra inferior visível no mobile', await barra.isVisible());
    check('Barra inferior tem 5 destinos', (await barra.locator('a, button').count()) === 5);
    const alturas = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.barra-inferior a, .barra-inferior button')).map(e => e.getBoundingClientRect().height));
    check('Itens da barra inferior ≥ 48px de alvo', alturas.every(a => a >= 48), JSON.stringify(alturas));

    console.log('\n── 5. Inspeção: foto obrigatória na UI ──');
    const alvoInspecionar = equipamentos.find(e => e.status === 'operacional') || equipamentos[0];
    await page.goto(`${BASE}/equipamentos/${alvoInspecionar.id}/inspecionar`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    check('Tela de inspeção abre o checklist', (await page.locator('.item-checklist').count()) > 0,
      `${await page.locator('.item-checklist').count()} itens`);
    check('Área de foto obrigatória visível', (await page.locator('.area-camera').count()) === 1);
    check('Botão "Abrir câmera" presente', (await page.locator('button:has-text("Abrir câmera")').count()) === 1);
    check('Input com capture="environment" existe no DOM',
      (await page.locator('input[capture="environment"]').count()) >= 1);
    check('Barra de progresso do checklist presente', (await page.locator('.progresso').count()) >= 1);
    await semRolagemHorizontal(page, 'Inspeção');

    // Botão de conclusão deve indicar a exigência da foto
    const textoConcluir = await page.locator('button:has-text("Concluir inspeção")').innerText().catch(() => '');
    check('Botão de conclusão menciona a foto obrigatória', /foto obrigatória/i.test(textoConcluir), textoConcluir);

    // Preenche todos os itens e confirma que continua bloqueado sem foto
    const itens = await page.locator('.item-checklist').count();
    for (let i = 0; i < itens; i++) {
      await page.locator('.item-checklist').nth(i).locator('.resposta--conforme').click();
      await page.waitForTimeout(45);
    }
    await page.waitForTimeout(1600);
    const concl = page.locator('button:has-text("Concluir inspeção")');
    check('Conclusão continua bloqueada sem foto mesmo com checklist completo',
      await concl.isDisabled(), 'botão estava habilitado sem foto');

    // Envia uma foto real pela câmera (arquivo gerado) e confirma o desbloqueio
    const jpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    await page.locator('input[capture="environment"]').first().setInputFiles({
      name: 'camera-ui.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await page.waitForTimeout(2500);
    check('Foto enviada e confirmada na UI', (await page.locator('.miniatura').count()) >= 1,
      `${await page.locator('.miniatura').count()} miniatura(s)`);
    check('Botão de conclusão desbloqueia após a foto', await concl.isEnabled());

    // Conclui de verdade e confirma a resposta do servidor
    await concl.click();
    await page.waitForTimeout(2500);
    const avisoSucesso = await page.locator('.aviso--sucesso').first().innerText().catch(() => '');
    check('Inspeção concluída com confirmação do servidor',
      /Concluída|concluída|retificada/i.test(avisoSucesso), avisoSucesso.slice(0, 160));

    console.log('\n── 6. Bloqueios por perfil na UI ──');
    const ctxConsulta = await navegador.newContext({ viewport: MOBILE, isMobile: true, hasTouch: true });
    const pConsulta = await ctxConsulta.newPage();
    await pConsulta.goto(`${BASE}/entrar`, { waitUntil: 'domcontentloaded' });
    await pConsulta.fill('#email', 'consulta@demo.hospcheck.local');
    await pConsulta.fill('#senha', 'Demo@consulta2026');
    await pConsulta.click('button[type=submit]');
    await pConsulta.waitForTimeout(1400);

    await pConsulta.goto(`${BASE}/equipamentos/${alvo.id}`, { waitUntil: 'domcontentloaded' });
    await pConsulta.waitForTimeout(800);
    check('Perfil consulta não vê botão de interditar',
      (await pConsulta.locator('button:has-text("Interditar")').count()) === 0);
    check('Perfil consulta não vê botão de editar',
      (await pConsulta.locator('a:has-text("Editar")').count()) === 0);
    check('Perfil consulta ainda vê a ficha (leitura liberada)',
      (await pConsulta.locator('.ficha-cabecalho__nome').count()) === 1);

    await pConsulta.goto(`${BASE}/config`, { waitUntil: 'domcontentloaded' });
    await pConsulta.waitForTimeout(600);
    check('Perfil consulta é bloqueado em Configurações',
      (await pConsulta.locator('text=Sem permissão').count()) >= 1);

    await pConsulta.goto(`${BASE}/equipamentos/novo`, { waitUntil: 'domcontentloaded' });
    await pConsulta.waitForTimeout(600);
    check('Perfil consulta é bloqueado no cadastro de equipamento',
      (await pConsulta.locator('text=Sem permissão').count()) >= 1);

    console.log('\n── 7. Desktop: painel lateral ──');
    const ctxDesktop = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pDesk = await ctxDesktop.newPage();
    await pDesk.goto(`${BASE}/entrar`, { waitUntil: 'domcontentloaded' });
    await pDesk.fill('#email', 'admin@demo.hospcheck.local');
    await pDesk.fill('#senha', 'Demo@administrador2026');
    await pDesk.click('button[type=submit]');
    await pDesk.waitForTimeout(1500);
    check('Painel lateral visível no desktop', await pDesk.locator('.painel-lateral').isVisible());
    check('Barra inferior oculta no desktop', !(await pDesk.locator('.barra-inferior').isVisible()));
    check('Painel lateral lista as áreas', (await pDesk.locator('.painel-lateral__nav a').count()) >= 9,
      `${await pDesk.locator('.painel-lateral__nav a').count()} links`);
    const largDesk = await pDesk.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    check('Desktop sem rolagem horizontal', largDesk);

    console.log('\n── 8. PWA ──');
    const manifest = await page.evaluate(async () => {
      const r = await fetch('/manifest.webmanifest');
      return { status: r.status, tipo: r.headers.get('content-type'), corpo: await r.text() };
    });
    check('Manifest PWA servido com tipo correto',
      manifest.status === 200 && manifest.tipo === 'application/manifest+json', manifest.tipo);
    const m = JSON.parse(manifest.corpo);
    check('Manifest tem nome, ícones, start_url e display',
      !!m.name && Array.isArray(m.icons) && m.icons.length >= 2 && !!m.start_url && !!m.display);
    check('Ícones do PWA existem', (await page.evaluate(async () =>
      (await fetch('/icone-192.svg')).status)) === 200);
    check('Tema azul declarado no meta theme-color',
      (await page.locator('meta[name="theme-color"]').getAttribute('content')) === '#0B5CAB');

    console.log('\n── 9. Erros de console ──');
    // Erros de console: ignora apenas resource-load (rastreado acima por URL/status) e
    // avisos conhecidos do navegador. Qualquer erro de página real falha aqui.
    const relevantes = errosConsole.filter(e => !/favicon|manifest.*icon|ResizeObserver|Failed to load resource/i.test(e));
    check('Sem erros de JavaScript na aplicação', relevantes.length === 0, relevantes.slice(0, 3).join(' | '));

    // HTTP: só é aceito o 401 de /api/auth/eu (sondagem de sessão antes do login).
    // Qualquer outra resposta >= 400 indica problema real na interface.
    const httpInesperadas = falhasHttp.filter(h => !(h.status === 401 && /\/api\/auth\/eu$/.test(h.url.split('?')[0])));
    check('Nenhuma falha HTTP inesperada na interface', httpInesperadas.length === 0,
      httpInesperadas.slice(0, 3).map(h => `${h.status} ${h.url}`).join(' | '));
    check('401 do teste de sessão é o único esperado (comprovado)',
      falhasHttp.every(h => h.status === 401 && /\/api\/auth\/eu$/.test(h.url.split('?')[0])) || falhasHttp.length === 0,
      `${falhasHttp.length} respostas >= 400`);

    // Capturas de tela para o dossiê
    fs.mkdirSync(path.join(RAIZ, 'capturas'), { recursive: true });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(RAIZ, 'capturas', 'mobile-dashboard.png'), fullPage: false });
    await page.goto(`${BASE}/equipamentos/${alvo.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(RAIZ, 'capturas', 'mobile-ficha.png'), fullPage: false });
    await pDesk.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await pDesk.waitForTimeout(800);
    await pDesk.screenshot({ path: path.join(RAIZ, 'capturas', 'desktop-dashboard.png'), fullPage: false });
    console.log('  capturas salvas em capturas/');

    await ctxConsulta.close();
    await ctxDesktop.close();
    await ctx.close();
  } catch (e) {
    falhas++; total++;
    console.log('\n✘ ERRO FATAL:', e.message);
    console.log(log.slice(-1200));
  } finally {
    await navegador.close();
    servidor.kill('SIGTERM');
    try { fs.rmSync(DB, { force: true }); fs.rmSync(DB + '-wal', { force: true }); fs.rmSync(DB + '-shm', { force: true }); } catch {}
  }

  console.log(`\n═══ Interface: ${total - falhas}/${total} verificações OK, ${falhas} falha(s) ═══\n`);
  fs.writeFileSync(path.join(RAIZ, 'resultados-ui.json'),
    JSON.stringify({ total, falhas }, null, 2));
  process.exit(falhas ? 1 : 0);
}

main();
