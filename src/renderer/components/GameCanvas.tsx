import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GAME_MODES } from '../game/registry';
import type { GameMode } from '../game/types';
import { useGameLoop, forgetRace } from '../hooks/useGameLoop';
import { TelemetryController } from '../hooks/useTelemetry';
import ModFrame from './ModFrame';
import { useModGames } from '../hooks/useModGames';
import { loadHighScores, applyScore, saveHighScores, type HighScores } from '../lib/highscores';
import { SectorStrip } from './SectorStrip';
import { usePadFocus, type PadFocus } from '../hooks/usePadFocus';
import type { Sector } from '../types';
import type { Checkpoint } from '../lib/season';
import type { Job } from '../lib/intermission';
import { Glyph, withGlyphs } from './Glyph';
import { CommsRail, RAIL_W } from './CommsRail';
import { turnOf, type Turn } from '../lib/intermission';
import { C } from '../lib/ui';
import { ShootChoice, type ShotChoice } from './ShootChoice';

// The result of the lap just finished: real XP and real outcomes, shown over the track.
export interface LapCard {
  number: number;
  xp: number;
  ms: number | null;
  checkpoints: Checkpoint[];
}

export function formatLapTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const sec = (total - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
}

const LAP_CARD_MS = 7000;

interface Props {
  onClose: () => void;
  selectedId: string;
  onSelect: (id: string) => void;
  telemetry: TelemetryController;
  paused: boolean; // an approval modal is up — freeze and tell the pilot
  // The game menu: every game and mod as a card. Opened with Start (or the header button); App
  // routes the pad to it through menuNav while it's open, and the game pauses underneath.
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  menuNav: React.MutableRefObject<PadFocus | null>;
  onIntents?: (intents: import('../game/types').GameIntent[]) => void;
  // The real work, kept in view while playing: Claude's plan, and the lap card when it finishes.
  sectors: Sector[];
  checkpoints: Checkpoint[];
  lapCard: LapCard | null;
  // Intermission (lib/intermission.ts): the sessions in flight, the pilot's tidy-up, and a
  // session's news as targets the pilot shoots to answer (components/ShootChoice.tsx). The game
  // keeps running through it.
  jobs: Job[];
  // The comms rail: every session beside the game (components/CommsRail.tsx).
  comms: React.ComponentProps<typeof CommsRail>;
  tidy: { hits: number; needed: number; queued: boolean; contextPct: number | null } | null;
  choice: ShotChoice | null;
  onChoose: (id: string) => void;
  // Play one of the Deck's own Steam games (beside AnthroDeck in Game Mode, else a hand-off).
  onPlaySteam?: (appid: string, name: string) => void;
  // A Steam game is on screen instead of AnthroDeck: the game here pauses.
  hidden?: boolean;
  // The Steam game running beside AnthroDeck, and switching back to it.
  steamRunning?: { appid: string; name: string } | null;
  onResumeSteam?: () => void;
}

