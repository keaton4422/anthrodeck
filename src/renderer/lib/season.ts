// The career: XP, a driver ladder and achievements earned from building real software.
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
  { id: 'first-lap', name: 'Lights Out', blurb: 'Finish your first lap with Claude.' },
  { id: 'first-sector', name: 'Purple Sector', blurb: 'Complete a task from Claude\'s plan.' },
  { id: 'green-flag', name: 'Green Flag', blurb: 'Get a test run passing.' },
  { id: 'recovery', name: 'Safety Car In', blurb: 'Turn a failing test run green.' },
  { id: 'parc-ferme', name: 'Parc Fermé', blurb: 'Commit your work.' },
  { id: 'podium', name: 'Podium', blurb: 'Push to a remote.' },
  { id: 'hat-trick', name: 'Hat-Trick', blurb: 'Three sectors in a single lap.' },
  { id: 'clean-five', name: 'Clean Air', blurb: 'Five laps in a row without an error.' },
  { id: 'grand-prix', name: 'Grand Prix', blurb: 'Finish every sector of a 3+ task plan.' },
  { id: 'pit-wall', name: 'Pit Wall', blurb: 'Answer ten of Claude\'s questions.' },
  { id: 'ship-ten', name: 'Constructor', blurb: 'Ten commits.' },
];

// Career ladder. Thresholds grow so each step means more shipped work.
export const TIERS = [
  { name: 'Karting', minLevel: 1 },
  { name: 'F4', minLevel: 3 },
  { name: 'F3', minLevel: 5 },
  { name: 'F2', minLevel: 7 },
  { name: 'F1', minLevel: 10 },
  { name: 'World Champion', minLevel: 15 },
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
