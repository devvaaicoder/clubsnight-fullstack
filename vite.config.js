import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        katalog: resolve(import.meta.dirname, 'katalog.html'),
        login: resolve(import.meta.dirname, 'login.html'),
        artikel: resolve(import.meta.dirname, 'artikel.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
