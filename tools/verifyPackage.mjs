import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { builtinModules } from 'module';
import os from 'os';
import path from 'path';

// Does the thing the rest of the build never did: opens the packaged app and checks it can actually
// start.
//
// `npm run make` passing only ever meant "artifacts were produced". It did not mean the app runs.
// For most of this project's life the packaged main bundle called require() on electron-store,
// fastify, chokidar, selfsigned and the Anthropic SDK, none of which shipped — because forge's Vite
// plugin excludes node_modules from the package and those modules were marked external so Vite
// never bundled them either. Every release was dead on launch and every gate was green.
//
// So this walks the packaged main bundle for bare require() calls and asserts each one can resolve
// at runtime: a node builtin, `electron`, something physically present in the package, or an
// explicitly-allowed optional dependency.

// nodejs-whisper is a native addon that is deliberately not shipped; whisperTranscriber.ts requires
// it inside a try/catch, so a miss degrades local voice rather than killing the app. Anything added
// here MUST be require()d defensively at its call site.
const ALLOWED_MISSING = new Set(['nodejs-whisper']);

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

// Exported for testing.
export function extractBareRequires(source) {
  const found = new Set();
  for (const m of source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    const id = m[1];
    if (id.startsWith('.') || id.startsWith('/')) continue;   // relative — inside the bundle
    found.add(id);
  }
  return [...found].sort();
}

// Exported for testing. `present` is the set of module names physically in the package.
export function classify(requires, present) {
  const missing = [];
  const tolerated = [];
  for (const id of requires) {
    if (BUILTINS.has(id)) continue;
    if (id === 'electron') continue;
    // A subpath import (`foo/bar`) resolves through its package root.
    const pkg = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0];
    if (present.has(pkg)) continue;
    (ALLOWED_MISSING.has(pkg) ? tolerated : missing).push(id);
  }
  return { missing, tolerated };
}

function findPackagedApp(outDir) {
  if (!existsSync(outDir)) return null;
  // Prefer a directory matching the current platform; fall back to any packaged app dir.
  const dirs = readdirSync(outDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'make')
    .map((d) => path.join(outDir, d.name))
    .filter((d) => existsSync(path.join(d, 'resources', 'app.asar')));
  if (!dirs.length) return null;
  const mine = dirs.find((d) => d.includes(process.platform));
  return mine ?? dirs[dirs.length - 1];
}

function main() {
  const appDir = findPackagedApp(path.resolve('out'));
  if (!appDir) {
    console.error('verify:package — no packaged app found under out/. Run `electron-forge package` first.');
    process.exit(1);
  }
  const asar = path.join(appDir, 'resources', 'app.asar');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'anthrodeck-verify-'));
  try {
    execFileSync('npx', ['asar', 'extract', asar, tmp], { stdio: 'pipe', shell: process.platform === 'win32' });

    // Scan EVERY emitted chunk, not just index.js. Rollup code-splits the main build, so index.js
    // can be a 134-byte re-export stub while the real 2 MB of code — and every require in it —
    // lives in a sibling chunk. Reading only the entry file reports a confident, meaningless OK.
    const buildDir = path.join(tmp, '.vite', 'build');
    if (!existsSync(buildDir)) throw new Error(`packaged build output missing at ${buildDir}`);
    const chunks = [];
    const walkJs = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walkJs(full);
        else if (e.name.endsWith('.js')) chunks.push(full);
      }
    };
    walkJs(buildDir);
    if (!chunks.length) throw new Error(`no .js chunks found under ${buildDir}`);

    // What actually shipped alongside the bundle.
    const nmDir = path.join(tmp, 'node_modules');
    const present = new Set();
    if (existsSync(nmDir)) {
      for (const e of readdirSync(nmDir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('@')) {
          for (const s of readdirSync(path.join(nmDir, e.name))) present.add(`${e.name}/${s}`);
        } else present.add(e.name);
      }
    }
    // Unpacked native modules live outside the asar.
    const unpacked = `${asar}.unpacked`;
    if (existsSync(path.join(unpacked, 'node_modules'))) {
      for (const e of readdirSync(path.join(unpacked, 'node_modules'))) present.add(e);
    }

    const all = new Set();
    let bytes = 0;
    for (const c of chunks) {
      const src = readFileSync(c, 'utf-8');
      bytes += src.length;
      for (const id of extractBareRequires(src)) all.add(id);
    }
    const requires = [...all].sort();
    const { missing, tolerated } = classify(requires, present);

    console.log(`verify:package — ${path.basename(appDir)}`);
    console.log(`  chunks scanned: ${chunks.length} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  bare requires: ${requires.length}`);
    if (tolerated.length) console.log(`  optional, may be absent: ${tolerated.join(', ')}`);

    if (missing.length) {
      console.error('\n  MISSING AT RUNTIME — the packaged app will not start:');
      for (const m of missing) console.error(`    require("${m}")  — not bundled and not shipped`);
      console.error('\n  Either remove it from `external` in vite.main.config.ts so Vite bundles it,');
      console.error('  or ship it in the package. See the packaging contract in that file.\n');
      process.exit(1);
    }
    console.log('  OK — every runtime require resolves.');

    // The renderer is a separate build with its own output path, and it went missing for every
    // release: main resolved loadFile() to a file that was not in the package, and the app opened
    // as a black window. Checking main's requires would never have caught it, so check the exact
    // path main loads.
    verifyRenderer(tmp);

    // Static resolution is necessary but NOT sufficient. fastify 5 resolved fine against
    // Electron 28 and still exploded on load, because Electron 28 ships Node 18 and fastify needs
    // `diagnostics_channel.tracingChannel` and the global `File` from Node 20. So actually LOAD the
    // shipped packages inside the app's own runtime, and compile a schema to exercise the
    // ajv / fast-json-stringify paths that only run when a route has one.
    bootCheck(appDir, asar);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Exported for testing: pulls the local src="" / href="" targets out of the renderer's entry HTML.
