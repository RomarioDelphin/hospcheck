import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// HospCheck - projeto novo e independente.
// O dev server roda na porta 3000 e proxy /api para o backend Node (porta 3100).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false },
      '/arquivos': { target: 'http://127.0.0.1:3100', changeOrigin: false }
    }
  },
  preview: { port: 3000, host: '0.0.0.0' },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 }
});
