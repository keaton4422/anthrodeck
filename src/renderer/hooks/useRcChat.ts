import { useEffect, useState } from 'react';
import type { LiveEntry } from '../types';

// The conversation with a Remote Control session on another computer (main/rcSessions.ts): what
// the pilot sent and what came back, as the live session screen's entries. Null ref: none open.
export function useRcChat(ref: string | null): LiveEntry[] | null {
  const [entries, setEntries] = useState<LiveEntry[] | null>(null);
  useEffect(() => {
    setEntries(null);
    if (!ref) return;
    let on = true;
    const show = (list: { id: string; role: LiveEntry['role']; text: string }[]) =>
      setEntries(list.map((e) => ({ id: e.id, role: e.role, text: e.text, deck: e.role === 'user' })));
    void window.electronAPI.rcChatGet(ref).then((l) => { if (on) show(l); });
    const off = window.electronAPI.onRcChat((r, l) => { if (r === ref) show(l); });
    return () => { on = false; off(); };
  }, [ref]);
  return entries;
}
