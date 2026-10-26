import { describe, it, expect } from 'vitest';
import { quitWatchdog } from '../quitWatchdog';

function harness() {
  const timers: { fn: () => void; ms: number }[] = [];
  const calls: string[] = [];
  const arm = quitWatchdog({
    setTimer: (fn, ms) => { timers.push({ fn, ms }); },
    exit: (code) => calls.push(`exit ${code}`),
    kill: () => calls.push('kill'),
    log: () => {},
  }, 4000, 2000);
  const fire = () => timers.shift()!.fn();
  return { arm, timers, calls, fire };
}

describe('quitWatchdog', () => {
  it('does nothing until a quit begins', () => {
    const h = harness();
    expect(h.timers).toHaveLength(0);
  });

  it('forces an exit after the grace period, then kills if that doesn\'t land', () => {
    const h = harness();
    h.arm();
    expect(h.timers.map((t) => t.ms)).toEqual([4000]);
    h.fire();
    expect(h.calls).toEqual(['exit 0']);
    expect(h.timers.map((t) => t.ms)).toEqual([2000]);
    h.fire();
    expect(h.calls).toEqual(['exit 0', 'kill']);
  });

  it('arms once however many quit events fire', () => {
    const h = harness();
    h.arm(); h.arm(); h.arm();
    expect(h.timers).toHaveLength(1);
  });
});
