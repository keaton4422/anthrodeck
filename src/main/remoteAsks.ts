// Prompts and finished turns from any computer with the AnthroDeck plugin for Claude Code
// (plugins/anthrodeck), arriving over Remote Control through the Deck's own session (main/rclink).
//
// A prompt becomes the same cards the SSH relay's do (livePrompt in main/live.ts), asked one at a
// time; the pilot's picks go back to that session as a decision. A prompt settled on its own
// computer first ("settled") takes its card away. A finished turn is passed on to be shown.

import { livePrompt, type LiveCard, type LiveRequest, type RelayDecision } from './live';

export interface RemoteAsksDeps {
  ask: (card: LiveCard & { id: string }, signal: AbortSignal) => Promise<string>;
  answer: (to: string, id: string, decision: RelayDecision) => void;
  // A prompt arrived, or a turn finished (with what Claude said), on `name`.
  onAsk: (name: string) => void;
  onDone: (name: string, text: string) => void;
}

interface Pending { from: string; req: LiveRequest; name: string }

const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export class RemoteAsks {
  private queue: Pending[] = [];
  private asking: { id: string; abort: AbortController } | null = null;

  constructor(private deps: RemoteAsksDeps) {}

  receive(from: string, body: Record<string, unknown>): void {
    const id = str(body.id);
    const name = str(body.name) || folder(str(body.cwd)) || 'A session';
    if (body.t === 'ask' && id) {
      if (this.queue.some((p) => p.req.id === id) || this.asking?.id === id) return;
      this.queue.push({
        from, name,
        req: {
          id, sessionId: str(body.sid), cwd: str(body.cwd), toolName: str(body.tool) || 'a tool',
          toolInput: (body.input && typeof body.input === 'object' ? body.input : {}) as Record<string, unknown>,
          suggestions: Array.isArray(body.suggestions) ? body.suggestions : [], ts: Date.now(),
        },
      });
      this.deps.onAsk(name);
      void this.next();
    } else if (body.t === 'settled' && id) {
      this.queue = this.queue.filter((p) => p.req.id !== id);
      if (this.asking?.id === id) this.asking.abort.abort();
    } else if (body.t === 'done') {
      const text = str(body.text).trim();
      if (text) this.deps.onDone(name, text);
    }
  }

  private async next(): Promise<void> {
    if (this.asking) return;
    const p = this.queue.shift();
    if (!p) return;
    const abort = new AbortController();
    this.asking = { id: p.req.id, abort };
    try {
      const prompt = livePrompt(p.req, `${p.name} · on another computer`);
      const picks: string[] = [];
      for (const [i, card] of prompt.cards.entries()) {
        const pick = await this.deps.ask({ ...card, id: `rc-${p.req.id}-${i}` }, abort.signal);
        if (abort.signal.aborted || !pick) return;     // settled there, or withdrawn here: never answer for the pilot
        picks.push(pick);
      }
      if (prompt.cards.length) this.deps.answer(p.from, p.req.id, prompt.decide(picks));
    } finally {
      this.asking = null;
      void this.next();
    }
  }
}
