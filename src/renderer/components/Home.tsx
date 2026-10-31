import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { LiveSession, Machine, PitWall, ProjectTile, RcSession, RemoteTarget, SessionCard } from '../types';
import { timeAgo } from '../lib/timeAgo';
import { buildQueue, type QueueEntry } from '../lib/queue';
import { useLive } from '../hooks/useLive';
import { Glyph } from './Glyph';
import { C, folderName, liveSource } from '../lib/ui';

// Home: the cockpit's landing screen, a queue of what needs the pilot. On the left, every session
// in the order it needs a thumb: waiting on an answer (with the question), then the pilot's turn
// (Claude finished: what it last said), then the ones Claude is working in, and the session open
// here. On the right, the way to start or resume work: the projects (the folders Claude Code has
// worked in) with their git state, and A on one opens its sessions. Same schema as Claude Desktop,
// driven like a console; no dashboard numbers, only things to act on.
//
// Built for the pad first: two columns, the D-pad moves (up/down within a column, left/right
// between them), A goes. App forwards pad input through the `HomeNav` handle; arrow keys and Enter
// work too.
//
// The queue covers the other computer's running sessions (main/live.ts): their approvals and
// questions also pop up as cards wherever the pilot is, and A opens one on the live session screen
// to follow it and send it messages. The projects column shows one computer at a time: Y switches.

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
  onOpenRc: (s: RcSession) => void;     // its own claude.ai page
}

type Item =
  | { kind: 'continue' }
  | { kind: 'live'; entry: QueueEntry; group: 'needs' | 'turn' | 'working' }
  | { kind: 'rc'; session: RcSession }
  | { kind: 'calm' }
  | { kind: 'project'; project: ProjectTile }
  | { kind: 'open' }
  | { kind: 'back' }
  | { kind: 'new'; cwd: string; name: string }
  | { kind: 'session'; session: SessionCard };

// Home remounts each time the pilot comes back to it. The last listings show at once while the
// shown computer is read again; the other one only feeds the readout's totals, so it's read again
// only once this old (for the remote computer, every read is a trip over SSH).
const wallCache: Partial<Record<Machine, { wall: PitWall; at: number }>> = {};
const OTHER_FRESH_MS = 60_000;
// Every Remote Control session on the account (main/rcSessions.ts), kept between visits.
let rcCache: RcSession[] = [];
const RC_EVERY_MS = 30_000;

