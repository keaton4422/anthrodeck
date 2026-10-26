// The career: XP, pilot ranks and achievements earned from building real software. It belongs to
// the cockpit as a whole, not to any one game, so its names are plain: what you actually did.
//
// The one rule: points come from outcomes, never from activity. Tokens burned, tools called and
// minutes spent are worth nothing. A finished task, a green test run, a commit, a push — those
// score. That is what keeps the game honest: the fastest way up the ladder is to ship.
//
// Pure (no React, no storage) so every rule is unit-tested.

import type { Confidence, Milestone } from '../types';

export type SeasonEvent =
  | { type: 'lap'; confidence: Confidence | null; isError: boolean }   // a turn finished
  | { type: 'sector'; total: number; completed: number }               // a task completed
  | { type: 'milestone'; kind: Milestone }
  | { type: 'edit-approved' }
  | { type: 'question-answered' };

export interface SeasonStats {
  laps: number;
  sectors: number;
  greenRuns: number;
  redFlags: number;
  builds: number;
  commits: number;
  pushes: number;
  approvals: number;
  answers: number;
  grandsPrix: number;
}

export interface SeasonState {
  xp: number;
  stats: SeasonStats;
  unlocked: string[];
  cleanStreak: number;     // consecutive laps without an error
  bestStreak: number;
  sectorsThisLap: number;
  redFlagOut: boolean;     // last test run failed — the next green one is a recovery
}

export const NEW_SEASON: SeasonState = {
  xp: 0,
  stats: { laps: 0, sectors: 0, greenRuns: 0, redFlags: 0, builds: 0, commits: 0, pushes: 0, approvals: 0, answers: 0, grandsPrix: 0 },
  unlocked: [],
  cleanStreak: 0,
  bestStreak: 0,
  sectorsThisLap: 0,
  redFlagOut: false,
};

export const XP = {
  lap: 10,
  confidentLap: 5,       // bonus for a high-confidence finish
  sector: 25,
  green: 40,
  recovery: 30,          // bonus: green after red
  build: 15,
  commit: 50,
  push: 75,
  approval: 5,
  answer: 5,
  grandPrix: 100,        // every sector of a 3+ sector plan done
} as const;

export interface Achievement { id: string; name: string; blurb: string }

export const ACHIEVEMENTS: Achievement[] = [
  // Ids are what the saved career stores, so they keep their original names; only the labels change.
  { id: 'first-lap', name: 'First Response', blurb: 'Finish your first turn with Claude.' },
  { id: 'first-sector', name: 'First Task', blurb: 'Complete a task from Claude\'s task list.' },
  { id: 'green-flag', name: 'Tests Passing', blurb: 'Get a test run passing.' },
  { id: 'recovery', name: 'Back to Green', blurb: 'Turn a failing test run green.' },
  { id: 'parc-ferme', name: 'First Commit', blurb: 'Commit your work.' },
  { id: 'podium', name: 'First Push', blurb: 'Push to a remote.' },
  { id: 'hat-trick', name: 'Three Tasks', blurb: 'Three tasks done in one turn.' },
  { id: 'clean-five', name: 'Clean Streak', blurb: 'Five turns in a row without an error.' },
  { id: 'grand-prix', name: 'Full Task List', blurb: 'Finish every task of a 3+ task list.' },
  { id: 'pit-wall', name: 'Ten Answers', blurb: 'Answer ten of Claude\'s questions.' },
  { id: 'ship-ten', name: 'Ten Commits', blurb: 'Ten commits.' },
];

// Pilot ranks. Thresholds grow so each step means more shipped work.
export const TIERS = [
  { name: 'Cadet', minLevel: 1 },
  { name: 'Pilot', minLevel: 3 },
  { name: 'Senior Pilot', minLevel: 5 },
  { name: 'Flight Lead', minLevel: 7 },
  { name: 'Commander', minLevel: 10 },
  { name: 'Ace', minLevel: 15 },
] as const;

// XP needed to *reach* a level: 0, 100, 250, 450, … (each level costs 50 more than the last).
export function xpForLevel(level: number): number {
  const n = Math.max(0, level - 1);
  return 25 * n * (n + 3);
}

