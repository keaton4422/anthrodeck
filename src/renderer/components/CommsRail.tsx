import React, { useEffect, useRef, useState } from 'react';
import { turnOf, type Job, type Turn } from '../lib/intermission';
import { C } from '../lib/ui';
import { Glyph } from './Glyph';

// The comms rail beside the game: every session the Deck flies, each with what it needs from the
// pilot and the last thing Claude said, so the game is where the work is watched and driven, not a
// break from it. App routes the pad (lib/intermission.ts): Y moves down the rail (or sends the
// orders waiting), hold X to talk to the selected session, View drops the orders, R3 types them.
// Answering a card or sending orders earns a power-up in the game.

export interface CommsDraft { jobId: string; text: string }

interface Props {
  rail: Job[];                    // already in rail order
  selected: string | null;
  draft: CommsDraft | null;
  listening: boolean;
  remoteLabel: string | null;
  typeSignal: number;             // bumps when the pilot presses R3: put the cursor in the message box
  onSelect: (id: string) => void;
  onSend: (jobId: string, text: string) => void;
  onDiscard: () => void;
}

const TURN: Record<Turn, { label: string; color: string }> = {
  'needs-you': { label: 'NEEDS YOU', color: C.amber },
  'your-turn': { label: 'YOUR TURN', color: C.clay },
  working: { label: 'WORKING', color: C.green },
};

export const RAIL_W = 320;

export function CommsRail({ rail, selected, draft, listening, remoteLabel, typeSignal, onSelect, onSend, onDiscard }: Props) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const sel = rail.find((j) => j.id === selected) ?? null;
  useEffect(() => { if (typeSignal) inputRef.current?.focus(); }, [typeSignal]);

  return (
    <div style={{
      width: RAIL_W, flexShrink: 0, borderLeft: `1px solid ${C.line}`, background: '#0E0F11',
      display: 'flex', flexDirection: 'column', minHeight: 0,
    }}>
      <div style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: C.text }}>SESSIONS</div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
          <span><Glyph b="Y" />{draft ? 'Send' : 'Next'}</span>
          <span><Glyph b="X" />Hold to talk</span>
          <span><Glyph b="R3" />Type</span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 8px 0' }}>
        {!rail.length && (
          <div style={{ fontSize: 13, color: C.faint, padding: '8px 6px', lineHeight: 1.5 }}>
            No sessions in flight. Start one from Home, or from Claude on {remoteLabel ?? 'your other computer'}.
          </div>
        )}
        {rail.map((j) => {
          const t = TURN[turnOf(j)];
          const on = j.id === selected;
          const mine = draft?.jobId === j.id ? draft : null;
          return (
            <div key={j.id} onClick={() => onSelect(j.id)} style={{
              padding: '10px 12px', marginBottom: 8, borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${on ? t.color : C.line}`, background: on ? '#17181B' : 'transparent',
              boxShadow: on ? `inset 3px 0 0 ${t.color}` : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', background: t.color, flexShrink: 0,
                  animation: j.working || j.needs ? 'commsPulse 1.4s ease-in-out infinite' : undefined,
                }} />
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: t.color }}>
                  {t.label}{j.needs && j.needs > 1 ? ` · ${j.needs}` : ''}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: C.faint }}>{j.remote ? remoteLabel ?? 'remote' : 'this Deck'}</span>
              </div>
              <div style={{ fontSize: 14, color: C.text, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.label}
              </div>
              {j.working && j.tool && (
                <div style={{ fontSize: 12, color: C.green, marginTop: 4, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ▸ {j.tool}
                </div>
              )}
              {j.said && (
                <div style={{
                  fontSize: 12.5, color: on ? '#C9C9C9' : C.dim, marginTop: 4, lineHeight: 1.45,
                  display: '-webkit-box', WebkitLineClamp: on ? 5 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {j.said}
                </div>
              )}
              {on && (listening || mine) && (
                <div style={{
                  marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#1A1714',
                  border: `1px solid ${listening ? C.red : '#2E2620'}`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: listening ? C.red : C.clay }}>
                    {listening ? 'LISTENING…' : 'YOUR ORDERS'}
                  </div>
                  {mine && <div style={{ fontSize: 14, color: C.text, marginTop: 4, whiteSpace: 'pre-wrap' }}>{mine.text}</div>}
                  {mine && !listening && (
                    <div style={{ fontSize: 12, color: C.dim, marginTop: 6, display: 'flex', gap: 12 }}>
                      <span><Glyph b="Y" />Send</span>
                      <span><Glyph b="X" />Add more</span>
                      <span><Glyph b="View" />Drop</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Typed orders: R3 puts the cursor here (STEAM + X brings up the keyboard on the Deck). */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!sel || !typed.trim()) return;
          onSend(sel.id, typed.trim());
          setTyped('');
          inputRef.current?.blur();
        }}
        style={{ padding: 8, borderTop: `1px solid ${C.line}` }}
      >
        <input
          ref={inputRef}
          className="comms-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setTyped(''); inputRef.current?.blur(); onDiscard(); } }}
          disabled={!sel}
          placeholder={sel ? `Message ${sel.label}` : 'Pick a session'}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, fontSize: 14,
            background: '#17181B', border: `1px solid ${C.line}`, color: C.text, outline: 'none', fontFamily: 'inherit',
          }}
        />
      </form>
      <style>{'@keyframes commsPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }'}</style>
    </div>
  );
}
