import { GameMode, GameInput, TelemetryFrame, GameIntent, IntentCarrier } from '../types';

// BELT CLEARANCE — a classic rock-splitter, done properly: three discrete size tiers, each hit
// splitting into two of the next size down, and a fresh wave once the field is clear.
//
// Rocks are stale context. Breaking a LARGE rock all the way down to dust emits `prune-stale`, so
// clearing the belt actually trims the next request. Big rocks are worth the most work and the
// least score — same as real cleanup.
//
// Controls are twin-stick (move with the left stick, aim/fire with the right) because that suits a
// gamepad better than rotate-and-thrust, but the rock behaviour is the classic one.

interface Bullet { x: number; y: number; vx: number; vy: number; life: number; }
interface Rock { x: number; y: number; vx: number; vy: number; tier: 0 | 1 | 2; spin: number; seed: number; }

export interface ShooterState extends IntentCarrier {
  w: number;
  h: number;
  shipX: number;
  shipY: number;
  vx: number;
  vy: number;
  aim: number;
  bullets: Bullet[];
  rocks: Rock[];
  cooldown: number;
  score: number;
  lives: number;
  wave: number;
  cleared: number;
  invuln: number;
  gameOver: boolean;
  tick: number;
  intents: GameIntent[];
}

// tier 2 = large, 1 = medium, 0 = small
const TIER_R = [12, 22, 38];
const TIER_SCORE = [100, 50, 20];
const ACCEL = 520;
const DAMP = 1.5;
const MAX_V = 330;
const BULLET_V = 470;
const BULLET_LIFE = 1.15;
const FIRE_CD = 0.17;
const SHIP_R = 11;
const INVULN_TIME = 1.6;

function clampDt(dt: number): number { return Math.max(0, Math.min(dt, 0.05)); }
function wrap(v: number, max: number): number { return v < 0 ? v + max : v > max ? v - max : v; }

function spawnRock(w: number, h: number, tick: number, i: number): Rock {
  const seed = (tick * 2654435761 + i * 40503) >>> 0;
  const t = ((seed >> 8) % 1000) / 1000;
  const edge = seed % 4;
  let x = 0, y = 0;
  if (edge === 0) { x = t * w; y = -30; }
  else if (edge === 1) { x = w + 30; y = t * h; }
  else if (edge === 2) { x = t * w; y = h + 30; }
  else { x = -30; y = t * h; }
  const ang = Math.atan2(h / 2 - y, w / 2 - x) + (t - 0.5) * 0.9;
  const sp = 34 + t * 44;
  return { x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, tier: 2, spin: (t - 0.5) * 2, seed };
}

function makeWave(w: number, h: number, wave: number, tick: number): Rock[] {
  const n = Math.min(9, 3 + wave);
  return Array.from({ length: n }, (_, i) => spawnRock(w, h, tick + i * 17, i));
}