export function extractLocalAssets(html) {
  const out = new Set();
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const v = m[1];
    if (/^(https?:|data:|#|\/\/)/.test(v)) continue;   // remote or in-page
    out.add(v.replace(/^\.?\//, ''));
  }
  return [...out].sort();
}

function verifyRenderer(tmp) {
  // Derive this from main's own code, do not restate it from memory. main/index.js lives at
  // .vite/build/main and calls loadFile('../renderer/<name>/index.html'), so the renderer must be
  // at .vite/build/renderer/<name>/. Getting this wrong once already produced a green check over a
  // black window, because the check asserted where the renderer HAD been put rather than where main
  // goes looking for it.
  const mainDir = path.join(tmp, '.vite', 'build', 'main');
  const rendererRoot = path.resolve(mainDir, '../renderer');
  if (!existsSync(rendererRoot)) {
    console.error('\n  RENDERER MISSING — the app will open as a blank window.');
    console.error(`    expected: ${path.relative(tmp, rendererRoot).split(path.sep).join('/')}/<target>/index.html`);
    console.error('    Check build.outDir in vite.renderer.config.ts: Vite resolves it relative to');
    console.error('    `root`, so it can silently land under src/renderer/ and never be packaged.\n');
    process.exit(1);
  }
  const targets = readdirSync(rendererRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  if (!targets.length) {
    console.error(`\n  RENDERER MISSING — .vite/renderer/ exists but contains no build targets.\n`);
    process.exit(1);
  }

  for (const t of targets) {
    const entry = path.join(rendererRoot, t.name, 'index.html');
    if (!existsSync(entry)) {
      console.error(`\n  RENDERER MISSING — no index.html for target "${t.name}".\n`);
      process.exit(1);
    }
    const html = readFileSync(entry, 'utf-8');
    // An index.html that references a bundle which did not ship is the same blank window with
    // extra steps, so resolve each local asset too.
    const missing = extractLocalAssets(html)
      .filter((a) => !existsSync(path.join(rendererRoot, t.name, a)));
    if (missing.length) {
      console.error(`\n  RENDERER INCOMPLETE — "${t.name}" references assets that did not ship:`);
      for (const m of missing) console.error(`    ${m}`);
      console.error('');
      process.exit(1);
    }
    console.log(`  OK — renderer "${t.name}" present with all referenced assets.`);
  }
}

function bootCheck(appDir, asar) {
  // executableName is `anthrodeck` (lowercase) per forge.config.ts. Match case-insensitively and
  // FAIL if it cannot be found: a check that silently skips is how the false-OK happened twice
  // already in this file's short history.
  const exe = readdirSync(appDir).find((f) => /^anthrodeck(\.exe)?$/i.test(f));
  if (!exe) {
    console.error(`  runtime load check could not find the app binary in ${appDir}`);
    console.error(`  contents: ${readdirSync(appDir).slice(0, 12).join(', ')}`);
    process.exit(1);
  }
  const script = `
    const path = require('path');
    const asar = process.env.ASARPATH;
    const load = (m) => require(path.join(asar, 'node_modules', m));
    const bad = [];
    for (const m of ${JSON.stringify(SHIP_ROOTS)}) {
      try { load(m); } catch (e) { bad.push(m + ': ' + e.message.split('\\n')[0]); }
    }
    if (bad.length) { console.error(bad.join('\\n')); process.exit(1); }
    const Fastify = load('fastify');
    const app = Fastify();
    app.post('/x', { schema: {
      body: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } } } },
    } }, async () => ({ ok: true }));
    app.ready()
      .then(() => { console.log('NODE=' + process.versions.node); process.exit(0); })
      .catch((e) => { console.error('schema compile: ' + e.message); process.exit(1); });
  `;
  try {
    const out = execFileSync(path.join(appDir, exe), ['-e', script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ASARPATH: asar },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    const node = /NODE=(\S+)/.exec(out)?.[1] ?? '?';
    console.log(`  OK — shipped packages load and compile a schema under Electron's Node ${node}.`);
  } catch (e) {
    console.error('\n  RUNTIME LOAD FAILED — resolves but will not run:');
    console.error(`    ${(e.stderr || e.stdout || e.message).toString().trim().split('\n').join('\n    ')}`);
    console.error('\n  Usually an Electron/Node version mismatch. Check process.versions.node against');
    console.error('  what the dependency requires.\n');
    process.exit(1);
  }
}

// Roots that ship as real files rather than being bundled; kept in sync with tools/shipDeps.mjs.
const SHIP_ROOTS = ['fastify', '@fastify/static', '@fastify/http-proxy'];

if (process.argv[1] && process.argv[1].endsWith('verifyPackage.mjs')) main();
