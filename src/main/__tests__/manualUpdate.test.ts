import { describe, it, expect } from 'vitest';
import { isNewer, parseLatestRelease } from '../manualUpdate';

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.8.4',
  html_url: 'https://github.com/keaton4422/anthrodeck/releases/tag/v0.8.4',
  body_html: '<h2>What\'s Changed</h2><ul><li>feat(updater): what\'s new in the update prompt by @keaton4422 in #6</li></ul>',
  ...over,
});

describe('isNewer', () => {
  it('compares x.y.z numerically, not as strings', () => {
    expect(isNewer('0.8.10', '0.8.9')).toBe(true);
    expect(isNewer('v0.9.0', '0.8.3')).toBe(true);
    expect(isNewer('0.8.3', '0.8.3')).toBe(false);
    expect(isNewer('0.8.2', '0.8.3')).toBe(false);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
  });
});

describe('parseLatestRelease', () => {
  it('reports a newer release with its notes and its release page', () => {
    expect(parseLatestRelease(release(), '0.8.3')).toEqual({
      version: '0.8.4',
      notes: [{ version: null, items: ["What's new in the update prompt"] }],
      manualUrl: 'https://github.com/keaton4422/anthrodeck/releases/tag/v0.8.4',
    });
  });

  it('is quiet when already up to date', () => {
    expect(parseLatestRelease(release({ tag_name: 'v0.8.3' }), '0.8.3')).toBeNull();
  });

  it('never hands the browser a link outside this repo\'s releases', () => {
    expect(parseLatestRelease(release({ html_url: 'https://evil.example/anthrodeck' }), '0.8.3')).toBeNull();
    expect(parseLatestRelease(release({ html_url: 'https://github.com/someone-else/anthrodeck/releases/tag/v9' }), '0.8.3')).toBeNull();
  });

  it('tolerates junk and missing notes', () => {
    expect(parseLatestRelease(null, '0.8.3')).toBeNull();
    expect(parseLatestRelease({ message: 'API rate limit exceeded' }, '0.8.3')).toBeNull();
    expect(parseLatestRelease(release({ body_html: undefined }), '0.8.3')?.notes).toEqual([]);
  });
});
