// HospCheck — camada de dados (SQLite via node:sqlite, sem dependências nativas externas)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(__dirname, '..');
export const DIR_DADOS = path.join(RAIZ, 'data');
export const DIR_UPLOADS = path.join(DIR_DADOS, 'uploads');
for (const d of [DIR_DADOS, DIR_UPLOADS]) fs.mkdirSync(d, { recursive: true });

const dbPath = process.env.HOSPCHECK_DB || path.join(DIR_DADOS, 'hospcheck.db');
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hospitais (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  nome_fantasia TEXT,
  cnpj TEXT,
  endereco TEXT,
  telefone TEXT,
  logo_arquivo_id TEXT,
  fuso TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  antecedencia_inspecao_dias INTEGER NOT NULL DEFAULT 2,
  antecedencia_calibracao_dias INTEGER NOT NULL DEFAULT 15,
  antecedencia_manutencao_dias INTEGER NOT NULL DEFAULT 7,
  dados_demo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  senha_salt TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('administrador','gestor','inspetor','manutencao','consulta')),
  telefone TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (hospital_id, email)
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS setores (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  nome TEXT NOT NULL,
  andar TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (hospital_id, nome)
);

CREATE TABLE IF NOT EXISTS anexos (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  equipamento_id TEXT,
  inspecao_id TEXT,
  ocorrencia_id TEXT,
  manutencao_id TEXT,
  calibracao_id TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('foto','laudo','comprovante','certificado','logo','evidencia','relatorio')),
  caminho TEXT NOT NULL,
  nome_original TEXT,
  mime TEXT,
  tamanho INTEGER,
  sha256 TEXT,
  legenda TEXT,
  enviado_por TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equipamentos (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  codigo TEXT NOT NULL,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL,
  marca TEXT,
  modelo TEXT,
  serie TEXT,
  patrimonio TEXT,
  foto_arquivo_id TEXT,
  setor_id TEXT REFERENCES setores(id),
  localizacao TEXT,
  responsavel_id TEXT REFERENCES usuarios(id),
  status TEXT NOT NULL DEFAULT 'operacional'
    CHECK (status IN ('operacional','restricao','interditado','manutencao','desativado')),
  periodicidade TEXT NOT NULL DEFAULT 'quinzenal' CHECK (periodicidade IN ('semanal','quinzenal','mensal')),
  data_inicial TEXT NOT NULL,
  checklist_modelo_id TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_por TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (hospital_id, codigo)
);

