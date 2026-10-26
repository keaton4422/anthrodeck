import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import {
  parseManifest, isSafeModPath, modGameId, MOD_PAGE_CSP, HOST_PAGE,
} from '../modManifest';
import { scanMods, resolveModFile, serveModRequest } from '../mods';
import { runModInVm } from './modHarness';
import { NEUTRAL_INPUT, EMPTY_TELEMETRY } from '../../renderer/game/types';

const EXAMPLES = path.join(__dirname, '../../../examples/mods');
const ORBIT_JS = fs.readFileSync(path.join(EXAMPLES, 'orbit-watch/game.js'), 'utf8');

const good = {
  id: 'my-game', name: 'My Game', version: '1.0.0',
  game: { kind: 'freeplay', entry: 'game.js', blurb: 'A test game' },
};

describe('parseManifest', () => {
  it('accepts a minimal game mod', () => {
    const r = parseManifest(good, 'my-game');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.game).toEqual(good.game);
      expect(r.warnings).toEqual([]);
    }
  });

  it('requires the id to match its folder', () => {
    const r = parseManifest(good, 'other');
    expect(r.ok).toBe(false);
  });

  it.each([
    [{ ...good, id: 'My Game' }, 'my-game'],
    [{ ...good, name: '' }, 'my-game'],
    [{ ...good, version: undefined }, 'my-game'],
    [{ ...good, game: { ...good.game, kind: 'admin' } }, 'my-game'],
    [{ ...good, game: { ...good.game, entry: '../evil.js' } }, 'my-game'],
    [{ ...good, game: { ...good.game, entry: 'game.html' } }, 'my-game'],
    [{ ...good, game: { ...good.game, entry: 'g"><script>.js' } }, 'my-game'],
    [{ ...good, game: { ...good.game, entry: '__cockpit__/runtime.js' } }, 'my-game'],
    [[], 'my-game'],
    [null, 'my-game'],
  ])('rejects %j', (raw, folder) => {
    expect(parseManifest(raw, folder).ok).toBe(false);
  });

  it('loads the game but warns about kinds of mod that are not built yet', () => {
    const r = parseManifest({ ...good, theme: { accent: '#fff' }, sounds: {}, extra: 1 }, 'my-game');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toHaveLength(3);
  });

  it('namespaces mod game ids away from built-in ones', () => {
    expect(modGameId('cockpit-flight')).toBe('mod:cockpit-flight');
  });
});

describe('isSafeModPath', () => {
  it.each(['game.js', 'art/ship.png', 'a-b_c.v2.js'])('allows %s', (p) => {
    expect(isSafeModPath(p)).toBe(true);
  });
  it.each(['', '/etc/passwd', '../x.js', 'a/../../x.js', '.hidden.js', 'a//b.js', 'a\\b.js', 'a b.js', '__cockpit__/host.html'])(
    'refuses %j', (p) => { expect(isSafeModPath(p)).toBe(false); },
  );
});

describe('loader', () => {
  let root: string;
  const write = (rel: string, body: string) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'anthrodeck-mods-'));
    write('my-game/mod.json', JSON.stringify(good));
    write('my-game/game.js', 'anthrodeck.registerMode({});');
    write('my-game/notes.txt', 'not served');
    write('broken/mod.json', '{ nope');
    write('no-entry/mod.json', JSON.stringify({ ...good, id: 'no-entry' }));
    write('Bad Name/mod.json', '{}');
    write('outside.js', 'secret');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('loads valid mods and reports every folder that did not load', () => {
    const scan = scanMods(root);
    expect(scan.mods.map((m) => m.id)).toEqual(['my-game']);
    expect(scan.problems.map((p) => p.folder).sort()).toEqual(['Bad Name', 'broken', 'no-entry']);
  });

  it('returns nothing (not an error) when the mods folder does not exist', () => {
    expect(scanMods(path.join(root, 'missing'))).toEqual({ mods: [], problems: [] });
  });

  it('resolves files inside the mod and nothing outside it', () => {
    expect(resolveModFile(root, 'my-game', 'game.js')).toBe(fs.realpathSync(path.join(root, 'my-game/game.js')));
    expect(resolveModFile(root, 'my-game', '../outside.js')).toBeNull();
    expect(resolveModFile(root, 'my-game', 'missing.js')).toBeNull();
    expect(resolveModFile(root, '..', 'outside.js')).toBeNull();
  });

  it('does not follow a symlink out of the mod folder', () => {
    fs.symlinkSync(path.join(root, 'outside.js'), path.join(root, 'my-game/link.js'));
    expect(resolveModFile(root, 'my-game', 'link.js')).toBeNull();
  });

  it('serves mod files with the no-network CSP', async () => {
    const res = serveModRequest(root, 'anthrodeck-mod://my-game/game.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript');
    expect(res.headers.get('content-security-policy')).toBe(MOD_PAGE_CSP);
    expect(await res.text()).toContain('registerMode');
  });

  it('serves the host page and runtime from the app, not the mod', async () => {
    const page = serveModRequest(root, `anthrodeck-mod://my-game/${HOST_PAGE}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('src="/__cockpit__/runtime.js"');
    expect(html).toContain('src="/game.js"');
    const rt = serveModRequest(root, 'anthrodeck-mod://my-game/__cockpit__/runtime.js');
    expect(await rt.text()).toContain('registerMode');
    expect(serveModRequest(root, 'anthrodeck-mod://my-game/__cockpit__/other.js').status).toBe(404);
  });

  it.each([
    'anthrodeck-mod://my-game/notes.txt',            // not a served type
    'anthrodeck-mod://my-game/%2e%2e/outside.js',    // encoded traversal
    'anthrodeck-mod://my-game/..%2Foutside.js',
    'anthrodeck-mod://my-game/mod.json/../../outside.js',
    'anthrodeck-mod://other/game.js',
    `anthrodeck-mod://broken/${HOST_PAGE}`,
  ])('refuses %s', (url) => {
    expect(serveModRequest(root, url).status).toBe(404);
  });

  it('refuses anything but GET', () => {
    expect(serveModRequest(root, 'anthrodeck-mod://my-game/game.js', 'POST').status).toBe(405);
  });

  it('the shipped example mod loads cleanly', () => {
    const scan = scanMods(EXAMPLES);
    expect(scan.problems).toEqual([]);
    expect(scan.mods.map((m) => m.id)).toContain('orbit-watch');
  });
});

