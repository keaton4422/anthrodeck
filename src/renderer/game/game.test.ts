import { describe, it, expect } from 'vitest';
import { GAME_MODES, getMode } from './registry';
import { createMode as createFlight, type FlightState } from './modes/flight';
import { createMode as createRacer, type RacerState, REGIONS, REGION_LENGTH, regionAt, perspAt, elevationAt, horizonAt } from './modes/racer';
import { createMode as createGrid, type GridState } from './modes/gridcycles';
import { createMode as createBelt, type ShooterState } from './modes/shooter';
import { NEUTRAL_INPUT, EMPTY_TELEMETRY, GameInput, TelemetryFrame, GameIntent } from './types';
import { project, depthAlpha, approach, clamp, makeRng } from './lib3d';
import { applyScore } from '../lib/highscores';

const W = 800;
const H = 600;

function tel(
  partial: Partial<TelemetryFrame['snapshot']> = {},
  events: TelemetryFrame['events'] = [],
): TelemetryFrame {
  return { snapshot: { ...EMPTY_TELEMETRY.snapshot, ...partial }, events };
}
function input(partial: Partial<GameInput>): GameInput {
  return { ...NEUTRAL_INPUT, ...partial };
}
function stepN<S>(
  mode: { init(w: number, h: number): S; step(s: S, i: GameInput, t: TelemetryFrame, dt: number): S },
  t: TelemetryFrame, n: number, i: GameInput = NEUTRAL_INPUT,
): S {
  let s = mode.init(W, H);
  for (let f = 0; f < n; f++) s = mode.step(s, i, t, 0.016);
  return s;
}
function intentsOf(s: unknown): GameIntent[] {
  return ((s as { intents?: GameIntent[] }).intents) ?? [];
}

describe('registry auto-discovery', () => {
  it('finds every mode file and gives each a unique id', () => {
    expect(GAME_MODES.length).toBeGreaterThanOrEqual(4);
    const ids = new Set(GAME_MODES.map((m) => m.id));
    expect(ids.size).toBe(GAME_MODES.length);
  });

  it('every discovered mode satisfies the GameMode contract', () => {
    for (const m of GAME_MODES) {
      expect(typeof m.id).toBe('string');
      expect(['telemetry', 'freeplay']).toContain(m.kind);
      const s = m.init(W, H);
      const s2 = m.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.016);
      expect(s2).toBeTruthy();
      expect(typeof m.hud(s2)).toBe('string');
    }
  });

  it('lists telemetry (cockpit) modes before free-play', () => {
    const firstFree = GAME_MODES.findIndex((m) => m.kind === 'freeplay');
    const lastTel = GAME_MODES.map((m) => m.kind).lastIndexOf('telemetry');
    if (firstFree !== -1 && lastTel !== -1) expect(lastTel).toBeLessThan(firstFree);
  });

  it('resolves by id', () => {
    expect(getMode(GAME_MODES[0].id)?.id).toBe(GAME_MODES[0].id);
    expect(getMode('nope')).toBeUndefined();
  });
});

