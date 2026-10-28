import React from 'react';
import { ACHIEVEMENTS, TIERS, achievementProgress, xpForLevel } from '../lib/season';
import type { SeasonView } from '../hooks/useSeason';
import { C } from '../lib/ui';

// Drawer → Pilot: the pilot's overall rank, built from real work across every session (turns
// finished, tasks done, passing tests, commits, pushes, questions answered), and the accolades
// earned along the way as achievements.

export function PilotTab({ season }: { season: SeasonView }) {
  const { state, level, tier, progress } = season;
  const next = TIERS.find((t) => t.minLevel > level);
  const toNext = xpForLevel(level + 1) - state.xp;
  const earned = ACHIEVEMENTS.filter((a) => state.unlocked.includes(a.id)).length;

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Rank */}
      <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid #1E1E1E' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 58, height: 58, borderRadius: 14, flexShrink: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column', background: 'rgba(217,119,87,0.12)', border: `1px solid ${C.clay}`,
          }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: C.clay }}>LEVEL</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: C.text, lineHeight: 1 }}>{level}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{tier}</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
              {state.xp.toLocaleString()} XP{next ? ` · ${next.name} at level ${next.minLevel}` : ' · top rank'}
            </div>
          </div>
        </div>
        <div style={{ height: 8, background: '#222', borderRadius: 4, overflow: 'hidden', marginTop: 14 }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: C.clay }} />
        </div>
        <div style={{ fontSize: 11, color: '#777', marginTop: 6, fontFamily: 'monospace' }}>
          {toNext.toLocaleString()} XP to level {level + 1}
        </div>
      </div>

      {/* Career */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1E1E1E' }}>
        <Title>Career</Title>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Stat label="Turns finished" v={state.stats.laps} />
          <Stat label="Tasks done" v={state.stats.sectors} />
          <Stat label="Passing test runs" v={state.stats.greenRuns} />
          <Stat label="Commits" v={state.stats.commits} />
          <Stat label="Pushes" v={state.stats.pushes} />
          <Stat label="Questions answered" v={state.stats.answers} />
          <Stat label="Full task lists" v={state.stats.grandsPrix} />
          <Stat label="Best clean streak" v={state.bestStreak} />
        </div>
      </div>

      {/* Achievements */}
      <div style={{ padding: '12px 16px' }}>
        <Title>Achievements · {earned} of {ACHIEVEMENTS.length}</Title>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ACHIEVEMENTS.map((a) => {
            const got = state.unlocked.includes(a.id);
            const prog = got ? null : achievementProgress(state, a.id);
            return (
              <div key={a.id} style={{
                display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 10,
                border: `1px solid ${got ? 'rgba(217,163,91,0.45)' : '#222'}`,
                background: got ? 'rgba(217,163,91,0.07)' : 'transparent',
              }}>
                <Badge got={got} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: got ? C.text : '#8A8A8A' }}>{a.name}</div>
                  <div style={{ fontSize: 11.5, color: got ? '#A8A8A8' : '#5E5E5E', marginTop: 2, lineHeight: 1.4 }}>{a.blurb}</div>
                  {prog && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 4, background: '#222', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${(prog.have / prog.need) * 100}%`, height: '100%', background: C.amber }} />
                      </div>
                      <span style={{ fontSize: 10.5, color: '#777', fontFamily: 'monospace' }}>{prog.have}/{prog.need}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// An earned achievement is a lit star medal; a locked one is its outline.
function Badge({ got }: { got: boolean }) {
  return (
    <svg width={30} height={30} viewBox="0 0 30 30" style={{ flexShrink: 0 }}>
      <circle cx={15} cy={15} r={13} fill={got ? 'rgba(217,163,91,0.18)' : 'none'} stroke={got ? C.amber : '#333'} strokeWidth={1.5} />
      <path d="M15 7.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z"
        fill={got ? C.amber : 'none'} stroke={got ? C.amber : '#444'} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: C.clay, marginBottom: 10, textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div style={{ background: '#181818', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      <div style={{ fontSize: 10.5, color: '#777', marginTop: 1 }}>{label}</div>
    </div>
  );
}
