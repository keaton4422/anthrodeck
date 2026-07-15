// Cockpit game layer — shared contracts.
//
// A GameMode is a PURE headless simulation (`init` + `step`) plus a thin `render`. Keeping step()
// free of canvas/DOM is what lets every mode be unit-tested deterministically. Telemetry-driven
// ("cockpit") modes read live agent state so that playing them IS monitoring the engine; free-play
// modes ignore telemetry and just fill the long-turn wait.

// Continuous, per-frame view of what the Claude engine is doing.
export interface TelemetrySnapshot {
  streaming: boolean;
  tokensPerSec: number;   // live output throughput → maps to "speed" in cockpit modes
  sessionTokens: number;  // cumulative
  toolActive: boolean;    // a tool ran very recently
}

// Discrete engine events the game consumes this frame.
export type TelemetryEvent =
  | { type: 'tool' }      // a tool call happened   → hazard / wall
  | { type: 'error' }     // the turn errored       → damage
  | { type: 'done' }      // turn completed         → finish line
  | { type: 'thinking' }  // thinking tokens flowed → shimmer
  | { type: 'boost' }     // pilot approved a write → speed burst
  | { type: 'crash' };    // pilot aborted the run  → crash

export interface TelemetryFrame {
  snapshot: TelemetrySnapshot;
  events: TelemetryEvent[];
}

export const EMPTY_TELEMETRY: TelemetryFrame = {
  snapshot: { streaming: false, tokensPerSec: 0, sessionTokens: 0, toolActive: false },
  events: [],
};

// Normalized controller/keyboard input for one frame.
export interface GameInput {
  steer: number;     // -1 (left) .. 1 (right) — left-stick X
  moveY: number;     // -1 (up) .. 1 (down) — left-stick Y
  throttle: number;  // 0 .. 1
  brake: number;     // 0 .. 1
  aimX: number;      // -1 .. 1 (right-stick / twin-stick aim)
  aimY: number;      // -1 .. 1
  fire: boolean;
  boost: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export const NEUTRAL_INPUT: GameInput = {
  steer: 0, moveY: 0, throttle: 0, brake: 0, aimX: 0, aimY: 0,
  fire: false, boost: false, up: false, down: false, left: false, right: false,
};

export interface GameMode<S = unknown> {
  id: string;
  name: string;
  kind: 'telemetry' | 'freeplay';
  blurb: string;
  init(width: number, height: number): S;
  // Pure: given prior state + input + telemetry + elapsed seconds, return the next state.
  step(state: S, input: GameInput, tel: TelemetryFrame, dt: number): S;
  render(ctx: CanvasRenderingContext2D, state: S, width: number, height: number): void;
  // Short status line for the overlay HUD (score / speed / state).
  hud(state: S): string;
}