describe('mod runtime (the sandboxed page)', () => {
  const frame = (run: number, extra: Record<string, unknown> = {}) => ({
    type: 'frame', run, w: 800, h: 600, input: NEUTRAL_INPUT, tel: EMPTY_TELEMETRY, dt: 0.016, ...extra,
  });

  it('runs the example mod and answers each frame with a status', () => {
    const page = runModInVm(ORBIT_JS);
    expect(page.posted).toEqual([{ type: 'ready' }]);
    page.send(frame(1));
    page.send(frame(1));
    const status = page.posted.at(-1)!;
    expect(status).toMatchObject({ type: 'status', run: 1, score: 0, over: false, intents: [] });
    expect(String(status.hud)).toContain('pts');
    expect(page.canvas.width).toBe(800);
  });

  it('re-inits when the cockpit starts a new run', () => {
    const page = runModInVm(ORBIT_JS);
    const tool = { snapshot: EMPTY_TELEMETRY.snapshot, events: [{ type: 'tool' }] };
    page.send(frame(1, { tel: tool }));
    page.send(frame(2));
    expect(page.posted.at(-1)).toMatchObject({ run: 2 });
  });

  it('ignores messages that are not from the cockpit', () => {
    const page = runModInVm(ORBIT_JS);
    page.send(frame(1), { someone: 'else' });
    expect(page.posted).toEqual([{ type: 'ready' }]);
  });

  it('reports a mod that throws, and stops running it', () => {
    const page = runModInVm(`anthrodeck.registerMode({
      init: function () { return {}; },
      step: function () { throw new Error('boom'); },
      render: function () {}, hud: function () { return ''; },
    });`);
    page.send(frame(1));
    page.send(frame(1));
    expect(page.posted.filter((m) => m.type === 'error')).toEqual([{ type: 'error', message: 'boom' }]);
  });

  it('reports a script that never registers a mode', () => {
    const page = runModInVm('var nothing = 1;');
    expect(page.posted).toEqual([{ type: 'error', message: 'the mod never called anthrodeck.registerMode()' }]);
  });

  it('adds exactly one global for the mod: anthrodeck.registerMode', () => {
    const page = runModInVm('');
    const added = Object.keys(page.globals).filter((k) => !['parent', 'document', 'addEventListener', 'window'].includes(k));
    expect(added).toEqual(['anthrodeck']);
    expect(Object.isFrozen(page.globals.anthrodeck)).toBe(true);
  });
});

describe('Orbit Watch (the example mod) as a GameMode', () => {
  type Item = { kind: string; angle: number; radius: number };
  type OrbitState = { angle: number; radius: number; items: Item[]; points: number; shields: number; over: boolean };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mode: any;
  beforeEach(() => {
    vm.runInNewContext(ORBIT_JS, { anthrodeck: { registerMode: (f: () => unknown) => { mode = f(); } } });
  });
  const tel = (events: unknown[] = [], tokensPerSec = 0) => ({ snapshot: { ...EMPTY_TELEMETRY.snapshot, tokensPerSec }, events });

  it('a finished task drops a beacon worth points', () => {
    let s: OrbitState = mode.step(mode.init(800, 600), NEUTRAL_INPUT, tel([{ type: 'sector' }]), 0.016);
    expect(s.items.map((i) => i.kind)).toEqual(['beacon']);
    s = { ...s, angle: s.items[0].angle, radius: s.items[0].radius };
    s = mode.step(s, NEUTRAL_INPUT, tel(), 0.001);
    expect(s.points).toBe(100);
    expect(s.items).toHaveLength(0);
  });

  it('a tool call throws debris that costs a shield', () => {
    let s: OrbitState = mode.step(mode.init(800, 600), NEUTRAL_INPUT, tel([{ type: 'tool' }]), 0.016);
    expect(s.items[0].kind).toBe('debris');
    s = { ...s, angle: s.items[0].angle, radius: s.items[0].radius };
    s = mode.step(s, NEUTRAL_INPUT, tel(), 0.001);
    expect(s.shields).toBe(2);
    expect(s.points).toBe(0);
  });

  it('is pure: same inputs, same state', () => {
    const run = () => {
      let s = mode.init(800, 600);
      for (let i = 0; i < 120; i++) {
        s = mode.step(s, { ...NEUTRAL_INPUT, moveY: i % 30 < 15 ? -1 : 1 }, tel(i % 20 === 0 ? [{ type: 'tool' }, { type: 'sector' }] : [], 40), 0.016);
      }
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});