export default function GameCanvas({
  onClose, selectedId, onSelect, telemetry, paused: approvalPaused, onIntents, sectors, checkpoints, lapCard,
  menuOpen, onMenu, menuNav, jobs, comms, tidy, choice, onChoose, onPlaySteam, hidden, steamRunning, onResumeSteam,
}: Props) {
  // The sim stops for an approval card, while the game menu is up, and while a Steam game is on
  // screen instead; never for news.
  const paused = approvalPaused || menuOpen || !!hidden;
  // The lap card shows for a few seconds after each chequered flag, then gets out of the way.
  const [shownCard, setShownCard] = useState<LapCard | null>(null);
  useEffect(() => {
    if (!lapCard) return;
    setShownCard(lapCard);
    const id = window.setTimeout(() => setShownCard(null), LAP_CARD_MS);
    return () => window.clearTimeout(id);
  }, [lapCard]);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Null until measured: the sim must start (or resume) at the real size, not a placeholder one.
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [gen, setGen] = useState(0);
  const [hud, setHud] = useState('');
  const [over, setOver] = useState(false);
  const [scores, setScores] = useState<HighScores>({});
  const [isRecord, setIsRecord] = useState(false);

  // Built-in modes plus any installed mod games (docs/MODS.md). A mod game is a proxy GameMode, so
  // the loop, picker and high scores treat it like any other; ModFrame is where it really runs.
  const modGames = useModGames();
  const allModes = useMemo(() => [...GAME_MODES, ...modGames.map((g) => g.mode)], [modGames]);
  const mode = allModes.find((m) => m.id === selectedId) ?? GAME_MODES[0];
  const modGame = modGames.find((g) => g.mode === mode);

  useEffect(() => { loadHighScores().then(setScores); }, []);

  const handleGameOver = useCallback((score: number) => {
    setScores((prev) => {
      const { isRecord: rec, next } = applyScore(prev, mode.id, score);
      if (rec) { setIsRecord(true); void saveHighScores(next); }
      return next;
    });
  }, [mode.id]);

  useLayoutEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      setDims({ w: Math.max(320, el.clientWidth), h: Math.max(240, el.clientHeight) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setIsRecord(false); }, [selectedId]);
  const restart = () => { forgetRace(mode.id); setGen((g) => g + 1); setIsRecord(false); };

  // The sim re-inits on a mode change, a resize or Restart, and otherwise resumes the parked race.
  const sizeKey = dims ? `${dims.w}x${dims.h}` : '';
  const { hudRef, overRef } = useGameLoop(
    canvasRef, dims ? mode : undefined, telemetry, true, paused, `${gen}:${sizeKey}`, onIntents, handleGameOver,
    () => setIsRecord(false),
  );

  // Surface the sim's HUD string (and whether the run is over) without re-rendering every frame.
  useEffect(() => {
    const id = window.setInterval(() => { setHud(hudRef.current); setOver(overRef.current); }, 150);
    return () => window.clearInterval(id);
  }, [hudRef, overRef]);

  const telemetryModes = allModes.filter((m) => m.kind === 'telemetry');
  const freeplayModes = allModes.filter((m) => m.kind === 'freeplay');

  // The sessions panel comes and goes over the game: it slides in when a session changes (one
  // needs you, finishes, starts working), when the pilot moves through it (Y), talks or types to
  // one, and steps aside a few seconds later. Otherwise a small count of them sits in the corner.
  const sig = comms.rail.map((j) => `${j.id}:${turnOf(j)}:${j.needs ?? 0}`).join('|');
  const [peekUntil, setPeekUntil] = useState(0);
  const [railFocus, setRailFocus] = useState(false);
  const [, setTick] = useState(0);
  const peek = useCallback(() => setPeekUntil(Date.now() + PEEK_MS), []);
  useEffect(() => { peek(); }, [sig, comms.selected, comms.nudge, peek]);
  useEffect(() => {
    const ms = peekUntil - Date.now();
    if (ms <= 0) return;
    const t = window.setTimeout(() => setTick((x) => x + 1), ms + 50);
    return () => window.clearTimeout(t);
  }, [peekUntil]);
  const railShown = comms.rail.length > 0 && (railFocus || comms.listening || !!comms.draft || Date.now() < peekUntil);
  const counts = comms.rail.reduce((c, j) => { c[turnOf(j)] += 1; return c; }, { 'needs-you': 0, 'your-turn': 0, working: 0 } as Record<Turn, number>);

  // The controls show for a few seconds each time a game starts, then get out of the way.
  const [hintUntil, setHintUntil] = useState(0);
  useEffect(() => { if (!menuOpen) setHintUntil(Date.now() + HINT_MS); }, [mode.id, gen, menuOpen]);
  useEffect(() => {
    const ms = hintUntil - Date.now();
    if (ms <= 0) return;
    const t = window.setTimeout(() => setTick((x) => x + 1), ms + 50);
    return () => window.clearTimeout(t);
  }, [hintUntil]);
  const hintShown = Date.now() < hintUntil;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: '#0A0B0D', overflow: 'hidden' }}>
      {/* The playfield is the whole screen; everything else floats over it. */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, top: mode.fullBleed ? 0 : BAR_H, overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          width={dims?.w ?? 1280}
          height={dims?.h ?? 800}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
        {modGame && <ModFrame game={modGame} />}
      </div>

      {/* One bar: the game, its score, and the way out. */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px 18px', background: 'linear-gradient(rgba(10,11,13,0.82), rgba(10,11,13,0))', pointerEvents: 'none',
      }}>
        <button onClick={() => onMenu(true)} title="All games and mods (Menu)" style={{
          pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 8,
          fontSize: 15, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(204,120,92,0.7)',
          background: 'rgba(20,16,14,0.7)', color: '#E08A6C',
        }}>
          {mode.name}<span style={{ color: '#9A9A9A', fontWeight: 400 }}>▾</span>
        </button>
        <span style={{ fontFamily: 'monospace', fontSize: 15, color: '#D8D8D8', whiteSpace: 'nowrap', textShadow: '0 1px 3px #000' }}>
          {hud}
        </span>
        {mode.score && (
          <span title="Best score for this game" style={{
            fontFamily: 'monospace', fontSize: 13, whiteSpace: 'nowrap', color: isRecord ? '#FFD36A' : '#8A8A8A', textShadow: '0 1px 3px #000',
          }}>
            {isRecord ? 'NEW BEST ' : 'BEST '}{(scores[mode.id] ?? 0).toLocaleString()}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {tidy && (tidy.queued || (tidy.contextPct ?? 0) >= 50) && <span style={{ pointerEvents: 'auto', fontSize: 13 }}><TidyMeter {...tidy} /></span>}
        {!railShown && comms.rail.length > 0 && (
          <button onClick={peek} title="Sessions (Y)" style={{
            pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderRadius: 999,
            fontSize: 14, fontWeight: 600, cursor: 'pointer', border: '1px solid #2A2A2A', background: 'rgba(14,15,17,0.8)', color: C.text,
          }}>
            {counts['needs-you'] > 0 && <span style={{ color: C.amber }}>● {counts['needs-you']} need you</span>}
            {counts['your-turn'] > 0 && <span style={{ color: C.clay }}>● {counts['your-turn']} your turn</span>}
            {counts.working > 0 && <span style={{ color: C.green }}>● {counts.working} working</span>}
            <Glyph b="Y" />
          </button>
        )}
        <button onClick={restart} style={hdrBtn} title="Restart">↺</button>
        <button onClick={onClose} style={hdrBtn} title="Close (back to Home)">✕</button>
      </div>

      {/* Claude's plan, when it has one: a thin strip under the bar. */}
      {(sectors.length > 0 || checkpoints.length > 0) && (
        <div style={{ position: 'absolute', top: 54, left: 14, right: railShown ? RAIL_W + 28 : 14, borderRadius: 8, overflow: 'hidden', opacity: 0.92, pointerEvents: 'none' }}>
          <SectorStrip sectors={sectors} checkpoints={checkpoints} />
        </div>
      )}

      {shownCard && !paused && (
        <div style={{
          position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)', padding: '10px 16px', borderRadius: 10,
          background: 'rgba(10,11,13,0.88)', border: '1px solid #CC785C', minWidth: 220,
          display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: '#CC785C' }}>✅ CLAUDE FINISHED</span>
          <span style={{ fontFamily: 'monospace', fontSize: 20, color: '#ECECEC' }}>
            {shownCard.ms != null ? formatLapTime(shownCard.ms) : '—'}
            <span style={{ fontSize: 14, color: '#FFD36A', marginLeft: 10 }}>+{shownCard.xp} XP</span>
          </span>
          {shownCard.checkpoints.length > 0 && (
            <span style={{ fontSize: 12, color: '#9A9A9A' }}>
              {shownCard.checkpoints.map((c) => (c.good ? '✓ ' : '✗ ') + c.label).join(' · ')}
            </span>
          )}
        </div>
      )}

      {/* The sessions, over the right edge while they're wanted. */}
      <div
        onFocus={() => setRailFocus(true)}
        onBlur={() => setRailFocus(false)}
        style={{
          position: 'absolute', top: 54, right: 14, bottom: 14, width: RAIL_W, borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 12px 40px rgba(0,0,0,0.55)', display: 'flex',
          transform: railShown ? 'translateX(0)' : `translateX(${RAIL_W + 40}px)`, opacity: railShown ? 1 : 0,
          transition: 'transform 220ms ease, opacity 220ms ease', pointerEvents: railShown ? 'auto' : 'none',
        }}
      >
        <CommsRail {...comms} />
      </div>

      {over && !paused && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 34, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '10px 20px', borderRadius: 999, fontSize: 17, fontWeight: 600,
            background: 'rgba(10,11,13,0.85)', border: '1px solid #2A2A2A', color: '#ECECEC',
          }}>
            <Glyph b="A" />Play again
          </span>
        </div>
      )}

      {/* The controls, for a moment at the start of each game. */}
      <div style={{
        position: 'absolute', left: 14, bottom: 14, padding: '8px 14px', borderRadius: 10, fontSize: 14, color: '#BDBDBD',
        background: 'rgba(10,11,13,0.78)', pointerEvents: 'none',
        opacity: hintShown && !over ? 1 : 0, transition: 'opacity 600ms ease',
      }}>
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 16px' }}>
          {(mode.controls ?? 'Left stick: move · [R2] or [A] fire').split(' · ').map((c) => (
            <span key={c}>{withGlyphs(c)}</span>
          ))}
          <span>{withGlyphs('[Menu] games')}</span>
        </span>
      </div>

      {choice && !approvalPaused && <ShootChoice choice={choice} onPick={onChoose} />}
      {approvalPaused && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(10,11,13,0.7)', flexDirection: 'column', gap: 8,
        }}>
          <span style={{ color: '#CC785C', fontSize: 22, fontWeight: 700 }}>Paused</span>
          <span style={{ color: '#9A9A9A', fontSize: 16 }}>Claude needs an answer: use the face buttons and you&apos;re straight back in.</span>
        </div>
      )}

      {menuOpen && (
        <GameMenu
          telemetry={telemetryModes}
          freeplay={freeplayModes}
          modIds={new Set(modGames.map((g) => g.mode.id))}
          selectedId={mode.id}
          nav={menuNav}
          onPick={(id) => { onSelect(id); onMenu(false); }}
          onPlaySteam={onPlaySteam}
          running={steamRunning ?? null}
          onResume={onResumeSteam ? () => { onMenu(false); onResumeSteam(); } : undefined}
          onClose={() => onMenu(false)}
          onLeave={() => { onMenu(false); onClose(); }}
        />
      )}
    </div>
  );
}