export function levelFor(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function tierFor(level: number): string {
  let name: string = TIERS[0].name;
  for (const t of TIERS) if (level >= t.minLevel) name = t.name;
  return name;
}

// Progress through the current level, 0..1, for the HUD bar.
export function levelProgress(xp: number): number {
  const lvl = levelFor(xp);
  const lo = xpForLevel(lvl);
  const hi = xpForLevel(lvl + 1);
  return hi > lo ? (xp - lo) / (hi - lo) : 0;
}

export interface SeasonUpdate {
  state: SeasonState;
  gained: number;
  unlocked: Achievement[];
  levelUp: number | null;  // the new level, when this event crossed one
}

export function applySeason(prev: SeasonState, ev: SeasonEvent): SeasonUpdate {
  const s: SeasonState = { ...prev, stats: { ...prev.stats }, unlocked: [...prev.unlocked] };
  let gained = 0;

  switch (ev.type) {
    case 'lap': {
      s.stats.laps += 1;
      if (ev.isError) {
        s.cleanStreak = 0;
      } else {
        gained += XP.lap + (ev.confidence === 'high' ? XP.confidentLap : 0);
        s.cleanStreak += 1;
        s.bestStreak = Math.max(s.bestStreak, s.cleanStreak);
      }
      s.sectorsThisLap = 0;
      break;
    }
    case 'sector': {
      s.stats.sectors += 1;
      s.sectorsThisLap += 1;
      gained += XP.sector;
      if (ev.total >= 3 && ev.completed === ev.total) {
        s.stats.grandsPrix += 1;
        gained += XP.grandPrix;
      }
      break;
    }
    case 'milestone': {
      switch (ev.kind) {
        case 'tests-pass':
          s.stats.greenRuns += 1;
          gained += XP.green + (s.redFlagOut ? XP.recovery : 0);
          break;
        case 'tests-fail':
          s.stats.redFlags += 1;
          break;
        case 'build-pass':
          s.stats.builds += 1;
          gained += XP.build;
          break;
        case 'commit':
          s.stats.commits += 1;
          gained += XP.commit;
          break;
        case 'push':
          s.stats.pushes += 1;
          gained += XP.push;
          break;
        default: break;
      }
      break;
    }
    case 'edit-approved':
      s.stats.approvals += 1;
      gained += XP.approval;
      break;
    case 'question-answered':
      s.stats.answers += 1;
      gained += XP.answer;
      break;
  }

  // Recovery is judged against the flag as it stood BEFORE this event.
  const recovered = ev.type === 'milestone' && ev.kind === 'tests-pass' && prev.redFlagOut;
  if (ev.type === 'milestone' && (ev.kind === 'tests-pass' || ev.kind === 'tests-fail')) {
    s.redFlagOut = ev.kind === 'tests-fail';
  }

  const earned: Record<string, boolean> = {
    'first-lap': ev.type === 'lap' && !ev.isError,
    'first-sector': s.stats.sectors >= 1,
    'green-flag': s.stats.greenRuns >= 1,
    recovery: recovered,
    'parc-ferme': s.stats.commits >= 1,
    podium: s.stats.pushes >= 1,
    'hat-trick': s.sectorsThisLap >= 3,
    'clean-five': s.cleanStreak >= 5,
    'grand-prix': s.stats.grandsPrix >= 1,
    'pit-wall': s.stats.answers >= 10,
    'ship-ten': s.stats.commits >= 10,
  };
  const unlocked = ACHIEVEMENTS.filter((a) => earned[a.id] && !s.unlocked.includes(a.id));
  s.unlocked.push(...unlocked.map((a) => a.id));

  const before = levelFor(prev.xp);
  s.xp = prev.xp + gained;
  const after = levelFor(s.xp);

  return { state: s, gained, unlocked, levelUp: after > before ? after : null };
}

// ─── The lap log ──────────────────────────────────────────────────────────────
// What one turn actually achieved, for the lap card and for the checkpoint strip when Claude
// didn't lay out a plan. It only repeats outcomes the season already scored; it never adds XP.
export interface Checkpoint { label: string; good: boolean }

export interface LapLog {
  xp: number;
  checkpoints: Checkpoint[];
}

export const EMPTY_LAP: LapLog = { xp: 0, checkpoints: [] };

const CHECKPOINT: Partial<Record<Milestone | 'edit-approved' | 'question-answered', Checkpoint>> = {
  'edit-approved': { label: 'Edit', good: true },
  'question-answered': { label: 'Answered', good: true },
  'tests-pass': { label: 'Tests green', good: true },
  'tests-fail': { label: 'Tests red', good: false },
  'build-pass': { label: 'Build', good: true },
  'build-fail': { label: 'Build failed', good: false },
  commit: { label: 'Commit', good: true },
  push: { label: 'Push', good: true },
};

// Folds one scored event into the running lap. A 'lap' event closes it: the caller keeps the
// returned log as the finished lap and starts the next from EMPTY_LAP.
export function logLap(log: LapLog, ev: SeasonEvent, gained: number): LapLog {
  const key = ev.type === 'milestone' ? ev.kind : ev.type;
  const cp = CHECKPOINT[key as keyof typeof CHECKPOINT];
  return {
    xp: log.xp + gained,
    checkpoints: cp ? [...log.checkpoints, cp] : log.checkpoints,
  };
}

// Tolerate whatever an older build (or a hand-edited store) left behind.
export function loadSeason(raw: unknown): SeasonState {
  if (!raw || typeof raw !== 'object') return NEW_SEASON;
  const r = raw as Partial<SeasonState>;
  return {
    ...NEW_SEASON,
    ...r,
    xp: typeof r.xp === 'number' && r.xp >= 0 ? r.xp : 0,
    stats: { ...NEW_SEASON.stats, ...(r.stats ?? {}) },
    unlocked: Array.isArray(r.unlocked) ? r.unlocked.filter((x): x is string => typeof x === 'string') : [],
  };
}
