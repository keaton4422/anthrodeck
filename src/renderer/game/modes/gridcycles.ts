import { GameMode, GameInput, TelemetryFrame, GameIntent, IntentCarrier } from '../types';
import { VAPOR, neon, drawScanlines } from '../vapor';

// GRID CYCLES — an original lightcycle game (no borrowed names, characters or marks; the only
// shared idea is "vehicle leaves a solid wall", which is the genre itself).
//
// A walled arena, you plus rival cycles, everyone laying wall behind them. Turn is 90° and
// grid-locked, which is what makes it a lightcycle game rather than a free-steering bike: you
// commit to a direction and live with it.
//
// It also does real work. Tool calls drop DATA NODES into the arena — each one is a superseded
// context item. Drive over a node and the mode emits `prune-stale`, so a good run genuinely tidies
// the next request while you wait.

const CELL = 8;
const TURN_COOLDOWN = 0.07;

type Dir = 0 | 1 | 2 | 3; // 0=up 1=right 2=down 3=left
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

interface Cycle {
  x: number;
  y: number;
  dir: Dir;
  alive: boolean;
  trail: number[]; // flat x,y pairs in cell coords
  color: string;
  cool: number;
}

interface Node { x: number; y: number; }

export interface GridState extends IntentCarrier {
  w: number;
  h: number;
  cols: number;
  rows: number;
  player: Cycle;
  rivals: Cycle[];
  nodes: Node[];
  occupied: Set<number>;
  speed: number;      // cells per second
  moveAcc: number;
  collected: number;
  rivalsDown: number;
  crashed: boolean;
  finished: boolean;
  boostT: number;
  tick: number;
  intents: GameIntent[];
}

const BASE_CPS = 11;
const MAX_CPS = 40;
const BOOST_TIME = 0.8;

function key(x: number, y: number): number { return y * 4096 + x; }

function spawn(cols: number, rows: number, i: number, color: string): Cycle {
  const spots: [number, number, Dir][] = [
    [Math.floor(cols * 0.5), Math.floor(rows * 0.75), 0],
    [Math.floor(cols * 0.25), Math.floor(rows * 0.25), 2],
    [Math.floor(cols * 0.75), Math.floor(rows * 0.25), 2],
    [Math.floor(cols * 0.5), Math.floor(rows * 0.2), 2],
  ];
  const [x, y, dir] = spots[i % spots.length];
  return { x, y, dir, alive: true, trail: [x, y], color, cool: 0 };
}

// A rival turns only when it must: look one step ahead, and if that cell is taken, pick whichever
// side has more open room. Simple, but it produces cycles that corner sensibly and box you in.
function rivalThink(c: Cycle, occupied: Set<number>, cols: number, rows: number): Dir {
  const free = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && !occupied.has(key(x, y));

  const ahead = free(c.x + DX[c.dir], c.y + DY[c.dir]);
  if (ahead && (c.x * 7 + c.y * 13 + c.trail.length) % 29 !== 0) return c.dir;

  const room = (d: Dir) => {
    let n = 0;
    let x = c.x, y = c.y;
    while (n < 14) {
      x += DX[d]; y += DY[d];
      if (!free(x, y)) break;
      n++;
    }
    return n;
  };
  const left = ((c.dir + 3) % 4) as Dir;
  const right = ((c.dir + 1) % 4) as Dir;
  const rl = room(left);
  const rr = room(right);
  if (rl === 0 && rr === 0) return c.dir; // doomed; carry on
  return rl >= rr ? left : right;
}

