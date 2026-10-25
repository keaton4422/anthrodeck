import { describe, it, expect } from 'vitest';
import { cleanItem, parseNote, whatsNew } from '../releaseNotes';

// The v0.8.3 note exactly as GitHub's releases feed serves it (attributes trimmed).
const V083 = `<h2>What's Changed</h2>
<ul>
<li>fix(game): a race that lasts the session, scored by what ships by <a class="user-mention" href="https://github.com/keaton4422">@keaton4422</a> in <a class="issue-link" href="https://github.com/keaton4422/anthrodeck/pull/3">#3</a></li>
</ul>
<p><strong>Full Changelog</strong>: <a class="commit-link" href="https://github.com/keaton4422/anthrodeck/compare/v0.8.2...v0.8.3"><tt>v0.8.2...v0.8.3</tt></a></p>`;

describe('cleanItem', () => {
  it('drops the conventional-commit prefix and the author/PR credit', () => {
    expect(cleanItem('fix(game): a race that lasts the session by @keaton4422 in #3'))
      .toBe('A race that lasts the session');
    expect(cleanItem('ci: bump actions by @dependabot[bot] in https://github.com/o/r/pull/9'))
      .toBe('Bump actions');
  });

  it('leaves plain prose alone, apart from capitalising it', () => {
    expect(cleanItem('lap cards over the track')).toBe('Lap cards over the track');
  });

  it('caps very long titles', () => {
    expect(cleanItem('x'.repeat(400)).length).toBeLessThanOrEqual(140);
  });
});

describe('parseNote', () => {
  it('turns GitHub release HTML into plain bullets without the boilerplate', () => {
    expect(parseNote(V083)).toEqual(['A race that lasts the session, scored by what ships']);
  });

  it('never lets markup or entities through', () => {
    const items = parseNote('<ul><li>Fix <b>&lt;script&gt;</b> &amp; <img src=x onerror=alert(1)> crash</li></ul>');
    expect(items).toEqual(['Fix <script> & crash']);
    // Decoded text is rendered as React text, so "<script>" here is characters, not a tag.
  });

  it('hides pipeline and housekeeping changes a pilot never sees', () => {
    // The v0.8.4 note: two of its four PRs were CI-only.
    const v084 = '<ul>'
      + '<li>ci: Node 24 actions, Node 22 builds by @keaton4422 in #4</li>'
      + '<li>feat(updater): show what\'s new in the update prompt by @keaton4422 in #6</li>'
      + '<li>ci: Dependabot for GitHub Actions by @keaton4422 in #5</li>'
      + '<li>feat(updater): Windows links to the latest release by @keaton4422 in #7</li>'
      + '<li>chore(deps): bump vite by @dependabot[bot] in #8</li>'
      + '<li>build: smaller AppImage in #9</li><li>test!: new harness in #10</li><li>docs(readme): typo in #11</li>'
      + '</ul>';
    expect(parseNote(v084)).toEqual([
      "Show what's new in the update prompt",
      'Windows links to the latest release',
    ]);
  });

  it('keeps unprefixed titles and words that merely start like a prefix', () => {
    expect(parseNote('<ul><li>Faster boot in #1</li><li>Testing mode for new pilots in #2</li><li>Chores list in the drawer in #3</li></ul>'))
      .toEqual(['Faster boot', 'Testing mode for new pilots', 'Chores list in the drawer']);
  });

  it('reads hand-written paragraph notes too', () => {
    expect(parseNote('<p>Faster boot.</p><p>New track: Monaco.</p><p><strong>Full Changelog</strong>: x</p>'))
      .toEqual(['Faster boot.', 'New track: Monaco.']);
  });
});

describe('whatsNew', () => {
  it('handles the single-string form', () => {
    expect(whatsNew(V083)).toEqual([{ version: null, items: ['A race that lasts the session, scored by what ships'] }]);
  });

  it('keeps the newest few versions a skipped-ahead Deck missed, and drops empty ones', () => {
    const notes = ['0.9.3', '0.9.2', '0.9.1', '0.9.0'].map((v) => ({ version: v, note: `<ul><li>feat: thing ${v}</li></ul>` }));
    notes.splice(1, 0, { version: '0.9.25', note: null as unknown as string });
    const out = whatsNew(notes);
    expect(out.map((n) => n.version)).toEqual(['0.9.3', '0.9.2']);
    expect(out[0].items).toEqual(['Thing 0.9.3']);
  });

  it('drops a release that was all housekeeping', () => {
    expect(whatsNew([
      { version: '0.9.1', note: '<ul><li>ci: bump the actions group by @dependabot[bot] in #12</li></ul>' },
      { version: '0.9.0', note: '<ul><li>feat: Monaco track in #11</li></ul>' },
    ])).toEqual([{ version: '0.9.0', items: ['Monaco track'] }]);
  });

  it('is empty when there are no notes', () => {
    expect(whatsNew(null)).toEqual([]);
    expect(whatsNew('')).toEqual([]);
  });
});
