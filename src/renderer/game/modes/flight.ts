import { GameMode, GameInput, TelemetryFrame, GameIntent, IntentCarrier } from '../types';
import { makeRng, approach, clamp } from '../lib3d';

// TRENCH RUN — first person, from inside a starfighter, low and fast down a long metal trench.
//
// The trench is Claude's run. Every tool call puts a threat in it (a wall turret, a catwalk gun or
// a fighter diving in from ahead or behind), errors hurt, and when the turn completes the section's
// target run begins: a small core hangs at the end of the trench, and hitting it is the big score
// before the next section opens up. Shooting a turret or fighter down is real work too: each one
// prunes a stale context item.
//
// It flies itself, like the agent does. The autopilot threads the girders on its own; the moment you
// touch the stick, control blends to you. Answering one of Claude's cards or sending a session its
// orders mid-run is a POWER-UP: a shield and rapid, twin-linked fire.
//
// Rendering is a hand-rolled perspective divide (no 3D engine): the trench is a handful of planar
// quads per segment, batched into a few paths per frame, with no shadowBlur anywhere. Glow comes
// from the 'lighter' composite instead.

export type ViewMode = 'cockpit' | 'chase';

type ObstacleKind = 'low' | 'high' | 'mid' | 'catwalk' | 'left' | 'right';

// A girder or block spanning the trench at depth z: a box x0..x1, y0..y1 (y grows downward).
interface Obstacle {
  z: number; kind: ObstacleKind;
  x0: number; x1: number; y0: number; y1: number;
  done: boolean; // the ship has passed its depth (threaded or hit)
}

interface Turret { z: number; x: number; y: number; side: number; mount: 'wall' | 'catwalk'; hp: number; cd: number; }

// Fighters dive in from above the rim. 'overtake' ones start behind you and race past; 'attack'
// ones fly at you, weaving and firing.
interface Fighter {
  z: number; x: number; y: number; vx: number; vy: number; vz: number;
  lane: number; hp: number; phase: number; cd: number; mode: 'overtake' | 'attack';
}

interface Bolt { x: number; y: number; z: number; vx: number; vy: number; vz: number; dmg: number; power: boolean; }
interface Shot { x: number; y: number; z: number; vx: number; vy: number; vz: number; }

// 0 spark (bolt impact), 1 explosion, 2 shield ripple, 3 target down
interface Flash { x: number; y: number; z: number; t: number; kind: 0 | 1 | 2 | 3; }

interface Target { z: number; x: number; y: number; hit: boolean; }

type Tone = 'good' | 'bad' | 'info';

export interface FlightState extends IntentCarrier {
  w: number;
  h: number;
  z: number;          // distance flown down the trench
  shipX: number;      // lateral offset from the trench centreline
  shipY: number;      // vertical offset (y grows downward; the floor is at FLOOR)
  vx: number;
  vy: number;
  roll: number;       // bank angle the horizon rolls by (radians)
  speed: number;      // cruise speed from throughput, before boosts
  eff: number;        // speed actually flown this frame
  manual: number;     // 0 = autopilot, 1 = fully hand-flown
  section: number;
  sectionEnd: number; // z of this section's target
  target: Target;
  runAnnounced: boolean;
  targetsHit: number;
  targetsMissed: number;
  obstacles: Obstacle[];
  turrets: Turret[];
  fighters: Fighter[];
  bolts: Bolt[];
  shots: Shot[];
  flashes: Flash[];
  nextFeatureZ: number;
  fireCd: number;
  muzzle: number;
  kills: number;
  threaded: number;   // obstacles passed cleanly
  points: number;
  mult: number;
  hull: number;       // 0..1
  powerT: number;     // seconds of shield + rapid fire left
  powerFlash: number; // the big POWER-UP banner
  powerSource: 'answer' | 'prompt' | null;
  shieldHit: number;
  boostT: number;
  boostFuel: number;
  thinkT: number;
  shake: number;
  hurtT: number;
  banner: string;
  bannerSub: string;
  bannerT: number;
  bannerTone: Tone;
  aimX: number;       // where the twin bolts converge (world), leading a locked target
  aimY: number;
  aimZ: number;
  locked: boolean;
  tps: number;
  lastTool: string | null;
  view: ViewMode;
  prevToggle: boolean;
  destroyed: boolean;
  seed: number;
  tick: number;
  intents: GameIntent[];
}

// ─── World ────────────────────────────────────────────────────────────────────
const TW = 230;              // trench half-width
const RIM = -170;            // top of the walls
const FLOOR = 190;           // trench floor
const SHIP_R = 22;
const X_LIM = TW - 36;
const Y_MIN = RIM - 150;     // you can pop up over the rim (exposed: turrets fire twice as fast)
const Y_MAX = FLOOR - 34;
const CRUISE_Y = 30;

const BASE_SPEED = 480;
const MAX_SPEED = 1500;
const FAR = 5200;
const SEG = 220;
const SECTION_LEN = 15000;
const RUN_WINDOW = 3600;
const DONE_RUN = 3200;
const ZT = 40;               // girder thickness

const CONTROL_ACCEL = 1400;
const AUTO_ACCEL = 1100;
const DAMP = 2.6;
const DEADZONE = 0.16;

const BOLT_V = 4200;
const SHOT_V = 950;
const CANNON_X = 64;
const CANNON_Y = 34;
const CONV = 1700;           // free-aim convergence distance
const LOCK_CONE = 0.075;
const FIRE_CD = 0.16;
const RAPID_CD = 0.07;
const POWER_TIME = 12;
const POWER_MAX = 36;
const BOOST_TIME = 1.2;
const FLASH_T = [0.22, 0.6, 0.35, 1.1];

function clampDt(dt: number): number {
  return Math.max(0, Math.min(dt, 0.05));
}

function hash(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}

// ─── Sim helpers (all mutate the fresh copy `s` inside step) ─────────────────
function addFlash(s: FlightState, x: number, y: number, z: number, kind: Flash['kind']) {
  s.flashes.push({ x, y, z, t: FLASH_T[kind], kind });
  if (s.flashes.length > 28) s.flashes.shift();
}

function say(s: FlightState, text: string, sub: string, tone: Tone) {
  s.banner = text; s.bannerSub = sub; s.bannerT = 2.2; s.bannerTone = tone;
}

// Returns true when the hull actually took it (the shield absorbs everything while powered up).
function hurt(s: FlightState, amt: number): boolean {
  if (s.powerT > 0) {
    s.shieldHit = 0.4;
    s.shake = Math.min(1, s.shake + 0.18);
    addFlash(s, s.shipX, s.shipY, s.z + 60, 2);
    return false;
  }
  s.hull = clamp(s.hull - amt, 0, 1);
  s.shake = Math.min(1, s.shake + 0.55);
  s.hurtT = 0.45;
  s.mult = Math.max(1, s.mult - 0.25);
  return true;
}

function makeObstacle(rng: () => number, z: number, kind: ObstacleKind): Obstacle {
  switch (kind) {
    case 'low': return { z, kind, x0: -TW, x1: TW, y0: FLOOR - 130 + rng() * 30, y1: FLOOR, done: false };
    case 'high': return { z, kind, x0: -TW, x1: TW, y0: RIM, y1: RIM + 120 + rng() * 40, done: false };
    case 'mid': {
      const c = -40 + rng() * 100;
      return { z, kind, x0: -TW, x1: TW, y0: c - 22, y1: c + 22, done: false };
    }
    case 'catwalk': {
      const c = RIM + 90 + rng() * (FLOOR - RIM - 170);
      return { z, kind, x0: -TW, x1: TW, y0: c - 10, y1: c + 10, done: false };
    }
    case 'left': return { z, kind, x0: -TW, x1: -TW + TW * (0.8 + rng() * 0.3), y0: RIM, y1: FLOOR, done: false };
    case 'right': return { z, kind, x0: TW - TW * (0.8 + rng() * 0.3), x1: TW, y0: RIM, y1: FLOOR, done: false };
  }
}

const GIRDERS: ObstacleKind[] = ['low', 'high', 'mid', 'left', 'right'];

function wallTurret(rng: () => number, z: number): Turret {
  const side = rng() < 0.5 ? -1 : 1;
  return { z, x: side * (TW - 16), y: RIM + 40 + rng() * (FLOOR - RIM - 100), side, mount: 'wall', hp: 3, cd: 0.5 + rng() };
}

function spawnFeature(s: FlightState, rng: () => number, z: number) {
  const r = rng();
  if (r < 0.5) {
    s.obstacles.push(makeObstacle(rng, z, GIRDERS[Math.floor(rng() * GIRDERS.length) % GIRDERS.length]));
  } else if (r < 0.8) {
    s.turrets.push(wallTurret(rng, z));
  } else {
    // A catwalk across the trench with a gun on it.
    const cw = makeObstacle(rng, z, 'catwalk');
    s.obstacles.push(cw);
    s.turrets.push({ z, x: (rng() - 0.5) * TW * 1.2, y: cw.y0 - 24, side: 0, mount: 'catwalk', hp: 3, cd: 0.6 + rng() });
  }
}

function spawnFighter(s: FlightState, rng: () => number, behind: boolean) {
  const lane = RIM + 60 + rng() * (FLOOR - RIM - 140);
  s.fighters.push({
    z: behind ? s.z - 500 : s.z + 4400,
    x: (rng() - 0.5) * TW * 1.4,
    y: RIM - 230,
    vx: 0, vy: 0, vz: 0,
    lane, hp: 2, phase: rng() * Math.PI * 2, cd: 0.8 + rng(),
    mode: behind ? 'overtake' : 'attack',
  });
}

// A tool call puts a threat in the trench.
function spawnThreat(s: FlightState, rng: () => number) {
  const r = rng();
  if (r < 0.5) {
    const z = s.z + 2600 + rng() * 1200;
    if (rng() < 0.35) {
      const cw = makeObstacle(rng, z, 'catwalk');
      s.obstacles.push(cw);
      s.turrets.push({ z, x: (rng() - 0.5) * TW * 1.2, y: cw.y0 - 24, side: 0, mount: 'catwalk', hp: 3, cd: 0.6 + rng() });
    } else {
      s.turrets.push(wallTurret(rng, z));
    }
  } else {
    spawnFighter(s, rng, r > 0.75);
  }
}

