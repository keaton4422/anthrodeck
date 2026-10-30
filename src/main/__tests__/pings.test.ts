import { describe, it, expect } from 'vitest';
import { news } from '../pings';
import type { LiveRequest, LiveSession, LiveState } from '../live';

const s = (id: string, status: string): LiveSession =>
  ({ sessionId: id, name: `Session ${id}`, cwd: '/p', status, entrypoint: 'cli', updatedAt: 0 });
const r = (id: string, sessionId: string): LiveRequest =>
  ({ id, sessionId, cwd: '/p', toolName: 'Bash', toolInput: {}, suggestions: [], ts: 0 });
const state = (live: LiveSession[], requests: LiveRequest[] = []): LiveState => ({ live, requests, relay: 1 });

describe('pings while a Steam game is on screen', () => {
  it('says nothing the first time, then names a session that asks or finishes', () => {
    let n = news(null, state([s('a', 'busy'), s('b', 'busy')]));
    expect(n.ping).toBeNull();
    n = news(n.heard, state([s('a', 'busy'), s('b', 'busy')], [r('q1', 'b')]));
    expect(n.ping).toBe('Session b needs you');
    n = news(n.heard, state([s('a', 'busy'), s('b', 'busy')], [r('q1', 'b')]));
    expect(n.ping).toBeNull();                       // the same question again is not news
    n = news(n.heard, state([s('a', 'idle'), s('b', 'busy')], [r('q1', 'b')]));
    expect(n.ping).toBe('Session a finished');
  });

  it('doesn\'t call a session that went away "finished"', () => {
    const first = news(null, state([s('a', 'busy')]));
    expect(news(first.heard, state([])).ping).toBeNull();
  });
});
