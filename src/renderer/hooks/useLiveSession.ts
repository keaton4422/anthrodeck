import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveEntry } from '../types';

// One live session on the remote computer, open on the Deck (main/live.ts): its conversation as it
// happens, and the pilot's messages on their way in.
//
// A message goes through four states: sending (on its way over SSH), sent (in the session's inbox),
// queued (the session took it and will read it when its current turn ends) and then it shows up in
// the conversation itself, where it leaves this list. A session that skips permission prompts holds
// outside messages for review in its own window, so a message can stop at "sent".

export interface OutgoingMessage {
  id: number;
  text: string;
  state: 'sending' | 'sent' | 'queued' | 'failed';
  error?: string;
  sentAt: number;
}

const MAX_ENTRIES = 400;

export function useLiveSession(sessionId: string | null) {
  const [entries, setEntries] = useState<LiveEntry[] | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    setEntries(null);
    setOutgoing([]);
    if (!sessionId) return;
    window.electronAPI.liveWatch(sessionId);
    const off = window.electronAPI.onLiveTail((t) => {
      if (t.sessionId !== sessionId) return;
      setEntries((prev) => (t.reset ? t.entries : [...(prev ?? []), ...t.entries]).slice(-MAX_ENTRIES));
      // Match the pilot's messages against what the session reports: queued, then in the conversation.
      setOutgoing((out) => {
        let next = out;
        for (const e of t.entries) {
          if (e.role === 'queued') {
            const i = next.findIndex((m) => m.text === e.text && m.state === 'sent');
            if (i >= 0) next = next.map((m, j) => (j === i ? { ...m, state: 'queued' } : m));
          } else if (e.role === 'user' && e.deck) {
            const i = next.findIndex((m) => m.text === e.text && (m.state === 'sent' || m.state === 'queued'));
            if (i >= 0) next = next.filter((_, j) => j !== i);
          }
        }
        return next;
      });
    });
    return () => { off(); window.electronAPI.liveWatch(null); };
  }, [sessionId]);

  const send = useCallback(async (text: string) => {
    const body = text.trim();
    if (!sessionId || !body) return;
    const id = ++seq.current;
    setOutgoing((out) => [...out, { id, text: body, state: 'sending', sentAt: Date.now() }]);
    const r = await window.electronAPI.liveSend(sessionId, body);
    setOutgoing((out) => out.map((m) => (m.id !== id ? m
      : r.ok ? { ...m, state: 'sent', sentAt: Date.now() }
        : { ...m, state: 'failed', error: r.error ?? 'Not sent.' })));
  }, [sessionId]);

  const dismiss = useCallback((id: number) => setOutgoing((out) => out.filter((m) => m.id !== id)), []);

  return { entries, outgoing, send, dismiss };
}
