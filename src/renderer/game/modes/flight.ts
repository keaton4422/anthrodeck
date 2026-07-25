import { GameMode, GameInput, TelemetryFrame, GameIntent, IntentCarrier } from '../types';
import { project, depthAlpha, makeRng, approach, clamp } from '../lib3d';

// FLIGHT COCKPIT — the mode the whole "human as pilot" idea is actually about.
//
// You fly the Claude ship down the agent's engine loops: each ring is a step of work the engine is
// running. It flies itself — the autopilot is competent and will complete the course alone, exactly
// like the agent does. The moment you touch the stick, control blends to you, and rings you fly by
// hand score double. That is the whole thesis in a mechanic: the engine runs; the pilot makes it
// better when they take the reins.
//
// Rendered with a hand-rolled perspective divide (see lib3d) rather than a 3D engine — depth and
// speed cues are all this needs, and the bundle stays small.

export type ViewMode = 'chase' | 'cockpit';

interface Ring {
  z: number;
  x: number;
  y: number;
  r: number;
  state: 'ahead' | 'passed' | 'missed';
  hand: boolean; // flown manually
}

interface Debris {
  z: number;
  x: number;
  y: number;
}

interface Bolt { z: number; x: number; y: number; }

// Hostile drones: stale context flying escort for the engine. Shoot one down and it prunes.
interface Drone { z: number; x: number; y: number; hp: number; phase: number; }

export interface FlightState extends IntentCarrier {
  w: number;
  h: number;
  z: number;          // distance travelled down the corridor
  shipX: number;      // lateral offset
  shipY: number;      // vertical offset
  vx: number;
  vy: number;
  speed: number;
  manual: number;     // 0 = autopilot, 1 = fully hand-flown
  rings: Ring[];
  debris: Debris[];
  bolts: Bolt[];
  drones: Drone[];
  fireCd: number;
  kills: number;
  points: number;
  nextRingZ: number;
  hull: number;       // 0..1
  score: number;
  passed: number;
  missed: number;
  handFlown: number;
  shake: number;
  boostT: number;
  view: ViewMode;
  prevToggle: boolean;
  finished: boolean;
  destroyed: boolean;
  rngState: number;
  tick: number;
  intents: GameIntent[];
}

const BASE_SPEED = 260;
const MAX_SPEED = 1150;
const RING_GAP = 620;
const CORRIDOR = 190;      // half-width the ship may roam
const CONTROL_ACCEL = 620;
const AUTO_ACCEL = 430;
const DAMP = 2.4;
const FAR = 4200;
const BOOST_TIME = 0.9;
const BOOST_MULT = 1.7;
const DEADZONE = 0.16;
const RING_R = 96;

function clampDt(dt: number): number {
  return Math.max(0, Math.min(dt, 0.05));
}

// Course generation is seeded so a restart replays the same corridor and tests are deterministic.
function nextRing(state: FlightState): Ring {
  const rng = makeRng(state.rngState);
  const a = rng();
  const b = rng();
  state.rngState = Math.floor(a * 0xffffffff) ^ (state.tick * 2654435761);
  return {
    z: state.nextRingZ,
    x: (a - 0.5) * 2 * (CORRIDOR * 0.72),
    y: (b - 0.5) * 2 * (CORRIDOR * 0.5),
    r: RING_R,
    state: 'ahead',
    hand: false,
  };
}