CREATE TABLE IF NOT EXISTS modelos_checklist (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  nome TEXT NOT NULL,
  tipo_equipamento TEXT,
  versao INTEGER NOT NULL DEFAULT 1,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_por TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS itens_checklist (
  id TEXT PRIMARY KEY,
  modelo_id TEXT NOT NULL REFERENCES modelos_checklist(id),
  ordem INTEGER NOT NULL,
  enunciado TEXT NOT NULL,
  exige_justificativa INTEGER NOT NULL DEFAULT 0,
  exige_medicao INTEGER NOT NULL DEFAULT 0,
  unidade TEXT,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS inspecoes (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  equipamento_id TEXT NOT NULL REFERENCES equipamentos(id),
  modelo_id TEXT NOT NULL,
  modelo_versao INTEGER NOT NULL,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','concluida','retificada')),
  agendada_para TEXT,
  data_inicio TEXT NOT NULL,
  data_conclusao TEXT,
  resultado TEXT CHECK (resultado IN ('conforme','nao_conforme','nao_se_aplica')),
  nao_conforme_count INTEGER NOT NULL DEFAULT 0,
  observacao_geral TEXT,
  retificada_por TEXT,
  retificada_em TEXT,
  retificacao_motivo TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS respostas_inspecao (
  id TEXT PRIMARY KEY,
  inspecao_id TEXT NOT NULL REFERENCES inspecoes(id),
  item_id TEXT NOT NULL,
  enunciado TEXT NOT NULL,
  valor TEXT CHECK (valor IN ('conforme','nao_conforme','nao_se_aplica')),
  justificativa TEXT,
  observacao TEXT,
  medicao_num REAL,
  medicao_unidade TEXT,
  UNIQUE (inspecao_id, item_id)
);

CREATE TABLE IF NOT EXISTS ocorrencias (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  equipamento_id TEXT NOT NULL REFERENCES equipamentos(id),
  inspecao_id TEXT,
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  providencia TEXT,
  prioridade TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa','media','alta','critica')),
  responsavel_id TEXT REFERENCES usuarios(id),
  prazo TEXT,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_andamento','resolvida','cancelada')),
  evidencia_anexo_id TEXT,
  resolvida_em TEXT,
  resolvida_por TEXT,
  resolucao_descricao TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manutencoes (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  equipamento_id TEXT NOT NULL REFERENCES equipamentos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('preventiva','corretiva')),
  data TEXT NOT NULL,
  empresa TEXT,
  profissional TEXT,
  descricao TEXT NOT NULL,
  pecas_centavos INTEGER NOT NULL DEFAULT 0,
  mao_obra_centavos INTEGER NOT NULL DEFAULT 0,
  outros_centavos INTEGER NOT NULL DEFAULT 0,
  total_centavos INTEGER NOT NULL DEFAULT 0,
  proxima_data TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calibracoes (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  equipamento_id TEXT NOT NULL REFERENCES equipamentos(id),
  data TEXT NOT NULL,
  validade TEXT NOT NULL,
  resultado TEXT NOT NULL CHECK (resultado IN ('aprovada','reprovada','condicional')),
  empresa TEXT,
  responsavel TEXT,
  custo_centavos INTEGER NOT NULL DEFAULT 0,
  certificado_anexo_id TEXT,
  observacao TEXT,
  criado_por TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agendas (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  equipamento_id TEXT NOT NULL REFERENCES equipamentos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('inspecao','calibracao','manutencao')),
  ativo INTEGER NOT NULL DEFAULT 1,
  intervalo_dias INTEGER,
  intervalo_meses INTEGER,
  data_base TEXT NOT NULL,
  observacao TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria (
  id TEXT PRIMARY KEY,
  hospital_id TEXT,
  usuario_id TEXT,
  usuario_nome TEXT,
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id TEXT,
  dados_antes TEXT,
  dados_depois TEXT,
  ip TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emails_pendentes (
  id TEXT PRIMARY KEY,
  hospital_id TEXT NOT NULL REFERENCES hospitais(id),
  assunto TEXT NOT NULL,
  corpo TEXT NOT NULL,
  destinatarios TEXT,
  status TEXT NOT NULL CHECK (status IN ('pendente','enviado','falha')),
  motivo TEXT,
  criado_em TEXT NOT NULL,
  enviado_em TEXT
);
`;

db.exec(SCHEMA);

// ---------- migrações idempotentes (bancos já existentes) ----------
// Troca de senha obrigatória no primeiro acesso e em redefinições feitas pelo administrador.
const colunasUsuarios = db.prepare('PRAGMA table_info(usuarios)').all().map(c => c.name);
if (!colunasUsuarios.includes('deve_trocar_senha')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN deve_trocar_senha INTEGER NOT NULL DEFAULT 0');
}

// ---------- helpers ----------
export function agoraISO() { return new Date().toISOString(); }
export function novoId() { return randomUUID(); }

// Data "hoje" no fuso do hospital (padrão America/Sao_Paulo)
export function hojeSP(fuso = process.env.TZ || 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
export function agoraSP(fuso = process.env.TZ || 'America/Sao_Paulo') {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d);
  const g = (t) => fmt.find(p => p.type === t)?.value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

export function addDias(dataISO, dias) {
  const [a, m, d] = dataISO.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}
export function addMeses(dataISO, meses) {
  const [a, m, d] = dataISO.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, ultimo));
  return dt.toISOString().slice(0, 10);
}
// diferença em dias (b - a), arredondada
export function diffDias(a, b) {
  const da = Date.UTC(...a.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  const dbv = Date.UTC(...b.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  return Math.round((dbv - da) / 86400000);
}
export function ehDataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function registrarAuditoria({ hospital_id, usuario_id, usuario_nome, acao, entidade, entidade_id, dados_antes, dados_depois, ip }) {
  db.prepare(`INSERT INTO auditoria (id,hospital_id,usuario_id,usuario_nome,acao,entidade,entidade_id,dados_antes,dados_depois,ip,criado_em)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(novoId(), hospital_id || null, usuario_id || null, usuario_nome || null, acao, entidade, entidade_id || null,
      dados_antes ? JSON.stringify(dados_antes) : null,
      dados_depois ? JSON.stringify(dados_depois) : null,
      ip || null, agoraISO());
}

export function getHospital(id) {
  return db.prepare('SELECT * FROM hospitais WHERE id = ?').get(id);
}
export function primeiroHospital() {
  return db.prepare('SELECT * FROM hospitais ORDER BY criado_em LIMIT 1').get();
}
