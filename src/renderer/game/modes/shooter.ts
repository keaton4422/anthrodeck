import { GameMode, GameInput, TelemetryFrame } from '../types';

// Free-play twin-stick shooter (asteroids-style). Ignores telemetry — it's here to fill the wait
// during a long turn. Move with the left stick, aim/fire with the right stick + trigger. The App
// pauses it and surfaces the real modal when the engine needs the pilot.

interface Bullet { x: number; y: number; vx: number; vy: number; life: number; }
interface Rock { x: number; y: number; vx: number; vy: number; r: number; }

export interface ShooterState {
  w: number;
  h: number;
  shipX: number;
  shipY: number;
  vx: number;
  vy: number;
  aim: number; // radians
  bullets: Bullet[];
  rocks: Rock[];
  cooldown: number;
  spawnAcc: number;
  score: number;
  lives: number;
  gameOver: boolean;
  tick: number;
}

const ACCEL = 520;
const DAMP = 1.6;
const MAX_V = 340;
const BULLET_V = 460;
const BULLET_LIFE = 1.1;
const FIRE_CD = 0.16;
const SPAWN_INTERVAL = 1.4;
const SHIP_R = 12;

function clampDt(dt: number): number {
  return Math.max(0, Math.min(dt, 0.05));
}

function wrap(v: number, max: number): number {
  if (v < 0) return v + max;
  if (v > max) return v - max;
  return v;
}

// Deterministic spawn on a screen edge, drifting toward the interior.
function spawnRock(w: number, h: number, tick: number): Rock {
  const edge = tick % 4;
  const t = ((tick * 61) % 100) / 100;
  let x = 0, y = 0;
  if (edge === 0) { x = t * w; y = -20; }
  else if (edge === 1) { x = w + 20; y = t * h; }
  else if (edge === 2) { x = t * w; y = h + 20; }
  else { x = -20; y = t * h; }
  const cx = w / 2, cy = h / 2;
  const ang = Math.atan2(cy - y, cx - x) + (t - 0.5) * 0.8;
  const speed = 50 + t * 60;
  return { x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 26 };
}