export function createMode(): GameMode<FlightState> {
  return {
    id: 'cockpit-flight',
    name: 'Flight Cockpit',
    kind: 'telemetry',
    blurb: 'Fly the Claude ship through the engine loops · RT fires · shoot the red escort drones to prune stale context, dodge debris · autopilot flies it, hand-flown gates score double · D-pad up = cockpit/chase view',

    init(w, h): FlightState {
      const s: FlightState = {
        w, h,
        z: 0, shipX: 0, shipY: 0, vx: 0, vy: 0,
        speed: BASE_SPEED, manual: 0,
        rings: [], debris: [], bolts: [], drones: [], fireCd: 0, kills: 0, points: 0,
        nextRingZ: RING_GAP,
        hull: 1, score: 0, passed: 0, missed: 0, handFlown: 0,
        shake: 0, boostT: 0,
        view: 'chase', prevToggle: false,
        finished: false, destroyed: false,
        rngState: 0x1a2b3c4d, tick: 0, intents: [],
      };
      // Prime the corridor so there is something to aim at on frame one.
      for (let i = 0; i < 6; i++) {
        s.rings.push(nextRing(s));
        s.nextRingZ += RING_GAP;
      }
      return s;
    },

    step(state, input: GameInput, tel: TelemetryFrame, dtRaw): FlightState {
      if (state.destroyed || state.finished) return state;
      const dt = clampDt(dtRaw);
      const s: FlightState = {
        ...state,
        tick: state.tick + 1,
        rings: state.rings.slice(),
        debris: state.debris.slice(),
        bolts: state.bolts.slice(),
        drones: state.drones.map((d) => ({ ...d })),
        intents: [],
      };

      // ── Engine events ───────────────────────────────────────────────────────
      for (const ev of tel.events) {
        if (ev.type === 'crash') return { ...s, destroyed: true, shake: 1 };
        if (ev.type === 'done') return { ...s, finished: true };
        if (ev.type === 'boost') s.boostT = BOOST_TIME;
        if (ev.type === 'tool') {
          // A tool call extends the course — another loop to fly — and sends an escort drone.
          s.rings.push(nextRing(s));
          s.nextRingZ += RING_GAP;
          const rng = makeRng(s.rngState ^ (s.tick * 7919));
          s.drones.push({
            z: s.z + 2200 + rng() * 1200,
            x: (rng() - 0.5) * 2 * CORRIDOR,
            y: (rng() - 0.5) * 2 * (CORRIDOR * 0.55),
            hp: 2,
            phase: rng() * Math.PI * 2,
          });
        }
        if (ev.type === 'error') {
          // An error throws debris into the corridor ahead.
          const rng = makeRng(s.rngState ^ s.tick);
          s.debris.push({
            z: s.z + 1500 + rng() * 900,
            x: (rng() - 0.5) * 2 * CORRIDOR,
            y: (rng() - 0.5) * 2 * (CORRIDOR * 0.6),
          });
          s.shake = Math.min(1, s.shake + 0.35);
        }
      }

      // ── View toggle (D-pad up), edge-detected ───────────────────────────────
      if (input.up && !s.prevToggle) s.view = s.view === 'chase' ? 'cockpit' : 'chase';
      s.prevToggle = input.up;

      // ── Speed from the engine's throughput ──────────────────────────────────
      const target = BASE_SPEED + Math.min(tel.snapshot.tokensPerSec, 60) * 14;
      s.speed += (target - s.speed) * Math.min(1, dt * 2.2);
      if (s.boostT > 0) s.boostT = Math.max(0, s.boostT - dt);
      const eff = Math.min(MAX_SPEED, s.speed * (s.boostT > 0 ? BOOST_MULT : 1));
      s.z += eff * dt;

      // ── Control blend: autopilot vs pilot ───────────────────────────────────
      const stick = Math.hypot(input.steer, input.moveY);
      const piloting = stick > DEADZONE || input.left || input.right || input.down;
      // Taking the stick hands control over quickly; letting go returns it gently, so a nudge
      // doesn't yank the ship back the instant you relax.
      s.manual = piloting
        ? clamp(s.manual + dt * 3.2, 0, 1)
        : clamp(s.manual - dt * 0.55, 0, 1);

      const nextTarget = s.rings.find((r) => r.state === 'ahead' && r.z > s.z);
      const autoX = nextTarget ? nextTarget.x : 0;
      const autoY = nextTarget ? nextTarget.y : 0;

      // Autopilot pulls toward the next ring; pilot input is a direct acceleration.
      const autoAx = approach(s.vx, (autoX - s.shipX) * 2.2, AUTO_ACCEL * dt) - s.vx;
      const autoAy = approach(s.vy, (autoY - s.shipY) * 2.2, AUTO_ACCEL * dt) - s.vy;
      const pilotX = (input.steer + (input.right ? 1 : 0) - (input.left ? 1 : 0)) * CONTROL_ACCEL * dt;
      const pilotY = (input.moveY + (input.down ? 1 : 0)) * CONTROL_ACCEL * dt;

      s.vx += autoAx * (1 - s.manual) + pilotX * s.manual;
      s.vy += autoAy * (1 - s.manual) + pilotY * s.manual;

      const damp = Math.max(0, 1 - DAMP * dt);
      s.vx *= damp; s.vy *= damp;
      s.shipX = clamp(s.shipX + s.vx * dt, -CORRIDOR, CORRIDOR);
      s.shipY = clamp(s.shipY + s.vy * dt, -CORRIDOR * 0.7, CORRIDOR * 0.7);

      // ── Guns ────────────────────────────────────────────────────────────────
      s.fireCd = Math.max(0, s.fireCd - dt);
      if (input.fire && s.fireCd === 0) {
        s.bolts.push({ z: s.z + 40, x: s.shipX, y: s.shipY });
        s.fireCd = 0.14;
      }
      const BOLT_V = 2600;
      s.bolts = s.bolts
        .map((b) => ({ ...b, z: b.z + BOLT_V * dt }))
        .filter((b) => b.z < s.z + FAR);

      // Drones weave toward the ship; bolts knock them down.
      for (const d of s.drones) {
        d.phase += dt * 2;
        d.x += Math.sin(d.phase) * 26 * dt;
        d.y += Math.cos(d.phase * 0.7) * 18 * dt;
        // close on the pilot
        d.x += Math.sign(s.shipX - d.x) * 22 * dt;
        d.y += Math.sign(s.shipY - d.y) * 16 * dt;
      }
      const liveBolts: Bolt[] = [];
      for (const b of s.bolts) {
        let hit = false;
        for (const d of s.drones) {
          if (d.hp <= 0) continue;
          if (Math.abs(d.z - b.z) < 90 && Math.hypot(d.x - b.x, d.y - b.y) < 54) {
            d.hp -= 1;
            hit = true;
            if (d.hp <= 0) {
              s.kills += 1;
              s.points += 150;
              // A downed escort is one stale context item cleared.
              s.intents.push({ type: 'prune-stale' });
            }
            break;
          }
        }
        if (!hit) liveBolts.push(b);
      }
      s.bolts = liveBolts;

      // A drone that reaches you costs hull.
      for (const d of s.drones) {
        if (d.hp <= 0) continue;
        if (d.z <= s.z && d.z > s.z - 220 && Math.hypot(d.x - s.shipX, d.y - s.shipY) < 60) {
          s.hull = clamp(s.hull - 0.12, 0, 1);
          s.shake = Math.min(1, s.shake + 0.45);
          d.hp = 0;
        }
      }
      s.drones = s.drones.filter((d) => d.hp > 0 && d.z > s.z - 300);

      // ── Ring gates ──────────────────────────────────────────────────────────
      for (let i = 0; i < s.rings.length; i++) {
        const r = s.rings[i];
        if (r.state !== 'ahead' || r.z > s.z) continue;
        const dist = Math.hypot(r.x - s.shipX, r.y - s.shipY);
        if (dist <= r.r) {
          const hand = s.manual > 0.5;
          // Hand-flown rings are worth double — the pilot adds value over the autopilot.
          s.rings[i] = { ...r, state: 'passed', hand };
          s.passed += 1;
          if (hand) {
            s.handFlown += 1;
            // Flying a gate by hand does real work: clear one superseded context item.
            s.intents.push({ type: 'prune-stale' });
          }
          s.points += hand ? 200 : 100;
        } else {
          s.rings[i] = { ...r, state: 'missed' };
          s.missed += 1;
          s.hull = clamp(s.hull - 0.08, 0, 1);
          s.shake = Math.min(1, s.shake + 0.25);
        }
      }

      // ── Debris ──────────────────────────────────────────────────────────────
      for (const d of s.debris) {
        if (d.z > s.z || d.z < s.z - 200) continue;
        if (Math.hypot(d.x - s.shipX, d.y - s.shipY) < 42) {
          s.hull = clamp(s.hull - 0.14, 0, 1);
          s.shake = Math.min(1, s.shake + 0.5);
          d.z = -1e9; // consumed
        }
      }

      if (s.hull <= 0) return { ...s, destroyed: true, shake: 1 };

      // Cull what is behind us and keep the corridor stocked.
      s.rings = s.rings.filter((r) => r.z > s.z - 400);
      s.debris = s.debris.filter((d) => d.z > s.z - 400);
      s.points += eff * dt * 0.02;
      while (s.rings.filter((r) => r.z > s.z).length < 6) {
        s.rings.push(nextRing(s));
        s.nextRingZ += RING_GAP;
      }

      s.shake = Math.max(0, s.shake - dt * 1.6);
      return s;
    },

    render(ctx, s, w, h) {
      const shakeX = s.shake * (Math.sin(s.tick * 1.7) * 7);
      const shakeY = s.shake * (Math.cos(s.tick * 2.3) * 5);
      ctx.save();
      ctx.translate(shakeX, shakeY);

      ctx.fillStyle = '#05070B';
      ctx.fillRect(-20, -20, w + 40, h + 40);

      const speedFrac = clamp((s.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1);

      // ── Corridor: square frames receding to the vanishing point ─────────────
      const firstFrame = Math.floor(s.z / 300) * 300;
      for (let i = 0; i < 14; i++) {
        const fz = firstFrame + i * 300;
        const dz = fz - s.z;
        if (dz <= 10) continue;
        const a = depthAlpha(dz, FAR) * 0.5;
        if (a <= 0.01) continue;
        const p = project(-s.shipX, -s.shipY, dz, w, h);
        const half = CORRIDOR * 1.35 * p.scale;
        ctx.strokeStyle = `rgba(90,130,180,${a * 0.5})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - half, p.y - half * 0.72, half * 2, half * 1.44);
      }

      // Speed streaks — how fast the engine is streaming, read as motion.
      if (speedFrac > 0.05) {
        ctx.strokeStyle = `rgba(143,233,255,${0.08 + speedFrac * 0.32})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 26; i++) {
          const seed = (i * 2654435761) >>> 0;
          const ang = (seed % 360) * (Math.PI / 180);
          const rad = 60 + ((seed >> 9) % 300);
          const sx = w / 2 + Math.cos(ang) * rad;
          const sy = h / 2 + Math.sin(ang) * rad;
          const len = 8 + speedFrac * 46;
          const dx = Math.cos(ang) * len;
          const dy = Math.sin(ang) * len;
          ctx.moveTo(sx, sy); ctx.lineTo(sx + dx, sy + dy);
        }
        ctx.stroke();
      }

      // ── Rings, far to near (painter's algorithm) ────────────────────────────
      const ahead = s.rings.filter((r) => r.z > s.z - 60).sort((a, b) => b.z - a.z);
      const nextGate = s.rings.find((r) => r.state === 'ahead' && r.z > s.z);
      for (const r of ahead) {
        const dz = r.z - s.z;
        if (dz <= 10) continue;
        const a = depthAlpha(dz, FAR);
        if (a <= 0.02) continue;
        const p = project(r.x - s.shipX, r.y - s.shipY, dz, w, h);
        const rad = r.r * p.scale;
        if (rad < 1) continue;

        const isNext = nextGate === r;
        const color =
          r.state === 'missed' ? `rgba(224,82,82,${a * 0.8})`
          : r.state === 'passed' ? `rgba(82,167,124,${a * 0.5})`
          : isNext ? `rgba(204,120,92,${a})`
          : `rgba(143,233,255,${a * 0.75})`;

        ctx.strokeStyle = color;
        ctx.lineWidth = isNext ? 3 : 2;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rad, rad * 0.82, 0, 0, Math.PI * 2);
        ctx.stroke();

        // The gate you're actually aiming at gets tick marks so it reads instantly.
        if (isNext) {
          ctx.strokeStyle = `rgba(204,120,92,${a})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let k = 0; k < 4; k++) {
            const ang = (Math.PI / 2) * k;
            const ix = p.x + Math.cos(ang) * rad * 0.82;
            const iy = p.y + Math.sin(ang) * rad * 0.68;
            const ox = p.x + Math.cos(ang) * rad * 1.16;
            const oy = p.y + Math.sin(ang) * rad * 0.96;
            ctx.moveTo(ix, iy); ctx.lineTo(ox, oy);
          }
          ctx.stroke();
        }
      }

      // ── Debris ──────────────────────────────────────────────────────────────
      for (const d of s.debris) {
        const dz = d.z - s.z;
        if (dz <= 10 || dz > FAR) continue;
        const a = depthAlpha(dz, FAR);
        const p = project(d.x - s.shipX, d.y - s.shipY, dz, w, h);
        const size = Math.max(1.5, 26 * p.scale);
        ctx.fillStyle = `rgba(224,82,82,${a})`;
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      }

      // ── Drones + bolts ──────────────────────────────────────────────────────
      for (const d of s.drones) {
        const dz = d.z - s.z;
        if (dz <= 10 || dz > FAR) continue;
        const a = depthAlpha(dz, FAR);
        const p = project(d.x - s.shipX, d.y - s.shipY, dz, w, h);
        const size = Math.max(3, 62 * p.scale);
        ctx.strokeStyle = `rgba(224,82,82,${a})`;
        ctx.lineWidth = 2;
        // blocky hostile: hull bar + two pods, same design language as the player ship
        ctx.strokeRect(p.x - size / 2, p.y - size / 5, size, size * 0.4);
        ctx.fillStyle = `rgba(224,82,82,${a * 0.35})`;
        ctx.fillRect(p.x - size / 2, p.y - size / 5, size, size * 0.4);
        ctx.fillStyle = `rgba(255,160,120,${a})`;
        ctx.fillRect(p.x - size * 0.62, p.y - size * 0.08, size * 0.16, size * 0.16);
        ctx.fillRect(p.x + size * 0.46, p.y - size * 0.08, size * 0.16, size * 0.16);
      }
      for (const b of s.bolts) {
        const dz = b.z - s.z;
        if (dz <= 6 || dz > FAR) continue;
        const p = project(b.x - s.shipX, b.y - s.shipY, dz, w, h);
        const len = Math.max(3, 90 * p.scale);
        ctx.strokeStyle = `rgba(255,236,150,${depthAlpha(dz, FAR)})`;
        ctx.lineWidth = Math.max(1.5, 7 * p.scale);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - len); ctx.stroke();
      }

      // ── The ship ────────────────────────────────────────────────────────────
      if (s.view === 'chase') {
        drawShipExterior(ctx, w / 2 + s.vx * 0.05, h * 0.76, clamp(s.vx / 260, -1, 1), s.boostT > 0, s.manual > 0.5);
      } else {
        drawCockpitInterior(ctx, w, h, s.manual > 0.5);
      }

      // ── Control-authority bar: who is flying right now ──────────────────────
      const barW = 150;
      const bx = w - barW - 18;
      const by = 18;
      ctx.fillStyle = 'rgba(20,20,20,0.75)';
      ctx.fillRect(bx - 8, by - 12, barW + 16, 34);
      ctx.fillStyle = '#242424';
      ctx.fillRect(bx, by, barW, 5);
      ctx.fillStyle = s.manual > 0.5 ? '#CC785C' : '#52A77C';
      ctx.fillRect(bx, by, barW * s.manual, 5);
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = '#8A8A8A';
      ctx.textAlign = 'left';
      ctx.fillText('AUTOPILOT', bx, by + 16);
      ctx.textAlign = 'right';
      ctx.fillStyle = s.manual > 0.5 ? '#CC785C' : '#5A5A5A';
      ctx.fillText('PILOT', bx + barW, by + 16);

      // Hull
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(20,20,20,0.75)';
      ctx.fillRect(10, by - 12, 128, 34);
      ctx.fillStyle = '#242424';
      ctx.fillRect(18, by, 100, 5);
      ctx.fillStyle = s.hull > 0.5 ? '#52A77C' : s.hull > 0.25 ? '#D9A441' : '#E05252';
      ctx.fillRect(18, by, 100 * s.hull, 5);
      ctx.fillStyle = '#8A8A8A';
      ctx.fillText('HULL', 18, by + 16);

      ctx.restore();

      if (s.destroyed || s.finished) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.fillStyle = s.finished ? '#52A77C' : '#E05252';
        ctx.font = 'bold 38px system-ui, sans-serif';
        ctx.fillText(s.finished ? 'ARRIVED' : 'SHIP LOST', w / 2, h / 2 - 6);
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = '#9A9A9A';
        ctx.fillText(`${s.passed} gates · ${s.handFlown} hand-flown`, w / 2, h / 2 + 22);
      }
    },

    score: (s) => Math.round(s.points),
    isOver: (s) => s.destroyed || s.finished,

    hud(s) {
      if (s.destroyed) return 'SHIP LOST';
      if (s.finished) return `ARRIVED · ${s.passed} gates`;
      const who = s.manual > 0.5 ? 'PILOT' : 'AUTO';
      return `${who} · ${s.passed} gates · ${s.kills} kills · hull ${Math.round(s.hull * 100)}%`;
    },
  };
}

// ─── Ship design ──────────────────────────────────────────────────────────────
// Functional sci-fi in the McQuarrie vein: readable masses rather than a pointy wedge. A blocky
// command hull, a canopy pod set into it, two engine nacelles hung off the flanks, and swept fins —
// all flat planes with panel lines, in the app's own palette. The interior view repeats the same
// canopy shape and nacelle glow so the two views obviously belong to one vehicle.

const HULL = '#8A94A3';
const HULL_DARK = '#4A5361';
const HULL_LINE = 'rgba(15,19,25,0.55)';
const GLASS = '#1B3A4A';

function drawShipExterior(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, bank: number, boost: boolean, manual: boolean,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(bank * 0.32);

  const accent = manual ? '#CC785C' : '#8FE9FF';
  const glow = boost ? 1 : 0.5;

  // Engine nacelles (drawn first so the hull overlaps them).
  for (const sx of [-1, 1]) {
    ctx.fillStyle = HULL_DARK;
    ctx.beginPath();
    ctx.roundRect(sx * 26 - 9, -10, 18, 30, 3);
    ctx.fill();
    // exhaust bloom
    const g = ctx.createRadialGradient(sx * 26, 22, 1, sx * 26, 22, 16 + glow * 14);
    g.addColorStop(0, `rgba(255,211,106,${glow})`);
    g.addColorStop(1, 'rgba(255,211,106,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx * 26, 22, 16 + glow * 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,236,190,${0.5 + glow * 0.5})`;
    ctx.fillRect(sx * 26 - 6, 18, 12, 4);
  }

  // Swept fins.
  ctx.fillStyle = HULL_DARK;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * 14, -6);
    ctx.lineTo(sx * 40, 8);
    ctx.lineTo(sx * 38, 14);
    ctx.lineTo(sx * 14, 8);
    ctx.closePath(); ctx.fill();
  }

  // Command hull — a trapezoid, wide at the stern.
  ctx.fillStyle = HULL;
  ctx.beginPath();
  ctx.moveTo(-11, -22);
  ctx.lineTo(11, -22);
  ctx.lineTo(19, 16);
  ctx.lineTo(-19, 16);
  ctx.closePath(); ctx.fill();

  // Panel lines.
  ctx.strokeStyle = HULL_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-15, 2); ctx.lineTo(15, 2);
  ctx.moveTo(-17, 9); ctx.lineTo(17, 9);
  ctx.moveTo(0, -22); ctx.lineTo(0, 16);
  ctx.stroke();

  // Canopy pod.
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.moveTo(-7, -19);
  ctx.lineTo(7, -19);
  ctx.lineTo(9, -6);
  ctx.lineTo(-9, -6);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Accent trim along the shoulders.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-11, -21); ctx.lineTo(-18, 14);
  ctx.moveTo(11, -21); ctx.lineTo(18, 14);
  ctx.stroke();

  ctx.restore();
}

