// HospCheck — autenticação por sessão (cookie httpOnly) + perfis de acesso
import crypto from 'node:crypto';
import { db, agoraISO, novoId, registrarAuditoria } from './db.js';

const DURACAO_SESSAO_MS = 1000 * 60 * 60 * 12; // 12h
export const COOKIE = 'hospcheck_sessao';

export function hashSenha(senha, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return { salt, hash };
}
export function conferirSenha(senha, salt, hash) {
  const calc = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  const a = Buffer.from(calc, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function criarSessao(usuario, ip, userAgent) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessoes (token,usuario_id,criado_em,expira_em,ip,user_agent) VALUES (?,?,?,?,?,?)')
    .run(token, usuario.id, agoraISO(), new Date(Date.now() + DURACAO_SESSAO_MS).toISOString(), ip || null, (userAgent || '').slice(0, 300));
  return token;
}

export function usuarioDaSessao(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessoes WHERE token = ?').get(token);
  if (!s) return null;
  if (new Date(s.expira_em).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
    return null;
  }
  const u = db.prepare(`SELECT u.id,u.hospital_id,u.nome,u.email,u.perfil,u.telefone,u.ativo,u.deve_trocar_senha,
                        h.nome AS hospital_nome,h.dados_demo
                        FROM usuarios u JOIN hospitais h ON h.id = u.hospital_id WHERE u.id = ?`).get(s.usuario_id);
  if (!u || !u.ativo) return null;
  return u;
}

export function lerCookie(req, nome) {
  const hdr = req.headers.cookie;
  if (!hdr) return null;
  for (const parte of hdr.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Perfis: administrador > gestor > inspetor/manutencao > consulta
// Liberação/interdição de equipamento: apenas 'administrador' ou 'gestor' (responsável autorizado)
export function pode(perfil, acao) {
  const regras = {
    'administrador': ['*'],
    'gestor': ['equipamento.editar','equipamento.status','checklist.editar','inspecao.realizar','inspecao.retificar',
               'ocorrencia.gerir','manutencao.registrar','calibracao.registrar','relatorio.gerar','config.editar',
               'alerta.gerir','auditoria.ver','equipamento.criar','equipamento.desativar','exportar'],
    'inspetor': ['inspecao.realizar','ocorrencia.abrir','relatorio.gerar','equipamento.criar','exportar'],
    'manutencao': ['manutencao.registrar','calibracao.registrar','ocorrencia.gerir','relatorio.gerar','exportar'],
    'consulta': ['relatorio.gerar','exportar']
  };
  const lista = regras[perfil] || [];
  return lista.includes('*') || lista.includes(acao);
}

export function exigirPerfil(...perfis) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ erro: 'Não autenticado.' });
    if (!perfis.includes(req.usuario.perfil)) {
      return res.status(403).json({ erro: `Perfil "${req.usuario.perfil}" não tem permissão para esta ação.` });
    }
    next();
  };
}

export function exigirPermissao(acao) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ erro: 'Não autenticado.' });
    if (!pode(req.usuario.perfil, acao)) {
      return res.status(403).json({ erro: `Perfil "${req.usuario.perfil}" não pode executar "${acao}".` });
    }
    next();
  };
}

export function middlewareAuth(req, res, next) {
  const token = lerCookie(req, COOKIE);
  req.token = token;
  req.usuario = usuarioDaSessao(token);
  req.auditar = (acao, entidade, entidade_id, antes, depois) =>
    registrarAuditoria({
      hospital_id: req.usuario?.hospital_id, usuario_id: req.usuario?.id,
      usuario_nome: req.usuario?.nome, acao, entidade, entidade_id,
      dados_antes: antes, dados_depois: depois, ip: req.ip
    });
  next();
}

export function exigirAutenticado(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Não autenticado.', codigo: 'NAO_AUTENTICADO' });
  next();
}

export function configurarCookie(res, token, req) {
  // Cookie Secure em qualquer acesso HTTPS (inclusive atrás de proxy), ou por exigência explícita.
  const proto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const seguros = process.env.HOSPCHECK_FORCAR_HTTPS === '1' || req?.secure === true || proto === 'https';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${DURACAO_SESSAO_MS / 1000}; ${seguros ? ' Secure;' : ''}`);
}
export function limparCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

export function novoUsuario({ hospital_id, nome, email, senha, perfil, telefone, deve_trocar_senha = 0 }) {
  const { salt, hash } = hashSenha(senha);
  const id = novoId();
  db.prepare(`INSERT INTO usuarios (id,hospital_id,nome,email,senha_hash,senha_salt,perfil,telefone,ativo,
                deve_trocar_senha,criado_em,atualizado_em)
              VALUES (?,?,?,?,?,?,?, ?,1,?,?,?)`)
    .run(id, hospital_id, nome, email.trim().toLowerCase(), hash, salt, perfil, telefone || null,
      deve_trocar_senha ? 1 : 0, agoraISO(), agoraISO());
  return db.prepare('SELECT id,nome,email,perfil,telefone,ativo,deve_trocar_senha FROM usuarios WHERE id = ?').get(id);
}

export function listarUsuarios(hospital_id) {
  return db.prepare(`SELECT id,nome,email,perfil,telefone,ativo,deve_trocar_senha,criado_em
                     FROM usuarios WHERE hospital_id = ? ORDER BY nome`).all(hospital_id);
}
