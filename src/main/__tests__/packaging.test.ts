import { describe, it, expect } from 'vitest';
// @ts-expect-error - plain .mjs build tooling, no type declarations by design
import { extractBareRequires, classify } from '../../../tools/verifyPackage.mjs';
// @ts-expect-error - plain .mjs build tooling, no type declarations by design
import { collectClosure, SHIP_ROOTS } from '../../../tools/shipDeps.mjs';

// These guard the packaging gate itself. The gate exists because every packaged build of this app
// was dead on launch -- forge's Vite plugin ships no node_modules, so anything marked external in
// vite.main.config.ts was require()d at runtime and never present. typecheck, tests and `make` were
// all green throughout. If this gate regresses, that silence comes back.

describe('extractBareRequires', () => {
  it('finds bare requires and ignores relative ones', () => {
    const src = `require("electron-store");require('./local');require("../up");require("fastify")`;
    expect(extractBareRequires(src)).toEqual(['electron-store', 'fastify']);
  });

  it('handles whitespace inside the call', () => {
    expect(extractBareRequires('require(  "chokidar"  )')).toEqual(['chokidar']);
  });

  it('keeps subpath imports intact -- ajv/dist/runtime/* was a real miss', () => {
    expect(extractBareRequires('require("ajv/dist/runtime/equal")')).toEqual(['ajv/dist/runtime/equal']);
  });

  it('dedupes', () => {
    expect(extractBareRequires('require("fs");require("fs")')).toEqual(['fs']);
  });

  it('ignores absolute paths', () => {
    expect(extractBareRequires('require("/abs/path")')).toEqual([]);
  });
});

describe('classify', () => {
  it('passes node builtins and electron', () => {
    const r = classify(['fs', 'path', 'node:crypto', 'electron'], new Set());
    expect(r.missing).toEqual([]);
  });

  it('flags a module that is neither bundled nor shipped', () => {
    // Exactly the shape of the bug that shipped.
    expect(classify(['electron-store'], new Set()).missing).toEqual(['electron-store']);
  });

  it('passes a module that is physically present', () => {
    expect(classify(['fastify'], new Set(['fastify'])).missing).toEqual([]);
  });

  it('resolves a subpath through its package root', () => {
    expect(classify(['ajv/dist/runtime/equal'], new Set(['ajv'])).missing).toEqual([]);
  });

  it('resolves a scoped subpath through the scoped package root', () => {
    expect(classify(['@fastify/static/lib/x'], new Set(['@fastify/static'])).missing).toEqual([]);
  });

  it('tolerates the optional native module rather than failing the build', () => {
    const r = classify(['nodejs-whisper'], new Set());
    expect(r.missing).toEqual([]);
    expect(r.tolerated).toEqual(['nodejs-whisper']);
  });
});

describe('collectClosure', () => {
  // The dir handed to readPkg is path.join(nodeModulesDir, name), so strip the root to get the
  // name back — and normalise separators, because path.join uses backslashes on Windows.
  const ROOT = 'nm-root';
  const fake = (graph: Record<string, string[]>) => (dir: string) => {
    const name = dir.replace(/\\/g, '/').replace(`${ROOT}/`, '');
    return graph[name] ? { dependencies: Object.fromEntries(graph[name].map((d) => [d, '*'])) } : null;
  };

  it('walks transitively', () => {
    const got = collectClosure(['a'], ROOT, fake({ a: ['b'], b: ['c'], c: [] }));
    expect([...got.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('terminates on a dependency cycle', () => {
    const got = collectClosure(['a'], ROOT, fake({ a: ['b'], b: ['a'] }));
    expect([...got.keys()].sort()).toEqual(['a', 'b']);
  });

  it('skips packages that are not installed instead of throwing', () => {
    const got = collectClosure(['a'], ROOT, fake({ a: ['ghost'] }));
    expect([...got.keys()]).toEqual(['a']);
  });

  it('ships the real fastify tree, including the ajv chain that could not be bundled', () => {
    // Against the actual node_modules, not a fixture.
    const got = collectClosure(SHIP_ROOTS, 'node_modules');
    const names = [...got.keys()];
    expect(names).toContain('fastify');
    expect(names).toContain('ajv');
    expect(names).toContain('fast-json-stringify');
    expect(names.length).toBeGreaterThan(20);
  });
});

// ─── Renderer presence ────────────────────────────────────────────────────────
// @ts-expect-error - plain .mjs build tooling, no type declarations by design
import { extractLocalAssets } from '../../../tools/verifyPackage.mjs';

describe('extractLocalAssets', () => {
  it('pulls script and stylesheet targets out of the entry HTML', () => {
    const html = `<script type="module" src="/assets/index-abc.js"></script>
                  <link rel="stylesheet" href="/assets/index-def.css">`;
    expect(extractLocalAssets(html)).toEqual(['assets/index-abc.js', 'assets/index-def.css']);
  });

  it('ignores remote and in-page targets', () => {
    const html = `<a href="https://x.test/a"><img src="data:image/png;base64,AA=="><a href="#top">`;
    expect(extractLocalAssets(html)).toEqual([]);
  });

  it('normalises leading ./ and / so paths join against the target dir', () => {
    expect(extractLocalAssets('<script src="./a.js"></script><link href="/b.css">'))
      .toEqual(['a.js', 'b.css']);
  });

  it('dedupes repeated references', () => {
    expect(extractLocalAssets('<link href="a.css"><link href="a.css">')).toEqual(['a.css']);
  });
});
