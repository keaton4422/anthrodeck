import React from 'react';
import { Sector } from '../types';
import { ACHIEVEMENTS, xpForLevel } from '../lib/season';
import type { SeasonView } from '../hooks/useSeason';
import type { ContextGauge } from '../hooks/useClaude';
import { budgetLevel, BUDGET_COLORS, formatTokens } from '../lib/pilot';

interface Props {
  sectors: Sector[];
  context: ContextGauge | null;
  season: SeasonView;
  onPitStop: () => void;
  busy: boolean;
}

const STATUS_DOT: Record<Sector['status'], string> = {
  completed: '#B57CF0',   // purple sector
  in_progress: '#52A77C',
  pending: '#444',
};

// Drawer → Race: the lap plan (Claude's task list), the fuel situation, and the career.
export function RaceTab({ sectors, context, season, onPitStop, busy }: Props) {
  const done = sectors.filter((s) => s.status === 'completed').length;
  const ctxColor = context ? BUDGET_COLORS[budgetLevel(context.percentage, 100)] : '#444';
  const { state, level, tier } = season;
  const nextAt = xpForLevel(level + 1);

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Lap plan */}
      <Section title={sectors.length ? `Lap plan · ${done}/${sectors.length} sectors` : 'Lap plan'}>
        {sectors.length === 0 ? (
          <Empty>Give Claude a multi-step job and its task list shows up here as sectors.</Empty>
        ) : sectors.map((s) => (
          <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: STATUS_DOT[s.status] }} />
            <span style={{
              fontSize: 12, lineHeight: 1.5,
              color: s.status === 'completed' ? '#777' : '#CCC',
              textDecoration: s.status === 'completed' ? 'line-through' : 'none',
            }}>{s.title}</span>
          </div>
        ))}
      </Section>

      {/* Fuel */}
      <Section title="Context (fuel)">
        {context ? (
          <>
            <div style={{ height: 8, background: '#222', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, context.percentage)}%`, height: '100%', background: ctxColor }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginTop: 6, fontFamily: 'monospace' }}>
              <span>{Math.round(context.percentage)}% used</span>
              <span>{formatTokens(context.totalTokens)} / {formatTokens(context.maxTokens)}</span>
            </div>
          </>
        ) : <Empty>Reported after the first lap.</Empty>}
        <button onClick={onPitStop} disabled={busy} style={{
          width: '100%', marginTop: 10, padding: '8px 0', borderRadius: 7, cursor: busy ? 'default' : 'pointer',
          border: '1px solid #D9A441', background: 'rgba(217,164,65,0.1)', color: '#D9A441', fontSize: 12, fontWeight: 600,
          opacity: busy ? 0.5 : 1,
        }}>
          Pit stop · compact context
        </button>
        <p style={{ fontSize: 11, color: '#555', marginTop: 6, lineHeight: 1.4 }}>
          Claude Code also compacts on its own when the tank runs low.
        </p>
      </Section>

      {/* Career */}
      <Section title={`Career · ${tier} · level ${level}`}>
        <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace', marginBottom: 8 }}>
          {state.xp} XP · next level at {nextAt}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11, color: '#999' }}>
          <Stat label="Laps" v={state.stats.laps} />
          <Stat label="Sectors" v={state.stats.sectors} />
          <Stat label="Green runs" v={state.stats.greenRuns} />
          <Stat label="Commits" v={state.stats.commits} />
          <Stat label="Pushes" v={state.stats.pushes} />
          <Stat label="Grands Prix" v={state.stats.grandsPrix} />
          <Stat label="Best clean streak" v={state.bestStreak} />
          <Stat label="Questions answered" v={state.stats.answers} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {ACHIEVEMENTS.map((a) => {
            const got = state.unlocked.includes(a.id);
            return (
              <div key={a.id} style={{ display: 'flex', gap: 8, opacity: got ? 1 : 0.35 }}>
                <span style={{ fontSize: 13 }}>{got ? '🏆' : '○'}</span>
                <span style={{ fontSize: 12, color: got ? '#ECECEC' : '#888' }}>
                  {a.name} <span style={{ color: '#666' }}>· {a.blurb}</span>
                </span>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #1E1E1E' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: '#CC785C', marginBottom: 8, textTransform: 'uppercase' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#555', fontSize: 12, lineHeight: 1.5 }}>{children}</div>;
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span>{label}</span><span style={{ color: '#ECECEC', fontFamily: 'monospace' }}>{v}</span>
    </div>
  );
}
