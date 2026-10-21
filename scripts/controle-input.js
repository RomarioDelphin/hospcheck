// Controle de ambiente: digita num input HTML PURO (sem React) usando a mesma
// instância de navegador headless usada nos testes de interface.
// Serve a própria página (não depende do build) para isolar a variável "app vs ambiente".
import { chromium } from 'playwright-core';
import http from 'node:http';

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>controle</title></head>
<body><label for="puro">Campo</label><input id="puro" type="text"><p id="saida">-</p>
<script>
var evs=[],el=document.getElementById('puro');
el.addEventListener('input',function(){evs.push('input:'+el.value);m()});
el.addEventListener('keydown',function(e){evs.push('keydown:'+e.key);m()});
function m(){document.getElementById('saida').textContent=JSON.stringify({v:el.value,e:evs})}
window.__estado=function(){return {valor:el.value,eventos:evs}};
</script></body></html>`;

const servidor = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGINA);
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${servidor.address().port}`;

const nav = await chromium.launch({ args: ['--no-sandbox'] });
const pg = await (await nav.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await pg.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
await pg.waitForSelector('#puro', { timeout: 10000 });

// 1) teclado real (keydown/keypress/input)
await pg.click('#puro');
await pg.keyboard.type('abc', { delay: 30 });
await pg.waitForTimeout(400);
const teclado = await pg.evaluate(() => window.__estado());
console.log('INPUT PURO (teclado real):', JSON.stringify(teclado));

// 2) page.fill
await pg.evaluate(() => { document.getElementById('puro').value = ''; });
await pg.fill('#puro', 'xyz').catch(e => console.log('  page.fill ERRO:', e.message.slice(0, 120)));
await pg.waitForTimeout(300);
const fill = await pg.evaluate(() => window.__estado());
console.log('INPUT PURO (page.fill)   :', JSON.stringify(fill));

const okTeclado = teclado.valor !== '' && teclado.eventos.some(e => e.startsWith('input:'));
const okFill = fill.valor !== '';
console.log('\n=== DIAGNÓSTICO DO AMBIENTE ===');
console.log('  teclado insere texto em input puro?  ', okTeclado ? 'SIM' : 'NÃO');
console.log('  page.fill insere texto em input puro? ', okFill ? 'SIM' : 'NÃO');
console.log('  ->', (okTeclado || okFill)
  ? 'ambiente ACEITA digitação: falhas anteriores seriam do app e precisam ser corrigidas'
  : 'ambiente NÃO insere texto: limitação do headless (não é bug do app)');

await nav.close();
servidor.close();
process.exit(0);
