import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GAME_MODES, getMode } from '../game/registry';
import { useGameLoop } from '../hooks/useGameLoop';
import { TelemetryController } from '../hooks/useTelemetry';
import CockpitHud from './CockpitHud';
import { loadHighScores, applyScore, saveHighScores, type HighScores } from '../lib/highscores';

interface Props {
  onClose: () => void;
  selectedId: string;
  onSelect: (id: string) => void;
  telemetry: TelemetryController;
  paused: boolean; // an approval modal is up — freeze and tell the pilot
  onIntents?: (intents: import('../game/types').GameIntent[]) => void;
}

export default function GameCanvas({ onClose, selectedId, onSelect, telemetry, paused, onIntents }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 960, h: 560 });
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

  // Re-init the sim whenever the mode or the canvas size changes, or the pilot hits Restart.
  useEffect(() => { setGen((g) => g + 1); setIsRecord(false); }, [selectedId, dims.w, dims.h]);

  const hudRef = useGameLoop(canvasRef, mode, telemetry, true, paused, gen, onIntents, handleGameOver);

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

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          <ModeGroup label="Telemetry" modes={telemetryModes} selectedId={selectedId} onSelect={onSelect} />
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
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8A8A8A', minWidth: 120, textAlign: 'right' }}>
          {hud}
        </span>
        <button onClick={() => { setGen((g) => g + 1); setIsRecord(false); }} style={hdrBtn} title="Restart">↺</button>
        <button onClick={onClose} style={hdrBtn} title="Close cockpit">✕</button>
      </div>

      {/* Blurb */}
      <div style={{ padding: '6px 16px', fontSize: 12, color: '#6A6A6A', borderBottom: '1px solid #141414', flexShrink: 0 }}>
        {mode.blurb}
      </div>

      {/* Playfield + instruments. The panel gets its OWN strip rather than floating over the
          canvas: an overlay was covering the bottom of the play area (in the car mode, the player's
          own car sat underneath it). Chrome shouldn't sit on top of the thing it describes. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            width={dims.w}
            height={dims.h}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
          {paused && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: 'rgba(10,11,13,0.7)', flexDirection: 'column', gap: 8,
            }}>
              <span style={{ color: '#CC785C', fontSize: 20, fontWeight: 700 }}>Paused</span>
              <span style={{ color: '#9A9A9A', fontSize: 14 }}>The engine needs you — resolve the prompt to resume.</span>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 10, color: '#555', letterSpacing: '0.05em', marginRight: 2 }}>{label}:</span>
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
            }}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

// Height reserved for the instrument strip below the playfield.
const HUD_STRIP = 100;

const hdrBtn: React.CSSProperties = {
  background: '#1A1A1A', border: '1px solid #333', borderRadius: 6,
  width: 30, height: 30, color: '#9A9A9A', cursor: 'pointer', fontSize: 14, flexShrink: 0,
};
