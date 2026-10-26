import { describe, expect, it } from 'vitest';
import { timeAgo } from './timeAgo';

describe('timeAgo', () => {
  const now = Date.UTC(2026, 9, 25, 12);
  it('steps from seconds to days', () => {
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 12 * 60_000, now)).toBe('12m ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('falls back to a date for old work, and never goes negative', () => {
    expect(timeAgo(now - 40 * 86_400_000, now)).not.toMatch(/ago/);
    expect(timeAgo(now + 5_000, now)).toBe('just now');
  });
});
