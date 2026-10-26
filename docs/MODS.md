# Cockpit mods

A mod adds something to the cockpit without touching AnthroDeck's code: drop a folder in, reopen the
cockpit, and it's there. Built-in games are still added as one file in `src/renderer/game/modes/`
(see [GAMES.md](GAMES.md)). Mods are for everything that shouldn't need a PR or a rebuild.

## What a mod can provide

| Kind | Status | What it is |
|---|---|---|
| **Game** | ✅ this version | A `GameMode`, the same contract as the built-in games, run in a sandbox |
| **Theme** | planned | Colour tokens for the app chrome. Data only, no CSS files |
| **Sound pack** | planned | Tone specs (or short audio files) for the feedback cues. Data only |

Only a game runs code. Themes and sound packs are designed as data, so they never need the sandbox.

## Where mods live

```
<userData>/mods/<id>/mod.json
```

`<userData>` is the app's data folder: `~/.config/anthrodeck` on the Deck and other Linux,
`~/Library/Application Support/anthrodeck` on macOS, `%APPDATA%\anthrodeck` on Windows. The folder
name must be the mod's `id`. Mods are read each time the cockpit opens. A broken mod is skipped and
logged (`[mods] <folder>: <why>`); it never stops the others or the cockpit.

## Installing the example

```bash
mkdir -p ~/.config/anthrodeck/mods
cp -r examples/mods/orbit-watch ~/.config/anthrodeck/mods/
```

Open the cockpit. **Orbit Watch** is in the Telemetry group, with "Mod by AnthroDeck" in its blurb.

## mod.json

```json
{
  "id": "orbit-watch",
  "name": "Orbit Watch",
  "version": "1.0.0",
  "author": "AnthroDeck",
  "description": "Optional, up to 280 chars.",
  "game": {
    "kind": "telemetry",
    "entry": "game.js",
    "blurb": "One line under the picker, up to 140 chars."
  }
}
```

