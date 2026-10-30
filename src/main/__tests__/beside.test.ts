import { describe, it, expect } from 'vitest';
import { Beside, START_MS, baseLayer, parseFocused, type BesideDeps } from '../beside';

const ADK = '3275856054';
const GAME = '413150';

// A pretend Deck: which app gamescope shows, and whether the game's Steam launch is running.
function deck() {
  const d = { focused: ADK, running: false, now: 0, base: [] as string[], launched: [] as string[] };
  const deps: BesideDeps = {
    run: async (cmd, args) => {
      if (cmd === 'pgrep') return d.running ? '123\n' : '';
      if (args.includes('-set')) { d.base.push(args[args.length - 1]); return ''; }
      return `GAMESCOPE_FOCUSED_APP_GFX(CARDINAL) = ${d.focused}\n`;
    },
    launch: (appid) => { d.launched.push(appid); },
    now: () => d.now,
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
    expect(b.state()).toEqual({ game: { appid: GAME, name: 'Stardew Valley' }, starting: true, shown: true });

    d.running = true; d.focused = GAME;
    await b.poll();
    expect(b.state()).toMatchObject({ starting: false, shown: false });

    await b.show('deck');
    expect(d.base.pop()).toBe(`${ADK}, ${GAME}, 769`);
    await b.show('game');
    expect(d.base.pop()).toBe(`${GAME}, ${ADK}, 769`);

    d.running = false; d.focused = '';
    await b.poll();
    expect(d.base.pop()).toBe(`${ADK}, 769`);   // gamescope would otherwise keep the quit game's last frame
    expect(b.state()).toEqual({ game: null, starting: false, shown: true });
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
});
