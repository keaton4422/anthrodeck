import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseStatus, gateIntents, ModChannel, createModProxyMode, buildModGames, INTENT_COOLDOWN_S, type ModProxyState,
} from './mods';
import { NEUTRAL_INPUT, EMPTY_TELEMETRY, type GameIntent } from './types';
import { GAME_MODES } from './registry';
import type { ModManifest } from '../../main/modManifest';
import { runModInVm } from '../../main/__tests__/modHarness';

const manifest: ModManifest = {
  id: 'orbit-watch', name: 'Orbit Watch', version: '1.0.0', author: 'AnthroDeck',
  game: { kind: 'telemetry', entry: 'game.js', blurb: 'Keep station' },
};
const ORBIT_JS = fs.readFileSync(path.join(__dirname, '../../../examples/mods/orbit-watch/game.js'), 'utf8');

describe('parseStatus (everything a mod says is untrusted)', () => {
  it('keeps a well-formed status', () => {
    expect(parseStatus({ type: 'status', run: 3, hud: '10 pts', score: 10, over: false, intents: [{ type: 'prune-stale' }] }))
      .toEqual({ run: 3, hud: '10 pts', score: 10, over: false, intents: [{ type: 'prune-stale' }] });
  });

  it('drops any intent a game is not allowed to raise', () => {
    const s = parseStatus({
      type: 'status', run: 1, hud: '', score: 0, over: false,
      intents: [{ type: 'approve-write' }, { type: 'run-shell' }, { type: 'commit' }, { type: 'toString' }, null, 'prune-stale', { type: 'focus-question' }],
    });
    expect(s!.intents).toEqual([{ type: 'focus-question' }]);
  });

  it('clips the HUD, clamps the score and coerces the flags', () => {
    const s = parseStatus({ type: 'status', run: 1, hud: 'x'.repeat(500), score: Infinity, over: 'yes', intents: 'nope' });
    expect(s).toEqual({ run: 1, hud: 'x'.repeat(80), score: 0, over: false, intents: [] });
    expect(parseStatus({ type: 'status', run: 1, score: 1e15 })!.score).toBe(1e9);
    expect(parseStatus({ type: 'status', run: 1, score: -5 })!.score).toBe(0);
  });

  it('ignores anything that is not a status', () => {
    expect(parseStatus(null)).toBeNull();
    expect(parseStatus({ type: 'frame', run: 1 })).toBeNull();
    expect(parseStatus({ type: 'status' })).toBeNull();
  });
});

describe('gateIntents', () => {
  const prune: GameIntent = { type: 'prune-stale' };
  it('lets each intent through at most once per cooldown', () => {
    let g = gateIntents([prune, prune, prune], {}, 1);
    expect(g.intents).toEqual([prune]);
    g = gateIntents([prune], g.last, 1 + INTENT_COOLDOWN_S - 0.1);
    expect(g.intents).toEqual([]);
    g = gateIntents([prune, { type: 'focus-question' }], g.last, 1 + INTENT_COOLDOWN_S);
    expect(g.intents).toHaveLength(2);
  });
});

describe('ModChannel', () => {
  it("drops an older run's answers", () => {
    const c = new ModChannel();
    c.receive({ type: 'status', run: 1, hud: 'old', score: 5, over: false, intents: [{ type: 'prune-stale' }] });
    expect(c.take(2)).toEqual({ status: null, intents: [] });
  });

  it('collects intents between takes and records errors', () => {
    const c = new ModChannel();
    c.receive({ type: 'status', run: 1, hud: '', score: 0, over: false, intents: [{ type: 'prune-stale' }] });
    c.receive({ type: 'status', run: 1, hud: '', score: 0, over: false, intents: [{ type: 'focus-question' }] });
    expect(c.take(1).intents).toHaveLength(2);
    expect(c.take(1).intents).toHaveLength(0);
    c.receive({ type: 'error', message: 'boom' });
    expect(c.error).toBe('boom');
    c.attach(null);
    expect(c.error).toBeNull();
  });
});

describe('mod proxy mode', () => {
  it('cannot take the id of a built-in mode', () => {
    const builtIn = GAME_MODES[0].id.replace(/^mod:/, '');
    const [g] = buildModGames([{ ...manifest, id: builtIn }]);
    expect(g.mode.id).toBe(`mod:${builtIn}`);
    expect(GAME_MODES.some((m) => m.id === g.mode.id)).toBe(false);
  });

  it('skips mods without a game and duplicate ids', () => {
    const games = buildModGames([manifest, manifest, { id: 'theme-only', name: 'T', version: '1' }]);
    expect(games).toHaveLength(1);
    expect(games[0].mode.blurb).toBe('Mod by AnthroDeck · Keep station');
  });

  it('drives the real example mod end to end through the sandbox runtime', () => {
    const channel = new ModChannel();
    const page = runModInVm(ORBIT_JS, (m) => channel.receive(m));
    channel.attach({ postMessage: (m) => page.send(m) });
    const mode = createModProxyMode(manifest, channel);

    let s = mode.init(800, 600);
    expect(mode.hud(s)).toBe('');
    for (let i = 0; i < 3; i++) s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.016);
    expect(s.ready).toBe(true);
    expect(mode.hud(s)).toMatch(/^0 pts · ●●● · 0 tok\/s$/);
    expect(mode.isOver!(s)).toBe(false);
  });

  it('passes on allowed intents from the mod, rate-limited, and nothing else', () => {
    const channel = new ModChannel();
    const page = runModInVm(`anthrodeck.registerMode({
      init: function () { return { intents: [] }; },
      step: function () { return { intents: [{ type: 'prune-stale' }, { type: 'approve-write' }, { type: 'run-shell' }] }; },
      render: function () {}, hud: function () { return 'spam'; },
    });`, (m) => channel.receive(m));
    channel.attach({ postMessage: (m) => page.send(m) });
    const mode = createModProxyMode(manifest, channel);

    let s: ModProxyState = mode.init(800, 600);
    const seen: GameIntent[] = [];
    for (let i = 0; i < 60; i++) { // one second of frames
      s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 1 / 60);
      seen.push(...s.intents);
    }
    expect(seen).toEqual([{ type: 'prune-stale' }]);
  });

  it('reports a crashed mod on the HUD', () => {
    const channel = new ModChannel();
    const page = runModInVm(`anthrodeck.registerMode({
      init: function () { return {}; }, step: function () { throw new Error('kaput'); },
      render: function () {}, hud: function () { return ''; },
    });`, (m) => channel.receive(m));
    channel.attach({ postMessage: (m) => page.send(m) });
    const mode = createModProxyMode(manifest, channel);
    let s = mode.init(800, 600);
    s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.016);
    s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.016);
    expect(s.failed).toBe('kaput');
    expect(mode.hud(s)).toBe('Mod stopped');
  });
});
