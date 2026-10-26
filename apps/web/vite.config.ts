import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.RIICHI_API_PORT ?? '3101';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: {
    '/api': `http://127.0.0.1:${apiPort}`,
    '/ws': { target: `ws://127.0.0.1:${apiPort}`, ws: true },
  } },
});
