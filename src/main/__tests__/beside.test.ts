import { describe, it, expect } from 'vitest';
import { Beside, GONE_MS, START_MS, UPDATE_MS, baseLayer, parseFocused, type BesideDeps } from '../beside';

const ADK = '3275856054';
const GAME = '413150';

// A pretend Deck: which app gamescope shows, and whether the game's Steam launch is running.
function deck() {
  const d = { focused: ADK, running: false, now: 0, base: [] as string[], launched: [] as string[], update: null as { pct: number | null } | null };
  const deps: BesideDeps = {
    run: async (cmd, args) => {
      if (cmd === 'pgrep') return d.running ? '123\n' : '';
      if (args.includes('-set')) { d.base.push(args[args.length - 1]); return ''; }
      return `GAMESCOPE_FOCUSED_APP_GFX(CARDINAL) = ${d.focused}\n`;
    },
    launch: (appid) => { d.launched.push(appid); },
    now: () => d.now,
    update: () => d.update,
  };
  return { d, deps };
}

describe('playing a Steam game beside AnthroDeck', () => {
  it('reads what gamescope shows, and orders what it falls back to', () => {
    expect(parseFocused('GAMESCOPE_FOCUSED_APP_GFX(CARDINAL) = 413150\n')).toBe('413150');
    expect(parseFocused('GAMESCOPE_FOCUSED_APP_GFX:  not found.\n')).toBeNull();
    expect(baseLayer(GAME, ADK)).toBe(`${GAME}, ${ADK}, 769`);
    expect(baseLayer(ADK, null)).toBe(`${ADK}, 769`);
  });

  it('starts the game, knows when it covers AnthroDeck, switches both ways, and comes back when it quits', async () => {
    const { d, deps } = deck();
    const b = new Beside(ADK, deps);
    const states: unknown[] = [];
    b.on('state', (s) => states.push(s));
    b.play(GAME, 'Stardew Valley');
    b.stop();                                   // polled by hand below
    expect(d.launched).toEqual([GAME]);
    expect(b.state()).toEqual({ game: { appid: GAME, name: 'Stardew Valley' }, starting: true, update: null, shown: true });

    d.running = true; d.focused = GAME;
    await b.poll();
    expect(b.state()).toMatchObject({ starting: false, shown: false });

    await b.show('deck');
    expect(d.base.pop()).toBe(`${ADK}, ${GAME}, 769`);
    await b.show('game');
    expect(d.base.pop()).toBe(`${GAME}, ${ADK}, 769`);

    // Steam swaps the launch process while a game starts: a moment without it isn't a quit.
    d.running = false;
    await b.poll();
    expect(b.state().game).not.toBeNull();
    d.running = true;
    await b.poll();
    d.running = false; d.focused = '';
    await b.poll();
    d.now += GONE_MS;
    await b.poll();
    expect(d.base.pop()).toBe(`${ADK}, 769`);   // gamescope would otherwise keep the quit game's last frame
    expect(b.state()).toEqual({ game: null, starting: false, update: null, shown: true });
    expect(states.length).toBeGreaterThan(2);
  });

  it('gives a slow game time to start, then gives up on one that never does', async () => {
    const { d, deps } = deck();
    const b = new Beside(ADK, deps);
    b.play(GAME, 'Slow');
    b.stop();
    d.now = START_MS - 1;
    await b.poll();
    expect(b.state().game).not.toBeNull();
    d.now = START_MS + 1;
    await b.poll();
    expect(b.state().game).toBeNull();
  });

  it('notices a game started from Steam\'s own library covering AnthroDeck', async () => {
    const { d, deps } = deck();
    const b = new Beside(ADK, deps);
    d.focused = GAME;
    await b.poll();
    expect(b.state()).toEqual({ game: null, starting: false, update: null, shown: false });
  });

  it('waits out an update Steam runs first, and says how far along it is', async () => {
    const { d, deps } = deck();
    const b = new Beside(ADK, deps);
    d.update = { pct: null };
    b.play(GAME, 'Stardew Valley');
    b.stop();
    expect(b.state()).toMatchObject({ starting: true, update: { pct: null } });
    d.now = START_MS + 1; d.update = { pct: 40 };
    await b.poll();
    expect(b.state()).toMatchObject({ starting: true, update: { pct: 40 } });   // still waiting, past the start's usual time
    d.update = null; d.now = START_MS + 2;
    await b.poll();
    expect(b.state()).toMatchObject({ starting: true, update: null });          // updated: the usual time runs from here
    d.now = 2 * START_MS + 3;
    await b.poll();
    expect(b.state().game).toBeNull();
    d.update = { pct: 1 };
    b.play(GAME, 'Stardew Valley');
    b.stop();
    d.now += UPDATE_MS + 1;
    await b.poll();
    expect(b.state().game).toBeNull();                                          // an update that never ends
  });
});
