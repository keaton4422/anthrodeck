import React from 'react';
import { RADIAL_ITEMS } from '../lib/controls';

interface Props {
  selected: number | null;
}

const R_OUTER = 130;
const R_INNER = 52;
const SIZE = R_OUTER * 2 + 40;

// Wedge path for slice `i` of `count`, centered on straight-up for i = 0 (matches
// radialIndexFromStick).
function wedgePath(i: number, count: number): string {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const step = (Math.PI * 2) / count;
  const start = -Math.PI / 2 - step / 2 + i * step;
  const end = start + step;

  const p = (r: number, a: number) => `${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`;
  const large = step > Math.PI ? 1 : 0;

  return [
    `M ${p(R_INNER, start)}`,
    `L ${p(R_OUTER, start)}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${p(R_OUTER, end)}`,
    `L ${p(R_INNER, end)}`,
    `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${p(R_INNER, start)}`,
    'Z',
  ].join(' ');
}

function labelPos(i: number, count: number): { x: number; y: number } {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const step = (Math.PI * 2) / count;
  const mid = -Math.PI / 2 + i * step;
  const r = (R_OUTER + R_INNER) / 2;
  return { x: cx + Math.cos(mid) * r, y: cy + Math.sin(mid) * r };
}

export default function RadialMenu({ selected }: Props) {
  const count = RADIAL_ITEMS.length;

  return (
    <div className="radial-in" style={{
      position: 'fixed', inset: 0, zIndex: 85,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <svg width={SIZE} height={SIZE} style={{ overflow: 'visible' }}>
        {RADIAL_ITEMS.map((item, i) => {
          const active = i === selected;
          return (
            <path
              key={item.action}
              d={wedgePath(i, count)}
              fill={active ? 'rgba(204,120,92,0.35)' : 'rgba(26,26,26,0.92)'}
              stroke={active ? '#CC785C' : '#3A3A3A'}
              strokeWidth={active ? 2 : 1}
            />
          );
        })}
        {RADIAL_ITEMS.map((item, i) => {
          const { x, y } = labelPos(i, count);
          const active = i === selected;
          return (
            <text
              key={`t-${item.action}`}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={13}
              fontWeight={active ? 700 : 400}
              fill={active ? '#CC785C' : '#9A9A9A'}
            >
              {item.label}
            </text>
          );
        })}
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 6}
          textAnchor="middle"
          fontSize={11}
          fill="#6A6A6A"
          letterSpacing="0.08em"
        >
          AIM
        </text>
        <text x={SIZE / 2} y={SIZE / 2 + 12} textAnchor="middle" fontSize={11} fill="#6A6A6A">
          release to pick
        </text>
      </svg>
    </div>
  );
}
