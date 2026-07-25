import { describe, it, expect } from 'vitest';
import {
  resolveChord,
  radialIndexFromStick,
  commandForAction,
  RADIAL_ITEMS,
  RADIAL_DEADZONE,
  CHORD_MAP,
} from './controls';
import {
  RUMBLE,
  TONES,
  safeRumble,
  toneLength,
  clamp01,
  MAX_RUMBLE_MS,
  type FeedbackEvent,
} from './feedback';
import { stripToolLines, countToolLines } from './pilot';

describe('resolveChord', () => {
  it('returns null without the modifier so normal button behavior runs', () => {
    expect(resolveChord(false, 'A')).toBeNull();
    expect(resolveChord(false, 'Y')).toBeNull();
  });

  it('maps each face button to its meta action when held', () => {
    expect(resolveChord(true, 'A')).toBe('git-status');
    expect(resolveChord(true, 'B')).toBe('git-commit');
    expect(resolveChord(true, 'X')).toBe('run-tests');
    expect(resolveChord(true, 'Y')).toBe('undo-write');
  });

  it('covers all four face buttons', () => {
    expect(Object.keys(CHORD_MAP).sort()).toEqual(['A', 'B', 'X', 'Y']);
  });
});

describe('radialIndexFromStick', () => {
  const n = RADIAL_ITEMS.length;

  it('returns null inside the deadzone', () => {
    expect(radialIndexFromStick(0, 0, n)).toBeNull();
    expect(radialIndexFromStick(RADIAL_DEADZONE / 2, 0, n)).toBeNull();
  });

  it('maps straight up to index 0', () => {
    expect(radialIndexFromStick(0, -1, n)).toBe(0);
  });

  it('increases clockwise and wraps', () => {
    // Just clockwise of straight-up lands on 1; just counter-clockwise wraps to the last wedge.
    const wedge = (Math.PI * 2) / n;
    const at = (a: number) => radialIndexFromStick(Math.sin(a), -Math.cos(a), n);
    expect(at(wedge)).toBe(1);
    expect(at(wedge * 2)).toBe(2);
    expect(at(-wedge)).toBe(n - 1);
  });

  it('always returns a valid index outside the deadzone', () => {
    for (let deg = 0; deg < 360; deg += 7) {
      const a = (deg * Math.PI) / 180;
      const idx = radialIndexFromStick(Math.sin(a), -Math.cos(a), n);
      expect(idx).not.toBeNull();
      expect(idx!).toBeGreaterThanOrEqual(0);
      expect(idx!).toBeLessThan(n);
    }
  });

  it('handles a zero-item menu', () => {
    expect(radialIndexFromStick(0, -1, 0)).toBeNull();
  });
});

describe('commandForAction', () => {
  it('gives shell commands for shell-backed actions', () => {
    expect(commandForAction('git-status')).toContain('git status');
    expect(commandForAction('run-tests')).toBe('npm test');
  });

  it('returns null for in-app actions', () => {
    expect(commandForAction('undo-write')).toBeNull();
    expect(commandForAction('prune-context')).toBeNull();
    expect(commandForAction('git-commit')).toBeNull();
  });
});

describe('feedback tables', () => {
  const events: FeedbackEvent[] = [
    'tool-success', 'tool-error', 'message-complete',
    'voice-start', 'voice-stop', 'write-applied', 'crash',
  ];

  it('defines a tone set for every event', () => {
    for (const e of events) {
      expect(TONES[e]).toBeDefined();
      expect(TONES[e].length).toBeGreaterThan(0);
    }
  });

  it('keeps rumble magnitudes in range and durations bounded', () => {
    for (const e of events) {
      const p = RUMBLE[e];
      if (!p) continue;
      const s = safeRumble(p);
      expect(s.strongMagnitude).toBeGreaterThanOrEqual(0);
      expect(s.strongMagnitude).toBeLessThanOrEqual(1);
      expect(s.weakMagnitude).toBeGreaterThanOrEqual(0);
      expect(s.weakMagnitude).toBeLessThanOrEqual(1);
      expect(s.duration).toBeGreaterThan(0);
      expect(s.duration).toBeLessThanOrEqual(MAX_RUMBLE_MS);
    }
  });

  it('safeRumble clamps out-of-range input', () => {
    const s = safeRumble({ duration: 99999, strongMagnitude: 5, weakMagnitude: -2 });
    expect(s.duration).toBe(MAX_RUMBLE_MS);
    expect(s.strongMagnitude).toBe(1);
    expect(s.weakMagnitude).toBe(0);
  });

  it('clamp01 handles NaN', () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it('toneLength accounts for delayed notes', () => {
    expect(toneLength([
      { freq: 1, duration: 100, delay: 0, gain: 0.1, type: 'sine' },
      { freq: 1, duration: 50, delay: 200, gain: 0.1, type: 'sine' },
    ])).toBe(250);
  });

  it('error cue is more forceful than the success tick', () => {
    expect(RUMBLE['tool-error']!.duration).toBeGreaterThan(RUMBLE['tool-success']!.duration);
  });
});

describe('tool line collapsing', () => {
  const content = [
    'Looking at the code.',
    '`read: src/App.tsx`',
    '`$ npm test`',
    'All tests pass.',
    '`✓ wrote: src/x.ts`',
  ].join('\n');

  it('counts tool lines', () => {
    expect(countToolLines(content)).toBe(3);
  });

  it('strips tool lines but keeps prose', () => {
    const out = stripToolLines(content);
    expect(out).toContain('Looking at the code.');
    expect(out).toContain('All tests pass.');
    expect(out).not.toContain('read:');
    expect(out).not.toContain('npm test');
  });

  it('leaves prose-only content untouched', () => {
    expect(stripToolLines('just prose')).toBe('just prose');
    expect(countToolLines('just prose')).toBe(0);
  });
});
