// Pure input mapping for the Phase 5 button map: L1 chords and the radial menu. Kept out of the
// polling hook so the mapping rules are unit-testable without a gamepad.

export type FaceButton = 'A' | 'B' | 'X' | 'Y';

export type ChordAction = 'git-status' | 'git-commit' | 'run-tests' | 'undo-write';

// L1 held + face button = meta action. Deliberately mirrors the on-screen legend.
export const CHORD_MAP: Record<FaceButton, ChordAction> = {
  A: 'git-status',
  B: 'git-commit',
  X: 'run-tests',
  Y: 'undo-write',
};

export const CHORD_LABELS: Record<ChordAction, string> = {
  'git-status': 'Git status',
  'git-commit': 'Git commit',
  'run-tests': 'Run tests',
  'undo-write': 'Undo last write',
};

// Returns the chord action when the modifier is held, else null (so the caller falls through to the
// button's normal, unmodified behavior).
export function resolveChord(modifierHeld: boolean, button: FaceButton): ChordAction | null {
  if (!modifierHeld) return null;
  return CHORD_MAP[button] ?? null;
}

// ─── Radial menu ──────────────────────────────────────────────────────────────
export type RadialAction = ChordAction | 'deploy' | 'prune-context';

export const RADIAL_ITEMS: { action: RadialAction; label: string }[] = [
  { action: 'git-status', label: 'Git status' },
  { action: 'run-tests', label: 'Run tests' },
  { action: 'deploy', label: 'Deploy' },
  { action: 'undo-write', label: 'Undo write' },
  { action: 'prune-context', label: 'Prune context' },
];

export const RADIAL_DEADZONE = 0.4;

// Map a stick position to a wedge index. Index 0 is straight up, then clockwise. Returns null
// inside the deadzone so a centered stick selects nothing (release = cancel).
export function radialIndexFromStick(x: number, y: number, count: number): number | null {
  if (count <= 0) return null;
  if (Math.hypot(x, y) < RADIAL_DEADZONE) return null;

  // atan2(x, -y): 0 rad points up, increasing clockwise.
  let angle = Math.atan2(x, -y);
  if (angle < 0) angle += Math.PI * 2;

  const wedge = (Math.PI * 2) / count;
  // Offset by half a wedge so index 0 is *centered* on straight-up.
  const idx = Math.floor((angle + wedge / 2) / wedge);
  return idx % count;
}

// The shell command a chord/radial action runs, or null when the action is handled in-app
// (undo-write and prune-context are IPC/state operations, not shell commands).
export function commandForAction(action: RadialAction): string | null {
  switch (action) {
    case 'git-status': return 'git status --short --branch';
    case 'run-tests': return 'npm test';
    case 'deploy': return 'npm run deploy';
    case 'git-commit': return null;
    case 'undo-write': return null;
    case 'prune-context': return null;
    default: return null;
  }
}
