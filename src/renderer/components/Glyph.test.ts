import { describe, expect, it } from 'vitest';
import { withGlyphs } from './Glyph';

describe('withGlyphs', () => {
  it('draws the buttons named in a sentence and leaves the words alone', () => {
    expect(withGlyphs('No buttons here')).toBe('No buttons here');
    const parts = withGlyphs('Hold [X] to talk, [View] drops it') as unknown[];
    expect(parts).toHaveLength(5);
    expect(parts[0]).toMatchObject({ props: { children: 'Hold ' } });
    expect(parts[1]).toMatchObject({ props: { b: 'X' } });
    expect(parts[3]).toMatchObject({ props: { b: 'View' } });
  });
});
