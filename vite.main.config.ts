import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/build/main',
    rollupOptions: {
      external: [
        'electron',
        'electron-store',
        '@anthropic-ai/sdk',
        'fastify',
        '@fastify/static',
        '@fastify/http-proxy',
        'chokidar',
        'selfsigned',
        'child_process',
        'dns',
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
