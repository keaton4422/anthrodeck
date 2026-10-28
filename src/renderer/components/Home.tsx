import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { LiveSession, Machine, PitWall, ProjectTile, RemoteTarget, SessionCard } from '../types';
import { timeAgo } from '../lib/timeAgo';
import { useLive } from '../hooks/useLive';
import { Logo } from './Logo';

// Home: the launch screen. Every project on this device (the folders Claude Code has worked in)
// with its git state, the sessions run in each, and the session open right now. From here the
// pilot carries on with the current session, resumes an old one to make more changes, or starts a
// new one in any project. Same schema as Claude Desktop, driven like a cockpit.
//
// Built for the pad first: two columns, the D-pad moves (up/down within a column, left/right
// between them), A goes. App forwards pad input through the `HomeNav` handle; arrow keys and Enter
// work too.
//
// With a remote computer set up (Settings → Remote computer), Home switches between "This device"
// and that computer (Y, or the tabs): its projects and sessions, run there over SSH. Its sessions
// running right now (in the Claude app or a terminal) lead the list as LIVE, with what each is doing;
// their approvals and questions pop up as cards wherever the pilot is (main/live.ts). A opens one on
// the live session screen, to follow it and send it messages while it keeps running there.

export interface HomeNav {
  move(dx: number, dy: number): void;
  activate(): void;
  switchMachine(): void;
}

interface Props {
  projectPath: string | null;
  projectHost: string | null;     // the open project's computer (null = this one)
  // The conversation the cockpit has open, if any: offered first as the current session.
  current: { title: string; project: string | null } | null;
  onContinue: () => void;
  onResume: (s: SessionCard, machine: Machine) => void;
  onNew: (cwd: string, machine: Machine) => void;
  onOpenFolder: (machine: Machine) => void;
  onOpenLive: (s: LiveSession) => void;
}

type Item =
  | { kind: 'continue' }
  | { kind: 'live'; session: LiveSession; waiting: number }
  | { kind: 'project'; project: ProjectTile }
  | { kind: 'open' }
  | { kind: 'new'; cwd: string; name: string }
  | { kind: 'session'; session: SessionCard };

const C = {
  panel: '#151515',
  line: '#262626',
  text: '#ECECEC',
  dim: '#8A8A8A',
  faint: '#5E5E5E',
  clay: '#D97757',
  clayBg: 'rgba(217,119,87,0.10)',
  green: '#52A77C',
  amber: '#D9A35B',
};

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
export const liveSource = (entrypoint: string | null) =>
  entrypoint === 'claude-desktop' ? 'Claude app' : entrypoint === 'cli' ? 'terminal' : 'another app';

