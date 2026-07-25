// Visual harness for the cockpit game layer. Runs every registered mode side by side against
// synthetic input + telemetry so rendering, motion, and event mapping can be eyeballed (and NaN /
// frozen-state bugs caught) without launching Electron or owning a controller.
//
// Run: npx vite tools/gamelab --port 5199

import { GAME_MODES } from '../../src/renderer/game/registry';
import { NEUTRAL_INPUT, type GameInput, type TelemetryEvent, type TelemetryFrame } from '../../src/renderer/game/types';

const grid = document.getElementById('grid')!;

interface Cell {
  mode: (typeof GAME_MODES)[number];
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  hud: HTMLElement;
  warn: HTMLElement;
  state: unknown;
  frames: number;
  pending: TelemetryEvent[];
}

const cells: Cell[] = GAME_MODES.map((mode) => {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.innerHTML = `
    <div class="bar">
      <span class="name">${mode.name}</span>
      <span style="color:#666">${mode.kind}</span>
      <span class="warn"></span>
      <span class="hud"></span>
    </div>
    <div class="wrap"><canvas width="1280" height="640"></canvas></div>`;
  grid.appendChild(cell);

  const canvas = cell.querySelector('canvas') as HTMLCanvasElement;
  return {
    mode,
    canvas,
    ctx: canvas.getContext('2d')!,
    hud: cell.querySelector('.hud') as HTMLElement,
    warn: cell.querySelector('.warn') as HTMLElement,
    state: mode.init(canvas.width, canvas.height),
    frames: 0,
    pending: [],
  };
});

// Scripted "pilot": a gentle steering weave with throttle and fire held, so every mode gets
// meaningful input without a controller attached.
function scriptedInput(t: number): GameInput {
  return {
    ...NEUTRAL_INPUT,
    steer: Math.sin(t * 0.8) * 0.85,
    moveY: Math.cos(t * 0.6) * 0.5,
    throttle: 1,
    aimX: Math.cos(t * 1.3),
    aimY: Math.sin(t * 1.3),
    fire: true,
  };
}

// Synthetic engine telemetry: a streaming agent whose throughput oscillates, emitting a tool call
// every ~1.5s and an occasional error.
function scriptedTelemetry(t: number, drained: TelemetryEvent[]): TelemetryFrame {
  return {
    snapshot: {
      streaming: true,
      tokensPerSec: 25 + Math.sin(t * 0.5) * 20,
      sessionTokens: Math.floor(t * 400),
      toolActive: false,
    },
    events: drained,
  };
}

let elapsed = 0;
let toolAcc = 0;

function advance(dt: number) {
  elapsed += dt;

  // Fire a tool event on a cadence, and an error every 5th.
  toolAcc += dt;
  let tick: TelemetryEvent | null = null;
  if (toolAcc >= 1.5) {
    toolAcc = 0;
    tick = Math.random() < 0.25 ? { type: 'error' } : { type: 'tool' };
  }

  for (const cell of cells) {
    if (tick) cell.pending.push(tick);
    const tel = scriptedTelemetry(elapsed, cell.pending);
    cell.pending = [];

    cell.state = cell.mode.step(cell.state as never, scriptedInput(elapsed), tel, dt);
    cell.mode.render(cell.ctx, cell.state as never, cell.canvas.width, cell.canvas.height);
    cell.frames++;

    const hud = cell.mode.hud(cell.state as never);
    cell.hud.textContent = `${hud} · ${cell.frames}f`;

    // Surface obviously-broken states so a screenshot is enough to catch them.
    const s = cell.state as Record<string, unknown>;
    const bad: string[] = [];
    for (const key of ['x', 'y', 'speed', 'carX', 'shipX', 'shipY', 'score', 'distance']) {
      const v = s[key];
      if (typeof v === 'number' && !Number.isFinite(v)) bad.push(key);
    }
    if (hud.includes('NaN')) bad.push('hud');
    cell.warn.textContent = bad.length ? `NaN: ${bad.join(',')}` : '';

    // Auto-restart terminal states so the lab keeps exercising the sim.
    if ((s.crashed || s.finished || s.gameOver) && cell.frames % 1 === 0) {
      if (!cell.warn.dataset.deadFrames) cell.warn.dataset.deadFrames = '0';
      const d = Number(cell.warn.dataset.deadFrames) + 1;
      cell.warn.dataset.deadFrames = String(d);
      if (d > 90) {
        cell.state = cell.mode.init(cell.canvas.width, cell.canvas.height);
        cell.warn.dataset.deadFrames = '0';
      }
    }
  }
}

// rAF drives it when the page is visible...
let last = performance.now();
function frame(now: number) {
  advance(Math.min(0.05, (now - last) / 1000));
  last = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ...and this lets a headless driver step it deterministically (rAF is paused in non-composited
// tabs, so automated verification can't rely on it).
declare global {
  interface Window {
    __lab: {
      tick: (frames?: number, dt?: number) => void;
      reset: () => void;
      states: () => Record<string, unknown>[];
    };
  }
}
window.__lab = {
  tick(frames = 60, dt = 1 / 60) {
    for (let i = 0; i < frames; i++) advance(dt);
  },
  reset() {
    elapsed = 0;
    toolAcc = 0;
    for (const c of cells) {
      c.state = c.mode.init(c.canvas.width, c.canvas.height);
      c.frames = 0;
      c.pending = [];
    }
  },
  states: () => cells.map((c) => ({ name: c.mode.name, ...(c.state as Record<string, unknown>) })),
};
