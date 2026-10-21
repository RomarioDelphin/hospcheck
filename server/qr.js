// HospCheck — geração de QR Code real para a URL estável de cada equipamento
import QRCode from 'qrcode';

// A URL é estável e contém APENAS o identificador. Nenhum dado privado vai na etiqueta;
// sem autenticação a rota redireciona para o login preservando o destino.
export function urlEstavelEquipamento(req, codigoOuId) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const base = process.env.HOSPCHECK_URL_BASE || `${proto}://${host}`;
  return `${base.replace(/\/$/, '')}/e/${encodeURIComponent(codigoOuId)}`;
}

export async function qrDataUrl(texto, opts = {}) {
  return QRCode.toDataURL(texto, {
    errorCorrectionLevel: 'M', margin: 1, scale: opts.scale || 6,
    color: { dark: '#0B3D6B', light: '#FFFFFF' }
  });
}

export async function qrBuffer(texto, opts = {}) {
  return QRCode.toBuffer(texto, {
    errorCorrectionLevel: 'M', margin: 1, scale: opts.scale || 8,
    width: opts.width, color: { dark: '#0B3D6B', light: '#FFFFFF' }
  });
}
