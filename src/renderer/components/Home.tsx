import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { PitWall, ProjectTile, SessionCard } from '../types';
import { timeAgo } from '../lib/timeAgo';
import { Logo } from './Logo';

// Home: the launch screen. Every project on this device (the folders Claude Code has worked in)
// with its git state, the sessions run in each, and the session open right now. From here the
// pilot carries on with the current session, resumes an old one to make more changes, or starts a
// new one in any project. Same schema as Claude Desktop, driven like a cockpit.
//
// Built for the pad first: two columns, the D-pad moves (up/down within a column, left/right
// between them), A goes. App forwards pad input through the `HomeNav` handle; arrow keys and Enter
// work too.

export interface HomeNav {
  move(dx: number, dy: number): void;
  activate(): void;
}

interface Props {
  projectPath: string | null;
  // The conversation the cockpit has open, if any: offered first as the current session.
  current: { title: string; project: string | null } | null;
  onContinue: () => void;
  onResume: (s: SessionCard) => void;
  onNew: (cwd: string) => void;
  onOpenFolder: () => void;
}

type Item =
  | { kind: 'continue' }
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

const Home = forwardRef<HomeNav, Props>(function Home(
  { projectPath, current, onContinue, onResume, onNew, onOpenFolder }, ref,
) {
  const [wall, setWall] = useState<PitWall | null>(null);
  const [col, setCol] = useState(0);
  const [row, setRow] = useState<[number, number]>([0, 0]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.electronAPI.sessionsList().then((w) => { if (live) setWall(w); });
    return () => { live = false; };
  }, []);

  // The open project leads even if it has no sessions yet, so "new session here" is one press.
  const projects = useMemo<ProjectTile[]>(() => {
    const list = wall?.projects ?? [];
    if (projectPath && !list.some((p) => p.cwd === projectPath)) {
      return [{ cwd: projectPath, name: folderName(projectPath), lastModified: 0, sessions: [], git: null }, ...list];
    }
    return list;
  }, [wall, projectPath]);

  const left = useMemo<Item[]>(() => [
    ...(current ? [{ kind: 'continue' } as Item] : []),
    ...projects.map((project) => ({ kind: 'project', project } as Item)),
    { kind: 'open' } as Item,
  ], [current, projects]);

  // The right column shows the project under the cursor; otherwise the last one visited, then the
  // open project (so the current session sits beside its own project's list), then the most recent.
  const focusedLeft = left[Math.min(row[0], left.length - 1)];
  const shownProject = useMemo(() => {
    if (focusedLeft?.kind === 'project') return focusedLeft.project;
    return projects.find((p) => p.cwd === selected)
      ?? projects.find((p) => p.cwd === projectPath)
      ?? projects[0] ?? null;
  }, [focusedLeft, projects, selected, projectPath]);
  useEffect(() => { if (focusedLeft?.kind === 'project') setSelected(focusedLeft.project.cwd); }, [focusedLeft]);

  const right = useMemo<Item[]>(() => shownProject ? [
    { kind: 'new', cwd: shownProject.cwd, name: shownProject.name } as Item,
    ...shownProject.sessions.map((session) => ({ kind: 'session', session } as Item)),
  ] : [], [shownProject]);

  const columns = [left, right];

  const activate = useCallback((item: Item | undefined) => {
    if (!item) return;
    if (item.kind === 'continue') onContinue();
    else if (item.kind === 'open') onOpenFolder();
    else if (item.kind === 'new') onNew(item.cwd);
    else if (item.kind === 'session') onResume(item.session);
    else if (item.kind === 'project') { setCol(1); setRow((r) => [r[0], 0]); }
  }, [onContinue, onOpenFolder, onNew, onResume]);

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
  }), [activate]);
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
            Projects and sessions on this device. D-pad to move, A to open, B back to the current session.
          </div>
        </div>
      </div>

      {/* Sessions live on the machine they ran on, so a fresh Deck has none: say so plainly. */}
      {wall && !wall.error && !wall.projects.some((p) => p.sessions.length) && (
        <div style={{
          fontSize: 13, color: C.dim, lineHeight: 1.55, padding: '10px 12px', borderRadius: 8,
          border: `1px solid ${C.line}`, background: C.panel,
        }}>
          No Claude Code sessions on this device yet. Sessions stay on the machine they ran on, so ones
          from your other computers won&apos;t show up here. Open a project folder to start the first one.
        </div>
      )}

      {wall?.error && (
        <div style={{ fontSize: 12, color: C.amber }}>Couldn&apos;t read Claude Code&apos;s sessions: {wall.error}</div>
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
            if (item.kind === 'project') {
              const p = item.project;
              const open = p.cwd === shownProject?.cwd;
              return (
                <Row key={p.cwd} focused={focused} selected={open && col === 1} onClick={() => { setCol(0); setRow([i, row[1]]); }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{p.name}</span>
                    {p.cwd === projectPath && <Tag>open</Tag>}
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