export function makeShooterMode(): GameMode<ShooterState> {
  return {
    id: 'freeplay-shooter',
    name: 'Asteroids',
    kind: 'freeplay',
    blurb: 'Twin-stick shooter to pass a long turn · move left stick, aim/fire right stick + trigger',

    init(w, h): ShooterState {
      return {
        w, h,
        shipX: w / 2, shipY: h / 2, vx: 0, vy: 0, aim: -Math.PI / 2,
        bullets: [], rocks: [],
        cooldown: 0, spawnAcc: 0, score: 0, lives: 3, gameOver: false, tick: 0,
      };
    },

    step(state, input: GameInput, _tel: TelemetryFrame, dtRaw): ShooterState {
      if (state.gameOver) return state;
      const dt = clampDt(dtRaw);
      const tick = state.tick + 1;

      // Ship movement (left stick, with dpad fallback).
      const mx = input.steer + (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const my = input.moveY + (input.down ? 1 : 0) - (input.up ? 1 : 0);
      let vx = state.vx + mx * ACCEL * dt;
      let vy = state.vy + my * ACCEL * dt;
      const damp = Math.max(0, 1 - DAMP * dt);
      vx *= damp; vy *= damp;
      const sp = Math.hypot(vx, vy);
      if (sp > MAX_V) { vx = (vx / sp) * MAX_V; vy = (vy / sp) * MAX_V; }
      const shipX = wrap(state.shipX + vx * dt, state.w);
      const shipY = wrap(state.shipY + vy * dt, state.h);

      // Aim (right stick); keep last aim if stick centered.
      let aim = state.aim;
      if (Math.hypot(input.aimX, input.aimY) > 0.35) aim = Math.atan2(input.aimY, input.aimX);
      else if (sp > 40) aim = Math.atan2(vy, vx);

      // Fire.
      let cooldown = Math.max(0, state.cooldown - dt);
      let bullets = state.bullets;
      if (input.fire && cooldown === 0) {
        bullets = [
          ...bullets,
          { x: shipX, y: shipY, vx: Math.cos(aim) * BULLET_V, vy: Math.sin(aim) * BULLET_V, life: BULLET_LIFE },
        ];
        cooldown = FIRE_CD;
      }
      bullets = bullets
        .map((b) => ({ ...b, x: wrap(b.x + b.vx * dt, state.w), y: wrap(b.y + b.vy * dt, state.h), life: b.life - dt }))
        .filter((b) => b.life > 0);

      // Spawn rocks.
      let spawnAcc = state.spawnAcc + dt;
      let rocks = state.rocks.map((r) => ({
        ...r,
        x: wrap(r.x + r.vx * dt, state.w),
        y: wrap(r.y + r.vy * dt, state.h),
      }));
      if (spawnAcc >= SPAWN_INTERVAL && rocks.length < 12) {
        spawnAcc -= SPAWN_INTERVAL;
        rocks = [...rocks, spawnRock(state.w, state.h, tick)];
      }

      // Bullet↔rock collisions (destroy/split), score.
      const liveBullets: Bullet[] = [];
      let score = state.score;
      const survivingRocks: Rock[] = [];
      const consumed = new Set<number>();
      for (const b of bullets) {
        let hit = false;
        for (let i = 0; i < rocks.length; i++) {
          if (consumed.has(i)) continue;
          const r = rocks[i];
          if ((b.x - r.x) ** 2 + (b.y - r.y) ** 2 < r.r * r.r) {
            consumed.add(i);
            hit = true;
            score += 10;
            if (r.r > 16) {
              survivingRocks.push(
                { x: r.x, y: r.y, vx: -r.vy, vy: r.vx, r: r.r * 0.55 },
                { x: r.x, y: r.y, vx: r.vy, vy: -r.vx, r: r.r * 0.55 },
              );
            }
            break;
          }
        }
        if (!hit) liveBullets.push(b);
      }
      rocks.forEach((r, i) => { if (!consumed.has(i)) survivingRocks.push(r); });

      // Ship↔rock collision.
      let lives = state.lives;
      let nShipX = shipX, nShipY = shipY, nvx = vx, nvy = vy;
      let gameOver = false;
      for (const r of survivingRocks) {
        if ((shipX - r.x) ** 2 + (shipY - r.y) ** 2 < (r.r + SHIP_R) ** 2) {
          lives -= 1;
          nShipX = state.w / 2; nShipY = state.h / 2; nvx = 0; nvy = 0;
          if (lives <= 0) gameOver = true;
          break;
        }
      }

      return {
        ...state,
        shipX: nShipX, shipY: nShipY, vx: nvx, vy: nvy, aim,
        bullets: liveBullets, rocks: survivingRocks,
        cooldown, spawnAcc, score, lives, gameOver, tick,
      };
    },

    render(ctx, state, w, h) {
      ctx.fillStyle = '#08090C';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#9AA7B4';
      for (const r of state.rocks) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = '#9AA7B4';
      ctx.lineWidth = 1.5;
      for (const r of state.rocks) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = '#FFD36A';
      for (const b of state.bullets) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ship
      ctx.save();
      ctx.translate(state.shipX, state.shipY);
      ctx.rotate(state.aim);
      ctx.fillStyle = '#8FE9FF';
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(-9, -7); ctx.lineTo(-5, 0); ctx.lineTo(-9, 7); ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (state.gameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#E05252';
        ctx.font = 'bold 40px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', w / 2, h / 2);
      }
    },

    hud(state) {
      return state.gameOver
        ? `GAME OVER · score ${state.score}`
        : `♥ ${state.lives} · score ${state.score}`;
    },
  };
}
