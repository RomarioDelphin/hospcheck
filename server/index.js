// HospCheck — servidor principal (API + build estático), fuso America/Sao_Paulo
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, registrarAuditoria, agoraISO } from './db.js';
import { semear } from './seed.js';
import { garantirMaster } from './producao.js';
import { middlewareAuth, exigirAutenticado, criarSessao, configurarCookie, limparCookie, pode, conferirSenha, hashSenha } from './auth.js';
import { rotasCadastro } from './rotas-cadastro.js';
import { rotasEquipamentos, resolverEquipamentoPublico } from './rotas-equipamentos.js';
import { rotasInspeccoes } from './rotas-inspecoes.js';
import { rotasOperacao, servirArquivo } from './rotas-operacao.js';
import { rotasRelatorios } from './rotas-relatorios.js';
import { statusGoogle } from './integracoes.js';
import { iniciarRotinaEmail, executarResumoEmail } from './rotinas-email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT || 3100);
// Identificador desta execução: permite a operadores e aos testes confirmar
// que estão falando com o processo esperado (e não com um servidor antigo na mesma porta).
const INSTANCIA = crypto.randomBytes(4).toString('hex');

// Demonstração é OPCIONAL (HC_SEED_DEMO=1) e nunca roda em produção por acidente.
// Sem ela, o servidor provisiona apenas o acesso master (primeiro login exige troca de senha).
const MODO_DEMO = process.env.HC_SEED_DEMO === '1';
if (MODO_DEMO) {
  semear();
  console.log('[HospCheck] HC_SEED_DEMO=1 — dados fictícios de demonstração carregados.');
} else {
  const master = garantirMaster();
  console.log(master.criado
    ? `[HospCheck] acesso master criado (${process.env.HC_MASTER_USUARIO || 'romario'}) — troca de senha obrigatória no 1º acesso.`
    : '[HospCheck] acesso master já configurado.');
}

console.log(`[HospCheck] instância ${INSTANCIA} · porta ${PORTA} · banco ${process.env.HOSPCHECK_DB || '(padrão data/hospcheck.db)'} · modo ${MODO_DEMO ? 'demonstração' : 'produção'}`);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '25mb' }));
app.use((req, res, next) => {
  res.setHeader('X-HospCheck-Instancia', INSTANCIA);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Nunca armazenar documentos privados em cache compartilhado
  if (req.path.startsWith('/arquivos/') || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  next();
});

// CORS explícito para o dev do Vite (mesma origem em produção via build)
app.use((req, res, next) => {
  const origem = req.headers.origin;
  if (origem && /^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(origem)) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(middlewareAuth);

// ---------- Autenticação ----------
app.post('/api/auth/entrar', (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });
  const u = db.prepare('SELECT * FROM usuarios WHERE lower(email) = lower(?) AND ativo = 1').get(String(email).trim());
  if (!u) return res.status(401).json({ erro: 'Credenciais inválidas.' });
  if (!conferirSenha(senha, u.senha_salt, u.senha_hash)) return res.status(401).json({ erro: 'Credenciais inválidas.' });
  const token = criarSessao(u, req.ip, req.headers['user-agent']);
  configurarCookie(res, token, req);
  registrarAuditoria({ hospital_id: u.hospital_id, usuario_id: u.id, usuario_nome: u.nome,
    acao: 'entrar', entidade: 'usuario', entidade_id: u.id, ip: req.ip });
  const h = db.prepare('SELECT nome, dados_demo FROM hospitais WHERE id = ?').get(u.hospital_id);
  res.json({ ok: true, usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil,
    hospital_id: u.hospital_id, hospital_nome: h.nome, dados_demo: h.dados_demo,
    deve_trocar_senha: u.deve_trocar_senha ? 1 : 0 } });
});

// Troca da própria senha (também usada no primeiro acesso do master e de usuários criados)
app.post('/api/auth/senha', exigirAutenticado, (req, res) => {
  const { senha_atual, nova_senha } = req.body || {};
  if (!senha_atual || !nova_senha) return res.status(400).json({ erro: 'Informe a senha atual e a nova senha.' });
  if (String(nova_senha).length < 8) return res.status(400).json({ erro: 'A nova senha deve ter no mínimo 8 caracteres.' });
  if (String(nova_senha) === String(senha_atual)) return res.status(400).json({ erro: 'A nova senha deve ser diferente da atual.' });
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!u || !conferirSenha(senha_atual, u.senha_salt, u.senha_hash))
    return res.status(400).json({ erro: 'Senha atual incorreta.' });
  const { salt, hash } = hashSenha(nova_senha);
  db.prepare('UPDATE usuarios SET senha_hash = ?, senha_salt = ?, deve_trocar_senha = 0, atualizado_em = ? WHERE id = ?')
    .run(hash, salt, agoraISO(), u.id);
  // Encerra as outras sessões deste usuário (mantém a atual)
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?').run(u.id, req.token || '');
  req.auditar('alterar_senha', 'usuario', u.id, null, { troca: 'propria' });
  res.json({ ok: true });
});

