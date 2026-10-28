import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, LiveEntry, LiveSession } from '../types';
import type { OutgoingMessage } from '../hooks/useLiveSession';
import { MessageBubble } from './MessageBubble';
import { Glyph } from './Glyph';
import { C, folderName, liveSource } from '../lib/ui';

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
  mode: string | null;            // its permission mode (the status bar shows it too)
  outgoing: OutgoingMessage[];
  onDismiss: (id: number) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  composer: React.ReactNode;
  onBack: () => void;
}

// The conversation's column, as MessageBubble lays it out.
const column: React.CSSProperties = {
  width: 'calc(100% - 48px)', maxWidth: 920, margin: '6px auto', padding: '12px 18px', boxSizing: 'border-box',
};

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

export function LiveSessionView({ session, label, waiting, connected, entries, mode, outgoing, onDismiss, scrollRef, composer, onBack }: Props) {
  const busy = session.status === 'busy';
  const blocks = useMemo(() => toBlocks(entries ?? []), [entries]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!outgoing.some((m) => m.state === 'sent')) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [outgoing]);

  // Follow the conversation as it grows, a reply getting longer included, unless the pilot has
  // scrolled up to read.
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries, outgoing, scrollRef]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const badge = waiting ? { text: `NEEDS YOU · ${waiting}`, color: C.amber }
    : busy ? { text: 'LIVE · WORKING', color: C.green } : { text: 'LIVE · IDLE', color: C.faint };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ // On the conversation's column, so titles and messages share one left edge.
        padding: '14px max(24px, calc((100% - 920px) / 2 + 18px))', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 14 }}>
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
        <div style={{ fontSize: 13, color: C.dim }}><Glyph b="A" /> Write</div>
        <button onClick={onBack} style={{
          padding: '8px 14px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          border: `1px solid ${C.line}`, background: 'transparent', color: C.dim,
        }}><Glyph b="B" /> Home</button>
      </div>

      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {entries === null && (
          <div style={{ ...column, fontSize: 15, color: C.dim }}>Reading the conversation on {label}…</div>
        )}
        {entries !== null && !blocks.length && (
          <div style={{ ...column, fontSize: 15, color: C.dim }}>Nothing said in this session yet.</div>
        )}
        {blocks.map((b) => b.kind === 'message'
          ? <MessageBubble key={b.message.id} message={b.message} collapseTools={false} />
          : (
            <div key={b.id} style={{ ...column, fontSize: 14, color: C.dim, whiteSpace: 'pre-wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: C.faint }}>FROM ANOTHER SESSION · </span>
              {b.text}
            </div>
          ))}
        {outgoing.map((m) => (
          <div key={m.id} style={{ ...column, background: '#1A1714', border: '1px solid #2E2620', borderRadius: 12, marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: C.clay, marginBottom: 8 }}>YOU</div>
            <div style={{ fontSize: 16, color: m.state === 'failed' ? C.dim : C.text, whiteSpace: 'pre-wrap' }}>{m.text}</div>
            <div style={{ fontSize: 13, marginTop: 6, color: m.state === 'failed' ? C.red : C.faint }}>
              {m.state === 'sending' && `Sending to ${label}…`}
              {m.state === 'queued' && 'Queued: Claude reads it when it finishes what it\'s doing.'}
              {m.state === 'sent' && (now - m.sentAt < HELD_AFTER_MS
                ? 'Delivered to the session…'
                : <span style={{ color: C.amber }}>
                    Delivered, but the session hasn&apos;t picked it up. A session that skips permission prompts holds
                    messages from outside for you to review in its own window on {label}.
                  </span>)}
              {m.state === 'unsure' && <span style={{ color: C.amber }}>{m.error}</span>}
              {(m.state === 'failed' || m.state === 'unsure') && <>{m.state === 'failed' && `Not sent: ${m.error}`} <button onClick={() => onDismiss(m.id)} style={{
                marginLeft: 6, background: 'none', border: `1px solid ${C.line}`, color: C.dim, borderRadius: 5, fontSize: 11, cursor: 'pointer',
              }}>Dismiss</button></>}
            </div>
          </div>
        ))}
      </div>

      {/* Claude Code holds messages from outside for review in a session that never asks for
          permission, so say so before the pilot types, not after. */}
      {mode === 'bypassPermissions' && (
        <div style={{ ...column, margin: '0 auto', padding: '8px 18px', fontSize: 13, color: C.amber }}>
          This session runs with Bypass permissions, so the Claude app on {label} holds messages from the Deck
          until you allow them there.
        </div>
      )}
      <div className="live-composer">{composer}</div>
    </div>
  );
}
