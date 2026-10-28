import { describe, expect, it } from 'vitest';
import { dashboardStats, planHeadline, resetsIn } from './dashboard';
import type { PitWall } from '../types';

const now = new Date(2026, 9, 27, 15, 0).getTime();
const today = new Date(2026, 9, 27, 9, 0).getTime();
const yesterday = new Date(2026, 9, 26, 22, 0).getTime();
const session = (lastModified: number) => ({ id: String(lastModified), title: 't', project: 'p', cwd: '/p', branch: null, lastModified });

describe('dashboard', () => {
  it('adds up both computers: unshipped work, today\'s sessions, and what the live sessions need', () => {
    const deck: PitWall = { currentId: null, projects: [
      { cwd: '/a', name: 'a', lastModified: today, sessions: [session(today), session(yesterday)], git: { branch: 'main', ahead: 2, behind: 0, changes: 0 } },
      { cwd: '/b', name: 'b', lastModified: yesterday, sessions: [session(yesterday)], git: { branch: 'main', ahead: 0, behind: 1, changes: 0 } },
    ] };
    const mac: PitWall = { currentId: null, projects: [
      { cwd: '/c', name: 'c', lastModified: today, sessions: [session(today), session(today)], git: { branch: 'x', ahead: 0, behind: 0, changes: 7 } },
      { cwd: '/d', name: 'd', lastModified: today, sessions: [], git: null },
    ] };
    const live = {
      relay: 1,
      live: [
        { sessionId: '1', name: null, cwd: '/c', status: 'busy', entrypoint: 'claude-desktop', updatedAt: 0 },
        { sessionId: '2', name: null, cwd: '/c', status: 'idle', entrypoint: 'claude-desktop', updatedAt: 0 },
        { sessionId: '3', name: null, cwd: '/c', status: 'idle', entrypoint: 'cli', updatedAt: 0 },
      ],
      requests: [{ id: 'r', sessionId: '1', cwd: '/c', toolName: 'Bash', toolInput: {}, suggestions: [], ts: 0 }],
    };
    expect(dashboardStats([deck, mac], live, now)).toEqual({
      needsYou: 1,
      running: { working: 1, idle: 2 },
      unshipped: { files: 7, projects: 2, toPush: 2 },
      today: { sessions: 3, projects: 2 },
    });
    expect(dashboardStats([deck, null], null, now).running).toBeNull();
  });

  it('says when a limit resets, and leads with the window closest to its limit', () => {
    expect(resetsIn(now + 40 * 60_000, now)).toBe('resets in 40m');
    expect(resetsIn(now + 130 * 60_000, now)).toBe('resets in 2h 10m');
    expect(resetsIn(null, now)).toBe('');
    expect(planHeadline({ fiveHour: { used: 0.13, resetsAt: 1 }, week: { used: 0.29, resetsAt: 2 }, limited: false, at: 0 }, 0))
      .toEqual({ label: 'Weekly limit', used: 0.29, resetsAt: 2, limited: false });
    expect(planHeadline({ fiveHour: { used: 0.8, resetsAt: 1 }, week: null, limited: false, at: 0 }, 0)?.label).toBe('5-hour limit');
  });

  it('counts a window past its reset as empty again, and its limit as lifted', () => {
    const u = { fiveHour: { used: 1, resetsAt: now - 1 }, week: { used: 0.4, resetsAt: now + 3600_000 }, limited: true, at: now - 7200_000 };
    expect(planHeadline(u, now)).toEqual({ label: 'Weekly limit', used: 0.4, resetsAt: now + 3600_000, limited: false });
    expect(planHeadline({ ...u, fiveHour: { used: 1, resetsAt: now + 60_000 } }, now)).toMatchObject({ label: '5-hour limit', limited: true });
  });
});
