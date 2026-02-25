import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
        'electron-store',
        '@anthropic-ai/sdk',
        'child_process',
        'fs',
        'path',
        'os',
        'crypto',
        'stream',
        'http',
        'https',
        'url',
        'net',
        'tls',
        'zlib',
        'events',
        'util',
      ],
    },
  },
});
