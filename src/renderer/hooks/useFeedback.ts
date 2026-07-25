import { useCallback, useEffect, useRef } from 'react';
import { FeedbackEvent, RUMBLE, TONES, safeRumble } from '../lib/feedback';

// Plays the haptic/audio cues described in lib/feedback. Both channels degrade silently: a
// controller without a vibration actuator, or a browser that blocks audio until first interaction,
// just produces no cue rather than an error.

interface ActuatorLike {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
}

export interface FeedbackOptions {
  haptics: boolean;
  sound: boolean;
}

export function useFeedback(opts: FeedbackOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const ctxRef = useRef<AudioContext | null>(null);
  // Collapse duplicate cues fired in the same tick (e.g. several tools finishing together).
  const lastRef = useRef<{ event: FeedbackEvent | null; at: number }>({ event: null, at: 0 });

  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => { /* ignore */ });
      ctxRef.current = null;
    };
  }, []);

  const rumble = useCallback((event: FeedbackEvent) => {
    const pattern = RUMBLE[event];
    if (!pattern) return;
    try {
      const gp = navigator.getGamepads?.()[0];
      const actuator = (gp as unknown as { vibrationActuator?: ActuatorLike } | null)?.vibrationActuator;
      if (!actuator?.playEffect) return;
      const safe = safeRumble(pattern);
      void actuator.playEffect('dual-rumble', {
        duration: safe.duration,
        strongMagnitude: safe.strongMagnitude,
        weakMagnitude: safe.weakMagnitude,
      })?.catch?.(() => { /* unsupported effect type */ });
    } catch {
      /* no actuator */
    }
  }, []);

  const beep = useCallback((event: FeedbackEvent) => {
    const specs = TONES[event];
    if (!specs || specs.length === 0) return;
    try {
      if (!ctxRef.current) ctxRef.current = new AudioContext();
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* ignore */ });

      for (const spec of specs) {
        const start = ctx.currentTime + spec.delay / 1000;
        const end = start + spec.duration / 1000;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = spec.type;
        osc.frequency.setValueAtTime(spec.freq, start);
        // Quick attack, exponential release — reads as a "tick"/"chime" rather than a click.
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, spec.gain), start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(end + 0.02);
      }
    } catch {
      /* audio unavailable */
    }
  }, []);

  const fire = useCallback((event: FeedbackEvent) => {
    const now = Date.now();
    const last = lastRef.current;
    if (last.event === event && now - last.at < 60) return;
    lastRef.current = { event, at: now };

    if (optsRef.current.haptics) rumble(event);
    if (optsRef.current.sound) beep(event);
  }, [rumble, beep]);

  return fire;
}
