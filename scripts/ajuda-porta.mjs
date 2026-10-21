// HospCheck — utilitários compartilhados pelos scripts de verificação
import net from 'node:net';

/**
 * Reserva uma porta TCP livre e devolve o número.
 * Evita que um servidor antigo ocupando uma porta fixa faça o teste rodar
 * contra a instância errada (falhas falsas e dados de outro banco).
 */
export function portaLivre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', (e) => reject(new Error('Não foi possível reservar porta livre: ' + e.message)));
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Extrai o identificador de instância da linha de startup do servidor. */
export function instanciaDoLog(log) {
  const m = String(log || '').match(/\[HospCheck\] instância ([0-9a-f]+)/);
  return m ? m[1] : null;
}
