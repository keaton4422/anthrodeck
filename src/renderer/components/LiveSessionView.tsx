import React, { useEffect, useMemo, useState } from 'react';
import type { ChatMessage, LiveEntry, LiveSession } from '../types';
import type { OutgoingMessage } from '../hooks/useLiveSession';
import { MessageBubble } from './MessageBubble';
import { liveSource } from './Home';

// The live session screen: a Claude Code session running on the remote computer right now (in the
// Claude app, a terminal…), followed from the Deck. The conversation streams in as that session
// works; the pilot's messages go to it through Claude Code's session inbox (main/live.ts), and its
// approvals and questions keep arriving as cards. The session itself stays where it runs.
//
// Pad: B back to Home, A to the message box (STEAM + X for the keyboard, or hold L2 and talk),
// D-pad up/down scrolls. App routes the buttons.

interface Props {
  session: LiveSession;
  label: string;                  // the remote computer, e.g. "MacBook-Pro"
  waiting: number;                // its prompts waiting on the pilot
  connected: boolean;
  entries: LiveEntry[] | null;    // null until the first read
  outgoing: OutgoingMessage[];
  onDismiss: (id: number) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  composer: React.ReactNode;
  onBack: () => void;
}

const C = {
  line: '#262626',
  text: '#ECECEC',
  dim: '#8A8A8A',
  faint: '#5E5E5E',
  clay: '#D97757',
  green: '#52A77C',
  amber: '#D9A35B',
  red: '#E05252',
};

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

// A message the Deck sent that the session hasn't picked up after this long is probably being held.
const HELD_AFTER_MS = 8000;

type Block = { kind: 'message'; message: ChatMessage } | { kind: 'peer'; id: string; text: string };

// The transcript's entries as chat messages: each run of Claude's words and tool calls becomes one
// reply, tool calls as the same one-line labels the cockpit shows.
function toBlocks(entries: LiveEntry[]): Block[] {
  const out: Block[] = [];
  let reply: ChatMessage | null = null;
  for (const e of entries) {
    if (e.role === 'assistant' || e.role === 'tool') {
      const line = e.role === 'tool' ? `\`${e.text}\`` : e.text;
      if (reply) reply.content += `\n\n${line}`;
      else { reply = { id: e.id, role: 'assistant', content: line, timestamp: 0 }; out.push({ kind: 'message', message: reply }); }
      continue;
    }
    reply = null;
    if (e.role === 'user') out.push({ kind: 'message', message: { id: e.id, role: 'user', content: e.text, timestamp: 0 } });
    else if (e.role === 'peer') out.push({ kind: 'peer', id: e.id, text: e.text });
  }
  return out;
}

export function LiveSessionView({ session, label, waiting, connected, entries, outgoing, onDismiss, scrollRef, composer, onBack }: Props) {
  const busy = session.status === 'busy';
  const blocks = useMemo(() => toBlocks(entries ?? []), [entries]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!outgoing.some((m) => m.state === 'sent')) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [outgoing]);

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks.length, outgoing.length, scrollRef]);

  const badge = waiting ? { text: `NEEDS YOU · ${waiting}`, color: C.amber }
    : busy ? { text: 'LIVE · WORKING', color: C.green } : { text: 'LIVE · IDLE', color: C.faint };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: badge.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: badge.color === C.faint ? C.clay : badge.color }}>
              {badge.text}
            </span>
          </div>
          <div style={{ fontSize: 16, color: C.text, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.name || folderName(session.cwd)}
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
            {folderName(session.cwd)} · {liveSource(session.entrypoint)} on {label}
            {connected ? '' : ' · reconnecting…'}
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.faint, textAlign: 'right', lineHeight: 1.6 }}>A to write · L2 to talk</div>
        <button onClick={onBack} style={{
          padding: '6px 12px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          border: `1px solid ${C.line}`, background: 'transparent', color: C.dim,
        }}>B · Home</button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {entries === null && (
          <div style={{ padding: '18px 24px', fontSize: 13, color: C.dim }}>Reading the conversation on {label}…</div>
        )}
        {entries !== null && !blocks.length && (
          <div style={{ padding: '18px 24px', fontSize: 13, color: C.dim }}>Nothing said in this session yet.</div>
        )}
        {blocks.map((b) => b.kind === 'message'
          ? <MessageBubble key={b.message.id} message={b.message} collapseTools={false} />
          : (
            <div key={b.id} style={{ padding: '10px 24px 10px 72px', fontSize: 13, color: C.dim, borderBottom: '1px solid #1E1E1E', whiteSpace: 'pre-wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: C.faint }}>FROM ANOTHER SESSION · </span>
              {b.text}
            </div>
          ))}
        {outgoing.map((m) => (
          <div key={m.id} style={{ padding: '10px 24px 10px 72px', borderBottom: '1px solid #1E1E1E' }}>
            <div style={{ fontSize: 14, color: m.state === 'failed' ? C.dim : C.text, whiteSpace: 'pre-wrap' }}>{m.text}</div>
            <div style={{ fontSize: 12, marginTop: 4, color: m.state === 'failed' ? C.red : C.faint }}>
              {m.state === 'sending' && `Sending to ${label}…`}
              {m.state === 'queued' && 'Queued: Claude reads it when it finishes what it\'s doing.'}
              {m.state === 'sent' && (now - m.sentAt < HELD_AFTER_MS
                ? 'Delivered to the session…'
                : <span style={{ color: C.amber }}>
                    Delivered, but the session hasn&apos;t picked it up. A session that skips permission prompts holds
                    messages from outside for you to review in its own window on {label}.
                  </span>)}
              {m.state === 'failed' && <>Not sent: {m.error} <button onClick={() => onDismiss(m.id)} style={{
                marginLeft: 6, background: 'none', border: `1px solid ${C.line}`, color: C.dim, borderRadius: 5, fontSize: 11, cursor: 'pointer',
              }}>Dismiss</button></>}
            </div>
          </div>
        ))}
      </div>

      <div className="live-composer">{composer}</div>
    </div>
  );
}