export function createMode(): GameMode<GridState> {
  return {
    id: 'freeplay-gridcycles',
    name: 'Grid Cycles',
    kind: 'freeplay',
    blurb: 'Walled arena, 90° turns, rivals lay wall too · drive over data nodes to prune stale context · boost = a write you approved',

    init(w, h): GridState {
      const cols = Math.max(20, Math.floor(w / CELL));
      const rows = Math.max(20, Math.floor(h / CELL));
      const player = spawn(cols, rows, 0, VAPOR.cyan);
      const rivals = [
        spawn(cols, rows, 1, VAPOR.magenta),
        spawn(cols, rows, 2, VAPOR.violet),
      ];
      const occupied = new Set<number>();
      occupied.add(key(player.x, player.y));
      for (const r of rivals) occupied.add(key(r.x, r.y));
      return {
        w, h, cols, rows, player, rivals, nodes: [],
        occupied, speed: BASE_CPS, moveAcc: 0,
        collected: 0, rivalsDown: 0,
        crashed: false, finished: false, boostT: 0,
        tick: 0, intents: [],
      };
    },

    step(state, input: GameInput, tel: TelemetryFrame, dtRaw): GridState {
      if (state.crashed || state.finished) return state;
      const dt = Math.max(0, Math.min(dtRaw, 0.05));
      const s: GridState = {
        ...state,
        tick: state.tick + 1,
        intents: [],
        player: { ...state.player, trail: state.player.trail.slice() },
        rivals: state.rivals.map((r) => ({ ...r, trail: r.trail.slice() })),
        nodes: state.nodes.slice(),
        occupied: new Set(state.occupied),
      };

      for (const ev of tel.events) {
        if (ev.type === 'boost') s.boostT = BOOST_TIME;
        // Every tool call leaves a data node to sweep up.
        if (ev.type === 'tool' || ev.type === 'error') {
          const nx = 2 + ((s.tick * 37) % (s.cols - 4));
          const ny = 2 + ((s.tick * 53) % (s.rows - 4));
          if (!s.occupied.has(key(nx, ny))) s.nodes.push({ x: nx, y: ny });
        }
      }

      // Free-play: the pilot's own throttle drives pace, with a small nudge from throughput so the
      // arena still breathes with the engine.
      const target = BASE_CPS + input.throttle * 16 + Math.min(tel.snapshot.tokensPerSec, 40) * 0.22;
      s.speed += (target - s.speed) * Math.min(1, dt * 3);
      if (s.boostT > 0) s.boostT = Math.max(0, s.boostT - dt);
      const cps = Math.min(MAX_CPS, s.speed * (s.boostT > 0 ? 1.7 : 1));

      // Steering: 90° only, with a short cooldown so a held stick doesn't spin the cycle.
      s.player.cool = Math.max(0, s.player.cool - dt);
      if (s.player.cool <= 0) {
        let want: Dir | null = null;
        if (input.left || input.steer < -0.5) want = 3;
        else if (input.right || input.steer > 0.5) want = 1;
        else if (input.up || input.moveY < -0.5) want = 0;
        else if (input.down || input.moveY > 0.5) want = 2;
        // No instant reversals.
        if (want !== null && want !== ((s.player.dir + 2) % 4)) {
          if (want !== s.player.dir) {
            s.player.dir = want;
            s.player.cool = TURN_COOLDOWN;
          }
        }
      }

      // Discrete grid stepping.
      s.moveAcc += cps * dt;
      let steps = 0;
      while (s.moveAcc >= 1 && steps < 4) {
        s.moveAcc -= 1;
        steps++;

        // Rivals decide, then everyone advances simultaneously.
        for (const r of s.rivals) {
          if (!r.alive) continue;
          r.dir = rivalThink(r, s.occupied, s.cols, s.rows);
        }

        const movers: Cycle[] = [s.player, ...s.rivals];
        for (const c of movers) {
          if (!c.alive) continue;
          const nx = c.x + DX[c.dir];
          const ny = c.y + DY[c.dir];
          const outside = nx < 0 || ny < 0 || nx >= s.cols || ny >= s.rows;
          if (outside || s.occupied.has(key(nx, ny))) {
            c.alive = false;
            if (c === s.player) return { ...s, crashed: true };
            s.rivalsDown += 1;
            continue;
          }
          c.x = nx; c.y = ny;
          c.trail.push(nx, ny);
          s.occupied.add(key(nx, ny));

          if (c === s.player) {
            // Sweep up a data node — real work: one stale context item pruned.
            const hit = s.nodes.findIndex((n) => n.x === nx && n.y === ny);
            if (hit >= 0) {
              s.nodes.splice(hit, 1);
              s.collected += 1;
              s.intents.push({ type: 'prune-stale' });
            }
          }
        }
      }

      if (!s.player.alive) return { ...s, crashed: true };
      if (s.rivals.every((r) => !r.alive)) return { ...s, finished: true };
      return s;
    },

    render(ctx, s, w, h) {
      // Deep violet arena with a neon floor.
      // Flat near-black field. A vertical gradient here lit the bottom of the arena and made the
      // playfield read as unbalanced when it isn't — the arena is symmetric, so its ground should be.
      ctx.fillStyle = VAPOR.deep;
      ctx.fillRect(0, 0, w, h);

      // Arena floor grid.
      ctx.strokeStyle = 'rgba(138,79,255,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= s.cols; x += 4) { ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, s.rows * CELL); }
      for (let y = 0; y <= s.rows; y += 4) { ctx.moveTo(0, y * CELL); ctx.lineTo(s.cols * CELL, y * CELL); }
      ctx.stroke();

      // Arena wall.
      ctx.lineWidth = 2;
      ctx.strokeStyle = VAPOR.magenta;
      neon(ctx, VAPOR.magenta, 14, () => ctx.strokeRect(1, 1, s.cols * CELL - 2, s.rows * CELL - 2));

      // Data nodes.
      for (const n of s.nodes) {
        const px = n.x * CELL + CELL / 2;
        const py = n.y * CELL + CELL / 2;
        const pulse = 0.6 + Math.sin(s.tick * 0.15 + n.x) * 0.3;
        ctx.fillStyle = `rgba(139,247,255,${pulse})`;
        neon(ctx, VAPOR.cyan, 12, () => { ctx.beginPath(); ctx.arc(px, py, CELL * 0.5, 0, Math.PI * 2); ctx.fill(); });
      }

      const drawCycle = (c: Cycle) => {
        if (c.trail.length >= 4) {
          ctx.strokeStyle = c.alive ? c.color : 'rgba(90,90,90,0.5)';
          ctx.lineWidth = CELL * 0.7;
          ctx.lineJoin = 'round';
          const path = () => {
            ctx.beginPath();
            ctx.moveTo(c.trail[0] * CELL + CELL / 2, c.trail[1] * CELL + CELL / 2);
            for (let i = 2; i < c.trail.length; i += 2) {
              ctx.lineTo(c.trail[i] * CELL + CELL / 2, c.trail[i + 1] * CELL + CELL / 2);
            }
            ctx.stroke();
          };
          if (c.alive) neon(ctx, c.color, 12, path); else path();
        }
        if (c.alive) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(c.x * CELL, c.y * CELL, CELL, CELL);
        }
      };
      for (const r of s.rivals) drawCycle(r);
      drawCycle(s.player);
      drawScanlines(ctx, w, h, 0.05);

      if (s.crashed || s.finished) {
        ctx.fillStyle = 'rgba(0,0,0,0.58)';
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.fillStyle = s.finished ? '#52A77C' : '#E05252';
        ctx.font = 'bold 38px system-ui, sans-serif';
        ctx.fillText(s.finished ? 'ARENA CLEAR' : 'DEREZZED', w / 2, h / 2 - 4);
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = '#9A9A9A';
        ctx.fillText(`${s.collected} node${s.collected === 1 ? '' : 's'} swept · ${s.rivalsDown} rival${s.rivalsDown === 1 ? '' : 's'} down`, w / 2, h / 2 + 22);
      }
    },

    score: (s) => s.collected * 100 + s.rivalsDown * 250,
    isOver: (s) => s.crashed || s.finished,

    hud(s) {
      if (s.crashed) return `DEREZZED · ${s.collected} nodes`;
      if (s.finished) return `CLEAR · ${s.collected} nodes`;
      return `${s.collected} nodes · ${s.rivalsDown} down · ${Math.round(s.speed)} c/s`;
    },
  };
}
