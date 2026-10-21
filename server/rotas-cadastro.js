// HospCheck — rotas de cadastro: hospital, setores, usuários e modelos de checklist (versionados)
import { Router } from 'express';
import { db, agoraISO, novoId, registrarAuditoria, ehDataValida } from './db.js';
import { hashSenha, listarUsuarios, pode } from './auth.js';

export const rotasCadastro = Router();

// ---------- Hospital ----------
rotasCadastro.get('/hospitais/atual', (req, res) => {
  const h = db.prepare('SELECT * FROM hospitais WHERE id = ?').get(req.usuario.hospital_id);
  res.json(h);
});

rotasCadastro.patch('/hospitais/atual', (req, res) => {
  if (!pode(req.usuario.perfil, 'config.editar')) return res.status(403).json({ erro: 'Sem permissão para alterar a configuração do hospital.' });
  const h = db.prepare('SELECT * FROM hospitais WHERE id = ?').get(req.usuario.hospital_id);
  const b = req.body || {};
  const campos = ['nome', 'nome_fantasia', 'cnpj', 'endereco', 'telefone'];
  const sets = [], vals = [];
  for (const c of campos) if (b[c] !== undefined) { sets.push(`${c} = ?`); vals.push(b[c] || null); }
  for (const c of ['antecedencia_inspecao_dias', 'antecedencia_calibracao_dias', 'antecedencia_manutencao_dias']) {
    if (b[c] !== undefined) {
      const n = Number(b[c]);
      if (!Number.isInteger(n) || n < 0 || n > 365) return res.status(400).json({ erro: `${c} deve ser inteiro entre 0 e 365.` });
      sets.push(`${c} = ?`); vals.push(n);
    }
  }
  if (!sets.length) return res.status(400).json({ erro: 'Nada a atualizar.' });
  sets.push('atualizado_em = ?'); vals.push(agoraISO(), h.id);
  db.prepare(`UPDATE hospitais SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  req.auditar('atualizar', 'hospital', h.id, h, b);
  res.json(db.prepare('SELECT * FROM hospitais WHERE id = ?').get(h.id));
});

// ---------- Setores ----------
rotasCadastro.get('/setores', (req, res) => {
  res.json(db.prepare('SELECT * FROM setores WHERE hospital_id = ? ORDER BY nome').all(req.usuario.hospital_id));
});

rotasCadastro.post('/setores', (req, res) => {
  if (!pode(req.usuario.perfil, 'config.editar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const { nome, andar } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Nome do setor é obrigatório.' });
  const dup = db.prepare('SELECT id FROM setores WHERE hospital_id = ? AND lower(nome) = lower(?)').get(req.usuario.hospital_id, nome.trim());
  if (dup) return res.status(409).json({ erro: 'Já existe um setor com esse nome.' });
  const id = novoId();
  db.prepare('INSERT INTO setores (id,hospital_id,nome,andar,ativo,criado_em,atualizado_em) VALUES (?,?,?,?,1,?,?)')
    .run(id, req.usuario.hospital_id, nome.trim(), andar || null, agoraISO(), agoraISO());
  req.auditar('criar', 'setor', id, null, { nome, andar });
  res.status(201).json(db.prepare('SELECT * FROM setores WHERE id = ?').get(id));
});

rotasCadastro.patch('/setores/:id', (req, res) => {
  if (!pode(req.usuario.perfil, 'config.editar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const s = db.prepare('SELECT * FROM setores WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!s) return res.status(404).json({ erro: 'Setor não encontrado.' });
  const { nome, andar, ativo } = req.body || {};
  db.prepare('UPDATE setores SET nome = ?, andar = ?, ativo = ?, atualizado_em = ? WHERE id = ?')
    .run(nome?.trim() || s.nome, andar ?? s.andar, ativo === undefined ? s.ativo : (ativo ? 1 : 0), agoraISO(), s.id);
  req.auditar('atualizar', 'setor', s.id, s, req.body);
  res.json(db.prepare('SELECT * FROM setores WHERE id = ?').get(s.id));
});

// ---------- Usuários ----------
rotasCadastro.get('/usuarios', (req, res) => {
  if (!pode(req.usuario.perfil, 'config.editar')) return res.status(403).json({ erro: 'Sem permissão.' });
  res.json(listarUsuarios(req.usuario.hospital_id));
});

rotasCadastro.post('/usuarios', (req, res) => {
  if (!pode(req.usuario.perfil, 'config.editar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const { nome, email, senha, perfil, telefone } = req.body || {};
  if (!nome?.trim() || !email?.trim()) return res.status(400).json({ erro: 'Nome e e-mail são obrigatórios.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ erro: 'E-mail inválido.' });
  if (!senha || senha.length < 8) return res.status(400).json({ erro: 'A senha deve ter no mínimo 8 caracteres.' });
  const permitidos = ['administrador', 'gestor', 'inspetor', 'manutencao', 'consulta'];
  if (!permitidos.includes(perfil)) return res.status(400).json({ erro: 'Perfil inválido.' });
  const dup = db.prepare('SELECT id FROM usuarios WHERE hospital_id = ? AND lower(email) = lower(?)').get(req.usuario.hospital_id, email.trim());
  if (dup) return res.status(409).json({ erro: 'Já existe usuário com este e-mail.' });
  const { salt, hash } = hashSenha(senha);
  const id = novoId();
  // Senha inicial definida pelo administrador; o usuário pode trocá-la em "Mais → Trocar minha senha".
  db.prepare(`INSERT INTO usuarios (id,hospital_id,nome,email,senha_hash,senha_salt,perfil,telefone,ativo,
                deve_trocar_senha,criado_em,atualizado_em)
              VALUES (?,?,?,?,?,?,?,?,1,0,?,?)`)
    .run(id, req.usuario.hospital_id, nome.trim(), email.trim().toLowerCase(), hash, salt, perfil, telefone || null, agoraISO(), agoraISO());
  req.auditar('criar', 'usuario', id, null, { nome, email, perfil, troca_senha_obrigatoria: true });
  res.status(201).json(db.prepare('SELECT id,nome,email,perfil,telefone,ativo,deve_trocar_senha FROM usuarios WHERE id = ?').get(id));
});

rotasCadastro.patch('/usuarios/:id', (req, res) => {
  if (!pode(req.usuario.perfil, 'config.editar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ? AND hospital_id = ?').get(req.params.id, req.usuario.hospital_id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  const { nome, perfil, telefone, ativo, senha } = req.body || {};
  const sets = [], vals = [];
  if (nome) { sets.push('nome = ?'); vals.push(nome.trim()); }
  if (perfil) {
    if (!['administrador', 'gestor', 'inspetor', 'manutencao', 'consulta'].includes(perfil)) return res.status(400).json({ erro: 'Perfil inválido.' });
    sets.push('perfil = ?'); vals.push(perfil);
  }
  if (telefone !== undefined) { sets.push('telefone = ?'); vals.push(telefone || null); }
  if (ativo !== undefined) {
    if (u.id === req.usuario.id && !ativo) return res.status(400).json({ erro: 'Você não pode desativar a própria conta.' });
    sets.push('ativo = ?'); vals.push(ativo ? 1 : 0);
  }
  if (senha) {
    if (senha.length < 8) return res.status(400).json({ erro: 'A senha deve ter no mínimo 8 caracteres.' });
    const { salt, hash } = hashSenha(senha);
    // Redefinição pelo administrador é provisória: exige novo troca no acesso seguinte.
    sets.push('senha_hash = ?', 'senha_salt = ?', 'deve_trocar_senha = 1'); vals.push(hash, salt);
  }
  if (!sets.length) return res.status(400).json({ erro: 'Nada a atualizar.' });
  sets.push('atualizado_em = ?'); vals.push(agoraISO(), u.id);
  db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  if (senha) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
  req.auditar('atualizar', 'usuario', u.id,
    { nome: u.nome, perfil: u.perfil, ativo: u.ativo }, { ...req.body, senha: senha ? '(redefinida)' : undefined });
  res.json(db.prepare('SELECT id,nome,email,perfil,telefone,ativo,deve_trocar_senha FROM usuarios WHERE id = ?').get(u.id));
});

// ---------- Modelos de checklist (versionados) ----------
rotasCadastro.get('/modelos-checklist', (req, res) => {
  const modelos = db.prepare('SELECT * FROM modelos_checklist WHERE hospital_id = ? ORDER BY nome, versao DESC').all(req.usuario.hospital_id);
  const itens = db.prepare(`SELECT i.* FROM itens_checklist i JOIN modelos_checklist m ON m.id = i.modelo_id
                            WHERE m.hospital_id = ? AND i.ativo = 1 ORDER BY i.ordem`).all(req.usuario.hospital_id);
  res.json(modelos.map(m => ({ ...m, itens: itens.filter(i => i.modelo_id === m.id) })));
});

function validarItens(itens) {
  if (!Array.isArray(itens) || !itens.length) return 'Informe ao menos um item de checklist.';
  for (const [i, it] of itens.entries()) {
    if (!it?.enunciado?.trim()) return `Item ${i + 1}: enunciado é obrigatório.`;
    if (it.exige_medicao && !it.unidade?.trim()) return `Item ${i + 1}: medição numérica exige unidade (ex.: °C, cmH₂O, V).`;
  }
  return null;
}

// Cria um NOVO modelo com versão incrementada (versionamento por cópia — o histórico nunca se perde)
rotasCadastro.post('/modelos-checklist', (req, res) => {
  if (!pode(req.usuario.perfil, 'checklist.editar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const { nome, tipo_equipamento, itens, base_modelo_id } = req.body || {};
  if (!nome?.trim()) return res.status(400).json({ erro: 'Nome do modelo é obrigatório.' });
  const erro = validarItens(itens); if (erro) return res.status(400).json({ erro });

  let versao = 1, modeloId;
  const base = base_modelo_id ? db.prepare('SELECT * FROM modelos_checklist WHERE id = ? AND hospital_id = ?').get(base_modelo_id, req.usuario.hospital_id) : null;
  if (base) {
    const max = db.prepare('SELECT MAX(versao) AS v FROM modelos_checklist WHERE hospital_id = ? AND nome = ?')
      .get(req.usuario.hospital_id, base.nome);
    versao = (max?.v || 1) + 1;
    modeloId = base.id; // mesma entidade, versão nova; itens antigos preservados por versão
  } else {
    modeloId = novoId();
  }

  const agora = agoraISO();
  if (base) {
    // desativa a versão anterior e grava a nova sob o mesmo id, mantendo o histórico de versões em `modelos_historico`
    db.prepare('UPDATE itens_checklist SET ativo = 0 WHERE modelo_id = ?').run(modeloId);
    db.prepare('UPDATE modelos_checklist SET versao = ?, atualizado_em = ? WHERE id = ?').run(versao, agora, modeloId);
  } else {
    db.prepare(`INSERT INTO modelos_checklist (id,hospital_id,nome,tipo_equipamento,versao,ativo,criado_por,criado_em,atualizado_em)
                VALUES (?,?,?, ?,1,1,?,?,?)`)
      .run(modeloId, req.usuario.hospital_id, nome.trim(), tipo_equipamento || null, req.usuario.id, agora, agora);
  }
  itens.forEach((it, i) => {
    db.prepare(`INSERT INTO itens_checklist (id,modelo_id,ordem,enunciado,exige_justificativa,exige_medicao,unidade,ativo)
                VALUES (?,?,?,?,?,?,?,1)`)
      .run(novoId(), modeloId, i + 1, it.enunciado.trim(), it.exige_justificativa ? 1 : 0,
        it.exige_medicao ? 1 : 0, it.unidade?.trim() || null);
  });
  // Snapshot imutável das respostas já referencia o enunciado, então o histórico preserva o texto vigente à época.
  req.auditar(base ? 'novo_versionamento' : 'criar', 'modelo_checklist', modeloId, base || null, { nome, versao, itens: itens.length });
  const completo = db.prepare('SELECT * FROM modelos_checklist WHERE id = ?').get(modeloId);
  const its = db.prepare('SELECT * FROM itens_checklist WHERE modelo_id = ? AND ativo = 1 ORDER BY ordem').all(modeloId);
  res.status(201).json({ ...completo, itens: its });
});

// Auditoria dos modelos (quem versionou o quê)
rotasCadastro.get('/modelos-checklist/:id/auditoria', (req, res) => {
  if (!pode(req.usuario.perfil, 'auditoria.ver')) return res.status(403).json({ erro: 'Sem permissão.' });
  res.json(db.prepare(`SELECT * FROM auditoria WHERE entidade = 'modelo_checklist' AND entidade_id = ? ORDER BY criado_em DESC`)
    .all(req.params.id));
});

// ---------- Auditoria (global) ----------
rotasCadastro.get('/auditoria', (req, res) => {
  if (!pode(req.usuario.perfil, 'auditoria.ver')) return res.status(403).json({ erro: 'Sem permissão.' });
  const { entidade, usuario_id, limite } = req.query;
  const cl = ['hospital_id = ?'], vals = [req.usuario.hospital_id];
  if (entidade) { cl.push('entidade = ?'); vals.push(entidade); }
  if (usuario_id) { cl.push('usuario_id = ?'); vals.push(usuario_id); }
  vals.push(Math.min(Number(limite) || 200, 1000));
  res.json(db.prepare(`SELECT * FROM auditoria WHERE ${cl.join(' AND ')} ORDER BY criado_em DESC LIMIT ?`).all(...vals));
});

// ---------- Exportação / backup ----------
rotasCadastro.get('/export/backup', (req, res) => {
  if (!pode(req.usuario.perfil, 'exportar')) return res.status(403).json({ erro: 'Sem permissão.' });
  const hid = req.usuario.hospital_id;
  const g = (t) => db.prepare(`SELECT * FROM ${t} WHERE hospital_id = ?`).all(hid);
  const semHash = (usuarios) => usuarios.map(({ senha_hash, senha_salt, ...resto }) => resto);
  const pacote = {
    gerado_em: agoraISO(), aplicacao: 'HospCheck', versao: '1.0.0', observacao: 'Backup de demonstração',
    hospitais: db.prepare('SELECT * FROM hospitais WHERE id = ?').all(hid),
    usuarios: semHash(g('usuarios')), setores: g('setores'), equipamentos: g('equipamentos'),
    modelos_checklist: g('modelos_checklist'),
    itens_checklist: db.prepare(`SELECT i.* FROM itens_checklist i JOIN modelos_checklist m ON m.id = i.modelo_id WHERE m.hospital_id = ?`).all(hid),
    inspecoes: g('inspecoes'),
    respostas_inspecao: db.prepare(`SELECT r.* FROM respostas_inspecao r JOIN inspecoes i ON i.id = r.inspecao_id WHERE i.hospital_id = ?`).all(hid),
    ocorrencias: g('ocorrencias'), manutencoes: g('manutencoes'), calibracoes: g('calibracoes'),
    agendas: g('agendas'), anexos: g('anexos').map(({ caminho, ...a }) => ({ ...a, caminho_interno: caminho })),
    auditoria: g('auditoria')
  };
  req.auditar('exportar_backup', 'sistema', null, null, { tabelas: Object.keys(pacote).length });
  res.setHeader('Content-Disposition', `attachment; filename="hospcheck-backup-${Date.now()}.json"`);
  res.json(pacote);
});

export function exigirData(res, valor, campo) {
  if (valor && !ehDataValida(valor)) { res.status(400).json({ erro: `${campo}: data inválida (use AAAA-MM-DD).` }); return false; }
  return true;
}