const Home = forwardRef<HomeNav, Props>(function Home(
  { projectPath, projectHost, current, onContinue, onResume, onNew, onOpenFolder, onOpenLive }, ref,
) {
  const [wall, setWall] = useState<PitWall | null>(null);
  const [col, setCol] = useState(0);
  const [row, setRow] = useState<[number, number]>([0, 0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteTarget | null>(null);
  // Start on the computer the open project is on.
  const [machine, setMachine] = useState<Machine>(projectHost ? 'remote' : 'local');
  const live = useLive();

  useEffect(() => { void window.electronAPI.remoteGet().then(setRemote); }, []);
  useEffect(() => {
    let live = true;
    setWall(null);
    setRow([0, 0]); setCol(0); setSelected(null);
    void window.electronAPI.sessionsList(machine).then((w) => { if (live) setWall(w); });
    return () => { live = false; };
  }, [machine]);

  // Is this path the open project, on the computer being shown?
  const isOpen = useCallback((cwd: string) =>
    cwd === projectPath && (machine === 'remote') === !!projectHost, [projectPath, projectHost, machine]);
  const where = machine === 'remote' && remote ? remote.label : 'this device';

  // The open project leads even if it has no sessions yet, so "new session here" is one press.
  const projects = useMemo<ProjectTile[]>(() => {
    const list = wall?.projects ?? [];
    if (projectPath && (machine === 'remote') === !!projectHost && !list.some((p) => p.cwd === projectPath)) {
      return [{ cwd: projectPath, name: folderName(projectPath), lastModified: 0, sessions: [], git: null }, ...list];
    }
    return list;
  }, [wall, projectPath, projectHost, machine]);

  // Live now on the remote computer, apart from the session the Deck itself has open.
  const liveItems = useMemo<Item[]>(() => {
    if (machine !== 'remote' || !live?.state) return [];
    const reqs = live.state.requests;
    return live.state.live
      .filter((s) => s.sessionId !== wall?.currentId)
      .map((session) => ({ kind: 'live', session, waiting: reqs.filter((r) => r.sessionId === session.sessionId).length } as Item));
  }, [machine, live, wall]);

  const left = useMemo<Item[]>(() => [
    ...(current ? [{ kind: 'continue' } as Item] : []),
    ...liveItems,
    ...projects.map((project) => ({ kind: 'project', project } as Item)),
    { kind: 'open' } as Item,
  ], [current, liveItems, projects]);

  // The right column shows the project under the cursor; otherwise the last one visited, then the
  // open project (so the current session sits beside its own project's list), then the most recent.
  const focusedLeft = left[Math.min(row[0], left.length - 1)];
  const shownProject = useMemo(() => {
    if (focusedLeft?.kind === 'project') return focusedLeft.project;
    return projects.find((p) => p.cwd === selected)
      ?? projects.find((p) => isOpen(p.cwd))
      ?? projects[0] ?? null;
  }, [focusedLeft, projects, selected, isOpen]);
  useEffect(() => { if (focusedLeft?.kind === 'project') setSelected(focusedLeft.project.cwd); }, [focusedLeft]);

  const right = useMemo<Item[]>(() => shownProject ? [
    { kind: 'new', cwd: shownProject.cwd, name: shownProject.name } as Item,
    ...shownProject.sessions.map((session) => ({ kind: 'session', session } as Item)),
  ] : [], [shownProject]);

  const columns = [left, right];

  const activate = useCallback((item: Item | undefined) => {
    if (!item) return;
    if (item.kind === 'continue') onContinue();
    else if (item.kind === 'open') onOpenFolder(machine);
    else if (item.kind === 'new') onNew(item.cwd, machine);
    else if (item.kind === 'session') onResume(item.session, machine);
    else if (item.kind === 'live') onOpenLive(item.session);
    else if (item.kind === 'project') { setCol(1); setRow((r) => [r[0], 0]); }
  }, [onContinue, onOpenFolder, onNew, onResume, onOpenLive, machine]);

  const stateRef = useRef({ col, row, columns });
  stateRef.current = { col, row, columns };

  // One set of moves for the pad (through the HomeNav handle) and the keyboard.
  const nav = useMemo<HomeNav>(() => ({
    move(dx, dy) {
      const { col: c, row: r, columns: cols } = stateRef.current;
      if (dx) {
        const next = Math.max(0, Math.min(1, c + dx));
        if (next !== c && cols[next].length) { setCol(next); if (next === 1) setRow([r[0], 0]); }
        return;
      }
      const len = cols[c].length;
      if (!len) return;
      const i = Math.max(0, Math.min(len - 1, r[c] + dy));
      setRow(c === 0 ? [i, r[1]] : [r[0], i]);
    },
    activate() {
      const { col: c, row: r, columns: cols } = stateRef.current;
      activate(cols[c][r[c]]);
    },
    switchMachine() {
      if (remote) setMachine((m) => (m === 'local' ? 'remote' : 'local'));
    },
  }), [activate, remote]);
  useImperativeHandle(ref, () => nav, [nav]);

  // Keyboard, for the desktop and a Bluetooth keyboard.
  useEffect(() => {
    const keys: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
      if (keys[e.key]) { e.preventDefault(); nav.move(...keys[e.key]); }
      else if (e.key === 'Enter') { e.preventDefault(); nav.activate(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  const isFocused = (c: number, i: number) => col === c && row[c] === i;

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '22px 28px 16px', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Logo height={30} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.18em', color: C.text }}>HOME</div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>
            Projects and sessions on {where}. D-pad to move, A to open, B back to the current session.
          </div>
        </div>
        {remote && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {(['local', 'remote'] as const).map((m) => (
              <button key={m} onClick={() => setMachine(m)} style={{
                padding: '6px 12px', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontWeight: 600,
                border: `1px solid ${machine === m ? C.clay : C.line}`,
                background: machine === m ? C.clayBg : C.panel, color: machine === m ? C.clay : C.dim,
              }}>
                {m === 'local' ? 'This device' : `💻 ${remote.label}`}
              </button>
            ))}
            <span style={{ fontSize: 11, color: C.faint, marginLeft: 4 }}>Y to switch</span>
          </div>
        )}
      </div>

      {machine === 'remote' && !wall && (
        <div style={{ fontSize: 13, color: C.dim }}>Connecting to {remote?.label ?? 'your other computer'}…</div>
      )}

      {/* Sessions live on the machine they ran on, so a fresh Deck has none: say so plainly. */}
      {wall && !wall.error && !wall.projects.some((p) => p.sessions.length) && (
        <div style={{
          fontSize: 13, color: C.dim, lineHeight: 1.55, padding: '10px 12px', borderRadius: 8,
          border: `1px solid ${C.line}`, background: C.panel,
        }}>
          {machine === 'remote'
            ? <>No Claude Code sessions on {where} yet. Open one of its folders to start the first one.</>
            : <>No Claude Code sessions on this device yet. Sessions stay on the machine they ran on, so ones
              from your other computers won&apos;t show up here{remote ? <> (press Y for {remote.label})</> : null}.
              Open a project folder to start the first one.</>}
        </div>
      )}

      {wall?.error && (
        <div style={{ fontSize: 12, color: C.amber }}>Couldn&apos;t read Claude Code&apos;s sessions on {where}: {wall.error}</div>
      )}

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 7fr)', gap: 18, minHeight: 0 }}>
        {/* Projects */}
        <Column title="PROJECTS">
          {left.map((item, i) => {
            const focused = isFocused(0, i);
            if (item.kind === 'continue' && current) {
              return (
                <Row key="continue" focused={focused} accent onClick={() => activate(item)}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: C.clay }}>CURRENT SESSION</div>
                  <div style={{ fontSize: 14, color: C.text, marginTop: 3 }}>{current.title}</div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
                    {current.project ?? 'No project'} · A to continue
                  </div>
                </Row>
              );
            }
            if (item.kind === 'live') {
              const s = item.session;
              const busy = s.status === 'busy';
              return (
                <Row key={`live-${s.sessionId}`} focused={focused} accent onClick={() => { setCol(0); setRow([i, row[1]]); activate(item); }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: item.waiting ? C.amber : busy ? C.green : C.faint,
                    }} />
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: item.waiting ? C.amber : C.clay }}>
                      {item.waiting ? 'NEEDS YOU' : busy ? 'LIVE · WORKING' : 'LIVE · IDLE'}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, color: C.text, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name || folderName(s.cwd)}
                  </div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
                    {folderName(s.cwd)} · {liveSource(s.entrypoint)} · A to open
                  </div>
                </Row>
              );
            }
            if (item.kind === 'project') {
              const p = item.project;
              const open = p.cwd === shownProject?.cwd;
              return (
                <Row key={p.cwd} focused={focused} selected={open && col === 1} onClick={() => { setCol(0); setRow([i, row[1]]); }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{p.name}</span>
                    {isOpen(p.cwd) && <Tag>open</Tag>}
                  </div>
                  <GitLine project={p} />
                </Row>
              );
            }
            return (
              <Row key="open" focused={focused} onClick={() => activate(item)}>
                <div style={{ fontSize: 14, color: C.dim }}>＋ Open another folder</div>
              </Row>
            );
          })}
        </Column>

        {/* Sessions in the project under the cursor */}
        <Column title={shownProject ? `SESSIONS · ${shownProject.name.toUpperCase()}` : 'SESSIONS'}>
          {!shownProject && (
            <div style={{ fontSize: 13, color: C.faint, padding: '10px 4px', lineHeight: 1.6 }}>
              No projects on this device yet. Open a project folder to start the first session.
            </div>
          )}
          {right.map((item, i) => {
            const focused = isFocused(1, i);
            if (item.kind === 'new') {
              return (
                <Row key="new" focused={focused} accent onClick={() => activate(item)}>
                  <div style={{ fontSize: 14, color: C.text }}>＋ New session in {item.name}</div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>A fresh Claude Code session in this folder</div>
                </Row>
              );
            }
            if (item.kind === 'session') {
              const s = item.session;
              const isCurrent = s.id === wall?.currentId;
              return (
                <Row key={s.id} focused={focused} onClick={() => activate(item)}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 14, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.title}
                    </span>
                    {isCurrent && <Tag>current</Tag>}
                  </div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
                    {s.branch ? `⎇ ${s.branch} · ` : ''}{timeAgo(s.lastModified)} · A to resume
                  </div>
                </Row>
              );
            }
            return null;
          })}
        </Column>
      </div>
    </div>
  );
});

