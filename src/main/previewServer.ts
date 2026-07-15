import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyProxy from '@fastify/http-proxy';
import chokidar, { FSWatcher } from 'chokidar';
import selfsigned from 'selfsigned';
import { pickLanIp, normalizePort } from './network';

// Output directories we know how to serve, in priority order.
export const OUTPUT_DIRS = ['dist', 'out', 'build', 'public', '.vite/build', '.next'];

// Common dev-server ports to probe when the pilot asks to share a live dev server.
export const DEV_PORTS = [5173, 5174, 3000, 4321, 4200, 8080, 1420, 3001];

// Pure: pick the first candidate directory that exists under root. `exists` is injected so this is
// unit-testable without a real filesystem.
export function pickServeDir(
  root: string,
  candidates: string[],
  exists: (p: string) => boolean,
): string | null {
  for (const c of candidates) {
    const abs = path.join(root, c);
    if (exists(abs)) return abs;
  }
  return null;
}

export interface PreviewStatus {
  running: boolean;
  url: string | null;
  lanIp: string | null;
  port: number;
  https: boolean;
  mode: 'static' | 'proxy' | 'idle';
  servedDir: string | null;
  devPort: number | null;
}

interface StartOpts {
  projectPath: string;
  port?: number;
  https?: boolean;
  devPort?: number | null;
}

let server: FastifyInstance | null = null;
let watcher: FSWatcher | null = null;
let debounce: NodeJS.Timeout | null = null;

let state: PreviewStatus = {
  running: false,
  url: null,
  lanIp: null,
  port: 5757,
  https: false,
  mode: 'idle',
  servedDir: null,
  devPort: null,
};

let current: Required<StartOpts> | null = null;

function lanIp(): string | null {
  return pickLanIp(os.networkInterfaces() as never) ?? null;
}

function buildUrl(https: boolean, host: string, port: number): string {
  return `${https ? 'https' : 'http'}://${host}:${port}/`;
}

const PLACEHOLDER_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AntroDeck preview</title>
<style>body{font-family:system-ui,sans-serif;background:#0F0F0F;color:#ECECEC;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
.c{max-width:460px;padding:24px}.a{color:#CC785C}code{background:#242424;padding:2px 6px;border-radius:4px}</style>
</head><body><div class="c"><h1>◆ <span class="a">AntroDeck</span> preview</h1>
<p>No build output found yet. Run a build in your project (e.g. <code>npm run build</code>) and this
page will start serving it automatically.</p></div></body></html>`;

async function buildServer(opts: Required<StartOpts>): Promise<FastifyInstance> {
  const httpsOpts = opts.https ? await makeHttpsOptions() : undefined;
  // The https overload returns a differently-typed (secure server) instance; cast back to the
  // common FastifyInstance shape since we only use the shared request/register surface.
  const app = (
    httpsOpts ? Fastify({ https: httpsOpts }) : Fastify()
  ) as unknown as FastifyInstance;

  if (opts.devPort) {
    // Proxy mode: forward everything (including HMR websockets) to the dev server.
    await app.register(fastifyProxy, {
      upstream: `http://localhost:${opts.devPort}`,
      websocket: true,
    });
  } else {
    const servedDir = pickServeDir(opts.projectPath, OUTPUT_DIRS, (p) => {
      try { return fs.statSync(p).isDirectory(); } catch { return false; }
    });
    if (servedDir) {
      await app.register(fastifyStatic, { root: servedDir, prefix: '/' });
      // SPA-ish fallback: unknown paths return index.html when present.
      app.setNotFoundHandler((_req, reply) => {
        const index = path.join(servedDir, 'index.html');
        if (fs.existsSync(index)) reply.type('text/html').send(fs.readFileSync(index));
        else reply.code(404).send('Not found');
      });
    } else {
      app.get('/*', (_req, reply) => reply.type('text/html').send(PLACEHOLDER_HTML));
    }
  }
  return app;
}

async function makeHttpsOptions(): Promise<{ key: string; cert: string }> {
  const ip = lanIp();
  const altNames: { type: 1 | 2 | 6 | 7; value?: string; ip?: string }[] = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ];
  if (ip) altNames.push({ type: 7, ip });

  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 10);

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: ip ?? 'localhost' }],
    {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: notAfter,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'subjectAltName', altNames },
      ],
    },
  );
  return { key: pems.private, cert: pems.cert };
}

function computeMode(opts: Required<StartOpts>): PreviewStatus['mode'] {
  if (opts.devPort) return 'proxy';
  return 'static';
}

async function listen(opts: Required<StartOpts>) {
  const app = await buildServer(opts);
  await app.listen({ port: opts.port, host: '0.0.0.0' });
  server = app;

  const ip = lanIp();
  const servedDir =
    opts.devPort ? null : pickServeDir(opts.projectPath, OUTPUT_DIRS, (p) => {
      try { return fs.statSync(p).isDirectory(); } catch { return false; }
    });

  state = {
    running: true,
    url: buildUrl(opts.https, ip ?? `${os.hostname()}.local`, opts.port),
    lanIp: ip,
    port: opts.port,
    https: opts.https,
    mode: computeMode(opts),
    servedDir,
    devPort: opts.devPort ?? null,
  };
}

// Restart the HTTP server in place (same port) — used when the served output directory appears or
// changes on disk so we re-point without the pilot doing anything.
async function restart() {
  if (!current) return;
  if (server) { await server.close(); server = null; }
  await listen(current);
}

function startWatching(projectPath: string) {
  stopWatching();
  watcher = chokidar.watch(projectPath, { ignoreInitial: true, depth: 0 });
  const onChange = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      // Only static mode cares about output dirs appearing/disappearing.
      if (current && !current.devPort) {
        const nextDir = pickServeDir(current.projectPath, OUTPUT_DIRS, (p) => {
          try { return fs.statSync(p).isDirectory(); } catch { return false; }
        });
        if (nextDir !== state.servedDir) restart().catch(() => { /* ignore */ });
      }
    }, 400);
  };
  watcher.on('addDir', onChange).on('unlinkDir', onChange);
}

function stopWatching() {
  if (debounce) { clearTimeout(debounce); debounce = null; }
  if (watcher) { watcher.close().catch(() => { /* ignore */ }); watcher = null; }
}

export async function startPreview(opts: StartOpts): Promise<PreviewStatus> {
  await stopPreview();
  current = {
    projectPath: opts.projectPath,
    port: normalizePort(opts.port),
    https: !!opts.https,
    devPort: opts.devPort ?? null,
  };
  await listen(current);
  if (!current.devPort) startWatching(current.projectPath);
  return state;
}

export async function stopPreview(): Promise<void> {
  stopWatching();
  if (server) {
    try { await server.close(); } catch { /* ignore */ }
    server = null;
  }
  current = null;
  state = { ...state, running: false, url: null, mode: 'idle', servedDir: null, devPort: null };
}

export function getPreviewStatus(): PreviewStatus {
  // Refresh the LAN IP each read in case the network changed.
  if (state.running) state.lanIp = lanIp();
  return state;
}

// Probe common dev-server ports on localhost; return the first that answers.
export function detectDevPort(): Promise<number | null> {
  return new Promise((resolve) => {
    let remaining = DEV_PORTS.length;
    let found: number | null = null;

    const done = () => { if (--remaining === 0) resolve(found); };

    for (const port of DEV_PORTS) {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 500 }, (res) => {
        res.destroy();
        if (found === null) found = port;
        done();
      });
      req.on('timeout', () => { req.destroy(); done(); });
      req.on('error', () => done());
    }
  });
}
