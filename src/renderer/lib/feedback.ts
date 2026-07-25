// Haptic + audio feedback specs. Pure data + math so the whole table is unit-testable; the actual
// playback (gamepad vibrationActuator / WebAudio) lives in useFeedback.
//
// Sounds are synthesized from oscillator specs rather than shipped as audio assets — the constraint
// is to keep the bundle small, and a chime is cheaper to describe than to store.

export type FeedbackEvent =
  | 'tool-success'
  | 'tool-error'
  | 'message-complete'
  | 'voice-start'
  | 'voice-stop'
  | 'write-applied'
  | 'crash';

export interface RumblePattern {
  duration: number;         // ms
  strongMagnitude: number;  // 0..1 (low-frequency motor)
  weakMagnitude: number;    // 0..1 (high-frequency motor)
}

export interface ToneSpec {
  freq: number;      // Hz
  duration: number;  // ms
  delay: number;     // ms after trigger
  gain: number;      // 0..1 peak
  type: 'sine' | 'square' | 'triangle';
}

// Upper bounds keep a bug from pinning the motors on or blasting the speaker.
export const MAX_RUMBLE_MS = 600;
export const MAX_TONE_MS = 600;

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Light tick on success, longer buzz on error, subtle pulse on completion.
export const RUMBLE: Record<FeedbackEvent, RumblePattern | null> = {
  'tool-success': { duration: 35, strongMagnitude: 0, weakMagnitude: 0.35 },
  'tool-error': { duration: 260, strongMagnitude: 0.65, weakMagnitude: 0.3 },
  'message-complete': { duration: 90, strongMagnitude: 0.18, weakMagnitude: 0.25 },
  'voice-start': { duration: 25, strongMagnitude: 0, weakMagnitude: 0.5 },
  'voice-stop': { duration: 25, strongMagnitude: 0, weakMagnitude: 0.3 },
  'write-applied': { duration: 60, strongMagnitude: 0.25, weakMagnitude: 0.4 },
  'crash': { duration: 400, strongMagnitude: 0.9, weakMagnitude: 0.6 },
};

// Chime on complete, low tone on error, keypress-style tick on voice start/stop.
export const TONES: Record<FeedbackEvent, ToneSpec[]> = {
  'tool-success': [{ freq: 880, duration: 40, delay: 0, gain: 0.05, type: 'sine' }],
  'tool-error': [{ freq: 160, duration: 260, delay: 0, gain: 0.12, type: 'square' }],
  'message-complete': [
    { freq: 660, duration: 110, delay: 0, gain: 0.09, type: 'sine' },
    { freq: 990, duration: 150, delay: 90, gain: 0.07, type: 'sine' },
  ],
  'voice-start': [{ freq: 1200, duration: 30, delay: 0, gain: 0.06, type: 'triangle' }],
  'voice-stop': [{ freq: 700, duration: 30, delay: 0, gain: 0.06, type: 'triangle' }],
  'write-applied': [{ freq: 760, duration: 70, delay: 0, gain: 0.07, type: 'sine' }],
  'crash': [
    { freq: 220, duration: 180, delay: 0, gain: 0.12, type: 'square' },
    { freq: 110, duration: 300, delay: 140, gain: 0.12, type: 'square' },
  ],
};

// Normalize a pattern into something safe to hand the vibration actuator.
export function safeRumble(p: RumblePattern): RumblePattern {
  return {
    duration: Math.max(0, Math.min(MAX_RUMBLE_MS, Math.round(p.duration))),
    strongMagnitude: clamp01(p.strongMagnitude),
    weakMagnitude: clamp01(p.weakMagnitude),
  };
}

// Total wall-clock a cue occupies, so callers can avoid stacking overlapping cues.
export function toneLength(specs: ToneSpec[]): number {
  return specs.reduce((max, s) => Math.max(max, s.delay + s.duration), 0);
}