function makeTarget(rng: () => number, z: number): Target {
  return { z, x: (rng() - 0.5) * TW * 1.0, y: RIM + 90 + rng() * (FLOOR - RIM - 170), hit: false };
}

// Keep the approach to the target clear of girders and guns.
function clearRunWindow(s: FlightState) {
  const lo = s.sectionEnd - 900;
  const hi = s.sectionEnd + 500;
  s.obstacles = s.obstacles.filter((o) => o.z < lo || o.z > hi);
  s.turrets = s.turrets.filter((t) => t.z < lo || t.z > hi);
}

function newSection(s: FlightState, rng: () => number) {
  s.section += 1;
  s.sectionEnd = s.z + SECTION_LEN;
  s.target = makeTarget(rng, s.sectionEnd);
  s.runAnnounced = false;
}

function fillCourse(s: FlightState, rng: () => number) {
  while (s.nextFeatureZ < s.z + FAR) {
    if (s.nextFeatureZ > s.sectionEnd - 900 && s.nextFeatureZ < s.sectionEnd + 500) {
      s.nextFeatureZ = s.sectionEnd + 500 + rng() * 300;
      continue;
    }
    spawnFeature(s, rng, s.nextFeatureZ);
    s.nextFeatureZ += 950 + rng() * 700;
  }
}

// Where the autopilot wants to be to clear an obstacle.
function safePoint(o: Obstacle, wx: number, wy: number): [number, number] {
  switch (o.kind) {
    case 'low': return [wx, Math.max(Y_MIN + 20, o.y0 - 70)];
    case 'high': return [wx, Math.min(Y_MAX - 10, o.y1 + 70)];
    case 'mid':
    case 'catwalk': {
      const above = o.y0 - RIM;
      const below = Y_MAX - o.y1;
      return above > below ? [wx, (RIM + o.y0) / 2] : [wx, Math.min(Y_MAX - 10, (o.y1 + Y_MAX) / 2 + 6)];
    }
    case 'left': return [(o.x1 + X_LIM) / 2, wy];
    case 'right': return [(o.x0 - X_LIM) / 2, wy];
  }
}

// Where a moving point (x,y,z with velocity v) can be met by a bolt fired from (cx,cy,cz) moving
// forward at eff + BOLT_V. Returns the lead time.
function leadTime(z: number, vz: number, cz: number, eff: number): number {
  return Math.max(0.03, (z - cz) / Math.max(200, eff + BOLT_V - vz));
}

// Sweep test: did a mover that went prev→cur pass within r of (x, y) at depth z?
function sweepHit(
  px: number, py: number, pz: number, cx: number, cy: number, cz: number,
  x: number, y: number, z: number, r: number,
): boolean {
  const lo = Math.min(pz, cz) - 30;
  const hi = Math.max(pz, cz) + 30;
  if (z < lo || z > hi) return false;
  const span = cz - pz;
  const f = span === 0 ? 1 : clamp((z - pz) / span, 0, 1);
  const hx = px + (cx - px) * f - x;
  const hy = py + (cy - py) * f - y;
  return hx * hx + hy * hy < r * r;
}

