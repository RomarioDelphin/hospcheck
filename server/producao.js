// HospCheck — provisionamento de PRODUÇÃO
// Sem demonstração: cria (uma única vez) o acesso master e desativa os logins fictícios,
// preservando equipamentos, histórico, anexos e auditoria.
import { db, agoraISO, novoId, registrarAuditoria } from './db.js';
import { hashSenha } from './auth.js';

export function garantirMaster() {
  const usuario = String(process.env.HC_MASTER_USUARIO || 'romario').trim().toLowerCase();
  const senha = String(process.env.HC_MASTER_SENHA || 'romario');
  const nome = String(process.env.HC_MASTER_NOME || 'Romário (master)');
  const hospitalNome = String(process.env.HC_HOSPITAL_NOME || 'Hospital');

  const existente = db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(usuario);
  if (existente) return { criado: false, id: existente.id };

  // Hospital de produção — nunca marcado como demonstração
  let h = db.prepare('SELECT * FROM hospitais WHERE dados_demo = 0 ORDER BY criado_em LIMIT 1').get();
  if (!h) {
    const id = novoId(), agora = agoraISO();
    db.prepare(`INSERT INTO hospitais (id,nome,nome_fantasia,cnpj,endereco,telefone,fuso,
        antecedencia_inspecao_dias,antecedencia_calibracao_dias,antecedencia_manutencao_dias,
        dados_demo,criado_em,atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`)
      .run(id, hospitalNome, null, null, null, null, 'America/Sao_Paulo', 2, 15, 7, agora, agora);
    h = db.prepare('SELECT * FROM hospitais WHERE id = ?').get(id);
  }

  const { salt, hash } = hashSenha(senha);
  const id = novoId(), agora = agoraISO();
  db.prepare(`INSERT INTO usuarios (id,hospital_id,nome,email,senha_hash,senha_salt,perfil,telefone,ativo,
      deve_trocar_senha,criado_em,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,1,1,?,?)`)
    .run(id, h.id, nome, usuario, hash, salt, 'administrador', null, agora, agora);

  // Logins fictícios deixam de funcionar (nada é apagado)
  const demo = db.prepare(`UPDATE usuarios SET ativo = 0, atualizado_em = ?
      WHERE lower(email) LIKE '%@demo.hospcheck.local' AND ativo = 1`).run(agora);

  registrarAuditoria({ hospital_id: h.id, usuario_id: id, usuario_nome: nome,
    acao: 'criar_acesso_master', entidade: 'usuario', entidade_id: id,
    dados_depois: { usuario, perfil: 'administrador', troca_senha_obrigatoria: true } });
  if (demo.changes) {
    registrarAuditoria({ hospital_id: h.id, usuario_id: id, usuario_nome: nome,
      acao: 'desativar_logins_demonstracao', entidade: 'usuario',
      dados_depois: { desativados: demo.changes, escopo: '@demo.hospcheck.local' } });
  }

  return { criado: true, id, hospital_id: h.id, demo_desativados: demo.changes };
}
