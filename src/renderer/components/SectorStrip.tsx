import React from 'react';
import { Sector } from '../types';

const COLORS: Record<Sector['status'], string> = {
  completed: '#B57CF0',
  in_progress: '#52A77C',
  pending: '#2E2E2E',
};

// F1-style sector bar under the status bar: one segment per task in Claude's plan, with the sector
// currently being driven named on the right. Hidden until Claude has a plan.
export function SectorStrip({ sectors }: { sectors: Sector[] }) {
  if (sectors.length === 0) return null;
  const current = sectors.find((s) => s.status === 'in_progress')
    ?? sectors.find((s) => s.status === 'pending');
  const done = sectors.filter((s) => s.status === 'completed').length;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px',
      background: '#111', borderBottom: '1px solid #1E1E1E', flexShrink: 0,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#777', whiteSpace: 'nowrap' }}>
        LAP {done}/{sectors.length}
      </span>
      <div style={{ display: 'flex', gap: 3, flex: 1, minWidth: 60 }}>
        {sectors.map((s) => (
          <div key={s.id} title={s.title} style={{
            flex: 1, height: 6, borderRadius: 2, background: COLORS[s.status],
            boxShadow: s.status === 'in_progress' ? '0 0 6px rgba(82,167,124,0.7)' : 'none',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
      <span style={{
        fontSize: 11, color: current ? '#BBB' : '#B57CF0', maxWidth: '45%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {current ? current.title : 'All sectors complete'}
      </span>
    </div>
  );
}
