import { GameMode, GameInput, TelemetryFrame } from '../types';

// Tron lightcycle. As a cockpit mode it's telemetry-driven: speed tracks the engine's live token
// throughput, tool calls / errors drop hazards, a pilot-approved write boosts, an abort crashes.
// As a free-play mode the same sim runs on the pilot's own throttle/steer, ignoring telemetry.

export interface TronState {
  w: number;
  h: number;
  x: number;
  y: number;
  dir: number; // radians
  speed: number;
  trail: number[]; // flat [x0,y0,x1,y1,...]
  hazards: number[]; // flat points spawned by errors/tools
  crashed: boolean;
  finished: boolean;
  boostT: number;
  score: number;
  tick: number;
  telemetryDriven: boolean;
}

const TURN_RATE = 2.6; // rad/s
const BASE_SPEED = 90;
const MAX_SPEED = 320;
const BOOST_TIME = 0.7;
const BOOST_MULT = 1.8;
const TRAIL_GAP = 6;
const TRAIL_HIT = 5;
const HAZARD_HIT = 10;
const NECK_SKIP = 14; // recent trail points to ignore for self-collision

function clampDt(dt: number): number {
  return Math.max(0, Math.min(dt, 0.05));
}

function hitsTrail(trail: number[], x: number, y: number): boolean {
  const end = trail.length - NECK_SKIP * 2;
  for (let i = 0; i < end; i += 2) {
    const dx = trail[i] - x;
    const dy = trail[i + 1] - y;
    if (dx * dx + dy * dy < TRAIL_HIT * TRAIL_HIT) return true;
  }
  return false;
}

function hitsHazard(hazards: number[], x: number, y: number): boolean {
  for (let i = 0; i < hazards.length; i += 2) {
    const dx = hazards[i] - x;
    const dy = hazards[i + 1] - y;
    if (dx * dx + dy * dy < HAZARD_HIT * HAZARD_HIT) return true;
  }
  return false;
}

export function makeTronMode(opts: {
  id: string;
  name: string;
  kind: 'telemetry' | 'freeplay';
  telemetryDriven: boolean;
  blurb: string;
}): GameMode<TronState> {
  return {
    id: opts.id,
    name: opts.name,
    kind: opts.kind,
    blurb: opts.blurb,

    init(w, h): TronState {
      return {
        w, h,
        x: w * 0.5, y: h * 0.5,
        dir: 0, speed: BASE_SPEED,
        trail: [], hazards: [],
        crashed: false, finished: false,
        boostT: 0, score: 0, tick: 0,
        telemetryDriven: opts.telemetryDriven,
      };
    },

    step(state, input: GameInput, tel: TelemetryFrame, dtRaw): TronState {
      if (state.crashed || state.finished) return state;
      const dt = clampDt(dtRaw);
      const next: TronState = { ...state, tick: state.tick + 1 };

      // Discrete engine events (only meaningful in telemetry mode, harmless otherwise).
      let boostT = state.boostT;
      let hazards = state.hazards;
      for (const ev of tel.events) {
        if (ev.type === 'crash' && state.telemetryDriven) {
          return { ...next, crashed: true };
        }
        if (ev.type === 'boost') boostT = BOOST_TIME;
        if ((ev.type === 'error' || ev.type === 'tool') && state.telemetryDriven) {
          // Drop a hazard just off the bike's path (deterministic side by tick).
          const side = state.tick % 2 === 0 ? 1 : -1;
          const hx = state.x + Math.cos(state.dir + (Math.PI / 2) * side) * 26;
          const hy = state.y + Math.sin(state.dir + (Math.PI / 2) * side) * 26;
          hazards = [...hazards, hx, hy];
        }
        if (ev.type === 'done' && state.telemetryDriven) {
          return { ...next, finished: true };
        }
      }

      // Steering — analog steer plus discrete left/right (dpad).
      let dir = state.dir + input.steer * TURN_RATE * dt;
      if (input.left) dir -= TURN_RATE * dt;
      if (input.right) dir += TURN_RATE * dt;

      // Target speed: throughput (cockpit) or throttle (free-play).
      const target = state.telemetryDriven
        ? BASE_SPEED + Math.min(tel.snapshot.tokensPerSec, 60) * 3.2
        : BASE_SPEED + input.throttle * (MAX_SPEED - BASE_SPEED);
      const speed = state.speed + (target - state.speed) * Math.min(1, dt * 3);

      if (boostT > 0) boostT = Math.max(0, boostT - dt);
      const boosting = boostT > 0 || input.boost;
      const eff = Math.min(MAX_SPEED, speed * (boosting ? BOOST_MULT : 1));

      const nx = state.x + Math.cos(dir) * eff * dt;
      const ny = state.y + Math.sin(dir) * eff * dt;

      // Collisions.
      if (nx < 0 || nx > state.w || ny < 0 || ny > state.h) {
        return { ...next, dir, speed, boostT, hazards, crashed: true };
      }
      if (hitsTrail(state.trail, nx, ny) || hitsHazard(hazards, nx, ny)) {
        return { ...next, dir, speed, boostT, hazards, crashed: true };
      }

      // Extend the trail when we've moved far enough from the last node.
      let trail = state.trail;
      const n = trail.length;
      const far =
        n < 2 ||
        (nx - trail[n - 2]) ** 2 + (ny - trail[n - 1]) ** 2 > TRAIL_GAP * TRAIL_GAP;
      if (far) {
        trail = [...trail, nx, ny];
        // Trail grows with progress in cockpit mode; fixed in free-play.
        const cap = state.telemetryDriven
          ? Math.min(4000, 400 + Math.floor(tel.snapshot.sessionTokens / 4)) * 2
          : 1200;
        if (trail.length > cap) trail = trail.slice(trail.length - cap);
      }

      return {
        ...next,
        x: nx, y: ny, dir, speed, boostT, trail, hazards,
        score: state.score + eff * dt,
      };
    },

    render(ctx, state, w, h) {
      ctx.fillStyle = '#07090C';
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = 'rgba(70,110,160,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0; gx <= w; gx += 40) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
      for (let gy = 0; gy <= h; gy += 40) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
      ctx.stroke();

      // Hazards
      ctx.fillStyle = '#E05252';
      for (let i = 0; i < state.hazards.length; i += 2) {
        ctx.fillRect(state.hazards[i] - 4, state.hazards[i + 1] - 4, 8, 8);
      }

      // Trail
      if (state.trail.length >= 4) {
        ctx.strokeStyle = '#38C6E0';
        ctx.shadowColor = '#38C6E0';
        ctx.shadowBlur = 8;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(state.trail[0], state.trail[1]);
        for (let i = 2; i < state.trail.length; i += 2) ctx.lineTo(state.trail[i], state.trail[i + 1]);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Bike
      ctx.save();
      ctx.translate(state.x, state.y);
      ctx.rotate(state.dir);
      ctx.fillStyle = state.boostT > 0 ? '#FFD36A' : '#8FE9FF';
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-6, -5); ctx.lineTo(-6, 5); ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (state.crashed || state.finished) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = state.finished ? '#52A77C' : '#E05252';
        ctx.font = 'bold 40px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(state.finished ? 'FINISHED' : 'CRASHED', w / 2, h / 2);
      }
    },

    hud(state) {
      const label = state.crashed ? 'CRASH' : state.finished ? 'FINISH' : `SPD ${Math.round(state.speed)}`;
      return `${label} · score ${Math.round(state.score)}`;
    },
  };
}
