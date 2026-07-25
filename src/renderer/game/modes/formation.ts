import { GameMode, GameInput, TelemetryFrame, GameIntent, IntentCarrier } from '../types';
import { VAPOR, neon, drawScanlines } from '../vapor';

// SWARM PROTOCOL — a formation shooter in the Galaga lineage: attackers sweep in on curved entry
// paths, lock into a grid overhead, then peel off and dive at you one or two at a time.
//
// The formation IS the agent's backlog. Each attacker is a superseded context item; clear one and
// the mode emits `prune-stale`. A tool call reinforces the grid, so a busy engine literally fills
// the sky — and clearing the wave is you catching the cleanup back up.

type Phase = 'entering' | 'formed' | 'diving';

interface Attacker {
  gx: number;        // formation slot
  gy: number;
  x: number;
  y: number;
  phase: Phase;
  t: number;         // path parameter while entering / diving
  entryFrom: number; // -1 left, 1 right
  diveX: number;
  hp: number;
  seed: number;
}

interface Shot { x: number; y: number; vy: number; hostile: boolean; }

export interface FormationState extends IntentCarrier {
  w: number;
  h: number;
  shipX: number;
  attackers: Attacker[];
  shots: Shot[];
  cooldown: number;
  lives: number;
  wave: number;
  score: number;
  cleared: number;
  invuln: number;
  swayT: number;
  diveTimer: number;
  gameOver: boolean;
  tick: number;
  intents: GameIntent[];
}

const COLS = 8;
const ROWS = 4;
const CELL_W = 62;
const CELL_H = 46;
const GRID_TOP = 70;
const SHIP_Y_FROM_BOTTOM = 54;
const SHIP_SPEED = 430;
const SHOT_V = 620;
const HOSTILE_SHOT_V = 260;
const FIRE_CD = 0.22;
const HIT_R = 20;
const INVULN = 1.6;

function clampDt(dt: number): number { return Math.max(0, Math.min(dt, 0.05)); }

function slotX(w: number, gx: number, sway: number): number {
  const gridW = COLS * CELL_W;
  return w / 2 - gridW / 2 + gx * CELL_W + CELL_W / 2 + sway;
}
function slotY(gy: number): number { return GRID_TOP + gy * CELL_H; }

function makeWave(w: number, wave: number): Attacker[] {
  const out: Attacker[] = [];
  const rows = Math.min(ROWS, 2 + Math.floor(wave / 2));
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < COLS; gx++) {
      const seed = (gx * 73856093) ^ (gy * 19349663) ^ (wave * 83492791);
      out.push({
        gx, gy,
        x: gx % 2 ? -60 : w + 60,
        y: -40 - gy * 30,
        phase: 'entering',
        t: -(gx * 0.06 + gy * 0.12),
        entryFrom: gx % 2 ? -1 : 1,
        diveX: 0,
        hp: gy === 0 ? 2 : 1,
        seed: seed >>> 0,
      });
    }
  }
  return out;
}