// The pilot's tidy-up of the Deck's own session: each stale-context target cleared in a game counts,
// once the context is worth tidying (lib/intermission.ts).
function TidyMeter({ hits, needed, queued, contextPct }: { hits: number; needed: number; queued: boolean; contextPct: number | null }) {
  const pct = contextPct === null ? null : Math.round(contextPct);
  const text = queued ? 'Tidy-up ready: compacts when Claude finishes'
    : pct === null ? 'Context: —'
      : pct < 50 ? `Context ${pct}% · nothing to tidy`
        : `Context ${pct}% · tidy-up ${hits}/${needed}`;
  return (
    <span title="Clear stale-context targets in the game to compact Claude's context when this turn ends" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, whiteSpace: 'nowrap',
      color: queued ? '#52A77C' : pct !== null && pct >= 50 ? '#D9A35B' : '#6A6A6A',
    }}>
      {!queued && pct !== null && pct >= 50 && (
        <span style={{ width: 60, height: 4, borderRadius: 2, background: '#262626', overflow: 'hidden' }}>
          <span style={{ display: 'block', width: `${(hits / needed) * 100}%`, height: '100%', background: '#D9A35B' }} />
        </span>
      )}
      {text}
    </span>
  );
}

// Every game as a card, in two groups. A modal over the cockpit (the game pauses underneath), so it
// fits any number of games and mods, and it's driven by the pad: D-pad to move, A to pick,
// B or Start to close.
function GameMenu({
  telemetry, freeplay, modIds, selectedId, nav, onPick, onPlaySteam, running, onResume, onClose, onLeave,
}: {
  telemetry: GameMode[]; freeplay: GameMode[]; modIds: Set<string>; selectedId: string;
  nav: React.MutableRefObject<PadFocus | null>; onPick: (id: string) => void; onClose: () => void;
  onPlaySteam?: (appid: string, name: string) => void;
  running: { appid: string; name: string } | null; onResume?: () => void;
  onLeave: () => void;
}) {
  // The Deck's installed Steam games, with their covers (loaded one by one, they're files).
  const [steam, setSteam] = useState<{ appid: string; name: string }[]>([]);
  const [beside, setBeside] = useState(false);
  const [art, setArt] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!onPlaySteam) return;
    let live = true;
    void window.electronAPI.steamList().then(async (r) => {
      if (!live || !r.canPlay) return;
      setSteam(r.games);
      setBeside(r.beside);
      for (const g of r.games) {
        const a = await window.electronAPI.steamArt(g.appid);
        if (!live) return;
        setArt((m) => ({ ...m, [g.appid]: a }));
      }
    });
    return () => { live = false; };
  }, [onPlaySteam]);
  const rootRef = useRef<HTMLDivElement>(null);
  // The ring starts on the way back to a Steam game that's running, else on the game being played.
  const pad = usePadFocus(rootRef, undefined, () =>
    rootRef.current?.querySelector<HTMLElement>(running ? '[data-resume]' : `[data-game="${CSS.escape(selectedId)}"]`));
  useEffect(() => {
    nav.current = pad;
    return () => { nav.current = null; };
  }, [nav, pad]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const section = (title: string, hint: string, modes: GameMode[]) => modes.length > 0 && (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: '#6A6A6A', margin: '0 2px 8px' }}>
        {title} <span style={{ fontWeight: 400, letterSpacing: 0 }}>· {hint}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {modes.map((m) => {
          const active = m.id === selectedId;
          return (
            <button key={m.id} data-game={m.id} onClick={() => onPick(m.id)} style={{
              textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer', minHeight: 92,
              border: `1px solid ${active ? '#CC785C' : '#2A2A2A'}`,
              background: active ? 'rgba(204,120,92,0.10)' : '#151515', color: '#ECECEC',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: active ? '#CC785C' : '#ECECEC' }}>{m.name}</span>
                {modIds.has(m.id) && <span style={menuTag}>mod</span>}
                {active && <span style={menuTag}>playing</span>}
              </span>
              <span style={{
                fontSize: 12, color: '#8A8A8A', lineHeight: 1.4,
                display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {m.blurb.replace(/^Mod by [^·]+·\s*/, '')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{
      // Solid: a see-through backdrop let the cockpit header ghost through behind the title.
      position: 'absolute', inset: 0, zIndex: 5, background: '#0A0B0D',
      display: 'flex', justifyContent: 'center', padding: '20px 24px',
    }}>
      <div ref={rootRef} style={{ width: '100%', maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.16em', color: '#ECECEC' }}>GAMES</div>
            <div style={{ fontSize: 12, color: '#6A6A6A', marginTop: 3 }}>{withGlyphs('[D-pad] move · [A] play · [B] or [Menu] close')}</div>
          </div>
          <button onClick={onClose} style={hdrBtn} title="Close (B)">✕</button>
        </div>
        {/* The way out with the pad alone: the game may have come up by itself. */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={onLeave} style={{
            padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            border: '1px solid #2A2A2A', background: '#151515', color: '#ECECEC',
          }}>← Leave the game · back to your sessions</button>
          {running && onResume && (
            <button data-resume onClick={onResume} style={{
              padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              border: '1px solid #CC785C', background: '#2A1A14', color: '#ECECEC',
            }}>▶ Back to {running.name}</button>
          )}
        </div>
        {section('REACTS TO CLAUDE', 'what Claude does shows up in the game', telemetry)}
        {section('FREE PLAY', 'something to do while you wait', freeplay)}
        {steam.length > 0 && onPlaySteam && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: '#6A6A6A', margin: '0 2px 8px' }}>
              YOUR STEAM GAMES <span style={{ fontWeight: 400, letterSpacing: 0 }}>· {beside
                ? 'Claude keeps working while you play; a chime when a session needs you. The Steam menu switches back here'
                : 'Claude keeps working on your Mac; a chime when a session finishes, and AnthroDeck comes back when you quit'}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
              {steam.map((g) => (
                <button key={g.appid} data-game={`steam-${g.appid}`} onClick={() => onPlaySteam(g.appid, g.name)} title={g.name} style={{
                  padding: 0, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', border: '1px solid #2A2A2A',
                  background: '#151515', color: '#ECECEC', textAlign: 'left', display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{
                    aspectRatio: '2 / 3', width: '100%', background: art[g.appid] ? `center / cover no-repeat url("${art[g.appid]}")` : '#202020',
                    display: 'flex', alignItems: 'flex-end', padding: 8, boxSizing: 'border-box',
                  }}>
                    {!art[g.appid] && <span style={{ fontSize: 14, fontWeight: 600 }}>{g.name}</span>}
                    {running?.appid === g.appid && <span style={{ ...menuTag, background: '#141414', fontSize: 11, padding: '1px 6px' }}>Running</span>}
                  </div>
                  <span style={{ fontSize: 13, padding: '6px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const menuTag: React.CSSProperties = {
  fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#CC785C',
  border: '1px solid #CC785C', borderRadius: 3, padding: '0 4px',
};

// How long the sessions panel stays after something in it changes, and the controls after a game starts.
const PEEK_MS = 6000;
// The bar's height: a game that isn't full-bleed starts below it.
const BAR_H = 56;
const HINT_MS = 6000;

const hdrBtn: React.CSSProperties = {
  background: '#1A1A1A', border: '1px solid #333', borderRadius: 6,
  width: 30, height: 30, color: '#9A9A9A', cursor: 'pointer', fontSize: 14, flexShrink: 0,
};
