import { GameMode, GameInput, TelemetryFrame, GameIntent, IntentCarrier } from '../types';

// ENGINE RUNNER — you drive a blue JDM-style hero coupe (long hood, low roof, big rear wing;
// evoked, not badged — no marks or model names).
//
// RED cars are stale context hunting you down. Ram one and you SMASH IT OFF THE ROAD: it spins to
// the shoulder, and the mode emits `prune-stale` so the app really does drop a superseded item from
// the next request. GREY cars are ordinary traffic — hit one of those and you wreck. So the game is
// weaving through traffic to hunt the reds, and every red you put in the weeds is genuine cleanup.

const LANES = 4;

type CarKind = 'hunter' | 'civilian';

interface Car {
  lane: number;
  x: number;        // px — hunters drift between lanes to line you up
  y: number;
  speed: number;    // closing speed relative to the road
  kind: CarKind;
  spin: number;     // >0 = knocked off, spinning away
  vx: number;       // lateral velocity once knocked
  rot: number;
}

export interface RacerState extends IntentCarrier {
  w: number;
  h: number;
  lane: number;
  laneX: number;
  speed: number;
  cars: Car[];
  crashed: boolean;
  finished: boolean;
  boostT: number;
  distance: number;
  smashed: number;
  civWrecks: number;
  strikes: number;
  score: number;
  spawnAcc: number;
  prevLeft: boolean;
  prevRight: boolean;
  tick: number;
  intents: GameIntent[];
}

const BASE_SPEED = 160;
const MAX_SPEED = 600;
const BOOST_TIME = 0.7;
const BOOST_MULT = 1.7;
const CAR_Y_FROM_BOTTOM = 84;
const CAR_W = 28;
const CAR_H = 50;
const SPAWN_DIST = 200;

function clampDt(dt: number): number { return Math.max(0, Math.min(dt, 0.05)); }
function roadLeft(w: number): number { return w * 0.15; }
function roadRight(w: number): number { return w * 0.85; }
export function laneCenter(w: number, lane: number): number {
  const l = roadLeft(w);
  return l + ((roadRight(w) - l) / LANES) * (lane + 0.5);
}

