import { describe, it, expect } from 'vitest';
import { GAME_MODES, getMode } from './registry';
import { makeTronMode, TronState } from './modes/tron';
import { makeRacerMode, RacerState } from './modes/racer';
import { makeShooterMode, ShooterState } from './modes/shooter';
import { NEUTRAL_INPUT, EMPTY_TELEMETRY, GameInput, TelemetryFrame } from './types';

const W = 800;
const H = 600;

function tel(partial: Partial<TelemetryFrame['snapshot']>, events: TelemetryFrame['events'] = []): TelemetryFrame {
  return { snapshot: { ...EMPTY_TELEMETRY.snapshot, ...partial }, events };
}

function input(partial: Partial<GameInput>): GameInput {
  return { ...NEUTRAL_INPUT, ...partial };
}

describe('registry contract', () => {
  it('every registered mode satisfies the GameMode shape and has a unique id', () => {
    const ids = new Set<string>();
    for (const m of GAME_MODES) {
      expect(typeof m.id).toBe('string');
      expect(typeof m.name).toBe('string');
      expect(['telemetry', 'freeplay']).toContain(m.kind);
      expect(typeof m.init).toBe('function');
      expect(typeof m.step).toBe('function');
      expect(typeof m.render).toBe('function');
      expect(typeof m.hud).toBe('function');
      const s = m.init(W, H);
      // step must be callable and return a state; hud must return a string.
      const s2 = m.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.016);
      expect(s2).toBeTruthy();
      expect(typeof m.hud(s2)).toBe('string');
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
    }
    expect(ids.size).toBe(GAME_MODES.length);
  });

  it('getMode resolves ids and returns undefined for unknown', () => {
    expect(getMode('cockpit-tron')?.id).toBe('cockpit-tron');
    expect(getMode('nope')).toBeUndefined();
  });
});

describe('tron (telemetry) — engine event mapping', () => {
  const mode = makeTronMode({ id: 't', name: 'T', kind: 'telemetry', telemetryDriven: true, blurb: '' });

  it('an abort (crash) event crashes the bike', () => {
    const s0 = mode.init(W, H);
    const s1 = mode.step(s0, NEUTRAL_INPUT, tel({}, [{ type: 'crash' }]), 0.016);
    expect(s1.crashed).toBe(true);
  });

  it('a done event finishes', () => {
    const s0 = mode.init(W, H);
    const s1 = mode.step(s0, NEUTRAL_INPUT, tel({}, [{ type: 'done' }]), 0.016);
    expect(s1.finished).toBe(true);
  });

  it('an error/tool event spawns a hazard', () => {
    const s0 = mode.init(W, H);
    const s1 = mode.step(s0, NEUTRAL_INPUT, tel({}, [{ type: 'error' }]), 0.016);
    expect(s1.hazards.length).toBe(2); // one (x,y) point
  });

  it('higher throughput drives higher target speed', () => {
    const slow = stepN(mode, tel({ tokensPerSec: 0, streaming: true }), 20);
    const fast = stepN(mode, tel({ tokensPerSec: 50, streaming: true }), 20);
    expect(fast.speed).toBeGreaterThan(slow.speed);
  });

  it('is frozen once crashed (idempotent step)', () => {
    const crashed: TronState = { ...mode.init(W, H), crashed: true };
    const after = mode.step(crashed, input({ throttle: 1 }), EMPTY_TELEMETRY, 0.016);
    expect(after).toBe(crashed);
  });
});

describe('tron (free-play) — throttle drives speed, ignores telemetry crash', () => {
  const mode = makeTronMode({ id: 'tf', name: 'TF', kind: 'freeplay', telemetryDriven: false, blurb: '' });

  it('does not crash on a telemetry crash event (decoupled)', () => {
    const s0 = mode.init(W, H);
    const s1 = mode.step(s0, NEUTRAL_INPUT, tel({}, [{ type: 'crash' }]), 0.016);
    expect(s1.crashed).toBe(false);
  });

  it('throttle increases speed over time', () => {
    const moving = stepN(mode, EMPTY_TELEMETRY, 30, input({ throttle: 1 }));
    expect(moving.speed).toBeGreaterThan(mode.init(W, H).speed);
  });

  it('boost held makes it travel farther than no boost in the same time', () => {
    const base = stepN(mode, EMPTY_TELEMETRY, 20, input({ throttle: 1 }));
    const boosted = stepN(mode, EMPTY_TELEMETRY, 20, input({ throttle: 1, boost: true }));
    expect(boosted.score).toBeGreaterThan(base.score);
  });
});

