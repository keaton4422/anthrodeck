import { useEffect, useRef } from 'react';
import { TelemetryEvent, TelemetryFrame, TelemetrySnapshot } from '../game/types';

// Derives a live telemetry feed for the cockpit game modes from the Claude IPC events we already
// emit (deltas, tool activity, thinking, done, error) — no new main-process channel needed. The
// game loop runs on rAF (outside React render), so this returns a stable mutable controller.

export interface TelemetryController {
  // Called once per animation frame: returns the current snapshot and DRAINS queued discrete events.
  getFrame(): TelemetryFrame;
  // Snapshot WITHOUT draining — for readouts (the instrument HUD) that must not steal events from
  // the simulation.
  peek(): TelemetrySnapshot;
  // App-driven engine events (boost on approved write, crash on abort).
  emit(ev: TelemetryEvent): void;
  setSessionTokens(n: number): void;
  setBudget(n: number): void;
}

export function useTelemetry(): TelemetryController {
  const events = useRef<TelemetryEvent[]>([]);
  const tokenTimes = useRef<number[]>([]); // timestamps of recently-streamed output tokens
  const streaming = useRef(false);
  const toolUntil = useRef(0);
  const sessionTokens = useRef(0);
  const thinkingUntil = useRef(0);
  const lastTool = useRef<string | null>(null);
  const budget = useRef(200_000);

  useEffect(() => {
    const unsubDelta = window.electronAPI.onClaudeDelta((delta) => {
      streaming.current = true;
      const now = performance.now();
      const toks = Math.max(1, Math.ceil(delta.length / 4));
      for (let i = 0; i < toks; i++) tokenTimes.current.push(now);
    });
    const unsubThink = window.electronAPI.onClaudeThinkingDelta(() => {
      streaming.current = true;
      thinkingUntil.current = performance.now() + 600;
      events.current.push({ type: 'thinking' });
    });
    const unsubTool = window.electronAPI.onClaudeToolActivity((label) => {
      events.current.push({ type: 'tool' });
      toolUntil.current = performance.now() + 800;
      // Labels arrive as "\n`read: src/App.tsx`\n" — strip to a bare instrument readout.
      const clean = label.replace(/[`\n]/g, '').trim();
      if (clean) lastTool.current = clean.slice(0, 42);
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

  const snapshot = (): TelemetrySnapshot => {
    const now = performance.now();
    const arr = tokenTimes.current;
    const cutoff = now - 1000;
    let drop = 0;
    while (drop < arr.length && arr[drop] < cutoff) drop++;
    if (drop > 0) arr.splice(0, drop);

    return {
      streaming: streaming.current,
      tokensPerSec: arr.length, // tokens streamed in the last second
      sessionTokens: sessionTokens.current,
      toolActive: now < toolUntil.current,
      thinking: now < thinkingUntil.current,
      lastTool: lastTool.current,
      budget: budget.current,
    };
  };

  const controller = useRef<TelemetryController>({
    getFrame(): TelemetryFrame {
      const snap = snapshot();
      const drained = events.current;
      events.current = [];
      return { snapshot: snap, events: drained };
    },
    peek: () => snapshot(),
    emit(ev) { events.current.push(ev); },
    setSessionTokens(n) { sessionTokens.current = n; },
    setBudget(n) { budget.current = n; },
  });

  return controller.current;
}