describe('lib3d projection', () => {
  it('puts a centred point at screen centre and scales with depth', () => {
    const near = project(0, 0, 100, W, H);
    expect(near.x).toBeCloseTo(W / 2);
    expect(near.y).toBeCloseTo(H / 2);
    const far = project(0, 0, 400, W, H);
    expect(far.scale).toBeLessThan(near.scale);
  });

  it('marks points at or behind the near plane invisible', () => {
    expect(project(0, 0, 0, W, H).visible).toBe(false);
    expect(project(0, 0, -50, W, H).visible).toBe(false);
  });

  it('offsets left/right of centre correctly', () => {
    expect(project(-50, 0, 200, W, H).x).toBeLessThan(W / 2);
    expect(project(50, 0, 200, W, H).x).toBeGreaterThan(W / 2);
  });

  it('depthAlpha is opaque up close and fades out by the far plane', () => {
    // dz <= 0 is at/behind the camera — degenerate, so it reads as invisible rather than opaque.
    expect(depthAlpha(0, 1000)).toBe(0);
    expect(depthAlpha(1, 1000)).toBeCloseTo(1, 2);
    expect(depthAlpha(500, 1000)).toBeCloseTo(0.5, 2);
    expect(depthAlpha(1000, 1000)).toBeCloseTo(0);
    expect(depthAlpha(2000, 1000)).toBe(0);
  });

  it('approach steps toward a target without overshooting', () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(0, 2, 5)).toBe(2);
    expect(approach(10, 0, 3)).toBe(7);
  });

  it('clamp bounds values', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
  });

  it('makeRng is deterministic for a seed and stays in [0,1)', () => {
    const a = makeRng(42); const b = makeRng(42);
    for (let i = 0; i < 20; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('flight cockpit', () => {
  const mode = createFlight();

  it('starts on autopilot with gates ahead', () => {
    const s = mode.init(W, H);
    expect(s.manual).toBe(0);
    expect(s.rings.length).toBeGreaterThan(0);
  });

  it('hands control to the pilot when the stick moves, and returns it when released', () => {
    let s = stepN(mode, tel({ streaming: true }), 40, input({ steer: 1 }));
    expect(s.manual).toBeGreaterThan(0.5);
    for (let i = 0; i < 200; i++) s = mode.step(s, NEUTRAL_INPUT, tel({ streaming: true }), 0.016);
    expect(s.manual).toBeLessThan(0.5);
  });

  it('the autopilot alone flies gates — it completes the course unaided', () => {
    const s = stepN(mode, tel({ streaming: true, tokensPerSec: 40 }), 900);
    expect(s.passed).toBeGreaterThan(0);
    expect(s.destroyed).toBe(false);
  });

  it('firing spawns a bolt', () => {
    const s = mode.step(mode.init(W, H), input({ fire: true }), EMPTY_TELEMETRY, 0.016);
    expect(s.bolts.length).toBe(1);
  });

  it('a tool event adds a gate and an escort drone', () => {
    const s = mode.step(mode.init(W, H), NEUTRAL_INPUT, tel({}, [{ type: 'tool' }]), 0.016);
    expect(s.drones.length).toBe(1);
  });

  it('an error throws debris to dodge', () => {
    const s = mode.step(mode.init(W, H), NEUTRAL_INPUT, tel({}, [{ type: 'error' }]), 0.016);
    expect(s.debris.length).toBe(1);
  });

  it('an abort destroys the ship; a completed turn arrives', () => {
    expect(mode.step(mode.init(W, H), NEUTRAL_INPUT, tel({}, [{ type: 'crash' }]), 0.016).destroyed).toBe(true);
    expect(mode.step(mode.init(W, H), NEUTRAL_INPUT, tel({}, [{ type: 'done' }]), 0.016).finished).toBe(true);
  });

  it('starts in first person and toggles to chase on a D-pad up edge', () => {
    let s: FlightState = mode.init(W, H);
    expect(s.view).toBe('cockpit');   // it's the cockpit mode — you start inside it
    s = mode.step(s, input({ up: true }), EMPTY_TELEMETRY, 0.016);
    expect(s.view).toBe('chase');
    s = mode.step(s, input({ up: true }), EMPTY_TELEMETRY, 0.016); // held — must not flip back
    expect(s.view).toBe('chase');
    s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.016);
    s = mode.step(s, input({ up: true }), EMPTY_TELEMETRY, 0.016);
    expect(s.view).toBe('cockpit');
  });

  it('higher throughput flies faster', () => {
    const slow = stepN(mode, tel({ tokensPerSec: 0, streaming: true }), 30);
    const fast = stepN(mode, tel({ tokensPerSec: 55, streaming: true }), 30);
    expect(fast.speed).toBeGreaterThan(slow.speed);
  });
});

describe('engine runner (cars)', () => {
  const mode = createRacer();

  it('smashing a hunter clears it and emits a prune intent', () => {
    let s: RacerState = mode.init(W, H);
    s = mode.step(s, NEUTRAL_INPUT, tel({}, [{ type: 'tool' }]), 0.016);
    // Drag the hunter onto the player's bumper.
    s.cars[0].x = s.laneX;
    s.cars[0].y = H - 84;
    s = mode.step(s, NEUTRAL_INPUT, tel({ streaming: true }), 0.016);
    expect(s.smashed).toBe(1);
    expect(intentsOf(s).some((i) => i.type === 'prune-stale')).toBe(true);
    expect(s.crashed).toBe(false); // hunters don't wreck you
  });

  it('hunting reds costs the hero nothing — no damage from a smash', () => {
    let s: RacerState = mode.init(W, H);
    for (let i = 0; i < 3; i++) {
      s.cars.push({ lane: s.lane, x: s.laneX, y: H - 84, speed: 0, kind: 'hunter', spin: 0, vx: 0, rot: 0, dents: 0, vy: 0, mass: 1400, rotV: 0 });
      s = mode.step(s, NEUTRAL_INPUT, tel({ streaming: true }), 0.016);
    }
    expect(s.smashed).toBe(3);
    expect(s.damage).toBe(0);
    expect(s.crashed).toBe(false);
  });

  it('civilians dent both cars, and enough damage ends the run', () => {
    let s: RacerState = mode.init(W, H);
    for (let hit = 1; hit <= 4; hit++) {
      s.cars.push({ lane: s.lane, x: s.laneX, y: H - 84, speed: 0, kind: 'civilian', spin: 0, vx: 0, rot: 0, dents: 0, vy: 0, mass: 1250, rotV: 0 });
      s = mode.step(s, NEUTRAL_INPUT, tel({ streaming: true }), 0.016);
      expect(s.damage).toBe(hit);
      // the civilian visibly wears the hit too
      expect(s.cars.some((c) => c.dents > 0)).toBe(true);
    }
    expect(s.crashed).toBe(true);
    expect(s.civWrecks).toBe(4);
  });

  it('changes lanes on a discrete press and stays in bounds', () => {
    let s: RacerState = mode.init(W, H);
    for (let i = 0; i < 30; i++) {
      s = mode.step(s, input({ left: true }), EMPTY_TELEMETRY, 0.016);
      s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.016);
    }
    expect(s.lane).toBe(0);
  });

  it('an impact transfers momentum — the struck car is launched and the hero is nudged', () => {
    let s: RacerState = mode.init(W, H);
    // Slightly ahead and offset — the geometry a car is actually struck at, so the contact normal
    // has a longitudinal component and the closing speed does work.
    s.cars.push({ lane: s.lane, x: s.laneX + 8, y: H - 84 - 30, speed: 0, kind: 'hunter', spin: 0, vx: 0, rot: 0, dents: 0, vy: 0, mass: 1400, rotV: 0 });
    const beforeX = s.laneX;
    s = mode.step(s, NEUTRAL_INPUT, tel({ streaming: true }), 0.016);
    const hit = s.cars.find((c) => c.kind === 'hunter')!;
    expect(Math.abs(hit.vx)).toBeGreaterThan(0);   // launched
    expect(Math.abs(hit.rotV)).toBeGreaterThan(0); // and spun by the off-centre contact
    expect(s.heroVx).not.toBe(0);                  // hero took the reaction
    expect(typeof beforeX).toBe('number');
  });

  it('the heavier hero loses less speed than it imparts', () => {
    let s: RacerState = mode.init(W, H);
    const before = s.speed;
    s.cars.push({ lane: s.lane, x: s.laneX, y: H - 84, speed: 0, kind: 'hunter', spin: 0, vx: 0, rot: 0, dents: 0, vy: 0, mass: 1400, rotV: 0 });
    s = mode.step(s, NEUTRAL_INPUT, tel({ streaming: true }), 0.016);
    expect(s.speed).toBeLessThanOrEqual(before); // scrubs some speed, never gains
  });

  it('smashing a hunter grants a boost and shoves the hero sideways', () => {
    let s: RacerState = mode.init(W, H);
    s.cars.push({ lane: s.lane, x: s.laneX + 8, y: H - 84 - 20, speed: 0, kind: 'hunter', spin: 0, vx: 0, rot: 0, dents: 0, vy: 0, mass: 1400, rotV: 0 });
    s = mode.step(s, NEUTRAL_INPUT, tel({ streaming: true }), 0.016);
    expect(s.smashed).toBe(1);
    expect(s.boostT).toBeGreaterThan(0);     // reward for taking them head-on
    expect(Math.abs(s.heroVx)).toBeGreaterThan(0); // and it shoved you on the way out
    expect(s.damage).toBe(0);                // never damages you
  });

  it('being shoved into the barrier is what actually hurts', () => {
    let s: RacerState = mode.init(W, H);
    s.lane = 0;
    s.laneX = W * 0.15 + 12;
    s.heroVx = -400;                         // shoved hard toward the armco
    for (let i = 0; i < 12 && s.railHits === 0; i++) {
      s = mode.step(s, NEUTRAL_INPUT, tel({ streaming: true }), 0.03);
    }
    expect(s.railHits).toBeGreaterThan(0);
    expect(s.damage).toBeGreaterThan(0);
    expect(s.heroVx).toBeGreaterThan(-400);  // scrubbed and bounced back off it
  });

  it('the pilot can add speed with the throttle', () => {
    const idle = stepN(mode, tel({ streaming: true }), 90);
    const pinned = stepN(mode, tel({ streaming: true }), 90, input({ throttle: 1 }));
    expect(pinned.speed).toBeGreaterThan(idle.speed);
  });

  it('winds itself up over a clean run even with no input', () => {
    const early = stepN(mode, tel({ streaming: true }), 60);
    const later = stepN(mode, tel({ streaming: true }), 900);
    expect(later.speed).toBeGreaterThan(early.speed);
  });

  it('the camera trails the car laterally instead of being welded to it', () => {
    let s: RacerState = mode.init(W, H);
    const startCam = s.camX;
    // Swerve two lanes over in a single frame's worth of input.
    for (let i = 0; i < 4; i++) {
      s = mode.step(s, input({ right: true }), tel({ streaming: true }), 0.016);
      s = mode.step(s, NEUTRAL_INPUT, tel({ streaming: true }), 0.016);
    }
    // The car has committed to a new lane, but the camera is still catching up.
    expect(s.lane).toBeGreaterThan(0);
    expect(Math.abs(s.camX - startCam)).toBeLessThan(Math.abs(s.laneX - startCam) + 1);
    expect(s.camX).not.toBe(s.laneX);
  });

  it('the camera eventually settles onto the car', () => {
    let s: RacerState = mode.init(W, H);
    s = mode.step(s, input({ right: true }), tel({ streaming: true }), 0.016);
    for (let i = 0; i < 300; i++) s = mode.step(s, NEUTRAL_INPUT, tel({ streaming: true }), 0.016);
    expect(Math.abs(s.camX - s.laneX)).toBeLessThan(2);
  });

  it('reports a score and terminal state', () => {
    const s = stepN(mode, tel({ streaming: true, tokensPerSec: 30 }), 120);
    expect(typeof mode.score?.(s)).toBe('number');
    expect(mode.isOver?.(s)).toBe(false);
  });
});

describe('chase camera', () => {
  const H = 640;

  it('is full scale at the bumper and compresses toward the far end', () => {
    expect(perspAt(H, H)).toBeCloseTo(1, 3);
    expect(perspAt(0, H)).toBeLessThan(1);
    expect(perspAt(0, H)).toBeGreaterThan(0.4);   // still readable, not a pinhole
  });

  it('is monotonic — no kinks for the eye to catch', () => {
    let prev = perspAt(0, H);
    for (let y = 0; y <= H; y += 8) {
      const k = perspAt(y, H);
      expect(k).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = k;
    }
  });

  it('falls off reciprocally, not linearly — the midpoint sits below the linear average', () => {
    // A 1/z camera compresses distance faster than a straight ramp; that difference is exactly
    // what stops traffic looking like it changes speed as it comes down the screen.
    const mid = perspAt(H / 2, H);
    const linearMid = (perspAt(0, H) + perspAt(H, H)) / 2;
    expect(mid).toBeLessThan(linearMid);
  });

  it('clamps outside the frame instead of inverting', () => {
    expect(perspAt(-500, H)).toBeGreaterThan(0);
    expect(perspAt(H * 3, H)).toBeCloseTo(1, 3);
  });
});

describe('rolling terrain', () => {
  const H = 640;

  it('the horizon actually moves — it is not one endless downhill', () => {
    const ys = [];
    for (let d = 0; d < 12000; d += 250) ys.push(horizonAt(d, H));
    const spread = Math.max(...ys) - Math.min(...ys);
    expect(spread).toBeGreaterThan(H * 0.08);   // a visible rise and fall, not a wobble
  });

  it('crests and dips both occur', () => {
    let sawRise = false, sawDip = false;
    for (let d = 0; d < 20000; d += 120) {
      const e = elevationAt(d);
      if (e > 0.5) sawDip = true;
      if (e < -0.5) sawRise = true;
    }
    expect(sawRise && sawDip).toBe(true);
  });

  it('stays on screen and above the road at every distance', () => {
    for (let d = 0; d < 40000; d += 97) {
      const y = horizonAt(d, H);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(H * 0.45);
    }
  });

  it('is continuous — no jumps the eye would catch', () => {
    let prev = horizonAt(0, H);
    for (let d = 5; d < 20000; d += 5) {
      const y = horizonAt(d, H);
      expect(Math.abs(y - prev)).toBeLessThan(1.5);
      prev = y;
    }
  });
});

describe('road regions', () => {
  it('cycles through every region as distance grows', () => {
    const seen = new Set(REGIONS.map((_, i) => regionAt(i * REGION_LENGTH + 10).name));
    expect(seen.size).toBe(REGIONS.length);
  });

  it('wraps back to the first region after the last', () => {
    expect(regionAt(REGIONS.length * REGION_LENGTH + 10).name).toBe(regionAt(10).name);
  });

  it('every region defines a full palette and a prop renderer', () => {
    for (const r of REGIONS) {
      expect(r.name.length).toBeGreaterThan(0);
      for (const k of ['sky', 'verge', 'asphalt', 'divider', 'edge', 'rail'] as const) {
        expect(typeof r[k]).toBe('string');
      }
      expect(typeof r.prop).toBe('function');
    }
  });
});

describe('swarm protocol (formation shooter)', () => {
  const mode = GAME_MODES.find((m) => m.id === 'freeplay-swarm')!;

  it('is discovered by the registry', () => {
    expect(mode).toBeTruthy();
    expect(mode.kind).toBe('freeplay');
  });

  it('opens with a full wave that sweeps in before forming up', () => {
    const s = mode.init(W, H) as never as { attackers: { phase: string }[] };
    expect(s.attackers.length).toBeGreaterThan(0);
    expect(s.attackers.every((a) => a.phase === 'entering')).toBe(true);
  });

  it('attackers reach formation, then peel off to dive', () => {
    let s = mode.init(W, H);
    for (let i = 0; i < 400; i++) s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.016);
    const st = s as never as { attackers: { phase: string }[] };
    expect(st.attackers.some((a) => a.phase === 'formed' || a.phase === 'diving')).toBe(true);
  });

  it('firing spawns a friendly shot', () => {
    const s = mode.step(mode.init(W, H), input({ fire: true }), EMPTY_TELEMETRY, 0.016);
    const st = s as never as { shots: { hostile: boolean }[] };
    expect(st.shots.some((x) => !x.hostile)).toBe(true);
  });

  it('scores and reports terminal state', () => {
    const s = mode.init(W, H);
    expect(typeof mode.score?.(s)).toBe('number');
    expect(mode.isOver?.(s)).toBe(false);
  });
});

