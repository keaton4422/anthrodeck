import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GAME_MODES } from '../game/registry';
import type { GameMode } from '../game/types';
import { useGameLoop, forgetRace } from '../hooks/useGameLoop';
import { TelemetryController } from '../hooks/useTelemetry';
import CockpitHud from './CockpitHud';
import ModFrame from './ModFrame';
import { useModGames } from '../hooks/useModGames';
import { loadHighScores, applyScore, saveHighScores, type HighScores } from '../lib/highscores';
import { SectorStrip } from './SectorStrip';
import { usePadFocus, type PadFocus } from '../hooks/usePadFocus';
import { DRIVE_MODE_LABELS } from '../../main/engine/config';
import type { DriveMode, Sector } from '../types';
import type { Checkpoint } from '../lib/season';
import type { Job } from '../lib/intermission';
import { Glyph, withGlyphs } from './Glyph';
import { CommsRail } from './CommsRail';
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
  // The real race, kept in view while playing: Claude's lap plan, the drive mode and the career.
  sectors: Sector[];
  checkpoints: Checkpoint[];
  lapCard: LapCard | null;
  career: { level: number; tier: string; progress: number };
  driveMode: DriveMode;
  // Intermission (lib/intermission.ts): the sessions in flight, the pilot's tidy-up, and a
  // session's news as targets the pilot shoots to answer (components/ShootChoice.tsx). The game
  // keeps running through it.
  jobs: Job[];
  // The comms rail: every session beside the game (components/CommsRail.tsx).
  comms: React.ComponentProps<typeof CommsRail>;
  tidy: { hits: number; needed: number; queued: boolean; contextPct: number | null } | null;
  choice: ShotChoice | null;
  onChoose: (id: string) => void;
}

