# Writing a cockpit game

A game mode is **one file**. Drop it in `src/renderer/game/modes/`, export `createMode()`, and it
appears in the picker — no registry edit, no wiring. That's deliberate: it makes a new game a
self-contained PR that touches exactly one file.

To add a game *without* a PR or a rebuild, write it as a mod instead: the same contract, dropped
into a folder and run in a sandbox. See [MODS.md](MODS.md).

```ts
// src/renderer/game/modes/mygame.ts
import { GameMode, GameInput, TelemetryFrame, GameIntent, IntentCarrier } from '../types';

export interface MyState extends IntentCarrier {
  x: number;
  over: boolean;
  points: number;
  intents: GameIntent[];
}

export function createMode(): GameMode<MyState> {
  return {
    id: 'freeplay-mygame',        // must be unique
    name: 'My Game',
    kind: 'freeplay',             // 'telemetry' = driven by the agent, 'freeplay' = passes the time
    blurb: 'One line shown under the picker',

    init: (w, h) => ({ x: w / 2, over: false, points: 0, intents: [] }),

    // PURE. No canvas, no DOM, no Date.now(), no Math.random() you don't seed yourself.
    step: (s, input, tel, dt) => ({ ...s, x: s.x + input.steer * 200 * dt, intents: [] }),

    render: (ctx, s, w, h) => {
      ctx.fillStyle = '#07080C';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#8FE9FF';
      ctx.fillRect(s.x - 10, h - 40, 20, 20);
    },

    hud: (s) => `${s.points} pts`,

    // Optional — implement both and you get persistent high scores for free.
    score: (s) => s.points,
    isOver: (s) => s.over,
  };
}
```

## The contract

| Member | Required | Notes |
|---|---|---|
| `id` / `name` / `kind` / `blurb` | ✅ | `id` must be unique; duplicates are skipped with a console warning |
| `init(w, h)` | ✅ | Return the starting state |
| `step(state, input, tel, dt)` | ✅ | **Must be pure** — same inputs, same output |
| `render(ctx, state, w, h)` | ✅ | Draw only. Never mutate state here |
| `hud(state)` | ✅ | Short status string for the header |
| `score(state)` / `isOver(state)` | — | Implement both for persistent high scores |

**`step` must be pure** because that's what makes modes testable headlessly, deterministic across a
restart, and safe to run at any frame rate. If you need randomness, seed it — `makeRng(seed)` in
`../lib3d` is an xorshift PRNG that gives you reproducible courses.

## Input

`GameInput` is already normalized across gamepad and keyboard, so you never touch either directly:

`steer` / `moveY` (left stick, −1..1) · `aimX` / `aimY` (right stick) · `throttle` / `brake`
(triggers) · `fire` · `boost` · `up` / `down` / `left` / `right` (D-pad).

Steering reads whichever horizontal stick is active, so a Steam Input **gyro → stick** profile drives
your game's steering with no extra work.

## Telemetry — making the game about the agent

`TelemetryFrame` is what separates a cockpit mode from a time-killer.

`snapshot` is continuous state: `streaming`, `tokensPerSec`, `sessionTokens`, `budget`, `thinking`,
`toolActive`, `lastTool`.

`events` are discrete things that just happened, drained once per frame:

| Event | Means | Conventional mapping |
|---|---|---|
| `tool` | A tool call ran | Spawn an obstacle / enemy / objective |
| `error` | The turn errored | Damage, hazard, debris |
| `done` | The turn completed | Finish line |
| `thinking` | Extended thinking is flowing | Ambient effect |
| `boost` | The pilot approved a write | Speed burst |
| `crash` | The pilot aborted the run | Destroy the player |
| `sector` | A task in Claude's plan completed | Checkpoint, boost, points |
| `milestone` | Tests / build / commit / push ran (`good: false` for a red flag) | Green flag reward, or a hazard |
| `powerup` | The pilot did real work mid-game: answered a card (`source: 'answer'`) or sent a session orders (`'prompt'`) | Shield, rapid fire, a multiplier: make it feel great |

`sector` and `milestone` are the outcome events: they only fire when something real happened in the
project, so they are the right things to reward. `tool` is activity and makes a better obstacle.

Free-play modes should ignore `crash`/`done` so an agent event never ends a game the pilot is
playing to pass the time.

## Intents — making the game *do* something

A mode can act on the real session by pushing onto `state.intents`. The loop drains them each frame
and dispatches them. This is what makes destroying the right object real work rather than decoration:

```ts
if (playerHitStaleThing) s.intents.push({ type: 'prune-stale' });
```

| Intent | Effect |
|---|---|
| `prune-stale` | One stale-context target cleared. With the context at 50% or more, eight of them queue a tidy-up: a `/compact` (told to keep the task, decisions and open questions and drop superseded output) that runs when Claude finishes its turn. Claude Code can't compact mid-turn, and it costs a model call, so it only happens because the pilot played for it (Settings → Playing tidies the context) |
| `focus-question` | Surfaces a pending `ask_user` to the pilot |

**Only non-destructive intents exist, on purpose.** Approving a file write or committing code from a
game would mean a stray flick of the stick could ship a change. If you want a new intent, it has to
be safe to trigger by accident — that's the bar.

Always reset `intents: []` at the top of your `step`, or you'll re-fire them every frame.

## Intermission: the game is part of the session

The games aren't a separate feature you go to. While Claude works (the Deck's own session, or any
live session on the remote computer) and the pilot has put the controls down for five seconds, the
game comes up by itself, like the Claude Code mods that open a game while Claude is busy:

- A card from any session (an approval, a question) pauses the game; answer it and play resumes.
- When a session finishes, the game stops on a "Claude is done" card: **A** goes to that session,
  **B** keeps playing.
- The **comms rail** beside the playfield lists every session: what needs you first, then the
  ones whose turn is over and wait for your orders (with the end of what Claude said, usually its
  question), then the ones working (with the tool they're running). In the game the pad drives it
  with buttons the games don't use: **Y** moves down the rail, **hold X** to talk to the selected
  session (the words wait in the rail), **Y** sends them, **View** drops them, **R3** types instead.
- Answering a card or sending orders mid-game fires a `powerup` event in the game.
- The header shows the tidy-up meter for the Deck's own context.
- Leaving the game (Start → Leave the game) means "not now" until another session starts working
  or this one starts its next turn.

`lib/intermission.ts` holds the rules; Settings → **Play while Claude works** turns it off.

## Testing your mode

Modes are pure, so test them headlessly — no canvas, no Electron:

```ts
import { createMode } from './modes/mygame';
import { NEUTRAL_INPUT, EMPTY_TELEMETRY } from './types';

const mode = createMode();
let s = mode.init(800, 600);
s = mode.step(s, { ...NEUTRAL_INPUT, steer: 1 }, EMPTY_TELEMETRY, 0.016);
expect(s.x).toBeGreaterThan(400);
```

The suite in `game.test.ts` already asserts the contract over **every** discovered mode, so your file
is covered the moment it exists. `npm test` must pass — `npm run make` runs it and fails the build
otherwise.

## Seeing it run

```bash
npx vite tools/gamelab --port 5199
```

The game lab renders every registered mode side by side against synthetic telemetry, and exposes
`window.__lab.tick(frames)` so you can step it deterministically from the console.

## Submitting one

One file in `src/renderer/game/modes/`, plus tests if it has interesting logic. Keep it in the app's
visual language (dark surfaces, `#CC785C` clay accent, `#8FE9FF` cyan, monospace numerals), and don't
use anyone else's trademarks, characters, or ship designs.