| Field | Rule |
|---|---|
| `id` | 2–40 chars of `a-z`, `0-9`, `-`; must equal the folder name |
| `name` | Up to 40 chars, shown in the picker |
| `version` | Any short string |
| `game.kind` | `telemetry` (driven by Claude's session) or `freeplay` (fills the wait) |
| `game.entry` | A `.js` file inside the folder; plain path characters only, no `..`, no dotfiles |

`theme` and `sounds` are reserved. A manifest that has them still loads its game, with a warning.

## Writing a mod game

A mod game is a `GameMode`, exactly as in [GAMES.md](GAMES.md): `init`, a pure `step`, `render`,
`hud`, optional `score`/`isOver`. The only difference is that it's a plain script that registers
itself, rather than a module that exports `createMode`:

```js
anthrodeck.registerMode(function createMode() {
  return {
    init: function (w, h) { return { x: w / 2, points: 0, intents: [] }; },
    step: function (s, input, tel, dt) { return Object.assign({}, s, { x: s.x + input.steer * 200 * dt, intents: [] }); },
    render: function (ctx, s, w, h) { ctx.fillStyle = '#141413'; ctx.fillRect(0, 0, w, h); },
    hud: function (s) { return s.points + ' pts'; },
    score: function (s) { return s.points; },
    isOver: function (s) { return false; },
  };
});
```

The picker id, name, kind and blurb come from `mod.json`; whatever the script sets for those is
ignored. Mod games are listed under `mod:<id>`, so a mod can never stand in for a built-in mode or
take its high score.

Everything in GAMES.md about input, telemetry events and intents applies unchanged. Bundle with any
tool you like (TypeScript, esbuild), as long as the output is one classic script, or several listed
via a small loader. [`examples/mods/orbit-watch/game.js`](../examples/mods/orbit-watch/game.js) is
a complete game in about 140 lines.

## How a mod game runs

```
cockpit (app window, has electronAPI)                 mod frame (anthrodeck-mod://<id>/)
───────────────────────────────────────               ──────────────────────────────────
useGameLoop ── proxy GameMode.step() ── postMessage ─▶ runtime.js: mode.step(), mode.render()
           ◀─ hud / score / over / intents ─────────── postMessage (one status per frame)
           │
           └─ parseStatus + gateIntents  (filtered here, on the trusted side)
```

- **Main** (`src/main/mods.ts`) only ever reads `mod.json` files. It never `require`s or evals
  anything from a mod. It serves mod files over the `anthrodeck-mod://` scheme, one host per mod.
- **The renderer** wraps each mod game in a proxy `GameMode` (`src/renderer/game/mods.ts`), so the
  existing loop, picker, pause-on-approval and high scores all work unchanged. The proxy's `step`
  posts the frame (input, telemetry, dt) to the mod's frame, and its state is whatever the mod
  last answered.
- **The mod's frame** (`components/ModFrame.tsx`) sits over the cockpit canvas and draws on its own
  canvas. The pad and keyboard stay with the cockpit, which forwards normalized input each frame.

## The sandbox

A mod is third-party code, and the app window holds `window.electronAPI`, which can run shell
commands, write files, push, and answer approval prompts. So mod code never runs in that window:

| Layer | What it stops |
|---|---|
| `<iframe sandbox="allow-scripts">`, no `allow-same-origin` | Opaque origin: no access to the parent window or `electronAPI`, no storage, no cookies, no popups, no forms, no top-level navigation |
| Preload runs in the main frame only (`nodeIntegrationInSubFrames` off) | No bridge, no Node, no `require` in the frame |
| Mod page CSP: `default-src 'none'; script-src 'self'; …` | No network of any kind (fetch, WebSocket, remote images), no inline script, no `eval` |
| App CSP `frame-src anthrodeck-mod:` + `will-frame-navigate` guard in main | A mod frame can't navigate itself to a website |
| Protocol handler | Serves only known file types from inside the mod's folder; text and symlink traversal are both checked; `GET` only |
| Permission handlers | Camera, mic, notifications etc. refused for `anthrodeck-mod:` (the app's own behaviour is unchanged) |
| `parseStatus` / `gateIntents` | The only thing a mod sends back is a status. The HUD line is clipped, the score clamped, and intents filtered (below) |

The frame-side layers were checked in Electron 37 with a deliberately hostile test mod. It tried
`parent.electronAPI`, the parent document, top navigation, storage, cookies, `window.open`, `eval`, inline script, fetch,
WebSocket, a remote image and navigating its own frame to a website, and every one was blocked. The
protocol and intent rules are unit-tested (`src/main/__tests__/mods.test.ts`,
`src/renderer/game/mods.test.ts`). The permission handlers are not yet tested.

### Intents: what a mod can make happen

A mod can raise the same intents a built-in game can, and nothing else: `prune-stale` (a "box, box"
nudge to compact when context is above 70%) and `focus-question`. Both are safe to trigger by
accident, which is the bar GAMES.md sets. On top of that, each intent is rate-limited to once every
5 seconds per mod, however often it's asked for.

The allowlist is a `Record` over the whole `GameIntent` union (`MOD_INTENTS` in `game/mods.ts`). If
anyone adds an intent to `game/types.ts`, the build fails until they decide whether a third-party
mod should get it.

**A mod can never approve an edit, commit, push or run a command.** Those are not intents at all,
and the frame has no other way to reach the app.

### XP

Mods don't touch XP. XP comes only from real outcomes (tasks done, tests passing, commits), scored
in `lib/season.ts` from the session itself. A mod's score feeds only its own high-score entry. A mod
*should* reward the same outcome events (`sector`, `milestone`) the built-in games do, which is what
Orbit Watch does, but that's points inside the game, not career XP.

### What a mod can see

The telemetry frame (output speed, token counts, the last tool's short label, events) and the
pilot's input. It has no network or storage to send or keep any of it.

## Planned: themes

```json
"theme": { "tokens": { "--orange": "#D97757", "--bg": "#141413" } }
```

Data only. Keys must be from a fixed list of the app's colour tokens (`global.css` `:root`). Values
must match a strict colour pattern (`#rgb`, `#rrggbb`, `rgb()`/`rgba()`): no `url()`, no
expressions, no CSS files. The cockpit sets them on `:root`. The pilot picks one theme in Settings.

Blocker: most components still hard-code hex colours (`#CC785C` alone appears in dozens of places),
so a theme would only recolour part of the app. Moving those to tokens comes first, and is worth
doing on its own.

## Planned: sound packs

```json
"sounds": { "sector": [{ "freq": 880, "duration": 120, "delay": 0, "gain": 0.3, "type": "sine" }] }
```

Overrides `TONES` in `lib/feedback.ts` per `FeedbackEvent`, through the same clamps (`MAX_TONE_MS`,
gain 0..1) that keep a bug from blasting the speaker. A later step could allow short `.ogg`/`.wav`
files from the mod folder (the protocol already serves them; the app CSP would need
`media-src anthrodeck-mod:`).

## Not in this version

- **A Settings list of installed mods** with on/off toggles and the problems from the last scan.
  Today any valid mod in the folder appears.
- **Installing from inside the app.** Copying a folder is the only install path. Downloading code
  from a URL is a bigger trust decision than running it in a sandbox.
- **Mod-provided intents.** Mods get only the shared, non-destructive set.
