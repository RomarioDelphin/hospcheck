// HospCheck — armazenamento privado de anexos (fotos, laudos, certificados, comprovantes)
// Arquivos ficam em data/uploads e são servidos apenas com autenticação (nunca público).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, DIR_UPLOADS, agoraISO, novoId } from './db.js';

const EXT_POR_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic',
  'application/pdf': '.pdf', 'image/gif': '.gif'
};

export function salvarAnexo({ hospital_id, tipo, base64, nome_original, mime, legenda,
  equipamento_id = null, inspecao_id = null, ocorrencia_id = null, manutencao_id = null,
  calibracao_id = null, enviado_por = null }) {

  if (!base64 || typeof base64 !== 'string') throw new Error('Arquivo vazio.');
  const limpo = base64.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(limpo)) throw new Error('Conteúdo base64 inválido.');
  const buffer = Buffer.from(limpo, 'base64');
  if (!buffer.length) throw new Error('Arquivo vazio após decodificação.');
  if (buffer.length > 15 * 1024 * 1024) throw new Error('Arquivo excede o limite de 15 MB.');

  const m = mime || (base64.match(/^data:([^;]+);/) || [])[1] || 'application/octet-stream';
  const ext = EXT_POR_MIME[m] || (nome_original && path.extname(nome_original).slice(0, 6)) || '.bin';
  const id = novoId();
  const nome = `${id}${ext}`;
  const caminhoRel = path.posix.join('uploads', nome);
  fs.writeFileSync(path.join(DIR_UPLOADS, nome), buffer);

  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  db.prepare(`INSERT INTO anexos (id,hospital_id,equipamento_id,inspecao_id,ocorrencia_id,manutencao_id,calibracao_id,
      tipo,caminho,nome_original,mime,tamanho,sha256,legenda,enviado_por,criado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, hospital_id, equipamento_id, inspecao_id, ocorrencia_id, manutencao_id, calibracao_id,
      tipo, caminhoRel, nome_original || null, m, buffer.length, sha, legenda || null, enviado_por, agoraISO());
  return { id, caminho: caminhoRel, mime: m, tamanho: buffer.length, sha256: sha };
}

export function caminhoSeguro(anexo) {
  if (!anexo) return null;
  const p = path.resolve(DIR_UPLOADS, '..', anexo.caminho);
  const base = path.resolve(DIR_UPLOADS);
  if (!p.startsWith(base + path.sep) && p !== base) return null; // anti path traversal
  return p;
}

export function anexosDe(filtro) {
  const campos = { equipamento_id: 'equipamento_id', inspecao_id: 'inspecao_id', ocorrencia_id: 'ocorrencia_id',
    manutencao_id: 'manutencao_id', calibracao_id: 'calibracao_id' };
  const clausulas = [], vals = [];
  for (const [chave, valor] of Object.entries(filtro)) {
    if (campos[chave] && valor) { clausulas.push(`${campos[chave]} = ?`); vals.push(valor); }
  }
  if (!clausulas.length) return [];
  return db.prepare(`SELECT id,tipo,mime,tamanho,sha256,legenda,nome_original,criado_em,inspecao_id,ocorrencia_id,
      manutencao_id,calibracao_id,equipamento_id FROM anexos WHERE ${clausulas.join(' AND ')} ORDER BY criado_em`)
    .all(...vals);
}

export function apagarAnexosDaInspeccao(inspecao_id) {
  const lista = db.prepare('SELECT id,caminho FROM anexos WHERE inspecao_id = ?').all(inspecao_id);
  for (const a of lista) {
    const p = caminhoSeguro(a);
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.prepare('DELETE FROM anexos WHERE inspecao_id = ?').run(inspecao_id);
  return lista.length;
}