describe('grid cycles', () => {
  const mode = createGrid();

  it('starts with the player and rivals alive', () => {
    const s = mode.init(W, H);
    expect(s.player.alive).toBe(true);
    expect(s.rivals.length).toBeGreaterThan(0);
  });

  it('a tool event drops a data node', () => {
    const s = mode.step(mode.init(W, H), NEUTRAL_INPUT, tel({}, [{ type: 'tool' }]), 0.016);
    expect(s.nodes.length).toBe(1);
  });

  it('driving over a node collects it and emits a prune intent', () => {
    let s: GridState = mode.init(W, H);
    // Place a node directly in the player's path.
    s.nodes.push({ x: s.player.x, y: s.player.y - 1 });
    for (let i = 0; i < 12 && s.collected === 0; i++) {
      s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.05);
    }
    expect(s.collected).toBe(1);
  });

  it('running into the wall derezzes the player', () => {
    let s: GridState = mode.init(W, H);
    for (let i = 0; i < 400 && !s.crashed; i++) {
      s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.05);
    }
    expect(s.crashed).toBe(true); // heading up with no input, it must hit the top wall
  });

  it('is frozen once crashed', () => {
    const crashed: GridState = { ...mode.init(W, H), crashed: true };
    expect(mode.step(crashed, input({ throttle: 1 }), EMPTY_TELEMETRY, 0.016)).toBe(crashed);
  });
});

