import React from 'react';
import { C } from '../lib/ui';

// Face buttons in the Deck's colours, as on the cards; anything longer (☰, L2) as a key cap.
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
