import { useEffect, useRef } from 'react';
import { TelemetryEvent, TelemetryFrame } from '../game/types';

// Derives a live telemetry feed for the cockpit game modes from the Claude IPC events we already
// emit (deltas, tool activity, thinking, done, error) — no new main-process channel needed. The
// game loop runs on rAF (outside React render), so this returns a stable mutable controller.

export interface TelemetryController {
  // Called once per animation frame: returns the current snapshot and DRAINS queued discrete events.
  getFrame(): TelemetryFrame;
  // App-driven engine events (boost on approved write, crash on abort).
  emit(ev: TelemetryEvent): void;
  setSessionTokens(n: number): void;
}

export function useTelemetry(): TelemetryController {
  const events = useRef<TelemetryEvent[]>([]);
  const tokenTimes = useRef<number[]>([]); // timestamps of recently-streamed output tokens
  const streaming = useRef(false);
  const toolUntil = useRef(0);
  const sessionTokens = useRef(0);

  useEffect(() => {
    const unsubDelta = window.electronAPI.onClaudeDelta((delta) => {
      streaming.current = true;
      const now = performance.now();
      const toks = Math.max(1, Math.ceil(delta.length / 4));
      for (let i = 0; i < toks; i++) tokenTimes.current.push(now);
    });
    const unsubThink = window.electronAPI.onClaudeThinkingDelta(() => {
      streaming.current = true;
      events.current.push({ type: 'thinking' });
    });
    const unsubTool = window.electronAPI.onClaudeToolActivity(() => {
      events.current.push({ type: 'tool' });
      toolUntil.current = performance.now() + 800;
    });
    const unsubDone = window.electronAPI.onClaudeDone(() => {
      streaming.current = false;
      events.current.push({ type: 'done' });
    });
    const unsubErr = window.electronAPI.onClaudeError(() => {
      streaming.current = false;
      events.current.push({ type: 'error' });
    });
    return () => { unsubDelta(); unsubThink(); unsubTool(); unsubDone(); unsubErr(); };
  }, []);

  const controller = useRef<TelemetryController>({
    getFrame(): TelemetryFrame {
      const now = performance.now();
      const arr = tokenTimes.current;
      const cutoff = now - 1000;
      let drop = 0;
      while (drop < arr.length && arr[drop] < cutoff) drop++;
      if (drop > 0) arr.splice(0, drop);

      const drained = events.current;
      events.current = [];

      return {
        snapshot: {
          streaming: streaming.current,
          tokensPerSec: arr.length, // tokens streamed in the last second
          sessionTokens: sessionTokens.current,
          toolActive: now < toolUntil.current,
        },
        events: drained,
      };
    },
    emit(ev) { events.current.push(ev); },
    setSessionTokens(n) { sessionTokens.current = n; },
  });

  return controller.current;
}