describe('racer (telemetry)', () => {
  const mode = makeRacerMode();

  it('crash event crashes, done event finishes', () => {
    expect(mode.step(mode.init(W, H), NEUTRAL_INPUT, tel({}, [{ type: 'crash' }]), 0.016).crashed).toBe(true);
    expect(mode.step(mode.init(W, H), NEUTRAL_INPUT, tel({}, [{ type: 'done' }]), 0.016).finished).toBe(true);
  });

  it('tool/error events spawn obstacles', () => {
    const s1 = mode.step(mode.init(W, H), NEUTRAL_INPUT, tel({}, [{ type: 'tool' }, { type: 'error' }]), 0.016);
    expect(s1.obsY.length).toBe(2);
  });

  it('steering moves the car and clamps within bounds', () => {
    let s: RacerState = mode.init(W, H);
    for (let i = 0; i < 200; i++) s = mode.step(s, input({ steer: -1 }), EMPTY_TELEMETRY, 0.016);
    expect(s.carX).toBeGreaterThanOrEqual(16);
    expect(s.carX).toBeLessThan(W / 2);
  });
});

describe('shooter (free-play)', () => {
  const mode = makeShooterMode();

  it('firing spawns a bullet', () => {
    const s0 = mode.init(W, H);
    const s1 = mode.step(s0, input({ fire: true, aimX: 1 }), EMPTY_TELEMETRY, 0.016);
    expect(s1.bullets.length).toBe(1);
  });

  it('spawns rocks over time and ignores telemetry crash', () => {
    const withRocks = stepN(mode, tel({}, [{ type: 'crash' }]), 200);
    expect(withRocks.gameOver).toBe(false);
    expect(withRocks.rocks.length).toBeGreaterThan(0);
  });

  it('ship starts with 3 lives', () => {
    expect(mode.init(W, H).lives).toBe(3);
  });
});

// A no-op 2D context stub: every method is a no-op, every property is settable. Lets us exercise
// render() paths (including the crash/finish overlays) headlessly without a real canvas.
function fakeCtx(): CanvasRenderingContext2D {
  const noop = () => { /* no-op */ };
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get: (t, p) => (p in t ? t[p as string] : noop),
    set: (t, p, v) => { t[p as string] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

describe('render does not throw', () => {
  it('renders init + running + terminal states for every mode', () => {
    const ctx = fakeCtx();
    for (const m of GAME_MODES) {
      let s = m.init(W, H);
      expect(() => m.render(ctx, s, W, H)).not.toThrow();
      // a few frames of activity
      for (let i = 0; i < 10; i++) {
        s = m.step(s, input({ steer: 0.5, throttle: 1, fire: true, aimX: 1 }),
          tel({ streaming: true, tokensPerSec: 30 }, i === 3 ? [{ type: 'error' }] : []), 0.016);
      }
      expect(() => m.render(ctx, s, W, H)).not.toThrow();
      // terminal overlay (crash) for telemetry modes
      const crashed = m.step(m.init(W, H), NEUTRAL_INPUT, tel({}, [{ type: 'crash' }]), 0.016);
      expect(() => m.render(ctx, crashed, W, H)).not.toThrow();
    }
  });
});

// Advance a mode N frames at 16ms with a fixed input/telemetry.
function stepN<S>(
  mode: { init(w: number, h: number): S; step(s: S, i: GameInput, t: TelemetryFrame, dt: number): S },
  t: TelemetryFrame,
  n: number,
  i: GameInput = NEUTRAL_INPUT,
): S {
  let s = mode.init(W, H);
  for (let f = 0; f < n; f++) s = mode.step(s, i, t, 0.016);
  return s;
}

// keep ShooterState import referenced for type-checking of tests
export type _S = ShooterState;
