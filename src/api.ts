// HospCheck — cliente de API (mesma origem via proxy do Vite em dev, direto em produção)
export type Perfil = 'administrador' | 'gestor' | 'inspetor' | 'manutencao' | 'consulta';

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  telefone?: string | null;
  hospital_id: string;
  hospital_nome?: string;
  dados_demo?: number;
  /** 1 = senha provisória: o sistema exige a troca antes de liberar as telas */
  deve_trocar_senha?: number | boolean;
  ativo?: number;
}

export interface Permissoes { [acao: string]: boolean; }

export class ErroApi extends Error {
  status: number;
  codigo?: string;
  pendentes?: string[];
  constructor(mensagem: string, status: number, codigo?: string, pendentes?: string[]) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.pendentes = pendentes;
  }
}

export interface SessaoAtual {
  usuario: UsuarioSessao;
  permissoes: Permissoes;
  integracoes?: any;
}

const BASE = '';

async function requisitar<T>(rota: string, opcoes: RequestInit = {}): Promise<T> {
  const cabecalhos: Record<string, string> = { ...(opcoes.headers as Record<string, string> || {}) };
  if (opcoes.body && typeof opcoes.body === 'string') cabecalhos['Content-Type'] = 'application/json';

  let resposta: Response;
  try {
    resposta = await fetch(BASE + rota, { ...opcoes, headers: cabecalhos, credentials: 'same-origin' });
  } catch {
    throw new ErroApi('Sem conexão com o servidor. Verifique a rede.', 0, 'SEM_REDE');
  }

  if (resposta.status === 401) {
    const destino = encodeURIComponent(window.location.pathname + window.location.search);
    if (!window.location.pathname.startsWith('/entrar')) {
      window.location.assign(`/entrar?destino=${destino}`);
    }
    throw new ErroApi('Sessão expirada. Entre novamente.', 401, 'NAO_AUTENTICADO');
  }

  const texto = await resposta.text();
  let dados: any = null;
  if (texto) { try { dados = JSON.parse(texto); } catch { dados = { _raw: texto }; } }

  if (!resposta.ok) {
    throw new ErroApi(dados?.erro || `Erro ${resposta.status}`, resposta.status, dados?.codigo, dados?.pendentes);
  }
  return dados as T;
}

export const api = {
  get: <T,>(rota: string) => requisitar<T>(rota),
  post: <T,>(rota: string, corpo?: unknown) =>
    requisitar<T>(rota, { method: 'POST', body: corpo === undefined ? undefined : JSON.stringify(corpo) }),
  patch: <T,>(rota: string, corpo?: unknown) =>
    requisitar<T>(rota, { method: 'PATCH', body: corpo === undefined ? undefined : JSON.stringify(corpo) }),
  del: <T,>(rota: string) => requisitar<T>(rota, { method: 'DELETE' })
};

/** Upload de arquivo: converte em base64 com compressão no cliente e envia com progresso. */
export function enviarArquivo(
  rota: string,
  arquivo: Blob,
  meta: Record<string, unknown>,
  aoProgresso?: (fracao: number) => void
): Promise<{ ok: boolean; anexo: { id: string; tamanho: number }; fotos_confirmadas?: number }> {
  return new Promise((resolve, reject) => {
    const leitor = new XMLHttpRequest();
    leitor.open('POST', BASE + rota);
    leitor.withCredentials = true;
    leitor.setRequestHeader('Content-Type', 'application/json');
    leitor.upload.onprogress = (e) => { if (e.lengthComputable && aoProgresso) aoProgresso(e.loaded / e.total); };
    leitor.onload = () => {
      let dados: any = null;
      try { dados = JSON.parse(leitor.responseText); } catch { dados = {}; }
      if (leitor.status >= 200 && leitor.status < 300) resolve(dados);
      else reject(new ErroApi(dados?.erro || `Falha no envio (${leitor.status})`, leitor.status, dados?.codigo));
    };
    leitor.onerror = () => reject(new ErroApi('Falha de rede no envio da foto.', 0, 'SEM_REDE'));
    leitor.onabort = () => reject(new ErroApi('Envio cancelado.', 0, 'CANCELADO'));

    const leitorArq = new FileReader();
    leitorArq.onload = () => {
      const dataUrl = String(leitorArq.result);
      leitor.send(JSON.stringify({ ...meta, base64: dataUrl.split(',')[1], mime: arquivo.type }));
    };
    leitorArq.onerror = () => reject(new ErroApi('Não foi possível ler o arquivo.', 0, 'LEITURA'));
    leitorArq.readAsDataURL(arquivo);
  });
}

/**
 * Comprime uma imagem no cliente mantendo legibilidade:
 * limita o maior lado em 1600px e usa JPEG qualidade 0.82.
 * Retorna Blob pronto para envio (e o dataURL para pré-visualização).
 */
export async function comprimirImagem(entrada: File | Blob, opcoes: { maxLado?: number; qualidade?: number } = {}):
  Promise<{ blob: Blob; dataUrl: string; largura: number; altura: number; bytesOrigem: number; bytesFinais: number }> {
  const maxLado = opcoes.maxLado ?? 1600;
  const qualidade = opcoes.qualidade ?? 0.82;

  const dataUrlOriginal = await lerDataUrl(entrada);
  const img = await carregarImagem(dataUrlOriginal);
  let { width: largura, height: altura } = img;

  if (largura > maxLado || altura > maxLado) {
    const escala = Math.min(maxLado / largura, maxLado / altura);
    largura = Math.round(largura * escala);
    altura = Math.round(altura * escala);
  }

  const tela = document.createElement('canvas');
  tela.width = largura;
  tela.height = altura;
  const ctx = tela.getContext('2d');
  if (!ctx) throw new ErroApi('Canvas indisponível neste navegador.', 0, 'CANVAS');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, largura, altura);

  const dataUrl = tela.toDataURL('image/jpeg', qualidade);
  const blob = dataUrlParaBlob(dataUrl);
  return { blob, dataUrl, largura, altura,
    bytesOrigem: entrada.size || 0, bytesFinais: blob.size };
}

function lerDataUrl(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new ErroApi('Falha ao ler a imagem.', 0, 'LEITURA'));
    r.readAsDataURL(arquivo);
  });
}

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ErroApi('Imagem inválida ou corrompida.', 0, 'IMAGEM'));
    img.src = src;
  });
}

function dataUrlParaBlob(dataUrl: string): Blob {
  const [cabecalho, corpo] = dataUrl.split(',');
  const tipo = (cabecalho.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const binario = atob(corpo);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

// ---------- Formatação ----------
export function formatarMoeda(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined || Number.isNaN(centavos)) return '—';
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Percentual pt-BR com uma casa decimal: 72.727 → "72,7%" (nunca "72.727%"). */
export function formatarPercentual(valor: number | null | undefined, casas = 1): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  if (!a || !m || !d) return '—';
  return `${d}/${m}/${a}`;
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

export function hojeISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function ehDataValida(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}