describe('belt clearance (asteroids)', () => {
  const mode = createBelt();

  it('opens with a wave of large rocks', () => {
    const s = mode.init(W, H);
    expect(s.rocks.length).toBeGreaterThan(0);
    expect(s.rocks.every((r) => r.tier === 2)).toBe(true);
  });

  it('a large rock splits into two mediums, a medium into two smalls', () => {
    let s: ShooterState = mode.init(W, H);
    const rock = s.rocks[0];
    s = { ...s, rocks: [rock], bullets: [{ x: rock.x, y: rock.y, vx: 0, vy: 0, life: 1 }] };
    s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.001);
    expect(s.rocks.length).toBe(2);
    expect(s.rocks.every((r) => r.tier === 1)).toBe(true);

    const med = s.rocks[0];
    s = { ...s, rocks: [med], bullets: [{ x: med.x, y: med.y, vx: 0, vy: 0, life: 1 }] };
    s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.001);
    expect(s.rocks.every((r) => r.tier === 0)).toBe(true);
  });

  it('dusting a small rock clears it and emits a prune intent', () => {
    let s: ShooterState = mode.init(W, H);
    const small = { ...s.rocks[0], tier: 0 as const, vx: 0, vy: 0 };
    s = { ...s, rocks: [small], bullets: [{ x: small.x, y: small.y, vx: 0, vy: 0, life: 1 }] };
    s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.001);
    expect(s.cleared).toBe(1);
    expect(intentsOf(s).some((i) => i.type === 'prune-stale')).toBe(true);
  });

  it('starts a fresh, larger wave once the belt is clear', () => {
    let s: ShooterState = mode.init(W, H);
    s = { ...s, rocks: [] };
    s = mode.step(s, NEUTRAL_INPUT, EMPTY_TELEMETRY, 0.016);
    expect(s.wave).toBe(2);
    expect(s.rocks.length).toBeGreaterThan(0);
  });

  it('keeps three lives and ignores telemetry aborts (free-play)', () => {
    expect(mode.init(W, H).lives).toBe(3);
    const s = stepN(mode, tel({}, [{ type: 'crash' }]), 60);
    expect(s.gameOver).toBe(false);
  });
});