export function createMode(): GameMode<FlightState> {
  return {
    id: 'cockpit-flight',
    name: 'Trench Run',
    kind: 'telemetry',
    blurb: 'Fly a starfighter down Claude\'s trench. Shoot turrets to prune stale context, and hit the core at the end of each section.',
    controls: 'Left stick: fly · Right stick: aim · [R2] or [A] fire · [B] or [L1] boost · [D-pad] up: chase view',

    init(w, h): FlightState {
      const rng = makeRng(0x7a3c91e5);
      const s: FlightState = {
        w, h,
        z: 0, shipX: 0, shipY: CRUISE_Y, vx: 0, vy: 0, roll: 0,
        speed: BASE_SPEED, eff: BASE_SPEED, manual: 0,
        section: 1, sectionEnd: SECTION_LEN, target: makeTarget(rng, SECTION_LEN), runAnnounced: false,
        targetsHit: 0, targetsMissed: 0,
        obstacles: [], turrets: [], fighters: [], bolts: [], shots: [], flashes: [],
        nextFeatureZ: 1600,
        fireCd: 0, muzzle: 0, kills: 0, threaded: 0, points: 0, mult: 1, hull: 1,
        powerT: 0, powerFlash: 0, powerSource: null, shieldHit: 0,
        boostT: 0, boostFuel: 1, thinkT: 0, shake: 0, hurtT: 0,
        banner: 'SECTION 1', bannerSub: 'trench ahead', bannerT: 2.2, bannerTone: 'info',
        aimX: 0, aimY: CRUISE_Y, aimZ: CONV, locked: false,
        tps: 0, lastTool: null,
        view: 'cockpit', prevToggle: false,
        destroyed: false,
        seed: 0x1a2b3c4d, tick: 0, intents: [],
      };
      fillCourse(s, rng);
      s.seed = Math.floor(rng() * 0xffffffff);
      return s;
    },

    step(state, input: GameInput, tel: TelemetryFrame, dtRaw): FlightState {
      if (state.destroyed) return state.intents.length ? { ...state, intents: [] } : state;
      const dt = clampDt(dtRaw);
      const s: FlightState = {
        ...state,
        tick: state.tick + 1,
        target: { ...state.target },
        obstacles: state.obstacles.map((o) => ({ ...o })),
        turrets: state.turrets.map((t) => ({ ...t })),
        fighters: state.fighters.map((f) => ({ ...f })),
        bolts: state.bolts.slice(),
        shots: state.shots.slice(),
        flashes: state.flashes.slice(),
        intents: [],
      };
      const rng = makeRng((s.seed ^ Math.imul(s.tick, 2654435761)) >>> 0);

      // ── Engine events ───────────────────────────────────────────────────────
      for (const ev of tel.events) {
        switch (ev.type) {
          case 'crash':
            addFlash(s, s.shipX, s.shipY, s.z + 80, 1);
            return { ...s, destroyed: true, shake: 1 };
          case 'done':
            // The turn completed: this section's target run starts now.
            if (s.sectionEnd - s.z > DONE_RUN) {
              s.sectionEnd = s.z + DONE_RUN;
              s.target = makeTarget(rng, s.sectionEnd);
              clearRunWindow(s);
              if (s.nextFeatureZ > s.sectionEnd - 900 && s.nextFeatureZ < s.sectionEnd + 500) {
                s.nextFeatureZ = s.sectionEnd + 500;
              }
            }
            s.runAnnounced = true;
            say(s, 'TARGET RUN', 'turn complete · hit the core', 'info');
            break;
          case 'boost': s.boostT = BOOST_TIME; break;
          case 'tool': spawnThreat(s, rng); break;
          case 'thinking': s.thinkT = 2; break;
          case 'error':
            hurt(s, 0.1);
            addFlash(s, s.shipX + (rng() - 0.5) * 80, s.shipY - 20, s.z + 70, 0);
            break;
          case 'sector':
            s.points += 300 * s.mult;
            s.hull = clamp(s.hull + 0.15, 0, 1);
            say(s, 'CHECKPOINT', 'task complete · hull +15%', 'good');
            break;
          case 'milestone':
            if (ev.good) {
              s.points += 500 * s.mult;
              s.mult = Math.min(4, s.mult + 0.5);
              s.hull = clamp(s.hull + 0.1, 0, 1);
              say(s, 'GREEN FLAG', `multiplier ×${s.mult.toFixed(1)}`, 'good');
            } else {
              s.obstacles.push(makeObstacle(rng, s.z + 2400, GIRDERS[Math.floor(rng() * GIRDERS.length) % GIRDERS.length]));
              s.turrets.push(wallTurret(rng, s.z + 2900));
              say(s, 'RED FLAG', 'hazard ahead', 'bad');
            }
            break;
          case 'powerup':
            s.powerT = Math.min(POWER_MAX, s.powerT + POWER_TIME);
            s.powerFlash = 2.4;
            s.powerSource = ev.source;
            break;
        }
      }
      s.tps = tel.snapshot.tokensPerSec;
      s.lastTool = tel.snapshot.lastTool;
      if (tel.snapshot.thinking) s.thinkT = Math.max(s.thinkT, 0.6);

      // ── View toggle (D-pad up), edge-detected ───────────────────────────────
      if (input.up && !s.prevToggle) s.view = s.view === 'chase' ? 'cockpit' : 'chase';
      s.prevToggle = input.up;

      // ── Speed: the engine's throughput, the triggers, and boosts ────────────
      const cruise = (BASE_SPEED + Math.min(Math.max(0, tel.snapshot.tokensPerSec), 60) * 11)
        * (1 + 0.15 * input.throttle) * (1 - 0.45 * input.brake);
      s.speed += (cruise - s.speed) * Math.min(1, dt * 2.2);
      const boosting = input.boost && s.boostFuel > 0;
      s.boostFuel = boosting ? Math.max(0, s.boostFuel - dt * 0.5) : Math.min(1, s.boostFuel + dt * 0.12);
      if (s.boostT > 0) s.boostT = Math.max(0, s.boostT - dt);
      const mult = s.boostT > 0 ? 1.7 : boosting ? 1.45 : 1;
      s.eff = Math.min(MAX_SPEED, s.speed * mult);
      if (mult > 1) s.shake = Math.max(s.shake, 0.12);
      const prevZ = s.z;
      s.z += s.eff * dt;

      // ── Course: keep the trench stocked ─────────────────────────────────────
      fillCourse(s, rng);

      // ── Control blend: autopilot vs pilot ───────────────────────────────────
      const sx = input.steer !== 0 ? input.steer : (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const sy = input.moveY !== 0 ? input.moveY : (input.down ? 1 : 0);
      const piloting = Math.hypot(sx, sy) > DEADZONE;
      // Taking the stick hands control over quickly; letting go returns it gently.
      s.manual = piloting ? clamp(s.manual + dt * 3.2, 0, 1) : clamp(s.manual - dt * 0.55, 0, 1);

      let tx = Math.sin(s.tick * 0.021) * 70;
      let ty = CRUISE_Y + Math.sin(s.tick * 0.013) * 30;
      let next: Obstacle | null = null;
      for (const o of s.obstacles) {
        if (o.z > s.z && o.z < s.z + 2200 && (!next || o.z < next.z)) next = o;
      }
      if (next) [tx, ty] = safePoint(next, tx, ty);

      const autoAx = approach(s.vx, (tx - s.shipX) * 3, AUTO_ACCEL * dt) - s.vx;
      const autoAy = approach(s.vy, (ty - s.shipY) * 3, AUTO_ACCEL * dt) - s.vy;
      s.vx += autoAx * (1 - s.manual) + sx * CONTROL_ACCEL * dt * s.manual;
      s.vy += autoAy * (1 - s.manual) + sy * CONTROL_ACCEL * dt * s.manual;
      const damp = Math.max(0, 1 - DAMP * dt);
      s.vx *= damp; s.vy *= damp;
      s.shipX += s.vx * dt;
      s.shipY += s.vy * dt;

      // The walls are real: scrape one hard and it costs hull.
      if (Math.abs(s.shipX) > X_LIM) {
        s.shipX = Math.sign(s.shipX) * X_LIM;
        if (Math.abs(s.vx) > 160) {
          hurt(s, 0.05);
          addFlash(s, Math.sign(s.shipX) * TW, s.shipY, s.z + 90, 0);
        }
        s.vx = -s.vx * 0.3;
      }
      if (s.shipY > Y_MAX) {
        s.shipY = Y_MAX;
        if (s.vy > 160) { hurt(s, 0.05); addFlash(s, s.shipX, FLOOR, s.z + 90, 0); }
        s.vy = -s.vy * 0.3;
      }
      if (s.shipY < Y_MIN) { s.shipY = Y_MIN; s.vy = Math.max(0, s.vy); }
      s.roll = approach(s.roll, clamp(s.vx / 420, -1, 1) * 0.5, dt * 2.2);
      const exposed = s.shipY < RIM;

      // ── Timers ──────────────────────────────────────────────────────────────
      s.powerT = Math.max(0, s.powerT - dt);
      s.powerFlash = Math.max(0, s.powerFlash - dt);
      s.shieldHit = Math.max(0, s.shieldHit - dt);
      s.thinkT = Math.max(0, s.thinkT - dt);
      s.hurtT = Math.max(0, s.hurtT - dt);
      s.bannerT = Math.max(0, s.bannerT - dt);
      s.muzzle = Math.max(0, s.muzzle - dt);
      s.shake = Math.max(0, s.shake - dt * 1.6);
      s.flashes = s.flashes
        .map((f) => ({ ...f, t: f.t - dt }))
        .filter((f) => f.t > 0);

      // ── Enemies move (before aiming, so the lead uses this frame's motion) ──
      for (const f of s.fighters) {
        f.phase += dt * 2.2;
        if (f.mode === 'overtake') {
          f.vz = s.eff + 420;
          if (f.z - s.z > 1500) f.mode = 'attack';
        } else {
          f.vz = -280;
          // Close in, then break off up and out of the trench, unless you're up there with it.
          if (f.z - s.z < 420) f.lane = RIM - 280;
        }
        f.vx = Math.sin(f.phase) * 170 + Math.sign(s.shipX - f.x) * 40;
        f.vy = clamp((f.lane - f.y) * 1.6, -320, 320);   // the dive into the trench
        f.x = clamp(f.x + f.vx * dt, -TW + 40, TW - 40);
        f.y += f.vy * dt;
        f.z += f.vz * dt;
      }

      // ── Targeting: the reticle locks the nearest threat in the aim cone and leads it ──
      const freeX = input.aimX * 300;
      const freeY = input.aimY * 200;
      const fax = freeX / CONV;
      const fay = freeY / CONV;
      const cz = s.z + 30;
      let best = LOCK_CONE;
      let lx = 0, ly = 0, lz = 0, lvx = 0, lvy = 0, lvz = 0;
      let locked = false;
      const consider = (x: number, y: number, z: number, vx: number, vy: number, vz: number) => {
        const dz = z - s.z;
        if (dz < 250 || dz > 3400) return;
        const d = Math.hypot((x - s.shipX) / dz - fax, (y - s.shipY) / dz - fay);
        if (d < best) { best = d; locked = true; lx = x; ly = y; lz = z; lvx = vx; lvy = vy; lvz = vz; }
      };
      for (const t of s.turrets) if (t.hp > 0) consider(t.x, t.y, t.z, 0, 0, 0);
      for (const f of s.fighters) if (f.hp > 0) consider(f.x, f.y, f.z, f.vx, f.vy, f.vz);
      if (!s.target.hit) consider(s.target.x, s.target.y, s.target.z, 0, 0, 0);
      if (locked) {
        const t = leadTime(lz, lvz, cz, s.eff);
        s.aimX = lx + lvx * t; s.aimY = ly + lvy * t; s.aimZ = lz + lvz * t;
      } else {
        const tc = CONV / BOLT_V;
        s.aimX = s.shipX + freeX + s.vx * tc;
        s.aimY = s.shipY + freeY + s.vy * tc;
        s.aimZ = s.z + CONV + s.eff * tc;
      }
      s.locked = locked;

      // ── Guns: twin bolts from the wing cannons, converging on the aim point ──
      s.fireCd = Math.max(0, s.fireCd - dt);
      const powered = s.powerT > 0;
      if (input.fire && s.fireCd === 0) {
        const t = Math.max(0.03, (s.aimZ - cz) / (s.eff + BOLT_V));
        for (const side of [-1, 1]) {
          const bx = s.shipX + side * CANNON_X;
          const by = s.shipY + CANNON_Y;
          s.bolts.push({
            x: bx, y: by, z: cz,
            vx: (s.aimX - bx) / t, vy: (s.aimY - by) / t, vz: s.eff + BOLT_V,
            dmg: powered ? 2 : 1, power: powered,
          });
        }
        s.fireCd = powered ? RAPID_CD : FIRE_CD;
        s.muzzle = 0.07;
      }

      // ── Enemy fire ──────────────────────────────────────────────────────────
      const fireAt = (x: number, y: number, z: number, vz: number, spread: number) => {
        const tt = Math.max(0.1, (z - s.z) / (SHOT_V - vz + s.eff));
        const ax = s.shipX + s.vx * tt * 0.5 + (rng() - 0.5) * spread;
        const ay = s.shipY + s.vy * tt * 0.5 + (rng() - 0.5) * spread;
        s.shots.push({ x, y, z, vx: (ax - x) / tt, vy: (ay - y) / tt, vz: vz - SHOT_V });
      };
      for (const t of s.turrets) {
        const dz = t.z - s.z;
        if (t.hp <= 0 || dz < 380 || dz > 3000) continue;
        t.cd -= dt * (exposed ? 2 : 1);
        if (t.cd <= 0) {
          fireAt(t.x, t.y, t.z, 0, 110);
          t.cd = 1.4 + rng() * 1.1;
        }
      }
      for (const f of s.fighters) {
        const dz = f.z - s.z;
        if (f.hp <= 0 || f.mode !== 'attack' || dz < 450 || dz > 2600) continue;
        f.cd -= dt;
        if (f.cd <= 0) {
          fireAt(f.x, f.y, f.z, f.vz, 130);
          f.cd = 1.1 + rng() * 0.8;
        }
      }

      // ── Bolts: move, then hit girders, walls, guns, fighters and the core ───
      const liveBolts: Bolt[] = [];
      for (const b0 of s.bolts) {
        const b: Bolt = { ...b0, x: b0.x + b0.vx * dt, y: b0.y + b0.vy * dt, z: b0.z + b0.vz * dt };
        const px = b0.x, py = b0.y, pz = b0.z;
        let hit = false;

        for (const o of s.obstacles) {
          if (o.z < Math.min(pz, b.z) - 4 || o.z > b.z + 4) continue;
          const f = b.z === pz ? 1 : clamp((o.z - pz) / (b.z - pz), 0, 1);
          const hx = px + (b.x - px) * f;
          const hy = py + (b.y - py) * f;
          if (hx >= o.x0 && hx <= o.x1 && hy >= o.y0 && hy <= o.y1) {
            addFlash(s, hx, hy, o.z, 0); hit = true; break;
          }
        }
        if (!hit) {
          for (const t of s.turrets) {
            if (t.hp <= 0 || !sweepHit(px, py, pz, b.x, b.y, b.z, t.x, t.y, t.z, 38)) continue;
            hit = true;
            t.hp -= b.dmg;
            addFlash(s, t.x, t.y, t.z, 0);
            if (t.hp <= 0) {
              s.kills += 1;
              s.points += 200 * s.mult;
              addFlash(s, t.x, t.y, t.z, 1);
              s.intents.push({ type: 'prune-stale' }); // a gun down is one stale context item cleared
            }
            break;
          }
        }
        if (!hit) {
          for (const f of s.fighters) {
            if (f.hp <= 0 || !sweepHit(px, py, pz, b.x, b.y, b.z, f.x, f.y, f.z, 48)) continue;
            hit = true;
            f.hp -= b.dmg;
            addFlash(s, f.x, f.y, f.z, 0);
            if (f.hp <= 0) {
              s.kills += 1;
              s.points += 300 * s.mult;
              addFlash(s, f.x, f.y, f.z, 1);
              s.intents.push({ type: 'prune-stale' });
            }
            break;
          }
        }
        if (!hit && !s.target.hit && sweepHit(px, py, pz, b.x, b.y, b.z, s.target.x, s.target.y, s.target.z, 36)) {
          hit = true;
          const bonus = Math.round(2500 * s.mult);
          s.points += bonus;
          s.targetsHit += 1;
          s.mult = Math.min(4, s.mult + 0.5);
          s.target.hit = true;
          s.shake = Math.min(1, s.shake + 0.3);
          addFlash(s, s.target.x, s.target.y, s.target.z, 3);
          say(s, 'TARGET DOWN', `+${bonus} · section ${s.section + 1} ahead`, 'good');
          newSection(s, rng);
        }
        if (hit) continue;
        if (Math.abs(b.x) > TW && b.y > RIM) { addFlash(s, Math.sign(b.x) * TW, b.y, b.z, 0); continue; }
        if (b.y > FLOOR) { addFlash(s, b.x, FLOOR, b.z, 0); continue; }
        if (b.z - s.z > FAR) continue;
        liveBolts.push(b);
      }
      s.bolts = liveBolts;

      // ── Enemy shots vs the ship ─────────────────────────────────────────────
      const liveShots: Shot[] = [];
      for (const sh0 of s.shots) {
        const sh: Shot = { ...sh0, x: sh0.x + sh0.vx * dt, y: sh0.y + sh0.vy * dt, z: sh0.z + sh0.vz * dt };
        const before = sh0.z - prevZ;
        const after = sh.z - s.z;
        if (before > 0 && after <= 0) {
          const f = before / (before - after);
          const hx = sh0.x + (sh.x - sh0.x) * f - s.shipX;
          const hy = sh0.y + (sh.y - sh0.y) * f - s.shipY;
          if (hx * hx + hy * hy < (SHIP_R + 8) * (SHIP_R + 8)) {
            if (hurt(s, 0.08)) addFlash(s, s.shipX + hx * 0.5, s.shipY + hy * 0.5, s.z + 50, 0);
            continue;
          }
        }
        if (after < -60 || Math.abs(sh.x) > TW * 3) continue;
        liveShots.push(sh);
      }
      s.shots = liveShots;

      // ── Fighters that reach you ram you ─────────────────────────────────────
      for (const f of s.fighters) {
        if (f.hp <= 0) continue;
        const before = f.z - f.vz * dt - prevZ;
        const after = f.z - s.z;
        if (before > 0 && after <= 0 && Math.hypot(f.x - s.shipX, f.y - s.shipY) < 50) {
          hurt(s, 0.18);
          f.hp = 0;
          addFlash(s, f.x, f.y, s.z + 60, 1);
        }
      }

      // ── Girders: thread them or hit them ────────────────────────────────────
      for (const o of s.obstacles) {
        if (o.done || o.z > s.z) continue;
        o.done = true;
        const inside = s.shipX > o.x0 - SHIP_R && s.shipX < o.x1 + SHIP_R && s.shipY > o.y0 - SHIP_R && s.shipY < o.y1 + SHIP_R;
        if (inside) {
          hurt(s, 0.25);
          addFlash(s, s.shipX, s.shipY, s.z + 60, 1);
        } else {
          s.threaded += 1;
          s.points += 40 * s.mult;
        }
      }

      // ── The target run ──────────────────────────────────────────────────────
      if (!s.runAnnounced && s.sectionEnd - s.z < RUN_WINDOW) {
        s.runAnnounced = true;
        say(s, 'TARGET RUN', 'hit the core', 'info');
      }
      if (!s.target.hit && s.z > s.target.z + 30) {
        s.targetsMissed += 1;
        say(s, 'TARGET MISSED', `section ${s.section + 1} ahead`, 'bad');
        newSection(s, rng);
      }

      if (s.hull <= 0) {
        addFlash(s, s.shipX, s.shipY, s.z + 80, 1);
        return { ...s, destroyed: true, shake: 1, seed: Math.floor(rng() * 0xffffffff) };
      }

      // Cull what is behind us.
      s.obstacles = s.obstacles.filter((o) => o.z > s.z - 400);
      s.turrets = s.turrets.filter((t) => t.hp > 0 && t.z > s.z - 300);
      s.fighters = s.fighters.filter((f) => f.hp > 0 && f.z > s.z - (f.mode === 'overtake' ? 1200 : 400));
      s.points += s.eff * dt * 0.02 * s.mult;
      s.seed = Math.floor(rng() * 0xffffffff);
      return s;
    },

    render(ctx, s, w, h) {
      renderFlight(ctx, s, w, h);
    },

    score: (s) => Math.round(s.points),
    isOver: (s) => s.destroyed,

    hud(s) {
      if (s.destroyed) return `SHIP LOST · ${s.targetsHit} targets · ${s.kills} kills`;
      const who = s.manual > 0.5 ? 'PILOT' : 'AUTO';
      const power = s.powerT > 0 ? ` · POWER ${Math.ceil(s.powerT)}s` : '';
      return `${who} · section ${s.section} · ${s.kills} kills · hull ${Math.round(s.hull * 100)}%${power}`;
    },
  };
}

// ─── Rendering ────────────────────────────────────────────────────────────────
// Palette: the app's clay / ink / ivory, with neon accents for things that emit light.
const CLAY = '#D97757';
const INK = '#141413';
const IVORY = '#ECECEC';
const CYAN = '#5BE7F5';
const HOSTILE = '#FF4B5C';
const GOOD = '#6BD49A';
const WARN = '#F2B53A';
const VIOLET = '#A08BFF';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

// Camera + projection scratch. Render-only module state, so the hot path allocates nothing.
const CAM = { x: 0, y: 0, z: 0, f: 600 };
const NEARZ = 6;
let PX = 0, PY = 0, PS = 0;
function proj(x: number, y: number, z: number): boolean {
  const dz = z - CAM.z;
  if (dz < NEARZ) return false;
  PS = CAM.f / dz;
  PX = (x - CAM.x) * PS;
  PY = (y - CAM.y) * PS;
  return true;
}
function zc(z: number): number { return Math.max(z, CAM.z + NEARZ); }

// Quad on a wall (plane x = const) from y a..b, z za..zb.
function wallQuad(ctx: CanvasRenderingContext2D, x: number, ya: number, yb: number, za: number, zb: number) {
  za = zc(za); zb = zc(zb);
  if (zb <= za) return;
  proj(x, ya, za); ctx.moveTo(PX, PY);
  proj(x, ya, zb); ctx.lineTo(PX, PY);
  proj(x, yb, zb); ctx.lineTo(PX, PY);
  proj(x, yb, za); ctx.lineTo(PX, PY);
  ctx.closePath();
}
// Quad on a horizontal plane (y = const) from x a..b, z za..zb.
function flatQuad(ctx: CanvasRenderingContext2D, xa: number, xb: number, y: number, za: number, zb: number) {
  za = zc(za); zb = zc(zb);
  if (zb <= za) return;
  proj(xa, y, za); ctx.moveTo(PX, PY);
  proj(xa, y, zb); ctx.lineTo(PX, PY);
  proj(xb, y, zb); ctx.lineTo(PX, PY);
  proj(xb, y, za); ctx.lineTo(PX, PY);
  ctx.closePath();
}

// Fixed starfield, generated once (render-only, so a module constant is fine).
const STARS: number[] = (() => {
  const r = makeRng(0x5eed);
  const out: number[] = [];
  for (let i = 0; i < 90; i++) out.push(r() * 2 - 1, -r() * 1.1, r() < 0.15 ? 2 : 1);
  return out;
})();

function fade(dz: number): number {
  return clamp((FAR - dz) / 1400, 0, 1);
}

function renderFlight(ctx: CanvasRenderingContext2D, s: FlightState, w: number, h: number) {
  const chase = s.view === 'chase';
  const k = clamp(Math.min(h / 640, w / 1100), 0.75, 1.4);
  const cx = w / 2;
  const cy = h * (chase ? 0.36 : 0.4);
  const pitch = clamp(s.vy * 0.1, -40, 40);
  const roll = s.roll * (chase ? 0.4 : 1);
  CAM.f = w * 0.62;
  CAM.x = s.shipX;
  CAM.y = chase ? s.shipY - 90 : s.shipY;
  CAM.z = chase ? s.z - 320 : s.z;

  const shakeAmt = s.shake * 9 * k;
  const shx = shakeAmt * Math.sin(s.tick * 1.7);
  const shy = shakeAmt * Math.cos(s.tick * 2.3);

  ctx.save();
  ctx.translate(shx, shy);

  // ── World, in the banked frame: origin at the vanishing point ─────────────
  ctx.save();
  ctx.translate(cx, cy + pitch);
  ctx.rotate(-roll);
  drawSky(ctx, s, w, h);
  drawTrench(ctx, s, w);
  drawObjects(ctx, s);
  drawFlashes(ctx, s);
  drawDust(ctx, s);
  drawBolts(ctx, s);
  if (chase) drawShipExterior(ctx, s, k);

  // Reticle: drawn in world space at the convergence / lead point.
  drawReticle(ctx, s, k);
  ctx.restore();

  // ── Cockpit (screen space) ────────────────────────────────────────────────
  if (!chase) drawCanopy(ctx, s, w, h, k);
  drawConsole(ctx, s, w, h, k);
  drawOverlay(ctx, s, w, h, k, cx, cy);
  ctx.restore();
}

function drawSky(ctx: CanvasRenderingContext2D, s: FlightState, w: number, h: number) {
  const span = Math.max(w, h) * 1.5;
  const g = ctx.createLinearGradient(0, -h * 0.6, 0, h * 0.2);
  g.addColorStop(0, '#09090C');
  g.addColorStop(0.7, INK);
  g.addColorStop(1, '#2A1C1E');
  ctx.fillStyle = g;
  ctx.fillRect(-span, -span, span * 2, span * 2);

  // Stars, with a whisper of parallax.
  const ox = -s.shipX * 0.05;
  ctx.fillStyle = 'rgba(236,236,236,0.75)';
  ctx.beginPath();
  for (let i = 0; i < STARS.length; i += 3) {
    const sz = STARS[i + 2];
    ctx.rect(STARS[i] * w * 0.75 + ox, STARS[i + 1] * h * 0.62, sz, sz);
  }
  ctx.fill();

  // A big clay world hanging over the trench.
  const pr = h * 0.42;
  const px = w * 0.27 - s.shipX * 0.08;
  const py = -h * 0.68;
  const pg = ctx.createLinearGradient(px - pr, py - pr, px + pr * 0.4, py + pr);
  pg.addColorStop(0, '#E8906F');
  pg.addColorStop(0.55, '#8E4A35');
  pg.addColorStop(1, '#1E1412');
  ctx.fillStyle = pg;
  ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(236,236,236,0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(px, py, pr * 1.6, pr * 0.22, -0.18, 0.1, Math.PI - 0.1); ctx.stroke();

  // Claude is thinking: ribbons of light ripple across the sky.
  if (s.thinkT > 0) {
    const a = Math.min(1, s.thinkT) * 0.28;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 3;
    for (let r = 0; r < 3; r++) {
      ctx.strokeStyle = r === 1 ? `rgba(160,139,255,${a})` : `rgba(91,231,245,${a})`;
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const x = -w * 0.7 + (i / 16) * w * 1.4;
        const y = -h * (0.42 - r * 0.07) + Math.sin(i * 0.7 + s.tick * 0.05 + r * 1.3) * 18;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

function drawTrench(ctx: CanvasRenderingContext2D, s: FlightState, w: number) {
  const zn = CAM.z + NEARZ;
  const zf = s.z + FAR;
  const k0 = Math.floor(zn / SEG);
  const k1 = Math.floor(zf / SEG);

  // Surface beyond the rim — only visible once you climb out of the trench.
  if (CAM.y < RIM) {
    ctx.fillStyle = '#1E1F25';
    ctx.beginPath();
    flatQuad(ctx, -2600, -TW, RIM, zn, zf);
    flatQuad(ctx, TW, 2600, RIM, zn, zf);
    ctx.fill();
    ctx.strokeStyle = 'rgba(217,119,87,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let kk = k0; kk <= k1; kk += 2) {
      const z = kk * SEG;
      if (!proj(-2600, RIM, zc(z))) continue;
      ctx.moveTo(PX, PY); proj(-TW, RIM, zc(z)); ctx.lineTo(PX, PY);
      proj(TW, RIM, zc(z)); ctx.moveTo(PX, PY); proj(2600, RIM, zc(z)); ctx.lineTo(PX, PY);
    }
    ctx.stroke();
  }

  // Base planes: floor, then walls with a sky-lit upper band.
  ctx.fillStyle = '#1B1C21';
  ctx.beginPath(); flatQuad(ctx, -TW, TW, FLOOR, zn, zf); ctx.fill();
  ctx.fillStyle = '#25262C';
  ctx.beginPath(); wallQuad(ctx, -TW, RIM, FLOOR, zn, zf); wallQuad(ctx, TW, RIM, FLOOR, zn, zf); ctx.fill();
  ctx.fillStyle = '#383942';
  ctx.beginPath(); wallQuad(ctx, -TW, RIM, RIM + 60, zn, zf); wallQuad(ctx, TW, RIM, RIM + 60, zn, zf); ctx.fill();

  // Alternating plates.
  ctx.fillStyle = '#2E2F36';
  ctx.beginPath();
  for (let kk = k0; kk <= k1; kk++) {
    const hk = hash(kk);
    if (hk & 1) continue;
    const z0 = kk * SEG + 12, z1 = (kk + 1) * SEG - 12;
    const ya = RIM + 74 + (hk >>> 4) % 40;
    wallQuad(ctx, -TW, ya, FLOOR - 30, z0, z1);
    wallQuad(ctx, TW, ya, FLOOR - 30, z0, z1);
    flatQuad(ctx, -TW + 30, -40, FLOOR, z0, z1);
    flatQuad(ctx, 40, TW - 30, FLOOR, z0, z1);
  }
  ctx.fill();

  // Greebles: vents and boxes, near segments only.
  const gfar = s.z + 2800;
  ctx.fillStyle = '#17181C';
  ctx.beginPath();
  for (let kk = k0; kk <= k1 && kk * SEG < gfar; kk++) {
    const hk = hash(kk * 7 + 3);
    const z0 = kk * SEG + 30;
    const z1 = z0 + SEG * (0.25 + ((hk >>> 6) % 4) * 0.1);
    if (hk % 3 === 0) {
      const ya = RIM + 90 + ((hk >>> 9) % 6) * 30;
      wallQuad(ctx, -TW, ya, ya + 34 + (hk >>> 13) % 30, z0, z1);
    }
    if ((hk >>> 2) % 3 === 0) {
      const ya = RIM + 80 + ((hk >>> 17) % 6) * 32;
      wallQuad(ctx, TW, ya, ya + 30 + (hk >>> 21) % 34, z0, z1);
    }
  }
  ctx.fill();

  // Panel seams: one "U" across the trench per segment, plus conduits running its length.
  ctx.strokeStyle = 'rgba(6,6,8,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let kk = k0 + 1; kk <= k1; kk++) {
    const z = kk * SEG;
    proj(-TW, RIM, z); ctx.moveTo(PX, PY);
    proj(-TW, FLOOR, z); ctx.lineTo(PX, PY);
    proj(TW, FLOOR, z); ctx.lineTo(PX, PY);
    proj(TW, RIM, z); ctx.lineTo(PX, PY);
  }
  for (const side of [-1, 1]) {
    for (const y of [RIM + 120, 40, FLOOR - 50]) {
      proj(side * TW, y, zn); ctx.moveTo(PX, PY);
      proj(side * TW, y, zf); ctx.lineTo(PX, PY);
    }
  }
  ctx.stroke();

  // Rim edge in clay, so the trench's lip reads against the sky.
  ctx.strokeStyle = 'rgba(217,119,87,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  proj(-TW, RIM, zn); ctx.moveTo(PX, PY); proj(-TW, RIM, zf); ctx.lineTo(PX, PY);
  proj(TW, RIM, zn); ctx.moveTo(PX, PY); proj(TW, RIM, zf); ctx.lineTo(PX, PY);
  ctx.stroke();

  // Lights: wall lamps and floor chasers that run toward you.
  ctx.globalCompositeOperation = 'lighter';
  const chase = Math.floor(s.tick / 3);
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0 ? 'rgba(217,119,87,0.9)' : 'rgba(91,231,245,0.85)';
    ctx.beginPath();
    for (let kk = k0; kk <= k1; kk++) {
      const hk = hash(kk * 13 + 5);
      const z = kk * SEG + SEG * 0.5;
      if (((hk >>> 3) & 1) === pass) {
        for (const side of [-1, 1]) {
          const y = RIM + 40 + ((hk >>> (side > 0 ? 5 : 11)) % 6) * 50;
          if (!proj(side * (TW - 1), y, z)) continue;
          const r = Math.max(1, 7 * PS);
          ctx.rect(PX - r, PY - r * 0.5, r * 2, r);
        }
      }
      if (pass === 0 && ((kk - chase) % 6 + 6) % 6 === 0) {
        for (const side of [-1, 1]) {
          if (!proj(side * (TW - 14), FLOOR - 2, kk * SEG)) continue;
          const r = Math.max(1, 9 * PS);
          ctx.rect(PX - r, PY - r * 0.4, r * 2, r * 0.8);
        }
      }
    }
    ctx.fill();
  }
  // Centreline dashes on the floor.
  ctx.fillStyle = 'rgba(236,236,236,0.16)';
  ctx.beginPath();
  for (let kk = k0; kk <= k1; kk++) flatQuad(ctx, -5, 5, FLOOR - 1, kk * SEG, kk * SEG + SEG * 0.45);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Depth haze pooled around the vanishing point, with a clay glow at the far end.
  const hr = w * 0.2;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, hr);
  g.addColorStop(0, 'rgba(217,119,87,0.55)');
  g.addColorStop(0.12, 'rgba(46,32,32,0.95)');
  g.addColorStop(0.45, 'rgba(26,24,28,0.55)');
  g.addColorStop(1, 'rgba(20,20,19,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-hr, -hr, hr * 2, hr * 2);
}

// Things in the trench, painted far to near.
const DRAW: { z: number; kind: number; i: number }[] = [];
function drawObjects(ctx: CanvasRenderingContext2D, s: FlightState) {
  let n = 0;
  const push = (z: number, kind: number, i: number) => {
    const dz = z - CAM.z;
    if (dz < NEARZ || z - s.z > FAR) return;
    if (n < DRAW.length) { const d = DRAW[n]; d.z = z; d.kind = kind; d.i = i; } else DRAW.push({ z, kind, i });
    n++;
  };
  s.obstacles.forEach((o, i) => push(o.z, 0, i));
  s.turrets.forEach((t, i) => push(t.z, 1, i));
  s.fighters.forEach((f, i) => push(f.z, 2, i));
  s.shots.forEach((sh, i) => push(sh.z, 3, i));
  if (!s.target.hit) push(s.target.z, 4, 0);
  const list = DRAW.slice(0, n).sort((a, b) => b.z - a.z);
  for (const d of list) {
    const a = fade(d.z - s.z);
    if (a <= 0.01) continue;
    ctx.globalAlpha = a;
    if (d.kind === 0) drawObstacle(ctx, s.obstacles[d.i]);
    else if (d.kind === 1) drawTurret(ctx, s.turrets[d.i]);
    else if (d.kind === 2) drawFighter(ctx, s.fighters[d.i], s.tick);
    else if (d.kind === 3) drawShot(ctx, s.shots[d.i]);
    else drawTarget(ctx, s);
  }
  ctx.globalAlpha = 1;
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: Obstacle) {
  const z = o.z;
  // Top or underside face, whichever the camera can see.
  ctx.fillStyle = '#474852';
  if (CAM.y < o.y0) { ctx.beginPath(); flatQuad(ctx, o.x0, o.x1, o.y0, z, z + ZT); ctx.fill(); }
  else if (CAM.y > o.y1) { ctx.fillStyle = '#202127'; ctx.beginPath(); flatQuad(ctx, o.x0, o.x1, o.y1, z, z + ZT); ctx.fill(); }
  // Inner side face of a side block.
  if (o.kind === 'left' && CAM.x > o.x1) { ctx.fillStyle = '#2C2D34'; ctx.beginPath(); wallQuad(ctx, o.x1, o.y0, o.y1, z, z + ZT); ctx.fill(); }
  if (o.kind === 'right' && CAM.x < o.x0) { ctx.fillStyle = '#2C2D34'; ctx.beginPath(); wallQuad(ctx, o.x0, o.y0, o.y1, z, z + ZT); ctx.fill(); }

  if (!proj(o.x0, o.y0, z)) return;
  const ax = PX, ay = PY;
  proj(o.x1, o.y1, z);
  const bx = PX, by = PY;
  ctx.fillStyle = '#34353D';
  ctx.fillRect(ax, ay, bx - ax, by - ay);

  // Truss: a zig-zag across the face.
  ctx.strokeStyle = 'rgba(10,10,12,0.85)';
  ctx.lineWidth = clamp(5 * PS, 1, 7);
  ctx.beginPath();
  const horiz = o.x1 - o.x0 > o.y1 - o.y0;
  const nseg = horiz ? 8 : 6;
  for (let i = 0; i <= nseg; i++) {
    const t = i / nseg;
    if (horiz) {
      const x = ax + (bx - ax) * t;
      if (i === 0) ctx.moveTo(x, i % 2 ? by : ay); else ctx.lineTo(x, i % 2 ? by : ay);
    } else {
      const y = ay + (by - ay) * t;
      if (i === 0) ctx.moveTo(i % 2 ? bx : ax, y); else ctx.lineTo(i % 2 ? bx : ax, y);
    }
  }
  ctx.stroke();
  ctx.strokeStyle = CLAY;
  ctx.lineWidth = clamp(3 * PS, 1, 4);
  ctx.beginPath();
  if (horiz) { ctx.moveTo(ax, ay); ctx.lineTo(bx, ay); } else { ctx.moveTo(o.kind === 'left' ? bx : ax, ay); ctx.lineTo(o.kind === 'left' ? bx : ax, by); }
  ctx.stroke();

  // Warning lamps on the ends.
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(242,181,58,0.9)';
  const r = Math.max(1.5, 8 * PS);
  ctx.beginPath();
  if (horiz) {
    ctx.rect(ax + r, (ay + by) / 2 - r / 2, r, r);
    ctx.rect(bx - 2 * r, (ay + by) / 2 - r / 2, r, r);
  } else {
    const ex = o.kind === 'left' ? bx - 2 * r : ax + r;
    ctx.rect(ex, ay + r, r, r);
    ctx.rect(ex, by - 2 * r, r, r);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

function drawTurret(ctx: CanvasRenderingContext2D, t: Turret) {
  if (!proj(t.x, t.y, t.z)) return;
  const x = PX, y = PY, sc = PS;
  const r = Math.max(2, 26 * sc);
  // Mount: a bracket into the wall, or legs down to the catwalk.
  ctx.fillStyle = '#2B2C33';
  if (t.mount === 'wall') {
    proj(t.side * TW, t.y, t.z);
    const wx = PX;
    ctx.fillRect(Math.min(wx, x), y - r * 0.35, Math.abs(wx - x), r * 0.7);
  } else {
    ctx.fillRect(x - r * 0.6, y, r * 1.2, r * 1.1);
  }
  ctx.fillStyle = '#3A3B44';
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.strokeStyle = 'rgba(255,75,92,0.55)';
  ctx.lineWidth = clamp(3 * sc, 1, 4);
  ctx.strokeRect(x - r, y - r, r * 2, r * 2);
  // Muzzle looking straight at you; its eye flares just before it fires.
  ctx.fillStyle = '#0B0B0D';
  ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
  const tell = t.cd < 0.35 ? 1 : 0.45;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(255,75,92,${tell})`;
  ctx.beginPath(); ctx.arc(x, y, r * (0.25 + tell * 0.2), 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

function drawFighter(ctx: CanvasRenderingContext2D, f: Fighter, tick: number) {
  if (!proj(f.x, f.y, f.z)) return;
  const x = PX, y = PY;
  const sz = Math.max(3, 70 * PS);
  const bank = clamp(f.vx / 300, -1, 1) * 0.35 * sz;
  // Two swept blades round a central pod — hostile, original, readable at a glance.
  ctx.fillStyle = '#26262C';
  ctx.strokeStyle = HOSTILE;
  ctx.lineWidth = clamp(3 * PS, 1, 4);
  ctx.beginPath();
  ctx.moveTo(x - sz * 0.12, y - sz * 0.05);
  ctx.lineTo(x - sz * 0.95, y - sz * 0.32 + bank);
  ctx.lineTo(x - sz * 0.7, y + sz * 0.18 + bank * 0.6);
  ctx.lineTo(x - sz * 0.12, y + sz * 0.1);
  ctx.closePath();
  ctx.moveTo(x + sz * 0.12, y - sz * 0.05);
  ctx.lineTo(x + sz * 0.95, y - sz * 0.32 - bank);
  ctx.lineTo(x + sz * 0.7, y + sz * 0.18 - bank * 0.6);
  ctx.lineTo(x + sz * 0.12, y + sz * 0.1);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3B3B44';
  ctx.beginPath(); ctx.arc(x, y, sz * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(255,75,92,${0.6 + 0.4 * Math.sin(tick * 0.4 + f.phase)})`;
  ctx.beginPath(); ctx.arc(x, y, sz * 0.09, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

function drawShot(ctx: CanvasRenderingContext2D, sh: Shot) {
  if (!proj(sh.x, sh.y, sh.z)) return;
  const hx = PX, hy = PY, sc = PS;
  if (!proj(sh.x - sh.vx * 0.05, sh.y - sh.vy * 0.05, sh.z - sh.vz * 0.05)) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,75,92,0.55)';
  ctx.lineWidth = clamp(16 * sc, 2, 12);
  ctx.beginPath(); ctx.moveTo(PX, PY); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,214,214,0.95)';
  ctx.lineWidth = clamp(5 * sc, 1, 4);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.globalCompositeOperation = 'source-over';
}

function drawTarget(ctx: CanvasRenderingContext2D, s: FlightState) {
  const t = s.target;
  if (!proj(t.x, t.y, t.z)) return;
  const x = PX, y = PY, sc = PS;
  // Cables from both walls hold the core in the middle of the trench.
  ctx.strokeStyle = 'rgba(120,120,130,0.8)';
  ctx.lineWidth = clamp(3 * sc, 1, 4);
  ctx.beginPath();
  proj(-TW, t.y - 80, t.z); ctx.moveTo(PX, PY); ctx.lineTo(x, y);
  proj(TW, t.y - 80, t.z); ctx.lineTo(PX, PY);
  ctx.stroke();
  const r = Math.max(3, 30 * sc);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(217,119,87,0.28)';
  ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = CLAY;
  ctx.lineWidth = Math.max(1.5, 6 * sc);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  // Spinning diamond at the heart.
  const a = s.tick * 0.06;
  const d = r * 0.62;
  ctx.fillStyle = IVORY;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const ang = a + (i * Math.PI) / 2;
    const px = x + Math.cos(ang) * d;
    const py = y + Math.sin(ang) * d;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
}

function drawFlashes(ctx: CanvasRenderingContext2D, s: FlightState) {
  if (s.flashes.length === 0) return;
  ctx.globalCompositeOperation = 'lighter';
  for (const f of s.flashes) {
    if (!proj(f.x, f.y, f.z)) continue;
    const life = f.t / FLASH_T[f.kind];
    const base = f.kind === 0 ? 30 : f.kind === 1 ? 90 : f.kind === 2 ? 60 : 220;
    const r = Math.max(2, base * PS * (1.3 - life * 0.6));
    if (f.kind === 2) {
      ctx.strokeStyle = `rgba(91,231,245,${life * 0.8})`;
      ctx.lineWidth = Math.max(1, 6 * PS);
      ctx.beginPath(); ctx.arc(PX, PY, r, 0, Math.PI * 2); ctx.stroke();
      continue;
    }
    ctx.fillStyle = f.kind === 3 ? `rgba(236,236,236,${life * 0.45})` : `rgba(217,119,87,${life * 0.55})`;
    ctx.beginPath(); ctx.arc(PX, PY, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,240,220,${life * 0.9})`;
    ctx.beginPath(); ctx.arc(PX, PY, r * 0.4, 0, Math.PI * 2); ctx.fill();
    if (f.kind !== 0) {
      ctx.strokeStyle = `rgba(242,181,58,${life})`;
      ctx.lineWidth = Math.max(1, 4 * PS);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + f.x * 0.01;
        ctx.moveTo(PX + Math.cos(ang) * r * 0.5, PY + Math.sin(ang) * r * 0.5);
        ctx.lineTo(PX + Math.cos(ang) * r * 1.5, PY + Math.sin(ang) * r * 1.5);
      }
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// Dust and speed lines: world-space motes that streak harder the faster you go.
function drawDust(ctx: CanvasRenderingContext2D, s: FlightState) {
  const speedFrac = clamp((s.eff - BASE_SPEED * 0.8) / (MAX_SPEED - BASE_SPEED * 0.8), 0, 1);
  const P = 2600;
  const len = 30 + s.eff * 0.1;
  ctx.strokeStyle = `rgba(236,236,236,${0.12 + speedFrac * 0.4})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 36; i++) {
    const hv = hash(i * 31 + 7);
    const x = ((hv & 0xffff) / 0xffff - 0.5) * 2 * TW * 0.95;
    const y = RIM + ((hv >>> 16) / 0xffff) * (FLOOR - RIM);
    const ph = (hash(i * 17 + 3) / 0xffffffff) * P;
    const z = s.z + 40 + ((((ph - s.z) % P) + P) % P);
    if (!proj(x, y, z)) continue;
    const hx = PX, hy = PY;
    if (!proj(x, y, z + len)) continue;
    ctx.moveTo(hx, hy); ctx.lineTo(PX, PY);
  }
  ctx.stroke();
}

// The lasers: bright twin bolts drawn between two depths so they converge on the reticle.
function drawBolts(ctx: CanvasRenderingContext2D, s: FlightState) {
  if (s.bolts.length === 0) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const b of s.bolts) {
    if (!proj(b.x, b.y, b.z)) continue;
    const hx = PX, hy = PY, hs = PS;
    const tz = Math.max(CAM.z + NEARZ, b.z - b.vz * 0.045);
    const f = (b.z - tz) / (b.vz * 0.045);
    proj(b.x - b.vx * 0.045 * f, b.y - b.vy * 0.045 * f, tz);
    ctx.strokeStyle = b.power ? 'rgba(91,231,245,0.5)' : 'rgba(255,106,74,0.5)';
    ctx.lineWidth = clamp(22 * hs, 2.5, 13);
    ctx.beginPath(); ctx.moveTo(PX, PY); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = b.power ? 'rgba(236,255,255,0.95)' : 'rgba(255,236,200,0.95)';
    ctx.lineWidth = clamp(7 * hs, 1.2, 4);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.globalCompositeOperation = 'source-over';
}

function drawReticle(ctx: CanvasRenderingContext2D, s: FlightState, k: number) {
  if (!proj(s.aimX, s.aimY, s.aimZ)) return;
  const x = PX, y = PY;
  const col = s.locked ? HOSTILE : s.powerT > 0 ? CYAN : CLAY;
  const r = (s.locked ? 20 : 26) * k;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.6 * k;
  ctx.beginPath();
  // Four corner brackets and a centre pip; the brackets close in when locked.
  for (let i = 0; i < 4; i++) {
    const dx = i & 1 ? 1 : -1;
    const dy = i & 2 ? 1 : -1;
    ctx.moveTo(x + dx * r, y + dy * r - dy * 8 * k);
    ctx.lineTo(x + dx * r, y + dy * r);
    ctx.lineTo(x + dx * r - dx * 8 * k, y + dy * r);
  }
  ctx.moveTo(x - 3 * k, y); ctx.lineTo(x + 3 * k, y);
  ctx.moveTo(x, y - 3 * k); ctx.lineTo(x, y + 3 * k);
  ctx.stroke();
  if (s.locked) {
    ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(s.tick * 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// Chase view: an original light fighter, a clay delta with wing-tip cannons.
function drawShipExterior(ctx: CanvasRenderingContext2D, s: FlightState, k: number) {
  if (!proj(s.shipX, s.shipY, s.z)) return;
  const x = PX, y = PY;
  const u = 120 * PS;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(s.roll * 0.9);
  const glow = s.boostT > 0 || s.eff > s.speed * 1.2 ? 1 : 0.55;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(217,119,87,${glow * 0.7})`;
  ctx.beginPath();
  ctx.arc(-u * 0.14, u * 0.06, u * 0.12, 0, Math.PI * 2);
  ctx.arc(u * 0.14, u * 0.06, u * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#5B5D66';
  ctx.beginPath();
  ctx.moveTo(0, -u * 0.3);
  ctx.lineTo(u * 0.55, u * 0.1);
  ctx.lineTo(u * 0.55, u * 0.18);
  ctx.lineTo(0, u * 0.12);
  ctx.lineTo(-u * 0.55, u * 0.18);
  ctx.lineTo(-u * 0.55, u * 0.1);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = CLAY;
  ctx.beginPath();
  ctx.moveTo(0, -u * 0.36); ctx.lineTo(u * 0.12, u * 0.12); ctx.lineTo(-u * 0.12, u * 0.12);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#16303A';
  ctx.beginPath(); ctx.ellipse(0, -u * 0.08, u * 0.05, u * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = IVORY;
  ctx.fillRect(-u * 0.57, u * 0.02, u * 0.04, u * 0.18);
  ctx.fillRect(u * 0.53, u * 0.02, u * 0.04, u * 0.18);
  if (s.powerT > 0) {
    ctx.strokeStyle = `rgba(91,231,245,${0.4 + 0.3 * Math.sin(s.tick * 0.3)})`;
    ctx.lineWidth = 2 * k;
    ctx.beginPath(); ctx.ellipse(0, 0, u * 0.7, u * 0.38, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

// ─── Cockpit ──────────────────────────────────────────────────────────────────
function consoleTop(h: number): number { return h * 0.765; }

function drawCanopy(ctx: CanvasRenderingContext2D, s: FlightState, w: number, h: number, k: number) {
  const top = consoleTop(h);
  const bow = h * 0.075;
  ctx.fillStyle = INK;
  ctx.beginPath();
  // Top bow, curved like the canopy hoop.
  ctx.moveTo(-20, -20); ctx.lineTo(w + 20, -20); ctx.lineTo(w + 20, bow);
  ctx.quadraticCurveTo(w / 2, bow * 1.9, -20, bow);
  ctx.closePath();
  // Raked side struts.
  ctx.moveTo(-20, bow - 4); ctx.lineTo(w * 0.075, bow + 2); ctx.lineTo(w * 0.15, top + 2); ctx.lineTo(-20, top + 2); ctx.closePath();
  ctx.moveTo(w + 20, bow - 4); ctx.lineTo(w * 0.925, bow + 2); ctx.lineTo(w * 0.85, top + 2); ctx.lineTo(w + 20, top + 2); ctx.closePath();
  ctx.fill();

  // Edge light on the frame.
  ctx.strokeStyle = 'rgba(217,119,87,0.6)';
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  ctx.moveTo(-20, bow); ctx.quadraticCurveTo(w / 2, bow * 1.9, w + 20, bow);
  ctx.moveTo(w * 0.075, bow + 2); ctx.lineTo(w * 0.15, top);
  ctx.moveTo(w * 0.925, bow + 2); ctx.lineTo(w * 0.85, top);
  ctx.stroke();

  // Rivets down the struts.
  ctx.fillStyle = 'rgba(236,236,236,0.18)';
  ctx.beginPath();
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    const yy = bow + (top - bow) * t;
    ctx.rect(w * (0.045 + 0.065 * t), yy, 2 * k, 2 * k);
    ctx.rect(w * (0.955 - 0.065 * t) - 2 * k, yy, 2 * k, 2 * k);
  }
  ctx.fill();

  // Glass: a faint glare streak.
  ctx.strokeStyle = 'rgba(236,236,236,0.05)';
  ctx.lineWidth = 18 * k;
  ctx.beginPath(); ctx.moveTo(w * 0.2, h * 0.12); ctx.lineTo(w * 0.32, h * 0.03); ctx.stroke();

  // Shield up: the canopy edges shimmer cyan.
  if (s.powerT > 0 || s.shieldHit > 0) {
    const a = Math.min(1, 0.35 + s.shieldHit * 1.5) * (0.6 + 0.4 * Math.sin(s.tick * 0.25));
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(91,231,245,${a})`;
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.moveTo(w * 0.15 + 6, top - 6); ctx.lineTo(w * 0.075 + 6, bow + 8);
    ctx.quadraticCurveTo(w / 2, bow * 1.9 + 8, w * 0.925 - 6, bow + 8);
    ctx.lineTo(w * 0.85 - 6, top - 6);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Muzzle flash at the wing guns, just inside the frame.
  if (s.muzzle > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const r = 46 * k * (0.6 + s.muzzle * 6);
    for (const mx of [w * 0.16, w * 0.84]) {
      const g = ctx.createRadialGradient(mx, top - 6 * k, 0, mx, top - 6 * k, r);
      g.addColorStop(0, s.powerT > 0 ? 'rgba(220,255,255,0.9)' : 'rgba(255,236,200,0.9)');
      g.addColorStop(0.35, s.powerT > 0 ? 'rgba(91,231,245,0.45)' : 'rgba(255,106,74,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(mx - r, top - 6 * k - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, bw: number, bh: number, v: number, col: string) {
  ctx.fillStyle = '#26262B';
  ctx.fillRect(x, y, bw, bh);
  ctx.fillStyle = col;
  ctx.fillRect(x, y, bw * clamp(v, 0, 1), bh);
}

function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, lw: number, lh: number, label: string, on: boolean, col: string, k: number) {
  ctx.fillStyle = on ? col : '#26262B';
  ctx.fillRect(x, y, lw, lh);
  ctx.fillStyle = on ? INK : '#6A6A70';
  ctx.font = `bold ${Math.round(9 * k)}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText(label, x + lw / 2, y + lh * 0.7);
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.max(0, Math.round(n))}`;
}

function drawConsole(ctx: CanvasRenderingContext2D, s: FlightState, w: number, h: number, k: number) {
  const top = consoleTop(h);
  const hood = top - 16 * k;
  ctx.fillStyle = '#1A1A1E';
  ctx.beginPath();
  ctx.moveTo(-20, top + 10 * k);
  ctx.lineTo(w * 0.3, top);
  ctx.lineTo(w * 0.35, hood);
  ctx.lineTo(w * 0.65, hood);
  ctx.lineTo(w * 0.7, top);
  ctx.lineTo(w + 20, top + 10 * k);
  ctx.lineTo(w + 20, h + 20);
  ctx.lineTo(-20, h + 20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = CLAY;
  ctx.lineWidth = 2 * k;
  ctx.stroke();

  const pad = 14 * k;
  const py0 = top + 22 * k;
  const ph = h - py0 - pad;
  const lab = `${Math.round(10 * k)}px ${MONO}`;
  const val = `bold ${Math.round(17 * k)}px ${MONO}`;
  const row = ph / 4;

  // Left screen: ship systems.
  const lx = w * 0.04, lw = w * 0.25;
  ctx.fillStyle = '#0C0D10';
  ctx.fillRect(lx, py0, lw, ph);
  ctx.strokeStyle = 'rgba(217,119,87,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(lx, py0, lw, ph);
  const bx = lx + 54 * k, bw = lw - 110 * k, bh = 7 * k;
  ctx.textAlign = 'left';
  const rows: [string, number, string, string][] = [
    ['HULL', s.hull, s.hull > 0.5 ? GOOD : s.hull > 0.25 ? WARN : HOSTILE, `${Math.round(s.hull * 100)}%`],
    ['SHLD', s.powerT / POWER_TIME, CYAN, s.powerT > 0 ? `${Math.ceil(s.powerT)}s` : 'OFF'],
    ['SPD', s.eff / MAX_SPEED, CLAY, `${Math.round(s.eff)}`],
    ['BST', s.boostFuel, VIOLET, s.boostT > 0 ? 'BURN' : `${Math.round(s.boostFuel * 100)}%`],
  ];
  for (let i = 0; i < rows.length; i++) {
    const [name, v, col, txt] = rows[i];
    const yy = py0 + row * i + row * 0.5;
    ctx.font = lab;
    ctx.fillStyle = '#8A8A90';
    ctx.textAlign = 'left';
    ctx.fillText(name, lx + 10 * k, yy + 4 * k);
    bar(ctx, bx, yy - bh / 2, bw, bh, v, col);
    ctx.font = val;
    ctx.fillStyle = IVORY;
    ctx.textAlign = 'right';
    ctx.fillText(txt, lx + lw - 8 * k, yy + 6 * k);
  }

  // Centre: the threat scope. Top-down: you at the bottom-centre, the trench running up.
  const scx = w / 2;
  const scr = Math.min(ph * 0.5, 80 * k);
  const scy = py0 + ph / 2;
  ctx.fillStyle = '#0C0D10';
  ctx.beginPath(); ctx.arc(scx, scy, scr, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(217,119,87,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Rear arc tinted: that's your six.
  ctx.fillStyle = 'rgba(255,75,92,0.08)';
  ctx.beginPath(); ctx.moveTo(scx, scy + scr * 0.4); ctx.arc(scx, scy + scr * 0.4, scr * 0.6, 0.25 * Math.PI, 0.75 * Math.PI); ctx.closePath(); ctx.fill();
  const shipSY = scy + scr * 0.4;
  const zs = (scr * 1.3) / 3600;
  const xs = (scr * 0.55) / TW;
  ctx.strokeStyle = 'rgba(236,236,236,0.15)';
  ctx.beginPath();
  ctx.moveTo(scx - TW * xs, scy - scr * 0.9); ctx.lineTo(scx - TW * xs, scy + scr * 0.9);
  ctx.moveTo(scx + TW * xs, scy - scr * 0.9); ctx.lineTo(scx + TW * xs, scy + scr * 0.9);
  ctx.stroke();
  const blip = (x: number, dz: number, col: string, sz: number) => {
    const bxp = scx + x * xs;
    const byp = shipSY - dz * zs;
    const dx = bxp - scx, dy = byp - scy;
    if (dx * dx + dy * dy > scr * scr) return;
    ctx.fillStyle = col;
    ctx.fillRect(bxp - sz / 2, byp - sz / 2, sz, sz);
  };
  ctx.strokeStyle = 'rgba(242,181,58,0.6)';
  ctx.beginPath();
  for (const o of s.obstacles) {
    const byp = shipSY - (o.z - s.z) * zs;
    if (Math.abs(byp - scy) > scr * 0.85) continue;
    ctx.moveTo(scx + Math.max(o.x0, -TW) * xs, byp); ctx.lineTo(scx + Math.min(o.x1, TW) * xs, byp);
  }
  ctx.stroke();
  for (const t of s.turrets) blip(t.x, t.z - s.z, HOSTILE, 4 * k);
  for (const f of s.fighters) blip(f.x, f.z - s.z, f.z < s.z ? WARN : HOSTILE, 5 * k);
  if (!s.target.hit) blip(s.target.x, s.target.z - s.z, IVORY, 6 * k);
  ctx.fillStyle = CLAY;
  ctx.beginPath();
  const shx = scx + s.shipX * xs;
  ctx.moveTo(shx, shipSY - 6 * k); ctx.lineTo(shx + 5 * k, shipSY + 5 * k); ctx.lineTo(shx - 5 * k, shipSY + 5 * k);
  ctx.closePath(); ctx.fill();
  // Sweep.
  const sw = s.tick * 0.05;
  ctx.strokeStyle = 'rgba(91,231,245,0.35)';
  ctx.beginPath(); ctx.moveTo(scx, scy); ctx.lineTo(scx + Math.cos(sw) * scr, scy + Math.sin(sw) * scr); ctx.stroke();

  // Lamps along the hood.
  const six = s.fighters.some((f) => f.z < s.z && f.hp > 0);
  const lamps: [string, boolean, string][] = [
    ['THINK', s.thinkT > 0, VIOLET],
    ['BOOST', s.boostT > 0 || s.eff > s.speed * 1.2, CLAY],
    ['SHIELD', s.powerT > 0, CYAN],
    ['LOCK', s.locked, HOSTILE],
    [s.shipY < RIM ? 'EXPOSED' : 'SIX', six ? (s.tick >> 3) % 2 === 0 : s.shipY < RIM, HOSTILE],
  ];
  const lampW = (w * 0.28) / lamps.length;
  const lampY = hood + 3 * k;
  for (let i = 0; i < lamps.length; i++) {
    lamp(ctx, w * 0.36 + i * lampW + 2, lampY, lampW - 4, 11 * k, lamps[i][0], lamps[i][1], lamps[i][2], k);
  }

  // Right screen: the run.
  const rx = w * 0.71, rw = w * 0.25;
  ctx.fillStyle = '#0C0D10';
  ctx.fillRect(rx, py0, rw, ph);
  ctx.strokeStyle = 'rgba(217,119,87,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, py0, rw, ph);
  const line = (i: number, label: string, value: string, col: string) => {
    const yy = py0 + row * i + row * 0.5;
    ctx.font = lab;
    ctx.fillStyle = '#8A8A90';
    ctx.textAlign = 'left';
    ctx.fillText(label, rx + 10 * k, yy + 4 * k);
    ctx.font = val;
    ctx.fillStyle = col;
    ctx.textAlign = 'right';
    ctx.fillText(value, rx + rw - 8 * k, yy + 6 * k);
  };
  const range = s.target.z - s.z;
  line(0, `SECTION ${s.section}`, `TGT ${fmtK(range)}`, range < RUN_WINDOW ? CLAY : IVORY);
  line(1, `SCORE ×${s.mult.toFixed(1)}`, `${Math.round(s.points)}`, IVORY);
  line(2, `KILLS ${s.kills}`, `CORES ${s.targetsHit}`, IVORY);
  // Who's flying.
  const yy = py0 + row * 3 + row * 0.3;
  bar(ctx, rx + 10 * k, yy, rw - 20 * k, 5 * k, s.manual, s.manual > 0.5 ? CLAY : GOOD);
  ctx.font = lab;
  ctx.textAlign = 'left';
  ctx.fillStyle = s.manual > 0.5 ? '#5A5A60' : GOOD;
  ctx.fillText('AUTO', rx + 10 * k, yy + 18 * k);
  ctx.textAlign = 'right';
  ctx.fillStyle = s.manual > 0.5 ? CLAY : '#5A5A60';
  ctx.fillText('PILOT', rx + rw - 10 * k, yy + 18 * k);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6A6A70';
  const tool = s.lastTool ? s.lastTool.slice(0, 14) : '—';
  ctx.fillText(`${tool} · ${Math.round(s.tps)} tok/s`, rx + rw / 2, yy + 18 * k);
}

function drawOverlay(
  ctx: CanvasRenderingContext2D, s: FlightState, w: number, h: number, k: number, cx: number, cy: number,
) {
  // Hit: the edges flash red.
  if (s.hurtT > 0) {
    const a = s.hurtT * 0.9;
    ctx.fillStyle = `rgba(255,75,92,${a * 0.5})`;
    const e = 26 * k;
    ctx.fillRect(0, 0, w, e); ctx.fillRect(0, h - e, w, e);
    ctx.fillRect(0, 0, e, h); ctx.fillRect(w - e, 0, e, h);
  }

  ctx.textAlign = 'center';
  // Target run: range readout above the trench.
  const range = s.target.z - s.z;
  if (!s.destroyed && !s.target.hit && range < RUN_WINDOW && range > 0 && (s.tick >> 4) % 4 !== 3) {
    ctx.font = `bold ${Math.round(15 * k)}px ${MONO}`;
    ctx.fillStyle = CLAY;
    ctx.fillText(`TARGET RUN · ${fmtK(range)}`, cx, h * 0.135);
  }

  if (s.bannerT > 0 && s.powerFlash <= 0) {
    const a = Math.min(1, s.bannerT * 1.5);
    ctx.globalAlpha = a;
    ctx.font = `bold ${Math.round(34 * k)}px ${MONO}`;
    ctx.fillStyle = s.bannerTone === 'good' ? GOOD : s.bannerTone === 'bad' ? HOSTILE : IVORY;
    ctx.fillText(s.banner, cx, cy - 70 * k);
    ctx.font = `${Math.round(13 * k)}px ${MONO}`;
    ctx.fillStyle = '#B0B0B5';
    ctx.fillText(s.bannerSub, cx, cy - 46 * k);
    ctx.globalAlpha = 1;
  }

  // POWER-UP: a big, proud flash naming what earned it.
  if (s.powerFlash > 0) {
    const t = 2.4 - s.powerFlash;
    const pop = t < 0.18 ? 1 + (0.18 - t) * 2.5 : 1;
    const a = Math.min(1, s.powerFlash * 1.4);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(91,231,245,${Math.max(0, 0.25 - t) * 0.8})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.font = `bold ${Math.round(52 * k * pop)}px ${MONO}`;
    ctx.fillStyle = CYAN;
    ctx.fillText('POWER-UP', cx, cy - 64 * k);
    ctx.font = `bold ${Math.round(16 * k)}px ${MONO}`;
    ctx.fillStyle = IVORY;
    const why = s.powerSource === 'answer' ? 'ANSWERED' : 'ORDERS SENT';
    ctx.fillText(`${why} · SHIELD + RAPID FIRE ${Math.ceil(s.powerT)}s`, cx, cy - 36 * k);
    ctx.globalAlpha = 1;
  }

  if (s.destroyed) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = HOSTILE;
    ctx.font = `bold ${Math.round(38 * k)}px ${MONO}`;
    ctx.fillText('SHIP LOST', w / 2, h / 2 - 6 * k);
    ctx.font = `${Math.round(14 * k)}px ${MONO}`;
    ctx.fillStyle = '#9A9A9A';
    ctx.fillText(`section ${s.section} · ${s.targetsHit} cores · ${s.kills} kills · ${Math.round(s.points)} pts`, w / 2, h / 2 + 22 * k);
  }
}
