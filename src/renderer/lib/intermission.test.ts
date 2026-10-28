import { describe, expect, it } from 'vitest';
import { finished, lastWords, nextSelection, railOrder, shouldStart, stillDismissed, tidyHit, turnOf, START_AFTER_MS, TIDY_HITS, type Job } from './intermission';

const deck = (working: boolean): Job => ({ id: 'deck', label: 'Fix login', remote: false, working });
const mac = (working: boolean): Job => ({ id: 'm1', label: 'API work', remote: true, working });
const base = { enabled: true, jobs: [deck(true)], needsYou: false, idleMs: START_AFTER_MS, busyScreen: false, playing: false, dismissed: new Set<string>() };

describe('intermission', () => {
  it('starts the game once Claude is working and the controls have been put down', () => {
    expect(shouldStart(base)).toBe(true);
    expect(shouldStart({ ...base, idleMs: START_AFTER_MS - 1 })).toBe(false);
    expect(shouldStart({ ...base, jobs: [deck(false), mac(false)] })).toBe(false);
    expect(shouldStart({ ...base, jobs: [deck(false), mac(true)] })).toBe(true);   // a Mac session counts too
  });

  it('never takes over a card, the keyboard, an open game, or a pilot who turned it off', () => {
    expect(shouldStart({ ...base, needsYou: true })).toBe(false);
    expect(shouldStart({ ...base, busyScreen: true })).toBe(false);
    expect(shouldStart({ ...base, playing: true })).toBe(false);
    expect(shouldStart({ ...base, enabled: false })).toBe(false);
  });

  it('closing the game means not now, until another session starts working or this one takes its next turn', () => {
    const dismissed = new Set(['deck']);
    expect(shouldStart({ ...base, dismissed })).toBe(false);
    expect(shouldStart({ ...base, dismissed, jobs: [deck(true), mac(true)] })).toBe(true);
    // The turn ends: the Deck's session leaves the set, so its next turn brings the game back.
    expect(stillDismissed(dismissed, [deck(false)])).toEqual(new Set());
    expect(stillDismissed(dismissed, [deck(true)])).toEqual(new Set(['deck']));
  });

  it('reports the sessions that just finished, including one that went away', () => {
    expect(finished([deck(true), mac(true)], [deck(false), mac(true)]).map((j) => j.id)).toEqual(['deck']);
    expect(finished([mac(true)], []).map((j) => [j.id, j.working])).toEqual([['m1', false]]);
    expect(finished([deck(false)], [deck(false)])).toEqual([]);
  });

  it('queues a tidy-up once enough stale context is cleared while the context is filling up', () => {
    let t = { hits: 0, queued: false };
    expect(tidyHit(t, 30)).toBe(t);       // nothing worth tidying yet
    expect(tidyHit(t, null)).toBe(t);
    for (let i = 0; i < TIDY_HITS; i++) t = tidyHit(t, 64);
    expect(t).toEqual({ hits: TIDY_HITS, queued: true });
    expect(tidyHit(t, 64)).toBe(t);       // already queued
  });

  it('orders the comms rail by what needs the pilot, and Y walks it', () => {
    const asking = { ...mac(true), id: 'm2', needs: 1 };
    const finishedOne = { ...mac(false), id: 'm3' };
    expect([turnOf(asking), turnOf(finishedOne), turnOf(deck(true))]).toEqual(['needs-you', 'your-turn', 'working']);
    const rail = railOrder([deck(true), finishedOne, asking]);
    expect(rail.map((j) => j.id)).toEqual(['m2', 'm3', 'deck']);
    expect(nextSelection(rail, null)).toBe('m2');
    expect(nextSelection(rail, 'm2')).toBe('m3');
    expect(nextSelection(rail, 'deck')).toBe('m2');
    expect(nextSelection([], 'deck')).toBeNull();
  });

  it('shows the end of what Claude said, as plain text', () => {
    expect(lastWords('Done. Run `npm test`?')).toBe('Done. Run npm test?');
    expect(lastWords('**Fixed**\n```ts\nconst a = 1;\n```\nShip it?')).toBe('Fixed Ship it?');
    const long = lastWords(`${'word '.repeat(200)}Want me to commit?`, 40);
    expect(long.startsWith('…')).toBe(true);
    expect(long.endsWith('Want me to commit?')).toBe(true);
  });
});
