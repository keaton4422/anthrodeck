import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { LiveSession, Machine, PitWall, PlanUsage, ProjectTile, RemoteTarget, SessionCard } from '../types';
import { timeAgo } from '../lib/timeAgo';
import { dashboardStats, planHeadline, resetsIn, type DashboardStats } from '../lib/dashboard';
import { useLive } from '../hooks/useLive';
import { Logo } from './Logo';

// Home: the cockpit's landing screen. Across the top, the readout: what needs the pilot (Claude's
// waiting questions), what's running, work not shipped yet, and how much of the plan's limits is
// left. Below it, every way in: the session open right now, sessions running on the other
// computer, and every project (the folders Claude Code has worked in) with its git state and its
// sessions, to resume one or start a new one. Same schema as Claude Desktop, driven like a console.
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
  red: '#E05252',
};

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
export const liveSource = (entrypoint: string | null) =>
  entrypoint === 'claude-desktop' ? 'Claude app' : entrypoint === 'cli' ? 'terminal' : 'another app';

const Home = forwardRef<HomeNav, Props>(function Home(
  { projectPath, projectHost, current, onContinue, onResume, onNew, onOpenFolder, onOpenLive }, ref,
) {
  // Both computers' projects: the shown one drives the columns, both feed the readout.
  const [walls, setWalls] = useState<Record<Machine, PitWall | null>>({ local: null, remote: null });
  const [col, setCol] = useState(0);
  const [row, setRow] = useState<[number, number]>([0, 0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteTarget | null>(null);
  // Start on the computer the open project is on.
  const [machine, setMachine] = useState<Machine>(projectHost ? 'remote' : 'local');
  const live = useLive();
  const [plan, setPlan] = useState<PlanUsage | null>(null);
  const wall = walls[machine];

  useEffect(() => {
    void window.electronAPI.remoteGet().then(setRemote);
    void window.electronAPI.planUsage().then(setPlan);
  }, []);
  const load = useCallback((m: Machine) => window.electronAPI.sessionsList(m).then((w) => {
    setWalls((ws) => ({ ...ws, [m]: w }));
  }), []);
  useEffect(() => {
    setRow([0, 0]); setCol(0); setSelected(null);
    void load(machine);
  }, [machine, load]);
  // The other computer too, once it's known, for the readout's totals.
  useEffect(() => {
    if (remote) void load(machine === 'local' ? 'remote' : 'local');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote]);
  const stats = useMemo(() => dashboardStats([walls.local, remote ? walls.remote : null], live?.state ?? null),
    [walls, remote, live]);

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
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '18px 28px 0', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Logo height={32} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.18em', color: C.text }}>HOME</div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>
            {stats.today.sessions
              ? `Today: ${stats.today.sessions} session${stats.today.sessions === 1 ? '' : 's'} in ${stats.today.projects} project${stats.today.projects === 1 ? '' : 's'}`
              : 'No sessions yet today'}
          </div>
        </div>
        {remote && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Glyph b="Y" />
            {(['local', 'remote'] as const).map((m) => (
              <button key={m} onClick={() => setMachine(m)} style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 600,
                border: `1px solid ${machine === m ? C.clay : C.line}`,
                background: machine === m ? C.clayBg : C.panel, color: machine === m ? C.clay : C.dim,
              }}>
                {m === 'local' ? 'This Deck' : remote.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <Readout stats={stats} plan={plan} remoteLabel={remote?.label ?? null} />

      {machine === 'remote' && !wall && (
        <div style={{ fontSize: 14, color: C.dim }}>Connecting to {remote?.label ?? 'your other computer'}…</div>
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
                  <div style={{ fontSize: 16, color: C.text, marginTop: 3 }}>{current.title}</div>
                  <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>
                    {current.project ?? 'No project'}
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
                  <div style={{ fontSize: 16, color: C.text, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name || folderName(s.cwd)}
                  </div>
                  <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>
                    {folderName(s.cwd)} · {liveSource(s.entrypoint)}
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
                    <span style={{ fontSize: 17, fontWeight: 600, color: C.text }}>{p.name}</span>
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
                  <div style={{ fontSize: 16, color: C.text }}>＋ New session in {item.name}</div>
                  <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>A fresh Claude Code session in this folder</div>
                </Row>
              );
            }
            if (item.kind === 'session') {
              const s = item.session;
              const isCurrent = s.id === wall?.currentId;
              return (
                <Row key={s.id} focused={focused} onClick={() => activate(item)}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 16, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.title}
                    </span>
                    {isCurrent && <Tag>current</Tag>}
                  </div>
                  <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>
                    {s.branch ? `⎇ ${s.branch} · ` : ''}{timeAgo(s.lastModified)}
                  </div>
                </Row>
              );
            }
            return null;
          })}
        </Column>
      </div>

      {/* The console's button legend. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 22, padding: '10px 2px 12px', borderTop: `1px solid ${C.line}`,
        fontSize: 13, color: C.dim,
      }}>
        <span><Glyph b="A" /> Open</span>
        {current && <span><Glyph b="B" /> Back to session</span>}
        {remote && <span><Glyph b="Y" /> {machine === 'local' ? remote.label : 'This Deck'}</span>}
        <span style={{ marginLeft: 'auto' }}><Glyph b="☰" /> Settings</span>
      </div>
    </div>
  );
});

export default Home;

// Face buttons in the Deck's colours, as on the cards.
const GLYPH: Record<string, string> = { A: '#52A77C', B: '#E05252', X: '#6B8CCE', Y: '#D9A35B' };
export function Glyph({ b }: { b: string }) {
  const round = b.length === 1 && GLYPH[b];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
      minWidth: 22, height: 22, padding: round ? 0 : '0 6px', borderRadius: round ? '50%' : 6,
      background: round ? GLYPH[b] : '#2A2A2A', color: round ? '#101010' : C.text,
      fontSize: 12, fontWeight: 800, marginRight: 4,
    }}>{b}</span>
  );
}

// The readout across the top of Home: four numbers, each pointing at something to do.
function Readout({ stats, plan, remoteLabel }: { stats: DashboardStats; plan: PlanUsage | null; remoteLabel: string | null }) {
  const head = plan && planHeadline(plan);
  const stale = plan && Date.now() - plan.at > 6 * 3600_000 ? ` · as of ${timeAgo(plan.at)}` : '';
  const { files, projects, toPush } = stats.unshipped;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
      <Tile
        label="NEEDS YOU"
        value={String(stats.needsYou)}
        tone={stats.needsYou ? C.amber : C.green}
        sub={stats.needsYou ? `Claude is waiting${remoteLabel ? ` on ${remoteLabel}` : ''}` : 'Nothing waiting on you'}
      />
      <Tile
        label="WORKING NOW"
        value={stats.running ? String(stats.running.working) : '—'}
        tone={stats.running?.working ? C.green : C.text}
        sub={stats.running
          ? `${stats.running.idle} idle · on ${remoteLabel}`
          : 'Add your other computer in Settings'}
      />
      <Tile
        label="UNSHIPPED"
        value={String(files)}
        tone={files || toPush ? C.amber : C.green}
        sub={files || toPush
          ? `${files ? `file${files === 1 ? '' : 's'} uncommitted` : 'all committed'}${toPush ? ` · ${toPush} to push` : ''} · ${projects} project${projects === 1 ? '' : 's'}`
          : 'Everything committed and pushed'}
      />
      <Tile
        label="PLAN USAGE"
        value={head ? `${Math.round(head.used * 100)}%` : '—'}
        tone={plan?.limited || (head && head.used >= 0.9) ? C.red : head && head.used >= 0.7 ? C.amber : C.text}
        meter={head ? head.used : null}
        sub={head
          ? `${plan?.limited ? 'Limit reached' : head.label} · ${resetsIn(head.resetsAt)}${stale}`
          : 'Shows after your next session'}
      />
    </div>
  );
}

function Tile({ label, value, sub, tone, meter = null }: { label: string; value: string; sub: string; tone: string; meter?: number | null }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '12px 16px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', color: C.faint }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: tone, marginTop: 4, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</div>
      {meter !== null && (
        <div style={{ height: 4, borderRadius: 2, background: C.line, marginTop: 6, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, meter * 100)}%`, height: '100%', background: tone === C.text ? C.clay : tone }} />
        </div>
      )}
      <div style={{ fontSize: 13, color: C.dim, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
    </div>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', color: C.faint, margin: '0 2px 8px' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', padding: '2px 6px 12px 2px' }}>{children}</div>
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
        textAlign: 'left', width: '100%', cursor: 'pointer', borderRadius: 10, padding: '12px 16px',
        background: focused ? C.clayBg : accent ? '#181512' : C.panel,
        border: `1px solid ${focused ? C.clay : selected ? '#4A3A33' : C.line}`,
        // The console's focus ring: unmistakable at arm's length.
        boxShadow: focused ? `0 0 0 2px ${C.clay}, 0 0 18px rgba(217,119,87,0.25)` : 'none',
        transition: 'box-shadow 120ms, background 120ms',
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: 13, color: C.dim, marginTop: 5 }}>
      {bits}
    </div>
  );
}
