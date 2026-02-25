import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/build/preload',
    rollupOptions: {
      external: ['electron'],
    },
  },
});
