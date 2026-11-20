import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        katalog: resolve(import.meta.dirname,
        login: resolve(__dirname, 'login.html'), 'katalog.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
