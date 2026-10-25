import { useEffect, useRef } from 'react';
import { GameMode, GameInput, GameIntent, NEUTRAL_INPUT, type TelemetryEvent } from '../game/types';
import { TelemetryController } from './useTelemetry';

const DEAD = 0.18;

function dz(v: number): number {
  return Math.abs(v) < DEAD ? 0 : v;
}

// A race outlives the cockpit overlay: closing it to read the chat parks the race, reopening it at
// the same size resumes it. One parked race per mode; ↺ (forgetRace) or a wreck starts fresh.
const parked = new Map<string, { state: unknown; w: number; h: number }>();

export function forgetRace(modeId: string): void {
  parked.delete(modeId);
}

// What happened while the race was parked. Real outcomes still count (the team's results don't
// wait for the driver); a session's worth of tool-call hunters arriving at once would just be a
// pile-up, so those are dropped.
export function carriedOver(events: TelemetryEvent[]): TelemetryEvent[] {
  return events.filter((e) => e.type === 'sector' || e.type === 'milestone' || e.type === 'done');
}

// Reads the gamepad (with keyboard fallback) and drives a GameMode's step()/render() on rAF.
export function useGameLoop(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  mode: GameMode | undefined,
  telemetry: TelemetryController,
  active: boolean,
  paused: boolean,
  restartKey: number | string,
  onIntents?: (intents: GameIntent[]) => void,
  onGameOver?: (score: number) => void,
) {
  const onIntentsRef = useRef(onIntents);
  onIntentsRef.current = onIntents;
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;
  const reportedRef = useRef(false);
  const keys = useRef<Record<string, boolean>>({});
  const stateRef = useRef<unknown>(null);
  const carryRef = useRef<TelemetryEvent[]>([]);
  const hudRef = useRef<string>('');

  // Track keyboard state for a controller-less fallback.
  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = true; };
    const up = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keys.current = {};
    };
  }, [active]);

  // (Re)initialize the sim on mode change / restart / resize, or resume the parked race.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!mode || !canvas) return;
    const queued = telemetry.getFrame().events;
    const p = parked.get(mode.id);
    if (p && p.w === canvas.width && p.h === canvas.height && !mode.isOver?.(p.state as never)) {
      stateRef.current = p.state;
      carryRef.current = [...carryRef.current, ...carriedOver(queued)];
    } else {
      // A fresh race: whatever queued up before it belongs to no race.
      stateRef.current = mode.init(canvas.width, canvas.height);
      carryRef.current = [];
    }
    reportedRef.current = false;
  }, [mode, restartKey, canvasRef, telemetry]);

  useEffect(() => {
    if (!active || !mode) return;
    let raf = 0;
    let last = performance.now();

    const readInput = (): GameInput => {
      const k = keys.current;
      const gp = navigator.getGamepads?.()[0] ?? null;

      let steer = 0, moveY = 0, aimX = 0, aimY = 0, throttle = 0, brake = 0;
      let fire = false, boost = false, up = false, downB = false, left = false, right = false;

      if (gp) {
        const lx = dz(gp.axes[0] ?? 0);
        const ly = dz(gp.axes[1] ?? 0);
        const rx = dz(gp.axes[2] ?? 0);
        const ry = dz(gp.axes[3] ?? 0);
        // Steer from whichever horizontal stick is active — lets a gyro→stick (Steam Input) mapping
        // drive steering without extra config; falls back to the right stick / left stick otherwise.
        steer = Math.abs(rx) > Math.abs(lx) ? rx : lx;
        moveY = ly;
        aimX = rx; aimY = ry;
        throttle = gp.buttons[7]?.value ?? 0; // RT
        brake = gp.buttons[6]?.value ?? 0;    // LT
        fire = (gp.buttons[7]?.value ?? 0) > 0.3 || (gp.buttons[0]?.pressed ?? false); // RT or A
        boost = (gp.buttons[1]?.pressed ?? false) || (gp.buttons[4]?.pressed ?? false); // B or LB
        up = gp.buttons[12]?.pressed ?? false;
        downB = gp.buttons[13]?.pressed ?? false;
        left = gp.buttons[14]?.pressed ?? false;
        right = gp.buttons[15]?.pressed ?? false;
      }

      // Keyboard fallback (overrides when pressed).
      if (k['arrowleft'] || k['a']) { steer = -1; left = true; }
      if (k['arrowright'] || k['d']) { steer = 1; right = true; }
      if (k['arrowup'] || k['w']) { moveY = -1; up = true; throttle = 1; }
      if (k['arrowdown'] || k['s']) { moveY = 1; downB = true; brake = 1; }
      if (k[' ']) fire = true;
      if (k['shift']) boost = true;

      return { steer, moveY, throttle, brake, aimX, aimY, fire, boost, up, down: downB, left, right };
    };

    const frame = (now: number) => {
      const canvas = canvasRef.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (canvas && stateRef.current != null) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (!paused) {
            const input = active ? readInput() : NEUTRAL_INPUT;
            let tel = telemetry.getFrame();
            if (carryRef.current.length) {
              tel = { ...tel, events: [...carryRef.current, ...tel.events] };
              carryRef.current = [];
            }
            stateRef.current = mode.step(stateRef.current as never, input, tel, dt);
            parked.set(mode.id, { state: stateRef.current, w: canvas.width, h: canvas.height });
            hudRef.current = mode.hud(stateRef.current as never);

            // Drain any intents the mode raised this step — this is how destroying the right thing
            // in a game does real work on the session (see game/types.ts).
            const carrier = stateRef.current as { intents?: GameIntent[] };
            if (carrier?.intents?.length) {
              onIntentsRef.current?.(carrier.intents);
              stateRef.current = { ...(stateRef.current as object), intents: [] };
            }

            // Report the final score once, the first frame the run ends.
            if (!reportedRef.current && mode.isOver?.(stateRef.current as never)) {
              reportedRef.current = true;
              onGameOverRef.current?.(mode.score?.(stateRef.current as never) ?? 0);
            }
          }
          mode.render(ctx, stateRef.current as never, canvas.width, canvas.height);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, mode, paused, telemetry, canvasRef]);

  return hudRef;
}
