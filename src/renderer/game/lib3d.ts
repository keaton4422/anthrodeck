// Minimal software 3D for the flight cockpit. A whole 3D engine would dwarf the app's bundle, and
// the goal here is depth and speed cues, not a renderer — a perspective divide and a painter's-
// algorithm sort get us there. Pure, so the projection is unit-testable.

export interface Projected {
  x: number;      // screen px
  y: number;      // screen px
  scale: number;  // world→screen factor at that depth (also drives size + fade)
  visible: boolean;
}

export const NEAR = 1;

// Project a point given in CAMERA space (dz = depth ahead of the camera) onto the screen.
export function project(
  dx: number, dy: number, dz: number,
  w: number, h: number, fov = 420,
): Projected {
  if (dz <= NEAR) {
    return { x: w / 2, y: h / 2, scale: 0, visible: false };
  }
  const scale = fov / dz;
  return { x: w / 2 + dx * scale, y: h / 2 + dy * scale, scale, visible: true };
}

// Depth fade: things far away wash into the background instead of popping.
export function depthAlpha(dz: number, far: number): number {
  if (dz <= 0) return 0;
  const a = 1 - dz / far;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

// Deterministic PRNG so a given seed always yields the same course — makes the flight sim
// reproducible in tests and identical across a restart.
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}

// Steer `cur` toward `target` by at most `maxDelta` — the autopilot's control law, and the same
// helper the pilot's input is blended through.
export function approach(cur: number, target: number, maxDelta: number): number {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