function drawCockpitInterior(ctx: CanvasRenderingContext2D, w: number, h: number, manual: boolean) {
  const accent = manual ? '#CC785C' : '#8FE9FF';

  // Canopy frame: the same trapezoid as the exterior pod, seen from inside.
  const topY = h * 0.06;
  const sillY = h * 0.72;
  ctx.fillStyle = '#161B22';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, topY);
  ctx.lineTo(w * 0.80, topY); ctx.lineTo(w * 0.93, sillY); ctx.lineTo(w, sillY);
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.lineTo(0, sillY);
  ctx.lineTo(w * 0.07, sillY); ctx.lineTo(w * 0.20, topY); ctx.lineTo(0, topY);
  ctx.closePath(); ctx.fill();

  // Frame edge + centre rib.
  ctx.strokeStyle = HULL_DARK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w * 0.20, topY); ctx.lineTo(w * 0.07, sillY);
  ctx.moveTo(w * 0.80, topY); ctx.lineTo(w * 0.93, sillY);
  ctx.moveTo(w * 0.20, topY); ctx.lineTo(w * 0.80, topY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(74,83,97,0.65)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, topY);
  ctx.stroke();

  // Console lip with readout blocks and status studs.
  ctx.fillStyle = '#10151C';
  ctx.fillRect(0, sillY, w, h - sillY);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, sillY); ctx.lineTo(w, sillY); ctx.stroke();

  ctx.fillStyle = 'rgba(74,83,97,0.55)';
  for (let i = 0; i < 7; i++) {
    const bw = w * 0.07;
    ctx.fillRect(w * 0.12 + i * (bw + 10), sillY + 16, bw, 9);
  }
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 === 0 ? accent : 'rgba(82,167,124,0.8)';
    ctx.beginPath();
    ctx.arc(w * 0.16 + i * 26, sillY + 40, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Nacelle glow bleeding in at the lower corners — same engines as the exterior view.
  for (const sx of [0.06, 0.94]) {
    const g = ctx.createRadialGradient(w * sx, h * 0.9, 2, w * sx, h * 0.9, 90);
    g.addColorStop(0, 'rgba(255,211,106,0.20)');
    g.addColorStop(1, 'rgba(255,211,106,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(w * sx, h * 0.9, 90, 0, Math.PI * 2); ctx.fill();
  }

  // Boresight reticle.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  const cy2 = h * 0.42;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 30, cy2); ctx.lineTo(w / 2 - 11, cy2);
  ctx.moveTo(w / 2 + 11, cy2); ctx.lineTo(w / 2 + 30, cy2);
  ctx.moveTo(w / 2, cy2 - 30); ctx.lineTo(w / 2, cy2 - 11);
  ctx.moveTo(w / 2, cy2 + 11); ctx.lineTo(w / 2, cy2 + 30);
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.strokeRect(w / 2 - 20, cy2 - 20, 40, 40);
  ctx.globalAlpha = 1;
}
