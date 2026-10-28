import React from 'react';
import type { Sector } from '../types';
import type { ContextGauge } from '../hooks/useClaude';
import { useLive } from '../hooks/useLive';
import { budgetLevel, BUDGET_COLORS, formatTokens } from '../lib/pilot';
import { C } from '../lib/ui';
import { withGlyphs } from './Glyph';

// Drawer → Overview: what's going on, in a glance (the session open here, its task list and how
// full Claude's context is, and the sessions on the other computer), and what AnthroDeck is for.

interface Props {
  project: string | null;
  remoteLabel: string | null;            // the computer the project is on, when it isn't this one
  otherLabel: string | null;             // the remote computer set up in Settings, if any
  session: { title: string; said: string | null; working: boolean } | null;
  sectors: Sector[];
  context: ContextGauge | null;
  onCompact: () => void;
}

const DOT: Record<Sector['status'], string> = { completed: C.green, in_progress: C.clay, pending: '#444' };

export function OverviewTab({ project, remoteLabel, otherLabel, session, sectors, context, onCompact }: Props) {
  const live = useLive();
  const mac = live?.state;
  const working = mac?.live.filter((s) => s.status === 'busy').length ?? 0;
  const waiting = mac?.requests.length ?? 0;
  const done = sectors.filter((s) => s.status === 'completed').length;
  const ctxColor = context ? BUDGET_COLORS[budgetLevel(context.percentage, 100)] : '#444';

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <Section title="What's going on">
        {/* The session open here. */}
        {session ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: session.working ? C.green : C.clay, flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: session.working ? C.green : C.clay }}>
                {session.working ? 'CLAUDE IS WORKING' : 'YOUR TURN'}
              </span>
            </div>
            <div style={{ fontSize: 14, color: C.text, marginTop: 5, lineHeight: 1.35 }}>{session.title}</div>
            <div style={{ fontSize: 11.5, color: '#777', marginTop: 2 }}>
              {project ?? 'No project'}{remoteLabel ? ` · on ${remoteLabel}` : ''}
            </div>
            {session.said && (
              <div style={{ fontSize: 12.5, color: '#AAA', marginTop: 8, lineHeight: 1.45, borderLeft: '2px solid #2A2A2A', paddingLeft: 10 }}>
                {session.said}
              </div>
            )}
          </div>
        ) : (
          <Muted>No session open. Pick a project on Home to start one.</Muted>
        )}

        {/* Its task list. */}
        {sectors.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <Label>Tasks · {done} of {sectors.length} done</Label>
            {sectors.map((s) => (
              <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: DOT[s.status] }} />
                <span style={{
                  fontSize: 12, lineHeight: 1.5, color: s.status === 'completed' ? '#777' : '#CCC',
                  textDecoration: s.status === 'completed' ? 'line-through' : 'none',
                }}>{s.title}</span>
              </div>
            ))}
          </div>
        )}

        {/* How full Claude's context is. */}
        {context && (
          <div style={{ marginTop: 14 }}>
            <Label>Context · {Math.round(context.percentage)}% full</Label>
            <div style={{ height: 6, background: '#222', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, context.percentage)}%`, height: '100%', background: ctxColor }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
              <span style={{ fontSize: 11, color: '#777', fontFamily: 'monospace' }}>
                {formatTokens(context.totalTokens)} / {formatTokens(context.maxTokens)}
              </span>
              <button onClick={onCompact} disabled={session?.working} style={{
                marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber,
                cursor: session?.working ? 'default' : 'pointer', opacity: session?.working ? 0.4 : 1,
              }}>Compact</button>
            </div>
          </div>
        )}

        {/* The other computer. */}
        {mac && (
          <div style={{ marginTop: 14 }}>
            <Label>On {otherLabel ?? 'your other computer'}</Label>
            <div style={{ fontSize: 12.5, color: '#BBB', lineHeight: 1.5 }}>
              {working ? `${working} session${working === 1 ? '' : 's'} working` : 'Nothing working'}
              {waiting ? <span style={{ color: C.amber }}> · {waiting} waiting on you</span> : null}
            </div>
          </div>
        )}
      </Section>

      <Section title="What AnthroDeck does">
        <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: '#BBB', lineHeight: 1.5 }}>
          <li>Runs Claude Code from your Steam Deck: start or resume a session in any project, here or on your other computer.</li>
          <li>Follows the sessions already running on your other computer, and answers their approvals and questions from the Deck.</li>
          <li>{withGlyphs('Talk instead of typing: hold [L2], check the words, then [A] sends.')}</li>
          <li>While Claude works, a game comes up. Sessions report in beside it, and answering them earns power-ups.</li>
          <li>Your work builds your pilot rank and achievements (the Pilot tab).</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #1E1E1E' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: C.clay, marginBottom: 10, textTransform: 'uppercase' }}>
        {title}
      </div>
      {children}
    </div>
  );
}
const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: '#6A6A6A', marginBottom: 6, textTransform: 'uppercase' }}>{children}</div>
);
const Muted = ({ children }: { children: React.ReactNode }) => <div style={{ color: '#555', fontSize: 12, lineHeight: 1.5 }}>{children}</div>;