export function createMode(): GameMode<ShooterState> {
  return {
    id: 'freeplay-belt',
    name: 'Belt Clearance',
    kind: 'freeplay',
    blurb: 'Rocks split large → medium → small · clearing a rock to dust prunes stale context · left stick moves, right stick aims, RT fires',

    init(w, h): ShooterState {
      return {
        w, h,
        shipX: w / 2, shipY: h / 2, vx: 0, vy: 0, aim: -Math.PI / 2,
        bullets: [], rocks: makeWave(w, h, 1, 1),
        cooldown: 0, score: 0, lives: 3, wave: 1, cleared: 0,
        invuln: INVULN_TIME, gameOver: false, tick: 0, intents: [],
      };
    },

    step(state, input: GameInput, tel: TelemetryFrame, dtRaw): ShooterState {
      if (state.gameOver) return state;
      const dt = clampDt(dtRaw);
      const s: ShooterState = { ...state, tick: state.tick + 1, intents: [] };

      for (const ev of tel.events) {
        // Extra debris when the engine errors — free-play, so no crash coupling.
        if (ev.type === 'error') s.rocks = [...s.rocks, spawnRock(s.w, s.h, s.tick, s.rocks.length)];
      }

      // Ship movement.
      const mx = input.steer + (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const my = input.moveY + (input.down ? 1 : 0) - (input.up ? 1 : 0);
      let vx = s.vx + mx * ACCEL * dt;
      let vy = s.vy + my * ACCEL * dt;
      const damp = Math.max(0, 1 - DAMP * dt);
      vx *= damp; vy *= damp;
      const sp = Math.hypot(vx, vy);
      if (sp > MAX_V) { vx = (vx / sp) * MAX_V; vy = (vy / sp) * MAX_V; }
      s.shipX = wrap(s.shipX + vx * dt, s.w);
      s.shipY = wrap(s.shipY + vy * dt, s.h);
      s.vx = vx; s.vy = vy;

      if (Math.hypot(input.aimX, input.aimY) > 0.35) s.aim = Math.atan2(input.aimY, input.aimX);
      else if (sp > 40) s.aim = Math.atan2(vy, vx);

      // Fire.
      s.cooldown = Math.max(0, s.cooldown - dt);
      let bullets = s.bullets;
      if (input.fire && s.cooldown === 0) {
        bullets = [...bullets, {
          x: s.shipX, y: s.shipY,
          vx: Math.cos(s.aim) * BULLET_V, vy: Math.sin(s.aim) * BULLET_V,
          life: BULLET_LIFE,
        }];
        s.cooldown = FIRE_CD;
      }
      bullets = bullets
        .map((b) => ({ ...b, x: wrap(b.x + b.vx * dt, s.w), y: wrap(b.y + b.vy * dt, s.h), life: b.life - dt }))
        .filter((b) => b.life > 0);

      let rocks = s.rocks.map((r) => ({
        ...r,
        x: wrap(r.x + r.vx * dt, s.w),
        y: wrap(r.y + r.vy * dt, s.h),
      }));

      // Bullet ↔ rock: split one tier down, or dust at the smallest.
      const survivingBullets: Bullet[] = [];
      const nextRocks: Rock[] = [];
      const destroyed = new Set<number>();
      for (const b of bullets) {
        let hit = false;
        for (let i = 0; i < rocks.length; i++) {
          if (destroyed.has(i)) continue;
          const r = rocks[i];
          const rad = TIER_R[r.tier];
          if ((b.x - r.x) ** 2 + (b.y - r.y) ** 2 < rad * rad) {
            destroyed.add(i);
            hit = true;
            s.score += TIER_SCORE[r.tier];
            if (r.tier > 0) {
              const nt = (r.tier - 1) as 0 | 1;
              const spd = Math.hypot(r.vx, r.vy) * 1.25;
              const base = Math.atan2(r.vy, r.vx);
              for (const off of [-0.6, 0.6]) {
                nextRocks.push({
                  x: r.x, y: r.y,
                  vx: Math.cos(base + off) * spd, vy: Math.sin(base + off) * spd,
                  tier: nt, spin: -r.spin, seed: (r.seed * 1664525 + 1013904223) >>> 0,
                });
              }
            } else {
              // Fully reduced to dust — one stale context item genuinely cleared.
              s.cleared += 1;
              s.intents.push({ type: 'prune-stale' });
            }
            break;
          }
        }
        if (!hit) survivingBullets.push(b);
      }
      rocks.forEach((r, i) => { if (!destroyed.has(i)) nextRocks.push(r); });
      rocks = nextRocks;

      // Ship ↔ rock.
      s.invuln = Math.max(0, s.invuln - dt);
      if (s.invuln === 0) {
        for (const r of rocks) {
          if ((s.shipX - r.x) ** 2 + (s.shipY - r.y) ** 2 < (TIER_R[r.tier] + SHIP_R) ** 2) {
            s.lives -= 1;
            s.shipX = s.w / 2; s.shipY = s.h / 2; s.vx = 0; s.vy = 0;
            s.invuln = INVULN_TIME;
            if (s.lives <= 0) { s.gameOver = true; }
            break;
          }
        }
      }

      // Next wave once the belt is clear.
      if (rocks.length === 0) {
        s.wave += 1;
        rocks = makeWave(s.w, s.h, s.wave, s.tick);
        s.invuln = Math.max(s.invuln, 1);
      }

      s.bullets = survivingBullets;
      s.rocks = rocks;
      return s;
    },

    render(ctx, s, w, h) {
      ctx.fillStyle = '#07080C';
      ctx.fillRect(0, 0, w, h);

      // Rocks: jagged polygons derived from the seed so each looks distinct but is deterministic.
      ctx.lineWidth = 1.6;
      for (const r of s.rocks) {
        const rad = TIER_R[r.tier];
        ctx.strokeStyle = r.tier === 2 ? '#B9C4D0' : r.tier === 1 ? '#94A2B2' : '#74808E';
        ctx.beginPath();
        const pts = 9;
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2 + r.spin * s.tick * 0.004;
          const jitter = 0.72 + (((r.seed >> (i % 12)) & 7) / 7) * 0.5;
          const px = r.x + Math.cos(a) * rad * jitter;
          const py = r.y + Math.sin(a) * rad * jitter;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }

      ctx.fillStyle = '#FFD36A';
      for (const b of s.bullets) {
        ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2); ctx.fill();
      }

      // Ship — blinks while invulnerable after a hit.
      const show = s.invuln === 0 || Math.floor(s.tick / 4) % 2 === 0;
      if (show) {
        ctx.save();
        ctx.translate(s.shipX, s.shipY);
        ctx.rotate(s.aim);
        drawTug(ctx);
        ctx.restore();
      }

      if (s.gameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.58)';
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#E05252';
        ctx.font = 'bold 38px system-ui, sans-serif';
        ctx.fillText('BELT LOST', w / 2, h / 2 - 4);
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = '#9A9A9A';
        ctx.fillText(`wave ${s.wave} · ${s.cleared} cleared · ${s.score} pts`, w / 2, h / 2 + 22);
      }
    },

    score: (s) => s.score,
    isOver: (s) => s.gameOver,

    hud(s) {
      if (s.gameOver) return `GAME OVER · ${s.score}`;
      return `♥ ${s.lives} · wave ${s.wave} · ${s.score} pts · ${s.cleared} cleared`;
    },
  };
}

