import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const DEV_PORT = process.env.MD_PORT || '41937';

export default defineConfig({
  plugins: [wasm()],
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${DEV_PORT}`,
      '/ws': { target: `ws://127.0.0.1:${DEV_PORT}`, ws: true },
    },
  },
});
