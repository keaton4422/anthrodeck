// Every Remote Control session on the pilot's account, on any computer, the way the Claude phone
// app sees them: listed by the Deck's own Remote Control session (main/rclink), with their status,
// and messageable. A message arrives in that session as a message from another session, and Claude
// there answers back the same way; those answers are the conversation the Deck shows. The full
// transcript and approval cards stay with computers AnthroDeck reaches over SSH (main/live.ts).

import { HUB_NAME } from './rclink/mod';

export interface RcSession {
  ref: string;            // Remote Control's short id, "fa1763"
  name: string;
  status: 'busy' | 'idle' | 'offline';
}

export interface RcEntry { id: string; role: 'user' | 'assistant' | 'peer'; text: string; at: number }

const LINK_NAMES = new Set([HUB_NAME, 'anthrodeck-deck']);

// ListAgents' rows: "  Name [fa1763]  ·  Remote Control  ·  idle  ·  …". Only the Remote Control
// ones: cloud sessions can't answer, and this session's own machine has none worth listing.
export function parseRcSessions(listing: string): RcSession[] {
  const out: RcSession[] = [];
  for (const line of listing.split('\n')) {
    const m = /^\s+(.+?) \[([0-9a-f]{4,})\]\s+·\s+([^·]+?)\s+·\s+(\S+)/.exec(line);
    if (!m || m[3].trim() !== 'Remote Control' || LINK_NAMES.has(m[1])) continue;
    const st = m[4];
    out.push({ name: m[1], ref: m[2], status: st === 'offline' ? 'offline' : st === 'idle' ? 'idle' : 'busy' });
  }
  // Working first, then idle, offline last; the listing's own order (most recent) within each.
  const rank = { busy: 0, idle: 1, offline: 2 } as const;
  return out.map((s, i) => [s, i] as const).sort((a, b) => rank[a[0].status] - rank[b[0].status] || a[1] - b[1]).map(([s]) => s);
}

// A cross-session message's own text, without Claude Code's envelope around it.
export function unwrap(text: string): string {
  return text.replace(/<\/?cross-session-message[^>]*>/g, '').trim();
}

// The conversations: what the pilot sent each session, and what came back. An answer is matched to
// its session by the short id in its envelope if there is one, else by the address it came from
// once known, else it goes to the session the pilot messaged last.
export class RcChats {
  private chats = new Map<string, RcEntry[]>();
  private byAddress = new Map<string, string>();
  private lastSent: string | null = null;
  private seq = 0;

  constructor(private onChange: (ref: string, entries: RcEntry[]) => void, private now = () => Date.now()) {}

  get(ref: string): RcEntry[] { return this.chats.get(ref) ?? []; }

  sent(ref: string, text: string): string {
    const id = `rc${++this.seq}`;
    this.add(ref, { id, role: 'user', text, at: this.now() });
    this.lastSent = ref;
    return id;
  }

  undelivered(id: string, reason: string): void {
    for (const [ref, list] of this.chats) {
      if (list.some((e) => e.id === id)) this.add(ref, { id: `${id}x`, role: 'peer', text: `Not delivered: ${reason}`, at: this.now() });
    }
  }

  received(from: string | null, raw: string, known: RcSession[]): void {
    const ref = known.find((s) => raw.includes(`[${s.ref}]`))?.ref
      ?? (from ? this.byAddress.get(from) : undefined)
      ?? this.lastSent;
    if (!ref) return;
    if (from) this.byAddress.set(from, ref);
    this.add(ref, { id: `rc${++this.seq}`, role: 'assistant', text: unwrap(raw), at: this.now() });
  }

  private add(ref: string, e: RcEntry): void {
    const list = [...this.get(ref), e].slice(-100);
    this.chats.set(ref, list);
    this.onChange(ref, list);
  }
}