app.post('/api/auth/sair', (req, res) => {
  if (req.token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(req.token);
  limparCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/eu', (req, res) => {
  if (!req.usuario) return res.status(401).json({ erro: 'Não autenticado.', codigo: 'NAO_AUTENTICADO' });
  res.json({ usuario: req.usuario, permissoes: permissoesDe(req.usuario.perfil),
    integracoes: statusGoogle() });
});

function permissoesDe(perfil) {
  const todas = ['equipamento.criar', 'equipamento.editar', 'equipamento.status', 'equipamento.desativado',
    'checklist.editar', 'inspecao.realizar', 'inspecao.retificar', 'ocorrencia.abrir', 'ocorrencia.gerir',
    'manutencao.registrar', 'calibracao.registrar', 'relatorio.gerar', 'config.editar', 'alerta.gerir',
    'auditoria.ver', 'exportar'];
  return Object.fromEntries(todas.map(a => [a, pode(perfil, a)]));
}

// ---------- Health check para hospedagem/monitoramento (sem dados sensíveis) ----------
app.get('/api/health', (req, res) => {
  try {
    const ativos = db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE ativo = 1').get().n;
    res.json({ ok: true, versao: '1.0.0', hora: agoraISO(), modo: MODO_DEMO ? 'demonstracao' : 'producao',
      usuarios_ativos: ativos });
  } catch (e) {
    res.status(503).json({ ok: false, erro: e.message });
  }
});

// ---------- QR público (não expõe dados privados) ----------
app.get('/api/publico/equipamento/:id', resolverEquipamentoPublico);

// ---------- API protegida ----------
app.use('/api', exigirAutenticado, (req, res, next) => {
  // Enquanto a senha inicial não for trocada, nada além da própria troca é liberado no servidor.
  const senhaLiberada = ['/auth/senha', '/auth/sair', '/auth/eu'].includes(req.path);
  if (req.usuario.deve_trocar_senha && !senhaLiberada) {
    return res.status(403).json({ erro: 'Troque a senha inicial para continuar.', codigo: 'SENHA_TROCA_OBRIGATORIA' });
  }
  // Integrações: status real, nunca simulação
  if (req.path === '/integracoes') {
    const st = statusGoogle();
    const pend = db.prepare(`SELECT status, COUNT(*) AS n FROM emails_pendentes GROUP BY status`).all();
    return res.json({ google: st, email: {
      status: pend.some(p => p.status === 'enviado') ? 'enviado' : (pend.some(p => p.status === 'falha') ? 'falha' : 'pendente'),
      rotina: 'executada no servidor (mesmo com o app fechado)',
      detalhes: pend.length ? pend : [{ status: 'pendente', n: 0 }],
      pendencias: provedorEmailPendencias()
    } });
  }
  if (req.path === '/integracoes/google/testar') {
    if (!pode(req.usuario.perfil, 'config.editar')) return res.status(403).json({ erro: 'Sem permissão.' });
    return res.json({ teste: 'ok', status: statusGoogle().status, observacao: 'Nenhuma chamada externa é feita sem credenciais autorizadas.' });
  }
  if (req.path === '/integracoes/email/executar') {
    if (!pode(req.usuario.perfil, 'config.editar')) return res.status(403).json({ erro: 'Sem permissão.' });
    return executarResumoEmail({ forcado: true }).then(r => res.json(r)).catch(e => res.status(500).json({ erro: e.message }));
  }
  next();
});

function provedorEmailPendencias() {
  const p = [];
  if (!process.env.HC_SMTP_URL) p.push('HC_SMTP_URL não definida — resumos ficam pendentes (nenhum envio é simulado).');
  if (!process.env.HC_EMAIL_RESUMO) p.push('HC_EMAIL_RESUMO não definida — destinatários do resumo não configurados.');
  return p;
}

app.use('/api', rotasCadastro);
app.use('/api', rotasEquipamentos);
app.use('/api', rotasInspeccoes);
app.use('/api', rotasOperacao);
app.use('/api', rotasRelatorios);
app.get('/arquivos/:id', exigirAutenticado, servirArquivo);

// ---------- Build estático ----------
const DIR_DIST = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIR_DIST)) {
  app.use(express.static(DIR_DIST, { index: false, maxAge: '1h', setHeaders: (r) => r.setHeader('Cache-Control', 'public, max-age=3600') }));
}
// SPA fallback — /e/:id (QR) cai aqui e o front redireciona preservando destino
app.get(/^\/(?!api|arquivos).*/, (req, res) => {
  if (fs.existsSync(path.join(DIR_DIST, 'index.html'))) return res.sendFile(path.join(DIR_DIST, 'index.html'));
  res.status(200).send('<h1>HospCheck — API no ar</h1><p>Build do front não encontrada. Rode <code>npm run build</code>.</p>');
});

// ---------- Tratamento de erros ----------
app.use((err, req, res, next) => {
  console.error('[HospCheck] erro:', err.message);
  res.status(500).json({ erro: 'Erro interno no servidor.', detalhe: err.message });
});

app.listen(PORTA, '0.0.0.0', () => {
  console.log(`[HospCheck] API em http://0.0.0.0:${PORTA} (TZ=${process.env.TZ})`);
  iniciarRotinaEmail();
  console.log('[HospCheck] Rotina de resumo por e-mail iniciada no servidor.');
});
