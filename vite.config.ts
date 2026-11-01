import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Relative asset URLs support GitHub Pages project sites (/TurenkiFight/).
  base: './',
  build: {
    outDir: 'dist',
    // Two independent entries: the local/offline prototype and the online page.
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        online: resolve(root, 'online.html'),
      },
    },
  },
});
