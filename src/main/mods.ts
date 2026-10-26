// Cockpit mods — the loader.
//
// Mods live in <userData>/mods/<id>/, each with a mod.json (see modManifest.ts and docs/MODS.md).
// Nothing in a mod runs in main or in the app's window: main only reads manifests and serves files
// over anthrodeck-mod://, with a CSP that allows no network, and the renderer shows each mod game in
// a sandboxed iframe. The guards at the bottom close the remaining doors (navigating away,
// permission prompts).
import { app, protocol, session, type WebContents } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  MOD_SCHEME, MOD_PAGE_CSP, RUNTIME_PREFIX, isModId, isSafeModPath, parseManifest, type ModManifest, type ModScan,
} from './modManifest';
import { MOD_RUNTIME_JS, hostPage } from './modRuntime';

const MANIFEST = 'mod.json';
const MAX_MANIFEST_BYTES = 64 * 1024;

export function modsDir(): string {
  return path.join(app.getPath('userData'), 'mods');
}

function readManifest(root: string, folder: string): ModManifest | string {
  const file = path.join(root, folder, MANIFEST);
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { return `no ${MANIFEST}`; }
  if (stat.size > MAX_MANIFEST_BYTES) return `${MANIFEST} is larger than 64 KB`;
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return `${MANIFEST} is not valid JSON: ${(e as Error).message}`; }
  const parsed = parseManifest(raw, folder);
  if (!parsed.ok) return parsed.error;
  if (parsed.manifest.game && !resolveModFile(root, folder, parsed.manifest.game.entry)) {
    return `game.entry "${parsed.manifest.game.entry}" is missing`;
  }
  return parsed.manifest;
}

// Every valid mod under `root`, plus a line for each folder that didn't load and why. A broken mod
// is reported, never fatal: one bad folder mustn't take the others (or the cockpit) down with it.
export function scanMods(root: string): ModScan {
  const scan: ModScan = { mods: [], problems: [] };
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return scan; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    if (!isModId(e.name)) {
      scan.problems.push({ folder: e.name, message: 'folder name must be a mod id (a-z, 0-9, -)' });
      continue;
    }
    const result = readManifest(root, e.name);
    if (typeof result === 'string') scan.problems.push({ folder: e.name, message: result });
    else scan.mods.push(result);
  }
  return scan;
}

function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// The real file a mod URL points at, or null. Checked twice: the path is validated as text, then
// the resolved file (after symlinks) must still be inside the mod's folder.
export function resolveModFile(root: string, modId: string, relPath: string): string | null {
  if (!isModId(modId) || !isSafeModPath(relPath)) return null;
  const dir = path.join(root, modId);
  const file = path.join(dir, ...relPath.split('/'));
  if (!inside(dir, file)) return null;
  try {
    const real = fs.realpathSync(file);
    if (!inside(fs.realpathSync(dir), real) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

function respond(status: number, body: string | Uint8Array<ArrayBuffer>, type = 'text/plain'): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': type,
      'Content-Security-Policy': MOD_PAGE_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

// Pure request → response, so the protocol is testable without Electron.
export function serveModRequest(root: string, url: string, method = 'GET'): Response {
  if (method !== 'GET') return respond(405, 'method not allowed');
  let u: URL;
  try { u = new URL(url); } catch { return respond(400, 'bad url'); }
  const modId = u.hostname;
  let rel: string;
  try { rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch { return respond(400, 'bad path'); }
  if (!isModId(modId)) return respond(404, 'not found');

  if (rel.startsWith(RUNTIME_PREFIX)) {
    if (rel === `${RUNTIME_PREFIX}runtime.js`) return respond(200, MOD_RUNTIME_JS, TYPES['.js']);
    if (rel === `${RUNTIME_PREFIX}host.html`) {
      const manifest = readManifest(root, modId);
      if (typeof manifest === 'string' || !manifest.game) return respond(404, 'not a game mod');
      return respond(200, hostPage(manifest.game.entry), 'text/html; charset=utf-8');
    }
    return respond(404, 'not found');
  }

  const file = resolveModFile(root, modId, rel);
  const type = file ? TYPES[path.extname(file).toLowerCase()] : undefined;
  // Unknown types aren't served at all, so nothing in a mod folder can be sniffed into HTML.
  if (!file || !type) return respond(404, 'not found');
  return respond(200, new Uint8Array(fs.readFileSync(file)), type);
}

// Must run before app 'ready'. `standard` gives each mod its own host (and its own origin); `secure`
// keeps it a secure context. Deliberately NOT: bypassCSP, corsEnabled, supportFetchAPI, stream.
export function registerModScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MOD_SCHEME, privileges: { standard: true, secure: true } }]);
}

export function isModUrl(url: string | undefined): boolean {
  return !!url && url.startsWith(`${MOD_SCHEME}:`);
}

// After 'ready'.
export function handleModProtocol(): void {
  protocol.handle(MOD_SCHEME, (req) => serveModRequest(modsDir(), req.url, req.method));
  // Electron grants permission requests by default. Keep that for the app, refuse it for mods: a
  // game has no business with the camera, the microphone or notifications.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback, details) => {
    callback(!isModUrl(details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, _permission, requestingOrigin, details) => {
    return !isModUrl(requestingOrigin) && !isModUrl(details.requestingUrl);
  });
}

// A mod frame may only ever show its own mod. The window's CSP (frame-src) already says so; this is
// the second lock, in main, where a page can't argue with it.
export function guardModFrames(wc: WebContents): void {
  wc.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return;
    const from = details.frame?.url;
    if (isModUrl(from) && !isModUrl(details.url)) details.preventDefault();
  });
}
