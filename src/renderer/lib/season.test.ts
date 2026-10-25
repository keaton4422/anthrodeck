import { describe, expect, it } from 'vitest';
import { applySeason, EMPTY_LAP, logLap, levelFor, levelProgress, loadSeason, NEW_SEASON, tierFor, xpForLevel, XP, type SeasonEvent, type SeasonState } from './season';

function run(events: SeasonEvent[], start: SeasonState = NEW_SEASON) {
  let s = start;
  const unlocked: string[] = [];
  let gained = 0;
  for (const e of events) {
    const u = applySeason(s, e);
    s = u.state;
    gained += u.gained;
    unlocked.push(...u.unlocked.map((a) => a.id));
  }
  return { s, unlocked, gained };
}

describe('season scoring', () => {
  it('scores outcomes, not activity: an errored lap is worth nothing', () => {
    expect(run([{ type: 'lap', confidence: 'high', isError: true }]).gained).toBe(0);
    expect(run([{ type: 'lap', confidence: 'high', isError: false }]).gained).toBe(XP.lap + XP.confidentLap);
    expect(run([{ type: 'milestone', kind: 'tests-fail' }]).gained).toBe(0);
  });

  it('awards a recovery bonus for turning red tests green, once', () => {
    const { gained, unlocked, s } = run([
      { type: 'milestone', kind: 'tests-fail' },
      { type: 'milestone', kind: 'tests-pass' },
      { type: 'milestone', kind: 'tests-pass' },
    ]);
    expect(gained).toBe(XP.green * 2 + XP.recovery);
    expect(unlocked).toEqual(['green-flag', 'recovery']);
    expect(s.redFlagOut).toBe(false);
  });

  it('a grand prix is every sector of a real (3+) plan', () => {
    const small = run([{ type: 'sector', total: 1, completed: 1 }]);
    expect(small.unlocked).not.toContain('grand-prix');
    const gp = run([
      { type: 'sector', total: 3, completed: 1 },
      { type: 'sector', total: 3, completed: 2 },
      { type: 'sector', total: 3, completed: 3 },
    ]);
    expect(gp.gained).toBe(XP.sector * 3 + XP.grandPrix);
    expect(gp.unlocked).toEqual(['first-sector', 'hat-trick', 'grand-prix']);
  });

  it('hat-trick counts sectors within a single lap only', () => {
    const { unlocked } = run([
      { type: 'sector', total: 5, completed: 1 },
      { type: 'sector', total: 5, completed: 2 },
      { type: 'lap', confidence: null, isError: false },
      { type: 'sector', total: 5, completed: 3 },
    ]);
    expect(unlocked).not.toContain('hat-trick');
  });

  it('an error breaks the clean-air streak', () => {
    const clean = Array.from({ length: 4 }, () => ({ type: 'lap', confidence: null, isError: false }) as SeasonEvent);
    const broken = run([...clean, { type: 'lap', confidence: null, isError: true }, ...clean]);
    expect(broken.unlocked).not.toContain('clean-five');
    expect(broken.s.bestStreak).toBe(4);
    expect(run([...clean, ...clean]).unlocked).toContain('clean-five');
  });

  it('shipping climbs the ladder and reports level-ups', () => {
    const u = applySeason(NEW_SEASON, { type: 'milestone', kind: 'push' });
    expect(u.levelUp).toBeNull();
    const u2 = applySeason(u.state, { type: 'milestone', kind: 'commit' });
    expect(u2.levelUp).toBe(2);
    expect(u2.unlocked.map((a) => a.id)).toEqual(['parc-ferme']);
  });
});

describe('lap log', () => {
  it('repeats what the season scored and adds nothing of its own', () => {
    const events: SeasonEvent[] = [
      { type: 'edit-approved' },
      { type: 'milestone', kind: 'tests-fail' },
      { type: 'milestone', kind: 'tests-pass' },
      { type: 'milestone', kind: 'commit' },
      { type: 'lap', confidence: 'high', isError: false },
    ];
    let state = NEW_SEASON;
    let log = EMPTY_LAP;
    for (const e of events) {
      const u = applySeason(state, e);
      state = u.state;
      log = logLap(log, e, u.gained);
    }
    expect(log.xp).toBe(state.xp);
    expect(log.checkpoints.map((c) => c.label)).toEqual(['Edit', 'Tests red', 'Tests green', 'Commit']);
    expect(log.checkpoints[1].good).toBe(false);
  });
});

describe('levels and tiers', () => {
  it('has a growing XP curve', () => {
    expect([1, 2, 3, 4].map(xpForLevel)).toEqual([0, 100, 250, 450]);
    expect(levelFor(0)).toBe(1);
    expect(levelFor(99)).toBe(1);
    expect(levelFor(100)).toBe(2);
    expect(levelProgress(175)).toBeCloseTo(0.5);
  });

  it('maps levels onto the career ladder', () => {
    expect(tierFor(1)).toBe('Karting');
    expect(tierFor(4)).toBe('F4');
    expect(tierFor(10)).toBe('F1');
    expect(tierFor(40)).toBe('World Champion');
  });

  it('loads tolerantly from storage', () => {
    expect(loadSeason(null)).toEqual(NEW_SEASON);
    expect(loadSeason({ xp: -5, stats: { commits: 3 }, unlocked: ['podium', 7] })).toMatchObject({
      xp: 0, unlocked: ['podium'], stats: { commits: 3, laps: 0 },
    });
  });
});
