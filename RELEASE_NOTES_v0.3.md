# AntroDeck v0.3.0

The human-as-pilot release. v0.2 could talk to Claude; v0.3 lets you **fly it** — you can see what
the engine is burning, steer it mid-flight, hand it back the wheel, and share what it built.

## Install on Steam Deck

SteamOS is Arch-based with a read-only rootfs, so the `.deb` isn't the path of least resistance:

- **AppImage (recommended)** — download, `chmod +x AntroDeck-*.AppImage`, run it.
- **Linux zip** — extract and run the `anthrodeck` binary.
- `.deb` is published for regular Debian/Ubuntu machines.

Open **Settings (⚙)** and paste an Anthropic API key to get going.

---

## Foundation modernization

- **SDK `@anthropic-ai/sdk` 0.39.0 → 0.111.0.** Stayed on the raw SDK rather than the Claude Agent
  SDK: the loop is coupled to Electron IPC (write-approval gate, per-token streaming, abort), which
  the Agent SDK's own loop would fight for no benefit at this scope.
- **Models.** Replaced the hardcoded (and invalid) `claude-opus-4-6` with a picker over
  **Opus 4.8 / Sonnet 5 / Haiku 4.5**, default Sonnet 5 for everyday cost, Opus 4.8 for hard turns.
- **Adaptive thinking + effort.** Extended thinking now uses `thinking: {type:'adaptive'}` plus an
  effort selector (low → max). The older fixed `budget_tokens` knob is gone — it returns a 400 on
  current models.
- **Prompt caching.** `cache_control` breakpoints on the tools array and the system prompt, with the
  prefix kept frozen. Repeat turns read from cache instead of re-paying for the preamble.
- **Retries.** `maxRetries: 4` — the SDK backs off 429/529 with jitter.
- **Cache-aware token accounting.** Usage now includes cache-read / cache-creation / thinking tokens
  and **accumulates across every model call in a turn** (it used to be overwritten per tool
  round-trip). This also fixed a latent bug where text after a tool call could stop rendering.

## Human-as-pilot core

- **Token HUD** in the status bar — cumulative session tokens against a 200K soft budget,
  green → yellow (70%) → red (90%), with a hover breakdown that shows cache reads in green because
  they're effectively free. Resets on Clear.
- **`ask_user` tool** — the agent can stop and ask you a 2–4 option question; options map to the
  **A/B/X/Y** face buttons.
- **Gamepad write approval** — **A** apply, **X** reject, **B** reject-with-voice, **D-pad** scrolls
  the diff. Push-to-talk is suppressed while a modal is up so a rejection can't leak into the chat.
- **Context inspector + pruner** — a CONTEXT drawer tab lists every message with an estimated token
  count; tap to prune it from the next request. "Agent-suggested prunes" flags earlier file reads
  superseded by a later re-read.
- **Confidence badges** — each answer carries a self-assessed high/med/low badge; low confidence gets
  a red border.

## Local sharing

- **LAN preview server** (Fastify) serves your latest build output — `dist`, `out`, `build`,
  `public`, `.vite/build`, `.next` — on a configurable port (default **5757**), re-pointing
  automatically when the output directory appears.
- **QR share modal** from the project drawer, with a copyable URL.
- **LAN IP detection** that prefers real private ranges on non-virtual interfaces and falls back to
  `hostname.local`.
- **Dev-server proxy** — a dev server's port is sniffed from `run_shell` stdout (Vite / Next /
  generic banners), with port probing as a fallback; the proxy forwards websockets so HMR works on
  your phone. It will never proxy AntroDeck's own dev server.
- **Optional self-signed HTTPS** so mobile web builds can request camera / mic / gyro.

## Voice + learning

- **Local Whisper (offline dictation)** — hold L2 to record; audio is downsampled and encoded to a
  16 kHz WAV in-app (no ffmpeg) and transcribed on-device. The native module is **not bundled**; it's
  a documented one-time install (see README), and the app falls back to Web Speech without it.
- **Teach mode** — every tool call pauses with the model's own one-line rationale: **A** continue,
  **B** redirect by voice, or auto-continue after a few seconds. Rationales collect in a LEARN tab.
- **Session flashcards** — every 10 tool calls the agent writes one non-obvious thing worth
  remembering about your project, persisted per project, with a review mode.
- **Rewind** — `↶ rewind` on any message trims the conversation back to that point so you can
  redirect instead of arguing forward.

## Cockpit game layer

A pluggable game-mode registry where each mode is a pure headless simulation plus a thin renderer.

- **Telemetry cockpit modes** where playing *is* monitoring: **Tron Cockpit** and **Engine Racer** —
  speed tracks live token throughput, tool calls and errors drop hazards, approving a write is a
  boost, aborting is a crash, a finished turn is the checkered flag.
- **Free-play modes** for long turns: **Asteroids** (twin-stick) and **Tron free-play**. They pause
  and surface the real modal the moment the engine needs you.
- Steering reads whichever stick is active, so a Steam Input **gyro → stick** profile gives you tilt
  steering with no extra configuration.

## Polish

- **Haptics** — light tick on tool success, longer buzz on error, subtle pulse on message complete.
- **Sound cues** — chime on complete, low tone on error, keypress tick on voice start/stop
  (synthesized, so no audio assets in the bundle). Both muteable in Settings.
- **Full button map** — **L3** drawer, **R3** settings, **D-pad ←/→** collapse/expand tool detail
  lines, **L1 + A/B/X/Y** chords (git status / git commit / run tests / undo last write), and a
  **radial menu** on hold-Select (map trackpad center-click to Select in Steam Input) covering git
  status, run tests, deploy, undo write, prune context.
- **Undo last write** — the app remembers what a file looked like before the agent wrote it and can
  roll the most recent write back (restoring content, or deleting a file that didn't exist before).

## Engineering

- **96 unit tests** and a **build gate**: `npm run make` runs `typecheck && test` first and fails the
  build if either is red — and CI runs `make`, so releases are gated too.
- Everything testable is pure: token accounting, confidence parsing, LAN/port selection, dev-server
  banner parsing, WAV encoding, flashcard thresholds, game simulations, chord/radial math.

## Known limitations

- **In-app auto-update doesn't work yet.** electron-forge's makers don't publish the `latest*.yml`
  metadata electron-updater needs, so update checks report "no update metadata published yet" and
  you should grab new releases from GitHub manually. Fixing it properly means moving publishing to
  electron-builder — deliberately out of scope for this release rather than half-done.
- **Local Whisper needs a manual native install** on the Deck (documented in the README). Web Speech
  is the default until then.
- The gamepad, voice, and phone-on-LAN paths are type-checked and unit-tested but were developed
  without Deck hardware in the loop — expect to shake out ergonomics on first real use.