export default Home;

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: C.faint, margin: '0 4px 8px' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', paddingRight: 4 }}>{children}</div>
    </div>
  );
}

function Row({ focused, selected, accent, onClick, children }: {
  focused: boolean; selected?: boolean; accent?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  const el = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (focused) el.current?.scrollIntoView({ block: 'nearest' }); }, [focused]);
  return (
    <button
      ref={el}
      onClick={onClick}
      style={{
        textAlign: 'left', width: '100%', cursor: 'pointer', borderRadius: 8, padding: '10px 12px',
        background: focused ? C.clayBg : accent ? '#181512' : C.panel,
        border: `1px solid ${focused ? C.clay : selected ? '#4A3A33' : C.line}`,
        boxShadow: focused ? `inset 3px 0 0 ${C.clay}` : 'none',
        color: C.text, font: 'inherit', flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.clay,
      border: `1px solid ${C.clay}`, borderRadius: 3, padding: '0 5px', flexShrink: 0,
    }}>
      {children}
    </span>
  );
}

function GitLine({ project }: { project: ProjectTile }) {
  const g = project.git;
  const bits: React.ReactNode[] = [];
  if (g) {
    bits.push(<span key="b">⎇ {g.branch ?? 'detached'}</span>);
    bits.push(g.changes
      ? <span key="c" style={{ color: C.amber }}>{g.changes} uncommitted</span>
      : <span key="c" style={{ color: C.green }}>clean</span>);
    if (g.ahead) bits.push(<span key="a">↑{g.ahead} to push</span>);
    if (g.behind) bits.push(<span key="d">↓{g.behind} behind</span>);
  } else {
    bits.push(<span key="n">not a git repo</span>);
  }
  bits.push(<span key="s">{project.sessions.length
    ? `${project.sessions.length} session${project.sessions.length === 1 ? '' : 's'} · ${timeAgo(project.lastModified)}`
    : 'no sessions yet'}</span>);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 12, color: C.dim, marginTop: 4 }}>
      {bits}
    </div>
  );
}