export function createMode(): GameMode<FormationState> {
  return {
    id: 'freeplay-swarm',
    name: 'Swarm Protocol',
    kind: 'freeplay',
    blurb: 'Formation shooter · attackers sweep in, lock up, then dive · every one you clear prunes a stale context item · stick moves, RT fires',

    init(w, h): FormationState {
      return {
        w, h,
        shipX: w / 2,
        attackers: makeWave(w, 1),
        shots: [],
        cooldown: 0, lives: 3, wave: 1, score: 0, cleared: 0,
        invuln: INVULN, swayT: 0, diveTimer: 2.5,
        gameOver: false, tick: 0, intents: [],
      };
    },

    step(state, input: GameInput, tel: TelemetryFrame, dtRaw): FormationState {
      if (state.gameOver) return state;
      const dt = clampDt(dtRaw);
      const s: FormationState = {
        ...state,
        tick: state.tick + 1,
        intents: [],
        attackers: state.attackers.map((a) => ({ ...a })),
        shots: state.shots.slice(),
      };
      const shipY = s.h - SHIP_Y_FROM_BOTTOM;

      // A busy engine reinforces the grid.
      for (const ev of tel.events) {
        if ((ev.type === 'tool' || ev.type === 'error') && s.attackers.length < COLS * ROWS) {
          const gx = s.tick % COLS;
          const gy = Math.min(ROWS - 1, Math.floor(s.attackers.length / COLS));
          s.attackers.push({
            gx, gy, x: gx % 2 ? -60 : s.w + 60, y: -40,
            phase: 'entering', t: 0, entryFrom: gx % 2 ? -1 : 1,
            diveX: 0, hp: 1, seed: (s.tick * 2654435761) >>> 0,
          });
        }
      }

      // Ship.
      const mx = input.steer + (input.right ? 1 : 0) - (input.left ? 1 : 0);
      s.shipX = Math.max(20, Math.min(s.w - 20, s.shipX + mx * SHIP_SPEED * dt));

      s.cooldown = Math.max(0, s.cooldown - dt);
      if (input.fire && s.cooldown === 0) {
        s.shots.push({ x: s.shipX, y: shipY - 14, vy: -SHOT_V, hostile: false });
        s.cooldown = FIRE_CD;
      }

      // Formation sway.
      s.swayT += dt;
      const sway = Math.sin(s.swayT * 0.8) * 26;

      // Send a diver periodically, picked from the formed ranks.
      s.diveTimer -= dt;
      if (s.diveTimer <= 0) {
        const formed = s.attackers.filter((a) => a.phase === 'formed');
        if (formed.length > 0) {
          const pick = formed[s.tick % formed.length];
          pick.phase = 'diving';
          pick.t = 0;
          pick.diveX = s.shipX;
        }
        s.diveTimer = Math.max(0.5, 2.4 - s.wave * 0.15);
      }

      for (const a of s.attackers) {
        if (a.phase === 'entering') {
          a.t += dt * 0.85;
          if (a.t >= 1) {
            a.phase = 'formed';
          } else if (a.t > 0) {
            // Curved sweep from the side into the slot.
            const tx = slotX(s.w, a.gx, sway);
            const ty = slotY(a.gy);
            const arc = Math.sin(a.t * Math.PI) * 130 * a.entryFrom;
            a.x = (a.entryFrom < 0 ? -60 : s.w + 60) + (tx - (a.entryFrom < 0 ? -60 : s.w + 60)) * a.t + arc;
            a.y = -40 + (ty + 40) * a.t;
          }
        }
        if (a.phase === 'formed') {
          a.x = slotX(s.w, a.gx, sway);
          a.y = slotY(a.gy);
        }
        if (a.phase === 'diving') {
          a.t += dt;
          // Swooping run: curve toward where you were, then off the bottom.
          a.y += (150 + s.wave * 18) * dt;
          a.x += Math.sin(a.t * 3.4) * 150 * dt + (a.diveX - a.x) * 0.55 * dt;
          if (((a.seed >> 3) % 100) / 100 < dt * 1.4) {
            s.shots.push({ x: a.x, y: a.y + 12, vy: HOSTILE_SHOT_V, hostile: true });
          }
          if (a.y > s.h + 40) {
            // Loop back around to its slot.
            a.phase = 'entering';
            a.t = 0;
            a.y = -40;
            a.x = a.entryFrom < 0 ? -60 : s.w + 60;
          }
        }
      }

      // Shots.
      const liveShots: Shot[] = [];
      for (const sh of s.shots) {
        const y = sh.y + sh.vy * dt;
        if (y < -20 || y > s.h + 20) continue;
        const moved = { ...sh, y };

        if (!moved.hostile) {
          let hit = false;
          for (const a of s.attackers) {
            if (a.hp <= 0) continue;
            if (Math.hypot(a.x - moved.x, a.y - moved.y) < HIT_R) {
              a.hp -= 1;
              hit = true;
              if (a.hp <= 0) {
                s.score += a.phase === 'diving' ? 200 : 80;  // divers are worth more
                s.cleared += 1;
                s.intents.push({ type: 'prune-stale' });
              }
              break;
            }
          }
          if (hit) continue;
        } else if (s.invuln <= 0 && Math.hypot(moved.x - s.shipX, moved.y - shipY) < 14) {
          s.lives -= 1;
          s.invuln = INVULN;
          if (s.lives <= 0) s.gameOver = true;
          continue;
        }
        liveShots.push(moved);
      }
      s.shots = liveShots;
      s.attackers = s.attackers.filter((a) => a.hp > 0);

      // Ramming.
      s.invuln = Math.max(0, s.invuln - dt);
      if (s.invuln === 0) {
        for (const a of s.attackers) {
          if (a.phase === 'diving' && Math.hypot(a.x - s.shipX, a.y - shipY) < 20) {
            s.lives -= 1;
            s.invuln = INVULN;
            a.hp = 0;
            if (s.lives <= 0) s.gameOver = true;
            break;
          }
        }
      }
      s.attackers = s.attackers.filter((a) => a.hp > 0);

      if (s.attackers.length === 0) {
        s.wave += 1;
        s.attackers = makeWave(s.w, s.wave);
        s.invuln = Math.max(s.invuln, 1);
      }
      return s;
    },

    render(ctx, s, w, h) {
      const shipY = h - SHIP_Y_FROM_BOTTOM;
      ctx.fillStyle = VAPOR.deep;
      ctx.fillRect(0, 0, w, h);

      // Starfield.
      for (let i = 0; i < 70; i++) {
        const sd = (i * 2654435761) >>> 0;
        const sx = ((sd % 1000) / 1000) * w;
        const sy = (((sd >> 10) % 1000) / 1000 + (s.tick * 0.0004)) % 1;
        ctx.fillStyle = i % 8 === 0 ? 'rgba(255,106,213,0.8)' : 'rgba(190,220,255,0.5)';
        ctx.fillRect(sx, sy * h, 1.6, 1.6);
      }

      // Attackers.
      for (const a of s.attackers) {
        const diving = a.phase === 'diving';
        const col = diving ? VAPOR.magenta : a.gy === 0 ? VAPOR.pink : VAPOR.cyan;
        ctx.save();
        ctx.translate(a.x, a.y);
        if (diving) ctx.rotate(Math.sin(a.t * 3.4) * 0.4);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        neon(ctx, col, 10, () => {
          // Beetle silhouette: body, swept mandible wings.
          ctx.beginPath();
          ctx.moveTo(0, -9); ctx.lineTo(7, -2); ctx.lineTo(5, 8); ctx.lineTo(-5, 8); ctx.lineTo(-7, -2);
          ctx.closePath(); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(-7, -2); ctx.lineTo(-14, -10);
          ctx.moveTo(7, -2); ctx.lineTo(14, -10);
          ctx.stroke();
        });
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.moveTo(0, -9); ctx.lineTo(7, -2); ctx.lineTo(5, 8); ctx.lineTo(-5, 8); ctx.lineTo(-7, -2);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // Shots.
      for (const sh of s.shots) {
        const col = sh.hostile ? VAPOR.magenta : VAPOR.sun;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        neon(ctx, col, 10, () => {
          ctx.beginPath();
          ctx.moveTo(sh.x, sh.y);
          ctx.lineTo(sh.x, sh.y + (sh.hostile ? -9 : 11));
          ctx.stroke();
        });
      }

      // Player: a compact interceptor, same design family as the flight cockpit ship.
      if (s.invuln === 0 || Math.floor(s.tick / 4) % 2 === 0) {
        ctx.save();
        ctx.translate(s.shipX, shipY);
        ctx.fillStyle = '#9AA6B4';
        ctx.beginPath();
        ctx.moveTo(0, -15); ctx.lineTo(5, -4); ctx.lineTo(6, 9); ctx.lineTo(-6, 9); ctx.lineTo(-5, -4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#59636F';
        ctx.fillRect(-15, 1, 9, 8);
        ctx.fillRect(6, 1, 9, 8);
        ctx.fillStyle = VAPOR.cyan;
        neon(ctx, VAPOR.cyan, 8, () => ctx.fillRect(-2.5, -12, 5, 5));
        ctx.fillStyle = 'rgba(255,211,106,0.9)';
        ctx.fillRect(-3, 9, 6, 4);
        ctx.restore();
      }

      drawScanlines(ctx, w, h, 0.05);

      if (s.gameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.fillStyle = VAPOR.magenta;
        ctx.font = 'bold 38px system-ui, sans-serif';
        ctx.fillText('SWARM WINS', w / 2, h / 2 - 4);
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = '#9A9A9A';
        ctx.fillText(`wave ${s.wave} · ${s.cleared} cleared · ${s.score} pts`, w / 2, h / 2 + 22);
      }
    },

    score: (s) => s.score,
    isOver: (s) => s.gameOver,

    hud(s) {
      if (s.gameOver) return `SWARM WINS · ${s.score}`;
      return `♥ ${s.lives} · wave ${s.wave} · ${s.score} pts · ${s.cleared} cleared`;
    },
  };
}
