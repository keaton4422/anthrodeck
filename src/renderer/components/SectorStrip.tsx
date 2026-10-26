import React from 'react';
import { Sector } from '../types';
import type { Checkpoint } from '../lib/season';

const COLORS: Record<Sector['status'], string> = {
  completed: '#B57CF0',
  in_progress: '#52A77C',
  pending: '#2E2E2E',
};

// F1-style sector bar under the status bar: one segment per task in Claude's plan, with the sector
// currently being driven named on the right. Without a plan it falls back to the lap's
// checkpoints (applied edits, green tests, commits) as they happen; hidden until there is either.
export function SectorStrip({ sectors, checkpoints = [] }: { sectors: Sector[]; checkpoints?: Checkpoint[] }) {
  if (sectors.length === 0) return checkpoints.length ? <CheckpointStrip checkpoints={checkpoints} /> : null;
  const current = sectors.find((s) => s.status === 'in_progress')
    ?? sectors.find((s) => s.status === 'pending');
  const done = sectors.filter((s) => s.status === 'completed').length;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px',
      background: '#111', borderBottom: '1px solid #1E1E1E', flexShrink: 0,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#777', whiteSpace: 'nowrap' }}>
        TASKS {done}/{sectors.length}
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
        {current ? current.title : 'All tasks done'}
      </span>
    </div>
  );
}

function CheckpointStrip({ checkpoints }: { checkpoints: Checkpoint[] }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px',
      background: '#111', borderBottom: '1px solid #1E1E1E', flexShrink: 0, overflow: 'hidden',
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#777', whiteSpace: 'nowrap' }}>
        PROGRESS
      </span>
      {checkpoints.map((c, i) => (
        <span key={i} style={{
          fontSize: 10, padding: '1px 7px', borderRadius: 3, whiteSpace: 'nowrap',
          background: c.good ? 'rgba(181,124,240,0.18)' : 'rgba(224,82,82,0.18)',
          color: c.good ? '#B57CF0' : '#E05252',
        }}>
          {c.label}
        </span>
      ))}
    </div>
  );
}
