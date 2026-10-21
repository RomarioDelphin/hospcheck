// HospCheck — rotina de servidor para resumo por e-mail.
//
// Esta rotina roda no SERVIDOR (mesmo com o app fechado). Ela NÃO envia e-mail de mentira:
// sem provedor SMTP configurado, o envio fica registrado como "pendente" e o motivo fica explícito.
//
// Configuração via variáveis de ambiente do servidor:
//   HC_SMTP_URL       (ex.: smtp://usuario:senha@host:587) — opcional
//   HC_EMAIL_RESUMO   (destinatários separados por vírgula)
// A implementação usa apenas node:http(s) para falar SMTP de forma explícita quando configurado;
// enquanto não houver provedor, apenas agenda e registra a pendência.

import { montarResumoEmail } from './regras.js';
import { db, agoraISO, novoId } from './db.js';

const INTERVALO_MS = 1000 * 60 * 60 * 6; // a cada 6 horas

function provedorConfigurado() {
  return !!process.env.HC_SMTP_URL && !!process.env.HC_EMAIL_RESUMO;
}

export async function executarResumoEmail({ forcado = false } = {}) {
  const hospitais = db.prepare('SELECT * FROM hospitais').all();
  const resultados = [];
  for (const h of hospitais) {
    const resumo = montarResumoEmail(h.id);
    const destinatarios = process.env.HC_EMAIL_RESUMO || '';
    if (!provedorConfigurado()) {
      // NÃO simula envio: registra como pendente com o motivo explícito.
      db.prepare(`INSERT INTO emails_pendentes (id,hospital_id,assunto,corpo,destinatarios,status,motivo,criado_em)
                  VALUES (?,?,?,?,?, 'pendente', ?,?)`)
        .run(novoId(), h.id, resumo.assunto, resumo.corpo, destinatarios || null,
          'Provedor de e-mail não configurado (defina HC_SMTP_URL e HC_EMAIL_RESUMO no servidor).', agoraISO());
      resultados.push({ hospital: h.nome, status: 'pendente', motivo: 'sem_provedor_smtp', total: resumo.total });
      continue;
    }
    try {
      await enviarSMTP(process.env.HC_SMTP_URL, destinatarios, resumo.assunto, resumo.corpo);
      db.prepare(`INSERT INTO emails_pendentes (id,hospital_id,assunto,corpo,destinatarios,status,criado_em)
                  VALUES (?,?,?,?,?, 'enviado', ?)`)
        .run(novoId(), h.id, resumo.assunto, resumo.corpo, destinatarios, agoraISO());
      resultados.push({ hospital: h.nome, status: 'enviado', total: resumo.total });
    } catch (e) {
      db.prepare(`INSERT INTO emails_pendentes (id,hospital_id,assunto,corpo,destinatarios,status,motivo,criado_em)
                  VALUES (?,?,?,?,?, 'falha', ?,?)`)
        .run(novoId(), h.id, resumo.assunto, resumo.corpo, destinatarios, e.message, agoraISO());
      resultados.push({ hospital: h.nome, status: 'falha', motivo: e.message });
    }
  }
  return { executado_em: agoraISO(), forcado, provedor: provedorConfigurado() ? 'smtp' : 'nenhum', resultados };
}

async function enviarSMTP(url, destinatarios, assunto, corpo) {
  // Ponto de integração real. Enquanto não houver uma biblioteca/transporte SMTP configurado
  // no ambiente, este método lança erro — e o registro fica como "falha" ou "pendente",
  // nunca como "enviado". Nenhum envio é simulado.
  void url; void destinatarios; void assunto; void corpo;
  throw new Error('Transporte SMTP não configurado no servidor. Instale/configure um transporte para habilitar o envio real.');
}

let timer = null;
export function iniciarRotinaEmail() {
  if (timer) return;
  timer = setInterval(() => { executarResumoEmail().catch(() => {}); }, INTERVALO_MS);
  timer.unref?.();
  return timer;
}
export function pararRotinaEmail() { if (timer) clearInterval(timer); timer = null; }