export function createMode(): GameMode<RacerState> {
  return {
    id: 'cockpit-runner',
    name: 'Engine Runner',
    kind: 'telemetry',
    blurb: 'Blue hero car · SMASH the red cars off the road to prune stale context · weave through grey traffic · speed = token throughput',

    init(w, h): RacerState {
      return {
        w, h, lane: 1, laneX: laneCenter(w, 1),
        speed: BASE_SPEED, cars: [],
        crashed: false, finished: false,
        boostT: 0, distance: 0, smashed: 0, civWrecks: 0, strikes: 0, score: 0, spawnAcc: 0,
        prevLeft: false, prevRight: false, tick: 0, intents: [],
      };
    },

    step(state, input: GameInput, tel: TelemetryFrame, dtRaw): RacerState {
      if (state.crashed || state.finished) return state;
      const dt = clampDt(dtRaw);
      const s: RacerState = { ...state, tick: state.tick + 1, cars: state.cars.map((c) => ({ ...c })), intents: [] };
      const carY = s.h - CAR_Y_FROM_BOTTOM;

      const addCar = (kind: CarKind, lane: number, speed: number) => {
        s.cars.push({
          lane, x: laneCenter(s.w, lane), y: -70,
          speed, kind, spin: 0, vx: 0, rot: 0,
        });
      };

      for (const ev of tel.events) {
        if (ev.type === 'crash') return { ...s, crashed: true };
        if (ev.type === 'done') return { ...s, finished: true };
        if (ev.type === 'boost') s.boostT = BOOST_TIME;
        // Tool calls and errors send hunters after you.
        if (ev.type === 'tool' || ev.type === 'error') {
          addCar('hunter', (s.tick * 7 + s.cars.length * 3) % LANES, ev.type === 'error' ? 110 : 70);
        }
      }

      const target = BASE_SPEED + Math.min(tel.snapshot.tokensPerSec, 60) * 7;
      s.speed += (target - s.speed) * Math.min(1, dt * 3);
      if (s.boostT > 0) s.boostT = Math.max(0, s.boostT - dt);
      const eff = Math.min(MAX_SPEED, s.speed * (s.boostT > 0 ? BOOST_MULT : 1));

      // Discrete lane changes, edge-triggered.
      const wantLeft = input.left || input.steer < -0.5;
      const wantRight = input.right || input.steer > 0.5;
      if (wantLeft && !s.prevLeft) s.lane = Math.max(0, s.lane - 1);
      if (wantRight && !s.prevRight) s.lane = Math.min(LANES - 1, s.lane + 1);
      s.prevLeft = wantLeft; s.prevRight = wantRight;
      s.laneX += (laneCenter(s.w, s.lane) - s.laneX) * Math.min(1, dt * 9);

      // Ordinary traffic keeps the road busy.
      s.spawnAcc += eff * dt;
      if (s.spawnAcc >= SPAWN_DIST) {
        s.spawnAcc -= SPAWN_DIST;
        addCar('civilian', (s.tick * 5) % LANES, 55 + ((s.tick * 11) % 40));
      }

      const next: Car[] = [];
      for (const c of s.cars) {
        // Already knocked off — spin toward the shoulder and fall behind.
        if (c.spin > 0) {
          c.spin -= dt;
          c.x += c.vx * dt;
          c.rot += dt * 9 * Math.sign(c.vx || 1);
          c.y += (eff - c.speed * 0.3) * dt;
          if (c.spin > 0 && c.y < s.h + 140) next.push(c);
          continue;
        }

        // Hunters actively steer toward your lane; civilians hold theirs.
        if (c.kind === 'hunter') {
          const want = laneCenter(s.w, s.lane);
          c.x += Math.sign(want - c.x) * Math.min(Math.abs(want - c.x), 70 * dt);
        }
        c.y += (eff - c.speed) * dt;
        if (c.y > s.h + 90) continue;

        const overlap = Math.abs(c.x - s.laneX) < CAR_W * 0.92 && Math.abs(c.y - carY) < CAR_H * 0.92;
        if (overlap) {
          if (c.kind === 'hunter') {
            // SMASH: punt it toward the nearest shoulder. Real work — one stale item pruned.
            c.spin = 1.4;
            c.vx = (c.x < s.w / 2 ? -1 : 1) * (260 + eff * 0.35);
            s.smashed += 1;
            s.score += 250;
            s.intents.push({ type: 'prune-stale' });
            next.push(c);
            continue;
          }
          // Civilians get knocked off too — the car is heavy enough. But they're not the target:
          // it costs score and a strike, and three strikes ends the run.
          c.spin = 1.4;
          c.vx = (c.x < s.w / 2 ? -1 : 1) * (200 + eff * 0.25);
          s.civWrecks += 1;
          s.strikes += 1;
          s.score = Math.max(0, s.score - 150);
          next.push(c);
          if (s.strikes >= 3) return { ...s, cars: next, crashed: true };
          continue;
        }
        next.push(c);
      }
      s.cars = next;
      s.distance += eff * dt;
      s.score += eff * dt * 0.05; // distance survived
      return s;
    },

    render(ctx, s, w, h) {
      const carY = h - CAR_Y_FROM_BOTTOM;
      const l = roadLeft(w);
      const r = roadRight(w);
      const speedFrac = Math.max(0, Math.min(1, (s.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)));

      ctx.fillStyle = '#080A0D';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#121820';            // verge
      ctx.fillRect(l - 34, 0, r - l + 68, h);
      ctx.fillStyle = '#1C2028';            // asphalt
      ctx.fillRect(l, 0, r - l, h);

      // Asphalt texture bands — cheap, but they give the surface grain.
      ctx.fillStyle = 'rgba(255,255,255,0.012)';
      const band = 90;
      for (let y = -band + (s.distance % band); y < h; y += band) ctx.fillRect(l, y, r - l, band / 2);

      // Guard rails, with posts that stream past faster as throughput rises.
      const postGap = 46;
      const off = s.distance % postGap;
      ctx.fillStyle = 'rgba(150,165,185,0.5)';
      ctx.fillRect(l - 32, 0, 4, h);
      ctx.fillRect(r + 28, 0, 4, h);
      ctx.fillStyle = `rgba(204,120,92,${0.3 + speedFrac * 0.4})`;
      const streak = 10 + speedFrac * 40;
      for (let y = -postGap + off; y < h; y += postGap) {
        ctx.fillRect(l - 30, y, 3, streak);
        ctx.fillRect(r + 29, y, 3, streak);
      }

      // Edge lines + dashed lane dividers.
      ctx.fillStyle = 'rgba(235,235,235,0.6)';
      ctx.fillRect(l + 2, 0, 3, h);
      ctx.fillRect(r - 5, 0, 3, h);
      ctx.fillStyle = 'rgba(235,235,235,0.3)';
      const dash = 36;
      const dashOff = s.distance % (dash * 2);
      for (let i = 1; i < LANES; i++) {
        const x = l + ((r - l) / LANES) * i;
        for (let y = -dash * 2 + dashOff; y < h; y += dash * 2) ctx.fillRect(x - 1.5, y, 3, dash);
      }

      for (const c of s.cars) {
        ctx.save();
        ctx.translate(c.x, c.y);
        if (c.spin > 0) ctx.rotate(c.rot);
        if (c.kind === 'hunter') drawCar(ctx, '#D93A3A', '#6E1616', false);
        else drawCar(ctx, '#7C8794', '#3A424C', false);
        ctx.restore();
      }

      // Hero car.
      ctx.save();
      ctx.translate(s.laneX, carY);
      drawCar(ctx, s.boostT > 0 ? '#5FD0FF' : '#2E6DE0', '#123A78', true);
      ctx.restore();
      if (s.boostT > 0) {
        ctx.fillStyle = 'rgba(255,211,106,0.8)';
        ctx.beginPath();
        ctx.moveTo(s.laneX - 8, carY + CAR_H / 2);
        ctx.lineTo(s.laneX + 8, carY + CAR_H / 2);
        ctx.lineTo(s.laneX, carY + CAR_H / 2 + 30);
        ctx.closePath(); ctx.fill();
      }

      if (s.crashed || s.finished) {
        ctx.fillStyle = 'rgba(0,0,0,0.58)';
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.fillStyle = s.finished ? '#52A77C' : '#E05252';
        ctx.font = 'bold 38px system-ui, sans-serif';
        ctx.fillText(s.finished ? 'ARRIVED' : 'WRECKED', w / 2, h / 2 - 4);
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = '#9A9A9A';
        ctx.fillText(`${Math.round(s.score)} pts · ${s.smashed} hunters smashed · ${s.civWrecks} civilian${s.civWrecks === 1 ? '' : 's'} hit`, w / 2, h / 2 + 22);
      }
    },

    score: (s) => Math.round(s.score),
    isOver: (s) => s.crashed || s.finished,

    hud(s) {
      const strikes = '●'.repeat(s.strikes) + '○'.repeat(Math.max(0, 3 - s.strikes));
      if (s.crashed) return `WRECKED · ${Math.round(s.score)} pts`;
      if (s.finished) return `ARRIVED · ${Math.round(s.score)} pts`;
      return `${Math.round(s.score)} pts · ${s.smashed} smashed · ${strikes}`;
    },
  };
}

