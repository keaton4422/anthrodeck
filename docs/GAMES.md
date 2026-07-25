# Writing a cockpit game

A game mode is **one file**. Drop it in `src/renderer/game/modes/`, export `createMode()`, and it
appears in the picker — no registry edit, no wiring. That's deliberate: it makes a new game a
self-contained PR that touches exactly one file.

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
| `prune-stale` | Drops one agent-suggested superseded context item from the next request |
| `focus-question` | Surfaces a pending `ask_user` to the pilot |

**Only non-destructive intents exist, on purpose.** Approving a file write or committing code from a
game would mean a stray flick of the stick could ship a change. If you want a new intent, it has to
be safe to trigger by accident — that's the bar.

Always reset `intents: []` at the top of your `step`, or you'll re-fire them every frame.

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
