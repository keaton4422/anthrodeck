import React, { useEffect, useRef } from 'react';
import { TelemetryController } from '../hooks/useTelemetry';
import { budgetLevel, BUDGET_COLORS, formatTokens } from '../lib/pilot';

// The instrument panel that turns a telemetry game mode into a cockpit: you can see WHY you're
// moving fast, what the engine is doing right now, and how much fuel is left.
//
// Design notes:
// - Instruments read as precision equipment, not skeuomorphic dials: hairline arcs, tabular
//   numerals, small-caps labels, flat surfaces, one accent colour.
// - Values EASE toward their target instead of snapping. Real needles lag, and that lag is most of
//   what makes a readout feel mechanical rather than like a DOM counter.
// - It runs its own rAF and writes straight to refs, so a 60 fps instrument never re-renders React.

const MAX_TPS = 60;          // full-scale deflection on the throughput gauge
const SWEEP = 250;           // degrees of arc
const START = -125;          // degrees, 0 = straight up
const R = 34;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  const a = polar(cx, cy, r, fromDeg);
  const b = polar(cx, cy, r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

interface Props {
  telemetry: TelemetryController;
}

export default function CockpitHud({ telemetry }: Props) {
  const needleRef = useRef<SVGLineElement>(null);
  const arcRef = useRef<SVGPathElement>(null);
  const tpsRef = useRef<HTMLSpanElement>(null);
  const toolRef = useRef<HTMLSpanElement>(null);
  const fuelBarRef = useRef<HTMLDivElement>(null);
  const fuelTextRef = useRef<HTMLSpanElement>(null);
  const lampStream = useRef<HTMLSpanElement>(null);
  const lampThink = useRef<HTMLSpanElement>(null);
  const lampTool = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let eased = 0; // smoothed tokens/sec

    const setLamp = (el: HTMLSpanElement | null, on: boolean, color: string) => {
      if (!el) return;
      el.style.background = on ? color : '#242424';
      el.style.boxShadow = on ? `0 0 8px ${color}` : 'none';
      el.style.borderColor = on ? color : '#3A3A3A';
    };

    const tick = () => {
      const s = telemetry.peek();

      // Needle lag — the instrument feel.
      eased += (s.tokensPerSec - eased) * 0.12;
      const frac = Math.max(0, Math.min(1, eased / MAX_TPS));
      const deg = START + frac * SWEEP;

      if (needleRef.current) {
        const p = polar(60, 52, R - 6, deg);
        needleRef.current.setAttribute('x2', String(p.x));
        needleRef.current.setAttribute('y2', String(p.y));
      }
      if (arcRef.current) {
        arcRef.current.setAttribute(
          'd',
          frac <= 0.001 ? '' : arcPath(60, 52, R, START, deg),
        );
      }
      if (tpsRef.current) tpsRef.current.textContent = String(Math.round(eased));

      if (toolRef.current) {
        toolRef.current.textContent = s.lastTool ?? (s.streaming ? 'generating…' : 'idle');
        toolRef.current.style.color = s.lastTool ? '#8FE9FF' : '#6A6A6A';
      }

      setLamp(lampStream.current, s.streaming, '#52A77C');
      setLamp(lampThink.current, s.thinking, '#6A8CC7');
      setLamp(lampTool.current, s.toolActive, '#CC785C');

      const level = budgetLevel(s.sessionTokens, s.budget);
      const pct = s.budget > 0 ? Math.min(1, s.sessionTokens / s.budget) : 0;
      if (fuelBarRef.current) {
        fuelBarRef.current.style.width = `${pct * 100}%`;
        fuelBarRef.current.style.background = BUDGET_COLORS[level];
      }
      if (fuelTextRef.current) {
        fuelTextRef.current.textContent = `${formatTokens(s.sessionTokens)} / ${formatTokens(s.budget)}`;
        fuelTextRef.current.style.color = BUDGET_COLORS[level];
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [telemetry]);

  return (
    <div style={panel}>
      {/* Throughput gauge — the tachometer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width={120} height={78} aria-hidden>
          <path d={arcPath(60, 52, R, START, START + SWEEP)} fill="none" stroke="#262626" strokeWidth={5} strokeLinecap="round" />
          <path ref={arcRef} fill="none" stroke="#CC785C" strokeWidth={5} strokeLinecap="round" />
          <line ref={needleRef} x1={60} y1={52} x2={60} y2={22} stroke="#ECECEC" strokeWidth={1.5} strokeLinecap="round" />
          <circle cx={60} cy={52} r={3} fill="#ECECEC" />
          <text x={60} y={72} textAnchor="middle" fontSize={8} fill="#5A5A5A" letterSpacing="0.14em">THROUGHPUT</text>
        </svg>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span ref={tpsRef} style={bigNum}>0</span>
          <span style={{ fontSize: 10, color: '#6A6A6A', letterSpacing: '0.08em' }}>tok/s</span>
        </div>
      </div>

      <div style={divider} />

      {/* Status lamps + current tool */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 190 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          <Lamp label="STREAM" refEl={lampStream} />
          <Lamp label="THINK" refEl={lampThink} />
          <Lamp label="TOOL" refEl={lampTool} />
        </div>
        <span ref={toolRef} style={toolReadout}>idle</span>
      </div>

      <div style={divider} />

      {/* Fuel — session tokens against the soft budget */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 150 }}>
        <span style={label}>FUEL</span>
        <div style={{ height: 6, background: '#242424', borderRadius: 3, overflow: 'hidden' }}>
          <div ref={fuelBarRef} style={{ width: '0%', height: '100%', background: '#52A77C', transition: 'background 240ms ease-out' }} />
        </div>
        <span ref={fuelTextRef} style={{ ...mono, fontSize: 11 }}>0 / 200K</span>
      </div>
    </div>
  );
}

function Lamp({ label: text, refEl }: { label: string; refEl: React.RefObject<HTMLSpanElement> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span
        ref={refEl}
        style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#242424', border: '1px solid #3A3A3A',
          display: 'inline-block',
          transition: 'background 160ms ease-out, box-shadow 160ms ease-out',
        }}
      />
      <span style={{ fontSize: 9, color: '#6A6A6A', letterSpacing: '0.12em' }}>{text}</span>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: 'absolute', left: 0, right: 0, bottom: 0,
  display: 'flex', alignItems: 'center', gap: 20,
  padding: '10px 18px',
  background: 'linear-gradient(to top, rgba(10,11,13,0.96), rgba(10,11,13,0.72))',
  borderTop: '1px solid #1E1E1E',
  pointerEvents: 'none',
};

const mono: React.CSSProperties = {
  fontFamily: 'JetBrains Mono, Consolas, monospace',
  fontVariantNumeric: 'tabular-nums',
};

const bigNum: React.CSSProperties = {
  ...mono, fontSize: 26, fontWeight: 600, color: '#ECECEC', lineHeight: 1,
};

const label: React.CSSProperties = {
  fontSize: 9, color: '#5A5A5A', letterSpacing: '0.14em',
};

const toolReadout: React.CSSProperties = {
  ...mono, fontSize: 11, color: '#6A6A6A',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

const divider: React.CSSProperties = { width: 1, alignSelf: 'stretch', background: '#1E1E1E' };