// Drawn at the origin, nose up. `hero` adds the long hood, low roof and big rear wing that give the
// blue car its tuned-coupe silhouette.
function drawCar(ctx: CanvasRenderingContext2D, body: string, dark: string, hero: boolean) {
  const w = CAR_W, h = CAR_H;
  ctx.fillStyle = '#0B0E12';
  ctx.fillRect(-w / 2 - 3, -h / 2 + 8, 3, 12);
  ctx.fillRect(w / 2, -h / 2 + 8, 3, 12);
  ctx.fillRect(-w / 2 - 3, h / 2 - 20, 3, 12);
  ctx.fillRect(w / 2, h / 2 - 20, 3, 12);

  if (hero) {
    ctx.fillStyle = dark;                       // rear wing
    ctx.fillRect(-w / 2 - 4, h / 2 - 8, w + 8, 4);
    ctx.fillRect(-w / 2 + 3, h / 2 - 11, 3, 7);
    ctx.fillRect(w / 2 - 6, h / 2 - 11, 3, 7);
  }

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, hero ? 7 : 5);
  ctx.fill();

  ctx.fillStyle = 'rgba(8,12,18,0.8)';          // glass
  ctx.fillRect(-w / 2 + 4, -h / 2 + (hero ? 13 : 8), w - 8, hero ? 10 : 12);
  ctx.fillRect(-w / 2 + 5, h / 2 - (hero ? 22 : 20), w - 10, 8);

  if (hero) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';   // racing stripes
    ctx.fillRect(-4, -h / 2 + 2, 2.5, h - 12);
    ctx.fillRect(2, -h / 2 + 2, 2.5, h - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, 6);
  }
}
