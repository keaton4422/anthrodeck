import React from 'react';
import { C } from '../lib/ui';

// The controller's buttons as the Deck draws them, so a hint shows the button rather than naming
// it: face buttons in their colours, View as its two squares, Menu as its three lines, bumpers,
// triggers, stick clicks and the D-pad as their shapes. Anything else shows as a key cap.
//
// `withGlyphs` turns [A], [View], [R3]… inside a sentence (a toast, say) into these.

const FACE: Record<string, string> = { A: '#52A77C', B: '#E05252', X: '#6B8CCE', Y: '#D9A35B' };
const INK = '#101010';

const box: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
  height: 22, marginRight: 4, flexShrink: 0,
};

function Svg({ w = 22, children, label }: { w?: number; children: React.ReactNode; label: string }) {
  return (
    <span style={box} role="img" aria-label={label} title={label}>
      <svg width={w} height={22} viewBox={`0 0 ${w} 22`} fill="none" stroke={C.text} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

const ICONS: Record<string, () => React.ReactElement> = {
  // View: two overlapping squares.
  View: () => (
    <Svg label="View button">
      <rect x={3.5} y={3.5} width={10} height={10} rx={2} />
      <rect x={8.5} y={8.5} width={10} height={10} rx={2} fill="#2A2A2A" />
    </Svg>
  ),
  // Menu: three lines.
  Menu: () => (
    <Svg label="Menu button">
      <path d="M5 6.5h12M5 11h12M5 15.5h12" />
    </Svg>
  ),
  'D-pad': () => (
    <Svg label="D-pad">
      <path d="M8.5 3h5v5.5H19v5h-5.5V19h-5v-5.5H3v-5h5.5z" />
    </Svg>
  ),
};

// Bumpers (a wide flat pill), triggers (a tall rounded top) and stick clicks (a stick with an arrow
// pressing it), each labelled.
function Shoulder({ name }: { name: string }) {
  const trigger = name.endsWith('2');
  return (
    <Svg w={30} label={`${name} ${trigger ? 'trigger' : 'bumper'}`}>
      {trigger
        ? <path d="M4 19V9.5C4 5.5 8 3 15 3s11 2.5 11 6.5V19z" />
        : <rect x={2.5} y={6} width={25} height={11} rx={5.5} />}
      <text x={15} y={trigger ? 15.5 : 15} textAnchor="middle" fontSize={9} fontWeight={800} fill={C.text} stroke="none"
        fontFamily="system-ui, sans-serif">{name}</text>
    </Svg>
  );
}
function StickClick({ side }: { side: 'L' | 'R' }) {
  return (
    <Svg w={26} label={`${side === 'L' ? 'Left' : 'Right'} stick click`}>
      <circle cx={11} cy={13} r={7.5} />
      <circle cx={11} cy={13} r={3.5} fill="#2A2A2A" />
      <path d="M21 3v6M18.5 6.5 21 9l2.5-2.5" />
      <text x={11} y={16} textAnchor="middle" fontSize={7.5} fontWeight={800} fill={C.text} stroke="none"
        fontFamily="system-ui, sans-serif">{side}</text>
    </Svg>
  );
}

export function Glyph({ b }: { b: string }) {
  const face = FACE[b];
  if (face) {
    return (
      <span style={{
        ...box, width: 22, borderRadius: '50%', background: face, color: INK, fontSize: 12, fontWeight: 800,
      }}>{b}</span>
    );
  }
  if (ICONS[b]) return ICONS[b]();
  if (b === '☰') return ICONS.Menu();
  if (/^[LR][12]$/.test(b)) return <Shoulder name={b} />;
  if (/^[LR]3$/.test(b)) return <StickClick side={b[0] as 'L' | 'R'} />;
  return (
    <span style={{
      ...box, minWidth: 22, padding: '0 6px', borderRadius: 6, background: '#2A2A2A', color: C.text,
      fontSize: 11, fontWeight: 800, letterSpacing: '0.04em',
    }}>{b}</span>
  );
}

// "Hold [X] to talk" → text with the X button drawn in.
export function withGlyphs(text: string): React.ReactNode {
  const parts = text.split(/\[([A-Za-z0-9☰-]{1,6})\]/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 ? <Glyph key={i} b={p} /> : <React.Fragment key={i}>{p}</React.Fragment>));
}
