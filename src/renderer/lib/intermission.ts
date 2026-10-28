// Intermission: the games are part of the session, not a separate feature. While Claude works and
// nothing needs the pilot, the cockpit game comes up by itself once the controls have been put down
// for a moment; a card from any session pauses it (App), and when a session finishes the game stops
// on a card that offers to go straight there. Like the Claude Code mods that open a game while
// Claude is busy and end it the moment Claude is ready or needs you.
//
// The sessions counted are every one the Deck can fly: its own, and the ones running live on the
// remote computer (main/live.ts). Pure, so it unit-tests; App holds the state.

export interface Job {
  id: string;             // 'deck' for the Deck's own session, else the live session's id
  label: string;          // the session's title, as Home shows it
  remote: boolean;
  working: boolean;
  needs?: number;         // its approvals and questions waiting on the pilot
  said?: string | null;   // the last thing Claude said in it
  tool?: string | null;   // what it's running right now, when that's the latest thing it did
}

// ─── The comms rail: every session beside the game ───────────────────────────
// Each session's state in the pilot's terms: it needs an answer, it's working, or it finished and
// it's the pilot's turn to tell it what's next.
export type Turn = 'needs-you' | 'working' | 'your-turn';

export function turnOf(j: Job): Turn {
  if (j.needs) return 'needs-you';
  return j.working ? 'working' : 'your-turn';
}

// The end of what Claude said, as plain text: that's where its question or its summary sits.
export function lastWords(text: string, max = 300): string {
  const plain = text.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/[*_#>]/g, '')
    .replace(/\s+/g, ' ').trim();
  return plain.length <= max ? plain : `…${plain.slice(-max).replace(/^\S*\s/, '')}`;
}

// The rail's order: what needs the pilot first, then finished sessions waiting for orders, then the
// ones still working; most recent first within each (the order the jobs came in).
const RANK: Record<Turn, number> = { 'needs-you': 0, 'your-turn': 1, working: 2 };
export function railOrder(jobs: Job[]): Job[] {
  return jobs.map((j, i) => ({ j, i })).sort((a, b) => RANK[turnOf(a.j)] - RANK[turnOf(b.j)] || a.i - b.i).map((x) => x.j);
}

// Y moves the selection down the rail, wrapping; a selection that left the rail falls to the top.
export function nextSelection(rail: Job[], current: string | null): string | null {
  if (!rail.length) return null;
  const i = rail.findIndex((j) => j.id === current);
  return rail[(i + 1) % rail.length].id;
}

// How long the controls rest, with Claude working, before the game comes up.
export const START_AFTER_MS = 5000;

export interface StartCheck {
  enabled: boolean;
  jobs: Job[];
  needsYou: boolean;      // a card is up: answer that first
  idleMs: number;         // since the pilot last touched the controls or the keyboard
  busyScreen: boolean;    // typing, Settings, the folder picker, the radial: never take those over
  playing: boolean;
  dismissed: Set<string>; // jobs that were working when the pilot last closed the game
}

// Start when something is working that wasn't already when the pilot closed the game: closing it
// means "not now" until another session starts working (or the same one starts its next turn).
export function shouldStart(c: StartCheck): boolean {
  if (!c.enabled || c.playing || c.needsYou || c.busyScreen || c.idleMs < START_AFTER_MS) return false;
  return c.jobs.some((j) => j.working && !c.dismissed.has(j.id));
}

// Sessions that were working and now aren't: each gets the "done" card.
export function finished(prev: Job[], next: Job[]): Job[] {
  const now = new Map(next.map((j) => [j.id, j]));
  return prev.filter((j) => j.working && !now.get(j.id)?.working).map((j) => now.get(j.id) ?? { ...j, working: false });
}

// The ids still in the "not now" set: a job leaves it once it stops working, so its next turn
// can bring the game back.
export function stillDismissed(dismissed: Set<string>, jobs: Job[]): Set<string> {
  const working = new Set(jobs.filter((j) => j.working).map((j) => j.id));
  return new Set([...dismissed].filter((id) => working.has(id)));
}

// ─── Tidying up by playing ────────────────────────────────────────────────────
// Every stale-context target cleared in a game (the `prune-stale` intent) counts toward a tidy-up
// of the Deck's own session. Once the pilot has cleared enough while the context is filling up,
// a compaction is queued and runs the moment Claude finishes its turn: Claude Code can't compact
// mid-turn, and it costs a model call, so it happens only because the pilot played for it.

export const TIDY_FROM_PCT = 50;   // below this there's nothing worth tidying
export const TIDY_HITS = 8;        // targets to clear for one compaction

export interface Tidy { hits: number; queued: boolean }

export function tidyHit(t: Tidy, contextPct: number | null): Tidy {
  if (t.queued || contextPct === null || contextPct < TIDY_FROM_PCT) return t;
  const hits = t.hits + 1;
  return { hits, queued: hits >= TIDY_HITS };
}

// What Claude Code is told to keep and drop when the pilot's tidy-up runs.
export const TIDY_COMPACT = '/compact Keep the current task, decisions made, and open questions. Drop superseded tool output, dead ends and exploration that is no longer needed.';
