import { defineConfig } from 'vite';
import { builtinModules } from 'module';

// PACKAGING CONTRACT — read before adding anything to `external`.
//
// electron-forge's Vite plugin sets `packagerConfig.ignore` to drop everything except `/.vite`, so
// NO node_modules directory ships inside the app. Whatever Vite does not bundle simply does not
// exist at runtime.
//
// This bit us badly. electron-store, the Anthropic SDK, fastify, chokidar and selfsigned were all
// listed here, so the packaged main bundle called require() on modules that were never shipped.
// Every packaged build died at startup with "Cannot find module 'electron-store'" — and the build
// gate never caught it, because typecheck, tests and `make` all pass without ever launching the
// artifact they produce.
//
// So: external is now ONLY things that genuinely cannot be bundled.
//   * node builtins and `electron` — provided by the runtime
//   * nodejs-whisper — a native addon, deliberately not shipped, and required inside a try/catch
//     in whisperTranscriber.ts so its absence degrades local voice instead of killing the app
//
// Anything else added here must also be physically copied into the package or the app will not
// start. `npm run verify:package` enforces that and runs as part of `npm run make`.

export default defineConfig({
  build: {
    outDir: '.vite/build/main',
    rollupOptions: {
      external: [
        'electron',
        'nodejs-whisper',
        // fastify's ajv / fast-json-stringify chain builds require() paths at runtime, so Rollup
        // cannot bundle it correctly. These are shipped as real files instead — see tools/shipDeps.mjs.
        'fastify',
        '@fastify/static',
        '@fastify/http-proxy',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
