import { GameMode, GameInput, TelemetryFrame } from '../types';

// Telemetry cockpit "engine room" racer. Top-down dodger: your speed tracks the engine's token
// throughput, obstacles drop from tool calls and errors, an approved write boosts you, an abort
// crashes you, and a completed turn is the checkered flag. Playing it = watching the engine run.

export interface RacerState {
  w: number;
  h: number;
  carX: number;
  speed: number;
  obsX: number[];
  obsY: number[];
  crashed: boolean;
  finished: boolean;
  boostT: number;
  distance: number;
  spawnAcc: number;
  tick: number;
}

const BASE_SPEED = 120;
const MAX_SPEED = 520;
const STEER_SPEED = 320;
const BOOST_TIME = 0.7;
const BOOST_MULT = 1.7;
const CAR_Y_FROM_BOTTOM = 46;
const HIT_R = 22;
const SPAWN_DIST = 130;

function clampDt(dt: number): number {
  return Math.max(0, Math.min(dt, 0.05));
}

function spawnX(w: number, tick: number): number {
  return 20 + ((tick * 97) % Math.max(1, w - 40));
}

export function makeRacerMode(): GameMode<RacerState> {
  return {
    id: 'cockpit-racer',
    name: 'Engine Racer',
    kind: 'telemetry',
    blurb: 'Speed = token throughput · obstacles = tool calls & errors · boost = approve · crash = abort',

    init(w, h): RacerState {
      return {
        w, h,
        carX: w * 0.5,
        speed: BASE_SPEED,
        obsX: [], obsY: [],
        crashed: false, finished: false,
        boostT: 0, distance: 0, spawnAcc: 0, tick: 0,
      };
    },

    step(state, input: GameInput, tel: TelemetryFrame, dtRaw): RacerState {
      if (state.crashed || state.finished) return state;
      const dt = clampDt(dtRaw);
      const carY = state.h - CAR_Y_FROM_BOTTOM;

      let boostT = state.boostT;
      let obsX = state.obsX;
      let obsY = state.obsY;
      let tick = state.tick + 1;

      for (const ev of tel.events) {
        if (ev.type === 'crash') return { ...state, tick, crashed: true };
        if (ev.type === 'done') return { ...state, tick, finished: true };
        if (ev.type === 'boost') boostT = BOOST_TIME;
        if (ev.type === 'tool' || ev.type === 'error') {
          obsX = [...obsX, spawnX(state.w, tick)];
          obsY = [...obsY, -20];
          tick += 1;
        }
      }

      // Speed from throughput.
      const target = BASE_SPEED + Math.min(tel.snapshot.tokensPerSec, 80) * 4;
      const speed = state.speed + (target - state.speed) * Math.min(1, dt * 3);
      if (boostT > 0) boostT = Math.max(0, boostT - dt);
      const eff = Math.min(MAX_SPEED, speed * (boostT > 0 ? BOOST_MULT : 1));

      // Steer.
      let carX = state.carX + input.steer * STEER_SPEED * dt;
      if (input.left) carX -= STEER_SPEED * dt;
      if (input.right) carX += STEER_SPEED * dt;
      carX = Math.max(16, Math.min(state.w - 16, carX));

      // Periodic obstacle even when idle, so there's always a little to dodge while streaming.
      let spawnAcc = state.spawnAcc + eff * dt;
      if (spawnAcc >= SPAWN_DIST && tel.snapshot.streaming) {
        spawnAcc -= SPAWN_DIST;
        obsX = [...obsX, spawnX(state.w, tick * 3)];
        obsY = [...obsY, -20];
      }

      // Advance obstacles, cull off-bottom, detect collision.
      const nextX: number[] = [];
      const nextY: number[] = [];
      let crashed = false;
      for (let i = 0; i < obsY.length; i++) {
        const y = obsY[i] + eff * dt;
        if (y > state.h + 20) continue;
        const dx = obsX[i] - carX;
        const dy = y - carY;
        if (dx * dx + dy * dy < HIT_R * HIT_R) crashed = true;
        nextX.push(obsX[i]);
        nextY.push(y);
      }

      return {
        ...state,
        carX, speed, boostT,
        obsX: nextX, obsY: nextY,
        spawnAcc, tick,
        distance: state.distance + eff * dt,
        crashed,
      };
    },

    render(ctx, state, w, h) {
      const carY = h - CAR_Y_FROM_BOTTOM;
      ctx.fillStyle = '#0B0D10';
      ctx.fillRect(0, 0, w, h);

      // Scrolling lane markers (scroll speed ~ distance).
      ctx.strokeStyle = 'rgba(204,120,92,0.25)';
      ctx.lineWidth = 3;
      const off = state.distance % 60;
      ctx.beginPath();
      for (let y = -60 + off; y < h; y += 60) { ctx.moveTo(w / 2, y); ctx.lineTo(w / 2, y + 30); }
      ctx.stroke();

      // Obstacles
      ctx.fillStyle = '#E0864F';
      for (let i = 0; i < state.obsY.length; i++) {
        ctx.beginPath();
        ctx.arc(state.obsX[i], state.obsY[i], 12, 0, Math.PI * 2);
        ctx.fill();
      }

      // Car
      ctx.fillStyle = state.boostT > 0 ? '#FFD36A' : '#8FE9FF';
      ctx.beginPath();
      ctx.moveTo(state.carX, carY - 16);
      ctx.lineTo(state.carX - 12, carY + 14);
      ctx.lineTo(state.carX + 12, carY + 14);
      ctx.closePath();
      ctx.fill();

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
      return `${label} · ${Math.round(state.distance)} m`;
    },
  };
}
