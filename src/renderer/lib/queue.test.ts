import { describe, it, expect } from 'vitest';
import { askSummary, buildQueue, TURN_MAX } from './queue';
import type { LiveRequest, LiveSession } from '../../main/live';

const now = 1_000_000_000;
const s = (id: string, status: string, ago: number): LiveSession =>
  ({ sessionId: id, name: id, cwd: `/p/${id}`, status, entrypoint: 'claude-desktop', updatedAt: now - ago });
const r = (sessionId: string, toolName: string, toolInput: Record<string, unknown>, ts = now): LiveRequest =>
  ({ id: `${sessionId}-${ts}`, sessionId, cwd: '/p', toolName, toolInput, suggestions: [], ts });

describe('Home\'s queue', () => {
  it('orders what needs the pilot: answers, then their turn, then work in progress', () => {
    const q = buildQueue({
      live: [s('busy', 'busy', 10), s('idle', 'idle', 60_000), s('asks', 'busy', 5), s('old', 'idle', 3 * 86_400_000)],
      requests: [r('asks', 'Bash', { command: 'npm test' })],
      relay: 1,
    }, null, now);
    expect(q.needs.map((e) => [e.session.sessionId, e.ask])).toEqual([['asks', '$ npm test']]);
    expect(q.turn.map((e) => e.session.sessionId)).toEqual(['idle']);
    expect(q.working.map((e) => e.session.sessionId)).toEqual(['busy']);
    expect(q.quiet).toBe(1);
  });

  it('puts the longest-waiting question first, and leaves out the session open here', () => {
    const q = buildQueue({
      live: [s('a', 'busy', 1), s('b', 'busy', 2), s('open', 'busy', 3)],
      requests: [r('a', 'Bash', { command: 'x' }, now), r('b', 'Bash', { command: 'y' }, now - 50), r('open', 'Bash', { command: 'z' })],
      relay: 1,
    }, 'open', now);
    expect(q.needs.map((e) => e.session.sessionId)).toEqual(['b', 'a']);
  });

  it('shows a handful of recent turns and counts the rest', () => {
    const live = Array.from({ length: TURN_MAX + 3 }, (_, i) => s(`i${i}`, 'idle', i * 1000));
    const q = buildQueue({ live, requests: [], relay: 1 }, null, now);
    expect(q.turn).toHaveLength(TURN_MAX);
    expect(q.quiet).toBe(3);
  });

  it('heads a request the way the card does', () => {
    expect(askSummary(r('a', 'Edit', { file_path: '/repo/src/app.ts' }))).toBe('Edit app.ts');
    expect(askSummary(r('a', 'AskUserQuestion', { questions: [{ question: 'Which database?' }] }))).toBe('Which database?');
    expect(askSummary(r('a', 'mcp__github__create_issue', {}))).toBe('create_issue');
  });
});
