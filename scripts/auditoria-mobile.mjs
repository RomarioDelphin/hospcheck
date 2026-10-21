// Auditoria mobile SOMENTE-LEITURA — HospCheck
// Contra uma cópia descartável do servidor (banco separado, HC_SEED_DEMO=1).
// Aponte HC_BASE para o servidor desejado, ex.: HC_BASE=http://127.0.0.1:3199
// Não cria registros: não digita em formulários, não conclui inspeções, não submete modais.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright-core');

const BASE = process.env.HC_BASE || 'http://127.0.0.1:3199';
const CAP = new URL('../capturas/', import.meta.url).pathname;


const VIEWPORTS = [
  { nome: '390', width: 390, height: 844 },
  { nome: '360', width: 360, height: 800 },
  { nome: '430', width: 430, height: 932 },
  { nome: 'desktop', width: 1280, height: 900 },
];

const saida = { base: BASE, quando: new Date().toISOString(), telas: [], errosConsole: [], httpRuim: [] };

const medir = () => {
  const out = {};
  const de = document.documentElement;
  const parse = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 }; };
  const visivel = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const emScroller = (el) => { let p = el.parentElement; while (p && p !== document.body) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll') return true; p = p.parentElement; } return false; };
  const nome = (el) => { const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; return el.tagName.toLowerCase() + (c ? '.' + c : ''); };

  out.largura = { vw: innerWidth, clientW: de.clientWidth, scrollW: de.scrollWidth, bodyW: document.body.scrollWidth };
  out.rolagemHorizontal = de.scrollWidth > de.clientWidth + 1 || document.body.scrollWidth > de.clientWidth + 1;

  const transbordam = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if ((r.right > innerWidth + 1 || r.left < -1) && !emScroller(el)) transbordam.push({ el: nome(el), esq: Math.round(r.left), dir: Math.round(r.right) });
  }
  out.transbordam = transbordam.slice(0, 8);
  out.scrollersInternos = [...document.querySelectorAll('body *')].filter(el => { const ox = getComputedStyle(el).overflowX; return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1; }).length;

  const nav = document.querySelector('.barra-inferior');
  if (nav) {
    const nr = nav.getBoundingClientRect();
    const itens = [...nav.querySelectorAll('a, button')];
    out.barra = {
      visivel: nr.height > 0 && getComputedStyle(nav).visibility !== 'hidden',
      posicao: getComputedStyle(nav).position,
      altura: Math.round(nr.height),
      topoNaTela: Math.round(nr.top),
      itens: itens.length,
      rotulos: itens.map(a => (a.textContent || '').trim().replace(/\s+/g, ' ')),
      alturasAlvos: itens.map(a => Math.round(a.getBoundingClientRect().height)),
      ativoAtual: itens.filter(a => a.classList.contains('ativo')).map(a => (a.textContent || '').trim().replace(/\s+/g, ' ')),
      badge: !!nav.querySelector('.badge-contador'),
      paddingBottomConteudo: (() => { const c = document.querySelector('.conteudo'); return c ? getComputedStyle(c).paddingBottom : null; })(),
    };
  } else out.barra = null;

  const topo = document.querySelector('.topo');
  const conteudo = document.querySelector('.conteudo');
  if (topo && conteudo) {
    const tr = topo.getBoundingClientRect();
    const primeiro = conteudo.firstElementChild;
    out.topo = {
      altura: Math.round(tr.height),
      posicao: getComputedStyle(topo).position,
      conteudoComecaEm: primeiro ? Math.round(primeiro.getBoundingClientRect().top) : null,
      sobrepoeConteudo: primeiro ? primeiro.getBoundingClientRect().top < tr.bottom - 1 : false,
    };
  }

  const alvos = [...document.querySelectorAll('main button, main a, main input, main select, .barra-inferior a, .barra-inferior button')].filter(visivel);
  const medidas = alvos.map(a => { const r = a.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), t: ((a.textContent || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ') || a.tagName.toLowerCase()).slice(0, 30) }; });
  const pequenos = medidas.filter(m => m.h < 44 || m.w < 44).sort((a, b) => (a.h * a.w) - (b.h * b.w));
  out.alvos = { total: medidas.length, minH: medidas.length ? Math.min(...medidas.map(m => m.h)) : null, abaixo44: pequenos.length, piores: pequenos.slice(0, 5) };

  const folhas = [...document.querySelectorAll('main *')].filter(el => el.children.length === 0 && (el.textContent || '').trim() && visivel(el));
  const fontes = folhas.map(el => ({ el, fs: parseFloat(getComputedStyle(el).fontSize) }));
  out.fontes = { min: fontes.length ? Math.min(...fontes.map(f => f.fs)) : null, abaixo12px: fontes.filter(f => f.fs < 12).length };

  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fundoDe = (el) => { let p = el; while (p) { const c = parse(getComputedStyle(p).backgroundColor); if (c && c.a > 0.6) return c; p = p.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
  // Fundo efetivo do texto: para no primeiro ancestral OPACO (cor sólida ou gradiente).
  // Antes, texto em selo dentro de .ficha-cabecalho era medido contra o gradiente do cartão
  // (o selo tem fundo próprio) e texto branco direto no gradiente caía no fundo do body (1.08).
  const fundoEfetivo = (el) => {
    let p = el;
    while (p) {
      const st = getComputedStyle(p);
      const img = st.backgroundImage || '';
      if (img.includes('gradient')) {
        const cores = (img.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/g) || []).map(parse).filter(c => c && c.a > 0.6);
        // gradiente: vale a pior parada (a mais clara para texto claro / a mais escura para texto escuro)
        if (cores.length) return { fundos: cores, tipo: 'gradiente' };
      }
      const c = parse(st.backgroundColor);
      if (c && c.a > 0.6) return { fundos: [c], tipo: 'solido' };
      p = p.parentElement;
    }
    return { fundos: [{ r: 255, g: 255, b: 255, a: 1 }], tipo: 'padrao' };
  };
  const contrasteDe = (cor, fundos) => Math.min(...fundos.map(bg => {
    const L1 = lum(cor), L2 = lum(bg);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  }));
  let abaixo = 0, medidosSobreGradiente = 0; const pioresContraste = [];
  for (const { el, fs } of fontes) {
    const cor = parse(getComputedStyle(el).color); if (!cor) continue;
    const { fundos, tipo } = fundoEfetivo(el);
    if (tipo === 'gradiente') medidosSobreGradiente++;
    const ratio = contrasteDe(cor, fundos);
    const negrito = parseInt(getComputedStyle(el).fontWeight) >= 700;
    const exige = fs >= 18.66 || (fs >= 14 && negrito) ? 3 : 4.5;
    if (ratio < exige) { abaixo++; if (pioresContraste.length < 5) pioresContraste.push({ fs, ratio: +ratio.toFixed(2), cor: getComputedStyle(el).color, fundo: tipo, texto: (el.textContent || '').trim().slice(0, 32) }); }
  }
  out.contraste = { abaixoRegra: abaixo, medidosSobreGradiente, piores: pioresContraste };

  // Rótulos de SVG: fonte efetivamente renderizada e corte nas bordas do viewBox.
  const svgs = [...document.querySelectorAll('main svg')].filter(s => s.querySelector('text'));
  out.svgRotulos = svgs.map(svg => {
    const vb = svg.viewBox.baseVal;
    const larguraRender = svg.getBoundingClientRect().width;
    const escala = vb && vb.width ? larguraRender / vb.width : 1;
    const medidas = [...svg.querySelectorAll('text')].map(t => {
      const b = t.getBBox();
      const fsPx = parseFloat(getComputedStyle(t).fontSize);
      return { texto: (t.textContent || '').trim(), fsPx, pxReal: +(fsPx * escala).toFixed(1),
        esq: +b.x.toFixed(1), dir: +(b.x + b.width).toFixed(1) };
    });
    return {
      viewBox: vb ? `${vb.width}x${vb.height}` : null,
      escala: +escala.toFixed(2),
      rotulos: medidas.length,
      fonteMinPx: medidas.length ? Math.min(...medidas.map(m => m.pxReal)) : null,
      cortados: medidas.filter(m => m.esq < -0.5 || m.dir > (vb ? vb.width : 0) + 0.5).map(m => m.texto),
    };
  });
  return out;
};

const medirRodape = () => {
  const out = {};
  const nav = document.querySelector('.barra-inferior');
  if (!nav) { out.cobertosPelaBarra = null; return out; }
  const nr = nav.getBoundingClientRect();
  const cobertos = [];
  for (const el of document.querySelectorAll('main a, main button, main input, main select, main h1, main h2, main h3, main p, main .metrica')) {
    const r = el.getBoundingClientRect();
    if (!r.height || r.bottom < 0 || r.top > innerHeight) continue;
    if (r.top < nr.bottom && r.bottom > nr.top && r.left < nr.right && r.right > nr.left) {
      cobertos.push({ el: el.tagName.toLowerCase(), texto: ((el.textContent || '').trim().replace(/\s+/g, ' ') || el.getAttribute('aria-label') || '').slice(0, 34) });
    }
  }
  out.cobertosPelaBarra = cobertos.slice(0, 6);
  const de = document.documentElement;
  out.rolagemHorizontalAbaixo = de.scrollWidth > de.clientWidth + 1;
  return out;
};

const medirModal = () => {
  const modal = document.querySelector('.modal');
  if (!modal) return { presente: false };
  const r = modal.getBoundingClientRect();
  const fechar = modal.querySelector('.modal__fechar');
  return {
    presente: true,
    fundoCobrindoTela: !!document.querySelector('.fundo-modal'),
    dentroDaViewport: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
    largura: Math.round(r.width), altura: Math.round(r.height),
    alturaMaxima: getComputedStyle(modal).maxHeight,
    rolagemInterna: getComputedStyle(modal).overflowY,
    botaoFechar: fechar ? Math.round(fechar.getBoundingClientRect().height) : null,
    campos: modal.querySelectorAll('input, select, textarea').length,
  };
};

async function ir(page, url, espera) {
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  if (espera) await page.waitForSelector(espera, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1100);
}

async function auditoriaTela(page, vp, nomeTela, url, espera) {
  await ir(page, url, espera);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const topo = await page.evaluate(medir);
  const shot = `aud-${vp}-${nomeTela}.png`;
  await page.screenshot({ path: `${CAP}/${shot}` });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(450);
  const rodape = await page.evaluate(medirRodape);
  saida.telas.push({ vp, tela: nomeTela, url: page.url().replace(BASE, ''), captura: shot, ...topo, aoRolarAteOFim: rodape });
  const svg = topo.svgRotulos?.[0];
  console.log(`[${vp}] ${nomeTela}: hscroll=${topo.rolagemHorizontal} transbordam=${topo.transbordam.length} alvos<44=${topo.alvos.abaixo44} fonteMin=${topo.fontes.min} contrasteRuim=${topo.contraste.abaixoRegra} cobertosBarra=${(rodape.cobertosPelaBarra || []).length}` + (svg ? ` svg[min=${svg.fonteMinPx}px cortados=${svg.cortados.length}]` : ''));
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function main() {
  // Prévia: confirma que o alvo é mesmo um HospCheck em pé (e registra a instância).
  const saude = await fetch(BASE + '/api/health').catch(() => null);
  if (!saude || !saude.ok) {
    throw new Error(`Servidor indisponível em ${BASE}. Suba uma cópia descartável antes da auditoria.`);
  }
  const instancia = saude.headers.get('x-hospcheck-instancia');
  console.log(`alvo: ${BASE} · instância ${instancia || '(sem identificador)'} · ${JSON.stringify(await saude.json())}`);

  const navegador = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') saida.errosConsole.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => saida.httpRuim.push({ tipo: 'pageerror', msg: e.message.slice(0, 200) }));
  page.on('response', r => { if (r.status() >= 400) saida.httpRuim.push({ status: r.status(), url: r.url().replace(BASE, '') }); });

  // Login de administrador (autenticação de demonstração)
  await ir(page, '/entrar', '#email');
  await page.fill('#email', 'admin@demo.hospcheck.local');
  await page.fill('#senha', 'Demo@administrador2026');
  await page.click('button[type=submit]');
  await page.waitForTimeout(1600);
  console.log('login ->', page.url().replace(BASE, ''));

  // Ficha: pega um equipamento real pela API (somente leitura)
  const eqResp = await ctx.request.get(`${BASE}/api/equipamentos`);
  const eqLista = await eqResp.json();
  const eq = Array.isArray(eqLista) ? eqLista[0] : eqLista.equipamentos?.[0];
  if (!eq?.id) throw new Error('sem equipamento para a ficha: ' + JSON.stringify(eqLista).slice(0, 150));

  // Inspeção real da cópia (rascunho se existir): nada de UUID fixo que pode não existir.
  const fichaResp = await ctx.request.get(`${BASE}/api/equipamentos/${eq.id}`);
  const ficha = await fichaResp.json();
  const insps = ficha.historico?.inspecoes || [];
  const insp = insps.find(i => i.status === 'rascunho') || insps[0];
  console.log(`ficha ${eq.codigo}: ${insps.length} inspeção(ões); usando ${insp?.id ? insp.status : 'nenhuma'}`);

  const telas = [
    ['painel', '/', '.metrica'],
    ['equipamentos', '/equipamentos', null],
    ['ficha', `/equipamentos/${eq.id}`, '.ficha-cabecalho__nome'],
    ...(insp?.id ? [['inspecao', `/inspecoes/${insp.id}`, '.item-checklist']] : []),
    ['manutencoes', '/manutencoes', null],
    ['config', '/config', null],
    ['trocar-senha', '/trocar-senha', '#senha-atual'],
  ];

  for (const { nome: vpNome, width: w, height: h } of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h });
    for (const [nomeTela, url, espera] of telas) {
      if (nomeTela === 'manutencoes') {
        await ir(page, url, espera);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator('button:has-text("Registrar manutenção")').first().click({ timeout: 8000 });
        await page.waitForSelector('.modal', { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(450);
        const modal = await page.evaluate(medirModal);
        const shot = `aud-${vpNome}-modal-manutencao.png`;
        await page.screenshot({ path: `${CAP}/${shot}` });
        const base = await page.evaluate(medir);
        saida.telas.push({ vp: vpNome, tela: 'modal-manutencao', url, captura: shot, modal, ...base });
        console.log(`[${vpNome}] modal-manutencao: aberto=${modal.presente} dentroViewport=${modal.dentroDaViewport} campos=${modal.campos} fechar=${modal.botaoFechar}px`);
        const fechar = page.locator('.modal__fechar');
        if (await fechar.count()) await fechar.first().click().catch(() => {});
        await page.waitForTimeout(300);
        continue;
      }
      await auditoriaTela(page, vpNome, nomeTela, url, espera);
    }
  }

  await navegador.close();

  const hscroll = saida.telas.filter(t => t.rolagemHorizontal);
  const cobertos = saida.telas.filter(t => (t.aoRolarAteOFim?.cobertosPelaBarra || []).length > 0);
  const contrasteRuim = saida.telas.filter(t => (t.contraste?.abaixoRegra || 0) > 0);
  const svgRuim = saida.telas.filter(t => (t.svgRotulos || []).some(s => s.cortados.length));
  const resumo = {
    telasAuditadas: saida.telas.length,
    comRolagemHorizontal: hscroll.map(t => `${t.vp}/${t.tela}`),
    comConteudoAbaixoDaBarra: cobertos.map(t => `${t.vp}/${t.tela}`),
    comContrasteAbaixo: contrasteRuim.map(t => `${t.vp}/${t.tela}`),
    comRotuloSvgCortado: svgRuim.map(t => `${t.vp}/${t.tela}`),
    errosConsole: saida.errosConsole.length,
    http4xx5xx: saida.httpRuim,
  };
  console.log('\nRESUMO ' + JSON.stringify(resumo, null, 1));
  fs.writeFileSync(new URL('../auditoria-mobile.json', import.meta.url), JSON.stringify({ ...saida, resumo }, null, 1));
}

main().catch(e => { console.error('ERRO FATAL:', e.stack || e.message); process.exit(1); });
