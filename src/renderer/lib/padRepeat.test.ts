import { describe, expect, it } from 'vitest';
import { holdFires, REPEAT_DELAY_MS, REPEAT_EVERY_MS, type HoldState } from './padRepeat';

// Feed one frame every 16 ms while the button is held for `ms`, and count the steps.
function stepsWhileHeld(ms: number): number {
  let st: HoldState | null = null;
  let fires = 0;
  for (let t = 0; t <= ms; t += 16) {
    const r = holdFires(true, t, st);
    st = r.st;
    if (r.fire) fires++;
  }
  return fires;
}

describe('holdFires', () => {
  it('steps once on a tap, however long the first frames last', () => {
    expect(stepsWhileHeld(REPEAT_DELAY_MS - 20)).toBe(1);
  });

  it('repeats steadily once held past the delay', () => {
    const held = REPEAT_DELAY_MS + 10 * REPEAT_EVERY_MS;
    const n = stepsWhileHeld(held);
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(12);
  });

  it('resets on release', () => {
    expect(holdFires(false, 500, { since: 0, last: 400 })).toEqual({ fire: false, st: null });
    expect(holdFires(true, 600, null).fire).toBe(true);
  });
});
