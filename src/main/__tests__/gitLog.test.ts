import { describe, expect, it } from 'vitest';
import { parseGitLog } from '../gitLog';

describe('parseGitLog', () => {
  it('reads commits with their refs, whatever the subject holds', () => {
    const out = [
      'a1b2c3d\x1ffix: commas, "quotes" | pipes\x1fKeaton\x1f1793170200\x1fHEAD -> main, tag: v0.9.14, origin/main, origin/HEAD\x1e',
      '\ne4f5a6b\x1fv0.9.13\x1fKeaton\x1f1793160000\x1f\x1e',
    ].join('');
    expect(parseGitLog(out)).toEqual([
      { hash: 'a1b2c3d', subject: 'fix: commas, "quotes" | pipes', author: 'Keaton', at: 1793170200000, refs: ['main', 'v0.9.14', 'origin/main'] },
      { hash: 'e4f5a6b', subject: 'v0.9.13', author: 'Keaton', at: 1793160000000, refs: [] },
    ]);
    expect(parseGitLog('')).toEqual([]);
  });
});
