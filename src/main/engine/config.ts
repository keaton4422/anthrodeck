// Engine configuration: everything the cockpit is allowed to tune on Claude Code, normalized from
// whatever came off IPC or out of electron-store. Pure — no Electron, no SDK — so it unit-tests.

// Claude Code model aliases. Aliases (not dated ids) so the Deck tracks whatever Claude Code
// currently means by "sonnet" without an AnthroDeck release.
export const MODELS = ['sonnet', 'opus', 'haiku'] as const;
export type ModelAlias = (typeof MODELS)[number];
export const DEFAULT_MODEL: ModelAlias = 'sonnet';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = 'high';

// Drive modes are Claude Code permission modes, named for the wheel:
//   plan        — formation lap: Claude explores and proposes, touches nothing
//   default     — race: every edit and command comes to the pilot for a yes/no
//   acceptEdits — push: edits land on their own, commands still ask
// bypassPermissions and the classifier-backed `auto` are deliberately not offered: a handheld
// whose face buttons approve things should never have a mode where nothing asks.
export const DRIVE_MODES = ['plan', 'default', 'acceptEdits'] as const;
export type DriveMode = (typeof DRIVE_MODES)[number];
export const DEFAULT_DRIVE_MODE: DriveMode = 'default';

export const DRIVE_MODE_LABELS: Record<DriveMode, string> = {
  plan: 'Formation lap',
  default: 'Race',
  acceptEdits: 'Push',
};

// Earlier builds stored dated model ids. Map them onto the alias for the same tier so a pilot's
// saved choice survives the upgrade instead of silently resetting.
const LEGACY_MODELS: Record<string, ModelAlias> = {
  'claude-sonnet-5': 'sonnet',
  'claude-opus-4-8': 'opus',
  'claude-haiku-4-5': 'haiku',
};

export function normalizeModel(v: unknown): ModelAlias {
  if (typeof v !== 'string') return DEFAULT_MODEL;
  if ((MODELS as readonly string[]).includes(v)) return v as ModelAlias;
  return LEGACY_MODELS[v] ?? DEFAULT_MODEL;
}

export function normalizeEffort(v: unknown): Effort {
  return typeof v === 'string' && (EFFORTS as readonly string[]).includes(v) ? (v as Effort) : DEFAULT_EFFORT;
}

export function normalizeDriveMode(v: unknown): DriveMode {
  return typeof v === 'string' && (DRIVE_MODES as readonly string[]).includes(v)
    ? (v as DriveMode)
    : DEFAULT_DRIVE_MODE;
}

// Next mode clockwise — what the mode-cycle chord does.
export function nextDriveMode(m: DriveMode): DriveMode {
  return DRIVE_MODES[(DRIVE_MODES.indexOf(m) + 1) % DRIVE_MODES.length];
}

export interface EngineSettings {
  model: ModelAlias;
  effort: Effort;
  thinking: boolean;
  mode: DriveMode;
  teachMode: boolean;
  teachTimeout: number;
}

export function resolveEngineSettings(raw: Record<string, unknown> | null | undefined): EngineSettings {
  const r = raw ?? {};
  const timeout = typeof r.teachTimeout === 'number' && r.teachTimeout >= 0 ? r.teachTimeout : 5;
  return {
    model: normalizeModel(r.model),
    effort: normalizeEffort(r.effort),
    thinking: !!r.thinking,
    mode: normalizeDriveMode(r.mode),
    teachMode: !!r.teachMode,
    teachTimeout: timeout,
  };
}

// Appended to Claude Code's own system prompt — never replacing it. Claude Code's prompt is the
// harness; this only tells it about the cockpit it is being driven from.
export const COCKPIT_PROMPT = `You are being driven from AnthroDeck, a gamepad cockpit on a Steam Deck. The person at the wheel is the pilot.
- Keep prose short: it is read on a 7-inch screen, often mid-game.
- For any job with more than one step, create a task list before you start and keep it updated as you go. Each task is a sector on the pilot's lap timer, so make tasks concrete, finishable and few (3-6).
- When a cheap question now saves wasted work later, ask it with AskUserQuestion (2-4 options). The pilot answers with face buttons.
- End every turn with a self-assessed confidence tag on its own final line: <confidence>high</confidence>, <confidence>med</confidence>, or <confidence>low</confidence>. Nothing after it.`;

export type Confidence = 'high' | 'med' | 'low';

// Pull the trailing <confidence> tag off the turn's final text.
export function parseConfidence(text: string): { confidence: Confidence | null; cleaned: string } {
  const re = /\s*<confidence>\s*(high|medium|med|low)\s*<\/confidence>\s*$/i;
  const m = text.match(re);
  if (!m || m.index === undefined) return { confidence: null, cleaned: text };
  const raw = m[1].toLowerCase();
  const confidence: Confidence = raw === 'high' ? 'high' : raw === 'low' ? 'low' : 'med';
  return { confidence, cleaned: text.slice(0, m.index).replace(/\s+$/, '') };
}

// First sentence (or a capped prefix) of the model's narration — the one-line "why" teach mode
// shows before a tool runs.
export function firstSentence(text: string, cap = 160): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^.*?[.!?](\s|$)/);
  const first = (m ? m[0] : trimmed).trim();
  return first.length > cap ? `${first.slice(0, cap - 1).trimEnd()}…` : first;
}