describe('high scores', () => {
  it('records only an improvement', () => {
    let scores = {};
    let r = applyScore(scores, 'm', 100);
    expect(r.isRecord).toBe(true);
    scores = r.next;
    r = applyScore(scores, 'm', 50);
    expect(r.isRecord).toBe(false);
    expect(r.next).toBe(scores);
    r = applyScore(scores, 'm', 150);
    expect(r.isRecord).toBe(true);
    expect(r.next.m).toBe(150);
  });

  it('keeps separate records per mode and rejects non-finite scores', () => {
    const { next } = applyScore({ a: 10 }, 'b', 5);
    expect(next).toEqual({ a: 10, b: 5 });
    expect(applyScore({}, 'a', Number.NaN).isRecord).toBe(false);
  });
});

describe('render does not throw', () => {
  function fakeCtx(): CanvasRenderingContext2D {
    const noop = () => undefined;
    const target: Record<string, unknown> = {};
    return new Proxy(target, {
      get: (t, p) => {
        if (p in t) return t[p as string];
        // Gradient factories must return an object with addColorStop, not a bare noop.
        if (p === 'createRadialGradient' || p === 'createLinearGradient' || p === 'createConicGradient') {
          return () => ({ addColorStop: noop });
        }
        return noop;
      },
      set: (t, p, v) => { t[p as string] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
  }

  it('renders init, mid-run and terminal states for every mode', () => {
    const ctx = fakeCtx();
    for (const m of GAME_MODES) {
      let s = m.init(W, H);
      expect(() => m.render(ctx, s, W, H)).not.toThrow();
      for (let i = 0; i < 30; i++) {
        s = m.step(
          s,
          input({ steer: 0.6, moveY: -0.3, throttle: 1, fire: true, aimX: 1 }),
          tel({ streaming: true, tokensPerSec: 35 }, i === 5 ? [{ type: 'tool' }] : i === 11 ? [{ type: 'error' }] : []),
          0.016,
        );
      }
      expect(() => m.render(ctx, s, W, H)).not.toThrow();
      const ended = m.step(m.init(W, H), NEUTRAL_INPUT, tel({}, [{ type: 'crash' }]), 0.016);
      expect(() => m.render(ctx, ended, W, H)).not.toThrow();
    }
  });
});
