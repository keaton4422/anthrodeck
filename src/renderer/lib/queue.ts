// Home's queue: the sessions on the other computer in the order they need the pilot. First the
// ones waiting on an answer (a permission prompt or a question), then the ones where it's the
// pilot's turn (Claude finished and is idle), most recent first, then the ones Claude is working in.
//
// Pure so it unit-tests; Home feeds it the live state the link reports.

import type { LiveRequest, LiveSession, LiveState } from '../../main/live';

export interface QueueEntry {
  session: LiveSession;
  // What's being asked, in a line: "$ npm test", "Edit src/app.ts", the question itself.
  ask: string | null;
  waiting: number;           // how many answers it's waiting on
}

export interface Queue {
  needs: QueueEntry[];
  turn: QueueEntry[];
  working: QueueEntry[];
  quiet: number;             // idle sessions left out of `turn` because nothing happened in them lately
}

export const TURN_WINDOW_MS = 24 * 3600_000;
export const TURN_MAX = 6;

// One line for a waiting request, the way the approval card heads it.
export function askSummary(req: LiveRequest): string {
  const input = req.toolInput ?? {};
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null);
  if (req.toolName === 'Bash') return `$ ${str('command') ?? ''}`.trim();
  if (req.toolName === 'AskUserQuestion') {
    const qs = input.questions as { question?: unknown }[] | undefined;
    const q = Array.isArray(qs) && typeof qs[0]?.question === 'string' ? qs[0].question : null;
    return q ?? 'Claude has a question';
  }
  if (req.toolName === 'ExitPlanMode') return 'Claude\'s plan is ready for you';
  const file = str('file_path') ?? str('notebook_path') ?? str('path');
  if (file) return `${req.toolName} ${file.split(/[\\/]/).filter(Boolean).pop()}`;
  if (str('url')) return `${req.toolName} ${str('url')}`;
  return req.toolName.replace(/^mcp__[^_]+__/, '');
}

export function buildQueue(state: LiveState | null, exclude: string | null, now = Date.now()): Queue {
  const empty: Queue = { needs: [], turn: [], working: [], quiet: 0 };
  if (!state) return empty;
  const asks = new Map<string, LiveRequest[]>();
  for (const r of [...state.requests].sort((a, b) => a.ts - b.ts)) {
    asks.set(r.sessionId, [...(asks.get(r.sessionId) ?? []), r]);
  }
  const q = empty;
  const recent = [...state.live].filter((s) => s.sessionId !== exclude).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const session of recent) {
    const reqs = asks.get(session.sessionId) ?? [];
    const entry = { session, ask: reqs[0] ? askSummary(reqs[0]) : null, waiting: reqs.length };
    if (reqs.length) q.needs.push(entry);
    else if (session.status === 'busy') q.working.push(entry);
    else if (now - session.updatedAt < TURN_WINDOW_MS && q.turn.length < TURN_MAX) q.turn.push(entry);
    else q.quiet += 1;
  }
  // Oldest question first: it has waited longest.
  q.needs.sort((a, b) => (asks.get(a.session.sessionId)![0].ts - asks.get(b.session.sessionId)![0].ts));
  return q;
}
