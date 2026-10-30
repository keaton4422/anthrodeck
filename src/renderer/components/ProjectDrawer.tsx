import React, { useEffect, useState } from 'react';
import type { Machine, ProjectActivity } from '../types';
import { timeAgo } from '../lib/timeAgo';

// The drawer: what's been happening in the projects Claude has worked in lately, on the other
// computer and on this Deck. For each, its branch and what isn't committed or pushed, the latest
// release tag and how much has landed since, and the last few commits (main/activity.ts).

interface Props {
  open: boolean;
  onClose: () => void;
  otherComputer: string | null;    // the remote computer set up in Settings, if any
  onShare: () => void;
}

interface Group { machine: Machine; label: string; projects: ProjectActivity[]; error: string | null }

const C = { line: '#2A2A2A', dim: '#8A8A8A', faint: '#5A5A5A', text: '#ECECEC', accent: '#CC785C', ok: '#6FBF73', warn: '#E0A458' };

async function load(machine: Machine, label: string): Promise<Group> {
  const list = await window.electronAPI.sessionsList(machine);
  const cwds = (list.projects ?? []).map((p) => p.cwd).slice(0, 8);
  if (!cwds.length) return { machine, label, projects: [], error: list.error ?? null };
  const r = await window.electronAPI.activityGet(machine, cwds);
  return { machine, label, projects: r.projects, error: r.error };
}

export default function ProjectDrawer({ open, onClose, otherComputer, onShare }: Props) {
  const [groups, setGroups] = useState<Group[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const wanted: [Machine, string][] = [...(otherComputer ? [['remote', otherComputer] as [Machine, string]] : []), ['local', 'This Deck']];
    void Promise.all(wanted.map(([m, l]) => load(m, l).catch((e: Error) => ({ machine: m, label: l, projects: [], error: e.message }))))
      .then((g) => { if (live) setGroups(g); });
    return () => { live = false; };
  }, [open, otherComputer]);

  return (
    <>
      {open && <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.5)' }} />}
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: 440, maxWidth: '100vw', zIndex: 50,
        background: '#141414', borderRight: `1px solid ${C.line}`,
        transform: open ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.22s ease',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${C.line}` }}>
          <span style={{ color: C.accent, fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>ACTIVITY</span>
          <span style={{ color: C.faint, fontSize: 12, marginLeft: 10 }}>commits and releases in your projects</span>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#777', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 18px' }}>
          {!groups && <div style={{ color: C.dim, fontSize: 14, padding: '18px 0' }}>Reading git…</div>}
          {groups?.map((g) => (g.projects.length > 0 || g.error) && (
            <div key={g.machine}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: C.faint, margin: '16px 0 8px' }}>{g.label.toUpperCase()}</div>
              {g.error && <div style={{ color: C.warn, fontSize: 13 }}>{g.error}</div>}
              {g.projects.map((p) => <ProjectCard key={p.cwd} p={p} />)}
            </div>
          ))}
          {groups && groups.every((g) => !g.projects.length && !g.error) && (
            <div style={{ color: C.dim, fontSize: 14, padding: '18px 0' }}>No git projects in your recent sessions.</div>
          )}
        </div>

        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.line}` }}>
          <button onClick={onShare} style={{
            width: '100%', padding: '10px', borderRadius: 8, border: `1px solid ${C.line}`, background: '#1A1A1A',
            color: C.dim, fontSize: 13, cursor: 'pointer',
          }}>Share a preview of the app you're building</button>
        </div>
      </div>
    </>
  );
}

function ProjectCard({ p }: { p: ProjectActivity }) {
  const { git, release } = p;
  const state = [
    git.changes > 0 && { text: `${git.changes} uncommitted`, color: C.warn },
    git.ahead > 0 && { text: `${git.ahead} to push`, color: C.warn },
    git.behind > 0 && { text: `${git.behind} behind`, color: C.dim },
  ].filter(Boolean) as { text: string; color: string }[];
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid #1E1E1E' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: C.text, fontSize: 16, fontWeight: 600 }}>{p.name}</span>
        <span style={{ color: C.faint, fontSize: 12 }}>{git.branch ?? 'detached'}</span>
        {p.today > 0 && <span style={{ marginLeft: 'auto', color: C.ok, fontSize: 12 }}>{p.today} today</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 13, marginTop: 4, color: C.dim }}>
        {release
          ? <span>{release.tag} · {timeAgo(release.at)}{release.since > 0 ? ` · ${release.since} since` : ' · up to date'}</span>
          : <span>no releases</span>}
        {state.length ? state.map((s) => <span key={s.text} style={{ color: s.color }}>{s.text}</span>) : <span style={{ color: C.ok }}>clean</span>}
      </div>
      {p.commits.slice(0, 3).map((c) => (
        <div key={c.hash} style={{ display: 'flex', gap: 8, fontSize: 13, marginTop: 5 }}>
          <span style={{ color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</span>
          <span style={{ color: C.faint, flexShrink: 0 }}>{timeAgo(c.at)}</span>
        </div>
      ))}
    </div>
  );
}
