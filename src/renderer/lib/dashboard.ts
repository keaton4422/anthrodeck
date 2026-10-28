// Home's cockpit readout: the few numbers worth a glance before picking what to fly next. Each one
// says what needs doing (answer Claude, ship work, mind the plan's limits), never vanity counts.
//
// Pure so it unit-tests; Home feeds it the project lists of both computers and the live state.

import type { LiveState } from '../../main/live';
import type { PitWall, PlanUsage } from '../types';

export interface DashboardStats {
  needsYou: number;                                   // approvals and questions waiting
  running: { working: number; idle: number } | null;  // live sessions on the remote computer (null: none set up)
  unshipped: { files: number; projects: number; toPush: number };
  today: { sessions: number; projects: number };
}

export function dashboardStats(walls: (PitWall | null)[], live: LiveState | null, now = Date.now()): DashboardStats {
  const projects = walls.flatMap((w) => w?.projects ?? []);
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const dirty = projects.filter((p) => p.git && (p.git.changes || p.git.ahead));
  const todays = projects.map((p) => p.sessions.filter((s) => s.lastModified >= midnight.getTime()).length);
  return {
    needsYou: live?.requests.length ?? 0,
    running: live ? {
      working: live.live.filter((s) => s.status === 'busy').length,
      idle: live.live.filter((s) => s.status !== 'busy').length,
    } : null,
    unshipped: {
      files: dirty.reduce((n, p) => n + (p.git?.changes ?? 0), 0),
      projects: dirty.length,
      toPush: dirty.reduce((n, p) => n + (p.git?.ahead ?? 0), 0),
    },
    today: { sessions: todays.reduce((a, b) => a + b, 0), projects: todays.filter(Boolean).length },
  };
}

// "resets in 2h 10m", "resets in 40m", "resets Thu"
export function resetsIn(at: number | null, now = Date.now()): string {
  if (at === null) return '';
  const m = Math.max(0, Math.round((at - now) / 60_000));
  if (m < 60) return `resets in ${m}m`;
  if (m < 24 * 60) return `resets in ${Math.floor(m / 60)}h ${m % 60}m`;
  return `resets ${new Date(at).toLocaleDateString(undefined, { weekday: 'short' })}`;
}

// The window closest to its limit leads: that's the one that can stop work.
export function planHeadline(u: PlanUsage): { label: string; used: number; resetsAt: number | null } | null {
  const wins = [
    u.fiveHour && { label: '5-hour limit', ...u.fiveHour },
    u.week && { label: 'Weekly limit', ...u.week },
  ].filter(Boolean) as { label: string; used: number; resetsAt: number | null }[];
  if (!wins.length) return null;
  return wins.reduce((a, b) => (b.used > a.used ? b : a));
}