// The belt tug: a working machine, not a fighter. Concept-art logic from the Dune / early Star Wars
// school — a heavy slab of a fuselage, an offset pressurised cabin bulb, twin outrigger thruster
// pods on stubby pylons, and a mining yoke slung out front. Asymmetry and visible function are the
// point; nothing here is a triangle.
function drawTug(ctx: CanvasRenderingContext2D) {
  const HULL = '#9AA6B4';
  const SHADE = '#59636F';
  const TRIM = '#CC785C';

  // Mining yoke — two forward tines that read as the business end.
  ctx.strokeStyle = SHADE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(6, -6); ctx.lineTo(17, -9);
  ctx.moveTo(6, 6); ctx.lineTo(17, 9);
  ctx.stroke();
  ctx.fillStyle = TRIM;
  ctx.fillRect(16, -11, 3, 4);
  ctx.fillRect(16, 7, 3, 4);

  // Outrigger pods on pylons.
  for (const sy of [-1, 1]) {
    ctx.strokeStyle = SHADE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, sy * 5); ctx.lineTo(-4, sy * 11);
    ctx.stroke();
    ctx.fillStyle = SHADE;
    ctx.beginPath();
    ctx.roundRect(-12, sy * 9 - 3.5, 15, 7, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,211,106,0.85)';   // thruster mouth
    ctx.fillRect(-13.5, sy * 9 - 2, 2.5, 4);
  }

  // Main hull — a blunt slab, wider at the stern.
  ctx.fillStyle = HULL;
  ctx.beginPath();
  ctx.moveTo(9, -5);
  ctx.lineTo(9, 5);
  ctx.lineTo(-10, 7);
  ctx.lineTo(-10, -7);
  ctx.closePath();
  ctx.fill();

  // Panel lines.
  ctx.strokeStyle = 'rgba(20,26,34,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-4, -6.4); ctx.lineTo(-4, 6.4);
  ctx.moveTo(2, -5.8); ctx.lineTo(2, 5.8);
  ctx.stroke();

  // Offset cabin bulb, sitting proud of the hull on one side.
  ctx.fillStyle = SHADE;
  ctx.beginPath();
  ctx.roundRect(-1, -8.5, 8, 6, 2.5);
  ctx.fill();
  ctx.fillStyle = '#1B3A4A';
  ctx.fillRect(1, -7.5, 5, 3);
  ctx.strokeStyle = TRIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(1, -7.5, 5, 3);
}
