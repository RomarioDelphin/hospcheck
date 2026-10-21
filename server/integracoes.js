// HospCheck — adaptador Google (Planilhas + Drive privado).
//
// IMPORTANTE: esta aplicação NÃO simula sincronização. Sem credenciais autorizadas o
// status permanece "desconectado" e nenhuma operação é fingida. As funções abaixo são os
// pontos de integração reais: quando o hospital autorizar, basta implementar `planilhas.*`
// e `drive.*` com as credenciais do backend (nunca no frontend).
//
// Credenciais devem chegar via variáveis de ambiente do servidor:
//   GOOGLE_SERVICE_ACCOUNT_JSON  (JSON da conta de serviço, como string)
//   GOOGLE_SHEETS_ID             (id da planilha de destino)
//   GOOGLE_DRIVE_FOLDER_ID       (pasta privada no Drive)
//   GOOGLE_SCOPES                (escopos, padrão: sheets + drive)
// O frontend só consulta GET /api/integracoes — nunca recebe chave nem senha.

const SCOPOS = process.env.GOOGLE_SCOPES ||
  'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

export function statusGoogle() {
  const temConta = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const temPlanilha = !!process.env.GOOGLE_SHEETS_ID;
  const temPasta = !!process.env.GOOGLE_DRIVE_FOLDER_ID;
  const conectado = temConta && temPlanilha && temPasta;

  return {
    provedor: 'google',
    planilhas: { habilitado: temConta && temPlanilha, status: conectado ? 'conectado' : 'desconectado' },
    drive: { habilitado: temConta && temPasta, status: conectado ? 'conectado' : 'desconectado' },
    status: conectado ? 'conectado' : 'desconectado',
    escopos: SCOPOS,
    sem_secrets_no_frontend: true,
    pendencias: [
      !temConta && 'Credencial de conta de serviço ausente (variável GOOGLE_SERVICE_ACCOUNT_JSON no servidor).',
      !temPlanilha && 'ID da planilha de destino não definido (GOOGLE_SHEETS_ID).',
      !temPasta && 'ID da pasta privada no Drive não definido (GOOGLE_DRIVE_FOLDER_ID).'
    ].filter(Boolean),
    proximos_passos: [
      'Criar projeto no Google Cloud e ativar Google Sheets API e Google Drive API.',
      'Criar conta de serviço, gerar chave JSON e registrar como segredo do SERVIDOR.',
      'Compartilhar a planilha e a pasta privada com o e-mail da conta de serviço (somente leitura/escrita mínima).',
      'Definir as variáveis de ambiente acima e reiniciar o backend. O status passará a "conectado" automaticamente.'
    ],
    observacao: 'Enquanto não autorizado, o HospCheck usa o banco interno SQLite como fonte operacional e mantém o espelhamento Google desligado. Nenhuma sincronização é simulada.'
  };
}

function conta() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const e = new Error('Integração Google não configurada: defina GOOGLE_SERVICE_ACCOUNT_JSON no servidor.');
    e.codigo = 'GOOGLE_NAO_CONFIGURADO';
    throw e;
  }
  return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

// Obtém token OAuth2 JWT↔access_token usando a conta de serviço (implementação real,
// sem bibliotecas externas: assina JWT RS256 com node:crypto).
async function tokenAcesso() {
  const crypto = await import('node:crypto');
  const cfg = conta();
  const agora = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cabecalho = b64({ alg: 'RS256', typ: 'JWT' });
  const corpo = b64({ iss: cfg.client_email, scope: SCOPOS, aud: 'https://oauth2.googleapis.com/token', exp: agora + 3600, iat: agora });
  const assinador = crypto.createSign('RSA-SHA256');
  assinador.update(`${cabecalho}.${corpo}`);
  const assinatura = assinador.sign(cfg.private_key).toString('base64url');
  const jwt = `${cabecalho}.${corpo}.${assinatura}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!resp.ok) throw new Error(`Falha ao obter token Google (${resp.status}).`);
  const json = await resp.json();
  return json.access_token;
}

// Espelhamento de tabelas → aba da planilha (cada tabela vira uma aba; linha de cabeçalho incluída)
export async function espelharTabela(nomeTabela, linhas) {
  const token = await tokenAcesso();
  const planilha = process.env.GOOGLE_SHEETS_ID;
  const valores = [];
  if (!linhas.length) return { ok: true, aba: nomeTabela, linhas: 0, status: 'vazio' };
  const cabecais = Object.keys(linhas[0]);
  valores.push(cabecais);
  for (const l of linhas) valores.push(cabecais.map(c => l[c] === null || l[c] === undefined ? '' : String(l[c])));

  const intervalo = `${nomeTabela}!A1`;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${planilha}/values/${encodeURIComponent(intervalo)}?valueInputOption=RAW`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: valores, majorDimension: 'ROWS' })
  });
  if (!r.ok) throw new Error(`Falha ao espelhar tabela "${nomeTabela}" (${r.status}).`);
  return { ok: true, aba: nomeTabela, linhas: linhas.length, status: 'espelhado' };
}

// Upload de documento privado (foto/laudo/PDF) para a pasta do Drive
export async function enviarParaDrive(nomeArquivo, mimeType, conteudoBase64) {
  const token = await tokenAcesso();
  const pasta = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const meta = { name: nomeArquivo, parents: [pasta] };
  const boundary = 'hospcheckboundary';
  const corpo = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${conteudoBase64}\r\n`),
    Buffer.from(`--${boundary}--`)
  ]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: corpo
  });
  if (!r.ok) throw new Error(`Falha ao enviar ao Drive (${r.status}).`);
  return { ok: true, ...(await r.json()) };
}
