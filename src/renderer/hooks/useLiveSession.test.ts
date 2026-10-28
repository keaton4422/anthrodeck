import { describe, expect, it } from 'vitest';
import { sameMessage } from './useLiveSession';

describe('useLiveSession', () => {
  it('matches the pilot\'s message to what the session shows, clipped or not', () => {
    expect(sameMessage('Add a test', 'Add a test')).toBe(true);
    const long = 'x'.repeat(5000);
    expect(sameMessage(long, `${long.slice(0, 4000)}…`)).toBe(true);
    expect(sameMessage('Add a test', 'Add a toast')).toBe(false);
    expect(sameMessage('Add a test', '…')).toBe(false);
  });
});