const Home = forwardRef<HomeNav, Props>(function Home(
  { projectPath, projectHost, current, onContinue, onResume, onNew, onOpenFolder, onOpenLive, onOpenRc }, ref,
) {
  // Both computers' projects: the shown one drives the columns, both feed the readout.
  const [walls, setWalls] = useState<Record<Machine, PitWall | null>>(
    { local: wallCache.local?.wall ?? null, remote: wallCache.remote?.wall ?? null });
  const [col, setCol] = useState(0);
  const [row, setRow] = useState<[number, number]>([0, 0]);
  const [remote, setRemote] = useState<RemoteTarget | null>(null);
  // Start on the computer the open project is on.
  const [machine, setMachine] = useState<Machine>(projectHost ? 'remote' : 'local');
  const live = useLive();
  const wall = walls[machine];
  // The project whose sessions the right column shows (null: the list of projects).
  const [drilled, setDrilled] = useState<string | null>(null);

  useEffect(() => {
    void window.electronAPI.remoteGet().then(setRemote);
  }, []);
  const load = useCallback((m: Machine) => window.electronAPI.sessionsList(m).then((w) => {
    wallCache[m] = { wall: w, at: Date.now() };
    setWalls((ws) => ({ ...ws, [m]: w }));
  }), []);
  useEffect(() => {
    setRow([0, 0]); setCol(0); setDrilled(null);
    void load(machine);
  }, [machine, load]);
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

  // The queue: the other computer's running sessions, apart from the one the Deck has open.
  const queue = useMemo(() => buildQueue(live?.state ?? null, projectHost ? wallCache.remote?.wall.currentId ?? null : null),
    [live, projectHost]);
  // Remote Control sessions on any computer, apart from the ones already here in full over SSH.
  const [rcList, setRcList] = useState<RcSession[]>(rcCache);
  useEffect(() => {
    let on = true;
    const get = () => window.electronAPI.rcSessions().then((r) => { if (on) { rcCache = r.sessions; setRcList(r.sessions); } });
    void get();
    const id = window.setInterval(() => void get(), RC_EVERY_MS);
    const off = window.electronAPI.onRcDone(() => void get());
    return () => { on = false; window.clearInterval(id); off(); };
  }, []);
  const rc = useMemo(() => {
    const here = new Set((live?.state?.live ?? []).map((l) => l.name).filter(Boolean));
    const list = rcList.filter((r) => !here.has(r.name));
    // Idle ones that just finished a turn (the plugin sent their reply) are the pilot's turn: first.
    const idle = list.filter((r) => r.status === 'idle');
    return { busy: list.filter((r) => r.status === 'busy'), idle: [...idle.filter((r) => r.said), ...idle.filter((r) => !r.said)] };
  }, [rcList, live]);
  // What needs an answer, then what Claude is working on, then the pilot's turns.
  const left = useMemo<Item[]>(() => {
    const items: Item[] = [
      ...queue.needs.map((entry) => ({ kind: 'live', entry, group: 'needs' } as Item)),
      ...queue.working.map((entry) => ({ kind: 'live', entry, group: 'working' } as Item)),
      ...rc.busy.map((session) => ({ kind: 'rc', session } as Item)),
      ...(current ? [{ kind: 'continue' } as Item] : []),
      ...queue.turn.map((entry) => ({ kind: 'live', entry, group: 'turn' } as Item)),
      ...rc.idle.map((session) => ({ kind: 'rc', session } as Item)),
    ];
    return items.length ? items : [{ kind: 'calm' }];
  }, [queue, current, rc]);

  const shownProject = useMemo(() => projects.find((p) => p.cwd === drilled) ?? null, [projects, drilled]);
  const right = useMemo<Item[]>(() => shownProject ? [
    { kind: 'back' } as Item,
    { kind: 'new', cwd: shownProject.cwd, name: shownProject.name } as Item,
    ...shownProject.sessions.map((session) => ({ kind: 'session', session } as Item)),
  ] : [
    ...projects.map((project) => ({ kind: 'project', project } as Item)),
    { kind: 'open' } as Item,
  ], [shownProject, projects]);

  const columns = [left, right];

  const activate = useCallback((item: Item | undefined) => {
    if (!item) return;
    touched.current = true;
    if (item.kind === 'continue') onContinue();
    else if (item.kind === 'open') onOpenFolder(machine);
    else if (item.kind === 'new') onNew(item.cwd, machine);
    else if (item.kind === 'session') {
      // Still running on that computer: follow it there, rather than start a second copy of it.
      const running = machine === 'remote' && item.session.id !== wall?.currentId
        ? live?.state?.live.find((l) => l.sessionId === item.session.id) : undefined;
      if (running) onOpenLive(running);
      else onResume(item.session, machine);
    }
    else if (item.kind === 'live') onOpenLive(item.entry.session);
    else if (item.kind === 'rc') onOpenRc(item.session);
    else if (item.kind === 'calm') { setCol(1); setRow((r) => [r[0], 0]); }
    else if (item.kind === 'project') { setDrilled(item.project.cwd); setCol(1); setRow((r) => [r[0], 0]); }
    else if (item.kind === 'back') {
      const at = projects.findIndex((p) => p.cwd === drilled);
      setDrilled(null); setCol(1); setRow((r) => [r[0], Math.max(0, at)]);
    }
  }, [onContinue, onOpenFolder, onNew, onResume, onOpenLive, onOpenRc, machine, wall, live, projects, drilled]);

  const touched = useRef(false);
  const stateRef = useRef({ col, row, columns });
  stateRef.current = { col, row, columns };

  // One set of moves for the pad (through the HomeNav handle) and the keyboard.
  const nav = useMemo<HomeNav>(() => ({
    move(dx, dy) {
      touched.current = true;
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

  // Nothing in the queue: the cursor starts on the projects instead, and comes back to the queue
  // when something arrives in it (the live sessions load a moment after Home), unless the pilot has
  // moved it since.
  const calm = left[0]?.kind === 'calm';
  useEffect(() => {
    if (calm && col === 0) setCol(1);
    else if (!calm && !touched.current) { setCol(0); setRow((r) => [0, r[1]]); }
  }, [calm, col]);
  const isFocused = (c: number, i: number) => col === c && row[c] === i;
  const other = remote ? (machine === 'local' ? remote.label : 'This Deck') : null;
  const needs = queue.needs.length;
  const working = queue.working.length + rc.busy.length;
  const workingText = working ? `Claude is working in ${working} session${working === 1 ? '' : 's'}` : '';
  const headline = needs
    ? [`${needs} session${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you`, workingText].filter(Boolean).join(' · ')
    : workingText || (queue.turn.length || current || rc.idle.length ? 'Nothing waiting on an answer' : 'All quiet');

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '18px 28px 0', gap: 16 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: needs ? C.amber : C.text }}>{headline}</div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: calm ? 'minmax(0, 4fr) minmax(0, 8fr)' : 'minmax(0, 7fr) minmax(0, 5fr)', gap: 22, minHeight: 0 }}>
        {/* The queue */}
        <Column title={`YOUR SESSIONS${remote ? ` · ${remote.label.toUpperCase()}, THIS DECK` : ''}${rc.busy.length + rc.idle.length ? ' AND OTHER COMPUTERS' : ''}`}>
          {left.map((item, i) => {
            const focused = isFocused(0, i);
            const go = () => { setCol(0); setRow([i, row[1]]); activate(item); };
            if (item.kind === 'continue' && current) {
              return (
                <Row key="continue" focused={focused} onClick={go}>
                  <Kicker color={C.clay}>OPEN HERE · THIS DECK</Kicker>
                  <Title>{current.title}</Title>
                  <Sub>{current.project ?? 'No project'}</Sub>
                </Row>
              );
            }
            if (item.kind === 'rc') {
              const busy = item.session.status === 'busy';
              return (
                <Row key={`rc-${item.session.ref}`} focused={focused} onClick={go}>
                  <Kicker color={busy ? C.green : item.session.said ? C.clay : C.dim}>
                    {busy ? 'WORKING' : item.session.said ? 'YOUR TURN' : 'IDLE'} <span style={{ color: C.faint, fontWeight: 600 }}>· ANOTHER COMPUTER</span>
                  </Kicker>
                  <Title>{item.session.name}</Title>
                  {item.session.said
                    ? <div style={{ fontSize: 16, color: C.dim, marginTop: 4, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.session.said}</div>
                    : <Sub>A to message it</Sub>}
                </Row>
              );
            }
            if (item.kind === 'live') {
              const s = item.entry.session;
              const tone = item.group === 'needs' ? C.amber : item.group === 'working' ? C.green : C.clay;
              const label = item.group === 'needs'
                ? `NEEDS YOU${item.entry.waiting > 1 ? ` · ${item.entry.waiting} QUESTIONS` : ''}`
                : item.group === 'turn' ? 'YOUR TURN' : 'WORKING';
              const line = item.group === 'needs' ? item.entry.ask : item.group === 'working' ? (s.tool ?? s.said) : s.said;
              return (
                <Row key={`live-${s.sessionId}`} focused={focused} accent={item.group === 'needs'} onClick={go}>
                  <Kicker color={tone}>
                    {label} <span style={{ color: C.faint, fontWeight: 600 }}>· {folderName(s.cwd)} · {timeAgo(s.updatedAt)}</span>
                  </Kicker>
                  <Title>{s.name || folderName(s.cwd)}</Title>
                  {line && (
                    <div style={{
                      fontSize: 16, color: item.group === 'needs' ? C.text : C.dim, marginTop: 4, lineHeight: 1.4,
                      fontFamily: item.group === 'needs' && line.startsWith('$ ') ? 'JetBrains Mono, Consolas, monospace' : undefined,
                      overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    }}>{line}</div>
                  )}
                </Row>
              );
            }
            return (
              <div key="calm" style={{ fontSize: 17, color: C.dim, lineHeight: 1.5, padding: '8px 4px' }}>
                {remote
                  ? live?.connected
                    ? <>Nothing needs you. Start something on the right.</>
                    : <>Connecting to {remote.label}…</>
                  : <>Nothing needs you. Start something on the right. Sessions on your other computers show here once Remote Control is on in Claude Code there.</>}
                {queue.quiet > 0 && <div style={{ fontSize: 15, color: C.faint, marginTop: 6 }}>{queue.quiet} older idle session{queue.quiet === 1 ? '' : 's'} on {remote?.label}</div>}
              </div>
            );
          })}
        </Column>

        {/* Start or resume */}
        <Column title={shownProject ? shownProject.name.toUpperCase() : `START OR RESUME · ${machine === 'remote' && remote ? remote.label.toUpperCase() : 'THIS DECK'}`}>
          {machine === 'remote' && !wall && <Sub>Connecting to {remote?.label ?? 'your other computer'}…</Sub>}
          {wall?.error && <div style={{ fontSize: 15, color: C.amber }}>Couldn&apos;t read Claude Code&apos;s sessions on {where}: {wall.error}</div>}
          {right.map((item, i) => {
            const focused = isFocused(1, i);
            const go = () => { setCol(1); setRow([row[0], i]); activate(item); };
            if (item.kind === 'project') {
              const p = item.project;
              return (
                <Row key={p.cwd} focused={focused} onClick={go}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <Title>{p.name}</Title>
                    {isOpen(p.cwd) && <Tag>open</Tag>}
                  </div>
                  <GitLine project={p} />
                </Row>
              );
            }
            if (item.kind === 'open') {
              return (
                <Row key="open" focused={focused} onClick={go}>
                  <div style={{ fontSize: 17, color: C.dim }}>＋ Open another folder</div>
                </Row>
              );
            }
            if (item.kind === 'back') {
              return (
                <Row key="back" focused={focused} onClick={go}>
                  <div style={{ fontSize: 17, color: C.dim }}>← All projects</div>
                </Row>
              );
            }
            if (item.kind === 'new') {
              return (
                <Row key="new" focused={focused} accent onClick={go}>
                  <Title>＋ New session</Title>
                  <Sub>A fresh Claude Code session in {item.name}</Sub>
                </Row>
              );
            }
            if (item.kind === 'session') {
              const s = item.session;
              const isCurrent = s.id === wall?.currentId;
              const running = !isCurrent && machine === 'remote' && !!live?.state?.live.some((l) => l.sessionId === s.id);
              return (
                <Row key={s.id} focused={focused} onClick={go}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                    <Title>{s.title}</Title>
                    {isCurrent && <Tag>open</Tag>}
                    {running && <Tag>live</Tag>}
                  </div>
                  <Sub>{s.branch ? `⎇ ${s.branch} · ` : ''}{timeAgo(s.lastModified)}</Sub>
                </Row>
              );
            }
            return null;
          })}
        </Column>
      </div>

      {/* The console's button legend. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 24, padding: '10px 2px 12px', borderTop: `1px solid ${C.line}`,
        fontSize: 16, color: C.dim,
      }}>
        <span><Glyph b="A" /> Open</span>
        {current && <span><Glyph b="B" /> Back to session</span>}
        {other && <span><Glyph b="Y" /> Projects on {other}</span>}
        <span><Glyph b="X" /> Games</span>
        <span style={{ marginLeft: 'auto' }}><Glyph b="Menu" /> Settings</span>
      </div>
    </div>
  );
});

export default Home;

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, letterSpacing: '0.14em', color: C.faint, margin: '0 2px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', padding: '2px 6px 12px 2px' }}>{children}</div>
    </div>
  );
}

function Row({ focused, accent, onClick, children }: {
  focused: boolean; accent?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  const el = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (focused) el.current?.scrollIntoView({ block: 'nearest' }); }, [focused]);
  return (
    <button
      ref={el}
      onClick={onClick}
      style={{
        textAlign: 'left', width: '100%', cursor: 'pointer', borderRadius: 12, padding: '14px 18px',
        background: focused ? C.clayBg : accent ? '#181512' : C.panel,
        border: `1px solid ${focused ? C.clay : C.line}`,
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
      fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.clay,
      border: `1px solid ${C.clay}`, borderRadius: 4, padding: '0 6px', flexShrink: 0,
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: 15, color: C.dim, marginTop: 5 }}>
      {bits}
    </div>
  );
}

const Kicker = ({ color, children }: { color: string; children: React.ReactNode }) => (
  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</div>
);
const Title = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 20, fontWeight: 600, color: C.text, marginTop: 3, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</div>
);
const Sub = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 15, color: C.dim, marginTop: 4 }}>{children}</div>
);