export default function GameCanvas({
  onClose, selectedId, onSelect, telemetry, paused: approvalPaused, onIntents, sectors, checkpoints, lapCard, career, driveMode,
  menuOpen, onMenu, menuNav, jobs, comms, tidy, choice, onChoose,
}: Props) {
  // The sim stops for an approval card and while the game menu is up; never for news.
  const paused = approvalPaused || menuOpen;
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
  const hudRef = useGameLoop(
    canvasRef, dims ? mode : undefined, telemetry, true, paused, `${gen}:${sizeKey}`, onIntents, handleGameOver,
  );

  // Surface the sim's HUD string without re-rendering every frame.
  useEffect(() => {
    const id = window.setInterval(() => setHud(hudRef.current), 150);
    return () => window.clearInterval(id);
  }, [hudRef]);

  const telemetryModes = allModes.filter((m) => m.kind === 'telemetry');
  const freeplayModes = allModes.filter((m) => m.kind === 'freeplay');

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 70, background: '#0A0B0D',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        borderBottom: '1px solid #1E1E1E', flexShrink: 0,
      }}>
        <span style={{ color: '#CC785C', fontWeight: 700, letterSpacing: '0.08em', fontSize: 14 }}>
          🎮 COCKPIT
        </span>

        {/* One button however many games and mods there are; the full list is the game menu. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <button onClick={() => onMenu(true)} title="All games and mods (Start)" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%',
            padding: '5px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
            border: '1px solid #CC785C', background: 'rgba(204,120,92,0.12)', color: '#CC785C', fontWeight: 600,
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mode.name}</span>
            <span style={{ color: '#9A9A9A', fontWeight: 400, whiteSpace: 'nowrap' }}>▾ · Start</span>
          </button>
        </div>

        {mode.score && (
          <span
            title="Best score for this mode"
            style={{
              fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap',
              color: isRecord ? '#FFD36A' : '#6A6A6A',
              border: `1px solid ${isRecord ? '#FFD36A' : '#2A2A2A'}`,
              borderRadius: 6, padding: '3px 8px',
            }}
          >
            {isRecord ? 'NEW BEST ' : 'BEST '}{(scores[mode.id] ?? 0).toLocaleString()}
          </span>
        )}
        <span style={{
          fontFamily: 'monospace', fontSize: 12, color: '#8A8A8A', width: 260, flexShrink: 0, textAlign: 'right',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {hud}
        </span>
        <span title="Permission mode (R1) · pilot rank" style={{ fontSize: 11, color: '#9A9A9A', whiteSpace: 'nowrap' }}>
          {DRIVE_MODE_LABELS[driveMode]} · <span style={{ color: '#ECECEC', fontWeight: 700 }}>{career.tier}</span>{' '}
          <span style={{ color: '#CC785C' }}>L{career.level}</span>
        </span>
        <button onClick={restart} style={hdrBtn} title="Restart">↺</button>
        <button onClick={onClose} style={hdrBtn} title="Close cockpit">✕</button>
      </div>

      {menuOpen && (
        <GameMenu
          telemetry={telemetryModes}
          freeplay={freeplayModes}
          modIds={new Set(modGames.map((g) => g.mode.id))}
          selectedId={mode.id}
          nav={menuNav}
          onPick={(id) => { onSelect(id); onMenu(false); }}
          onClose={() => onMenu(false)}
          onLeave={() => { onMenu(false); onClose(); }}
        />
      )}

      {/* Claude's lap, live while you play. The row is reserved even while empty: the canvas
          re-inits on resize, so a strip popping in mid-lap would wipe the race. */}
      <div style={{ height: STRIP_H, flexShrink: 0, overflow: 'hidden', background: '#111', borderBottom: '1px solid #1E1E1E' }}>
        <SectorStrip sectors={sectors} checkpoints={checkpoints} />
      </div>

      {/* Blurb */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', fontSize: 12, color: '#6A6A6A',
        borderBottom: '1px solid #141414', flexShrink: 0,
      }}>
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={mode.blurb}>
          {mode.blurb}
        </span>
        {tidy && <TidyMeter {...tidy} />}
      </div>

      {/* Playfield + instruments. The panel gets its OWN strip rather than floating over the
          canvas: an overlay was covering the bottom of the play area (in the car mode, the player's
          own car sat underneath it). Chrome shouldn't sit on top of the thing it describes. */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            width={dims?.w ?? 960}
            height={dims?.h ?? 560}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
          {modGame && <ModFrame game={modGame} />}
          {shownCard && !paused && (
            <div style={{
              position: 'absolute', top: 12, right: 12, padding: '10px 14px', borderRadius: 8,
              background: 'rgba(10,11,13,0.85)', border: '1px solid #CC785C', minWidth: 190,
              display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: '#CC785C' }}>
                ✅ CLAUDE FINISHED
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 18, color: '#ECECEC' }}>
                {shownCard.ms != null ? formatLapTime(shownCard.ms) : '—'}
                <span style={{ fontSize: 13, color: '#FFD36A', marginLeft: 10 }}>+{shownCard.xp} XP</span>
              </span>
              {shownCard.checkpoints.length > 0 && (
                <span style={{ fontSize: 11, color: '#9A9A9A' }}>
                  {shownCard.checkpoints.map((c) => (c.good ? '✓ ' : '✗ ') + c.label).join(' · ')}
                </span>
              )}
            </div>
          )}
          {choice && !approvalPaused && <ShootChoice choice={choice} onPick={onChoose} />}
          {approvalPaused && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: 'rgba(10,11,13,0.7)', flexDirection: 'column', gap: 8,
            }}>
              <span style={{ color: '#CC785C', fontSize: 20, fontWeight: 700 }}>Paused</span>
              <span style={{ color: '#9A9A9A', fontSize: 14 }}>Claude needs an answer: use the face buttons and you&apos;re straight back in.</span>
            </div>
          )}
        </div>

        {mode.kind === 'telemetry' && (
          <div style={{ height: HUD_STRIP, position: 'relative', flexShrink: 0 }}>
            <CockpitHud telemetry={telemetry} />
          </div>
        )}
      </div>
      {/* Always there, so the playfield never changes size mid-race (that re-inits the sim). */}
      <CommsRail {...comms} />
      </div>

      {/* Controls hint */}
      <div style={{ padding: '8px 16px', fontSize: 11, color: '#5A5A5A', borderTop: '1px solid #141414', flexShrink: 0 }}>
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px' }}>
          <span>Left stick or gyro: fly</span>
          <span><Glyph b="R2" />or <Glyph b="A" />fire</span>
          <span><Glyph b="B" />or <Glyph b="L1" />boost</span>
          <span><Glyph b="D-pad" />move</span>
          <span><Glyph b="Menu" />games</span>
        </span>
      </div>
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
  telemetry, freeplay, modIds, selectedId, nav, onPick, onClose, onLeave,
}: {
  telemetry: GameMode[]; freeplay: GameMode[]; modIds: Set<string>; selectedId: string;
  nav: React.MutableRefObject<PadFocus | null>; onPick: (id: string) => void; onClose: () => void;
  onLeave: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The ring starts on the game being played.
  const pad = usePadFocus(rootRef, undefined, () =>
    rootRef.current?.querySelector<HTMLElement>(`[data-game="${CSS.escape(selectedId)}"]`));
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
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
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
        <button onClick={onLeave} style={{
          alignSelf: 'flex-start', padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          border: '1px solid #2A2A2A', background: '#151515', color: '#ECECEC',
        }}>← Leave the game · back to your sessions</button>
        {section('REACTS TO CLAUDE', 'what Claude does shows up in the game', telemetry)}
        {section('FREE PLAY', 'something to do while you wait', freeplay)}
      </div>
    </div>
  );
}

const menuTag: React.CSSProperties = {
  fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#CC785C',
  border: '1px solid #CC785C', borderRadius: 3, padding: '0 4px',
};

// Height reserved for the sector / checkpoint strip under the header.
const STRIP_H = 26;

// Height reserved for the instrument strip below the playfield.
const HUD_STRIP = 100;

const hdrBtn: React.CSSProperties = {
  background: '#1A1A1A', border: '1px solid #333', borderRadius: 6,
  width: 30, height: 30, color: '#9A9A9A', cursor: 'pointer', fontSize: 14, flexShrink: 0,
};
