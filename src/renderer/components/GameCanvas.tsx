import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GAME_MODES, getMode } from '../game/registry';
import { useGameLoop, forgetRace } from '../hooks/useGameLoop';
import { TelemetryController } from '../hooks/useTelemetry';
import CockpitHud from './CockpitHud';
import { loadHighScores, applyScore, saveHighScores, type HighScores } from '../lib/highscores';
import { SectorStrip } from './SectorStrip';
import { DRIVE_MODE_LABELS } from '../../main/engine/config';
import type { DriveMode, Sector } from '../types';
import type { Checkpoint } from '../lib/season';

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
  onIntents?: (intents: import('../game/types').GameIntent[]) => void;
  // The real race, kept in view while playing: Claude's lap plan, the drive mode and the career.
  sectors: Sector[];
  checkpoints: Checkpoint[];
  lapCard: LapCard | null;
  career: { level: number; tier: string; progress: number };
  driveMode: DriveMode;
}

export default function GameCanvas({
  onClose, selectedId, onSelect, telemetry, paused, onIntents, sectors, checkpoints, lapCard, career, driveMode,
}: Props) {
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

  const mode = getMode(selectedId) ?? GAME_MODES[0];

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

  const telemetryModes = GAME_MODES.filter((m) => m.kind === 'telemetry');
  const freeplayModes = GAME_MODES.filter((m) => m.kind === 'freeplay');

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

        <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <ModeGroup label="Telemetry: driven by Claude's live session" modes={telemetryModes} selectedId={selectedId} onSelect={onSelect} />
          <span style={{ width: 1, alignSelf: 'stretch', background: '#2A2A2A', margin: '2px 4px', flexShrink: 0 }} />
          <ModeGroup label="Free-play" modes={freeplayModes} selectedId={selectedId} onSelect={onSelect} />
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

      {/* Claude's lap, live while you play. The row is reserved even while empty: the canvas
          re-inits on resize, so a strip popping in mid-lap would wipe the race. */}
      <div style={{ height: STRIP_H, flexShrink: 0, overflow: 'hidden', background: '#111', borderBottom: '1px solid #1E1E1E' }}>
        <SectorStrip sectors={sectors} checkpoints={checkpoints} />
      </div>

      {/* Blurb */}
      <div style={{
        padding: '6px 16px', fontSize: 12, color: '#6A6A6A', borderBottom: '1px solid #141414', flexShrink: 0,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }} title={mode.blurb}>
        {mode.blurb}
      </div>

      {/* Playfield + instruments. The panel gets its OWN strip rather than floating over the
          canvas: an overlay was covering the bottom of the play area (in the car mode, the player's
          own car sat underneath it). Chrome shouldn't sit on top of the thing it describes. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            width={dims?.w ?? 960}
            height={dims?.h ?? 560}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
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
          {paused && (
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

      {/* Controls hint */}
      <div style={{ padding: '8px 16px', fontSize: 11, color: '#5A5A5A', borderTop: '1px solid #141414', flexShrink: 0 }}>
        Stick / gyro = steer · RT = throttle · A or RT = fire · B/LB = boost · D-pad = move · Keyboard: arrows/WASD, Space fire, Shift boost
      </div>
    </div>
  );
}

function ModeGroup({
  label, modes, selectedId, onSelect,
}: { label: string; modes: typeof GAME_MODES; selectedId: string; onSelect: (id: string) => void }) {
  return (
    // The header has no room for a text label at Deck width; it lives in the tooltip instead.
    <div title={label} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      {modes.map((m) => {
        const active = m.id === selectedId;
        return (
          <button
            key={m.id}
            onClick={() => onSelect(m.id)}
            style={{
              padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              border: `1px solid ${active ? '#CC785C' : '#333'}`,
              background: active ? 'rgba(204,120,92,0.12)' : '#1A1A1A',
              color: active ? '#CC785C' : '#9A9A9A', fontWeight: active ? 600 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

// Height reserved for the sector / checkpoint strip under the header.
const STRIP_H = 26;

// Height reserved for the instrument strip below the playfield.
const HUD_STRIP = 100;

const hdrBtn: React.CSSProperties = {
  background: '#1A1A1A', border: '1px solid #333', borderRadius: 6,
  width: 30, height: 30, color: '#9A9A9A', cursor: 'pointer', fontSize: 14, flexShrink: 0,
};
