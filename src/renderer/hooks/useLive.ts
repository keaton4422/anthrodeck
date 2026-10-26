import { useEffect, useState } from 'react';
import type { LiveStatus } from '../types';

// The remote computer's live Claude Code sessions (main/live.ts), kept current.
export function useLive(): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>(null);
  useEffect(() => {
    let on = true;
    void window.electronAPI.liveGet().then((s) => { if (on) setStatus(s); });
    const off = window.electronAPI.onLiveState(setStatus);
    return () => { on = false; off(); };
  }, []);
  return status;
}
