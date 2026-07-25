import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GAME_MODES, getMode } from '../game/registry';
import { useGameLoop } from '../hooks/useGameLoop';
import { TelemetryController } from '../hooks/useTelemetry';
import CockpitHud from './CockpitHud';

interface Props {
  onClose: () => void;
  selectedId: string;
  onSelect: (id: string) => void;
  telemetry: TelemetryController;
  paused: boolean; // an approval modal is up — freeze and tell the pilot
}

export default function GameCanvas({ onClose, selectedId, onSelect, telemetry, paused }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 960, h: 560 });
  const [gen, setGen] = useState(0);
  const [hud, setHud] = useState('');

  const mode = getMode(selectedId) ?? GAME_MODES[0];

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
  useEffect(() => { setGen((g) => g + 1); }, [selectedId, dims.w, dims.h]);

  const hudRef = useGameLoop(canvasRef, mode, telemetry, true, paused, gen);

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

        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8A8A8A', minWidth: 120, textAlign: 'right' }}>
          {hud}
        </span>
        <button onClick={() => setGen((g) => g + 1)} style={hdrBtn} title="Restart">↺</button>
        <button onClick={onClose} style={hdrBtn} title="Close cockpit">✕</button>
      </div>

      {/* Blurb */}
      <div style={{ padding: '6px 16px', fontSize: 12, color: '#6A6A6A', borderBottom: '1px solid #141414', flexShrink: 0 }}>
        {mode.blurb}
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          width={dims.w}
          height={dims.h}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
        {/* Instrument panel — only for modes actually driven by engine telemetry. */}
        {mode.kind === 'telemetry' && <CockpitHud telemetry={telemetry} />}

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

const hdrBtn: React.CSSProperties = {
  background: '#1A1A1A', border: '1px solid #333', borderRadius: 6,
  width: 30, height: 30, color: '#9A9A9A', cursor: 'pointer', fontSize: 14, flexShrink: 0,
};
