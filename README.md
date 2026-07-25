# AntroDeck

A gamepad-driven agentic coding cockpit for the Steam Deck. The human is the **pilot**; the Claude
agent is the **engine**. Voice, touch, and controller drive an agent loop that reads, writes, runs
shell commands, and asks you targeted questions — with a token HUD, context pruner, LAN preview
sharing, and a cockpit game layer along for the ride.

Electron + React + Vite + TypeScript, packaged with Electron Forge.

## Develop

```sh
npm install
npm start          # electron-forge start (Vite HMR for the renderer)
npm run typecheck  # tsc --noEmit
npm run test       # vitest
npm run make       # build distributables (runs typecheck + tests first)
```

`npm run make` is gated by `premake` (`typecheck && test`) — a red typecheck or test fails the build,
and the release workflow runs `make`, so releases are gated too.

## Configure

Open **Settings (⚙)** and paste an Anthropic API key (stored locally via `electron-store`). Pick a
model (Sonnet 5 default; Opus 4.8 for hard turns; Haiku 4.5 for speed), toggle extended thinking,
and choose an effort level.

## Install on Steam Deck

SteamOS is Arch-based with a read-only rootfs, so a `.deb` isn't the easy path. Grab a release from
GitHub and pick:

- **AppImage (recommended)** — `chmod +x AntroDeck-*.AppImage` and run it.
- **Linux zip** — extract, run the `anthrodeck` binary.
- `.deb` is for regular Debian/Ubuntu machines.

## Controls

- **L2** — hold to talk (push-to-talk); release to send.
- **Y** — project drawer · **B / Start** — settings · **right stick** — scroll.
- **L3** — project drawer · **R3** — settings.
- **D-pad ← / →** — collapse / expand tool detail lines in the transcript.
- **Write approval**: **A** apply · **X** reject · **B** reject with voice · **D-pad ↑↓** scroll the diff.
- **ask_user / teach prompts**: face buttons **A/B/X/Y** map to the on-screen options.
- **L1 + face button** — meta chords: **A** git status · **B** git commit · **X** run tests ·
  **Y** undo last write.
- **Hold Select** — radial menu (git status / run tests / deploy / undo write / prune context); aim
  with the right stick, release to pick. Map **trackpad center-click → Select** in Steam Input to get
  the trackpad radial.
- **🎮 (status bar)** — open the cockpit game layer.

Haptics and sound cues are on by default and can be muted in Settings.

## Local voice (offline Whisper) on Steam Deck

By default, dictation uses the browser Web Speech API (needs internet). For fully offline, on-device
transcription you can enable **local voice** in Settings. The native Whisper module is **not** bundled
(it needs a compile step and a ~140 MB model), so it's a one-time manual install:

1. Install build tools on SteamOS (Arch). SteamOS's rootfs is read-only by default:
   ```sh
   sudo steamos-readonly disable
   sudo pacman -S base-devel cmake
   sudo steamos-readonly enable
   ```
   (Or build the module on another Arch/Linux x86_64 machine and copy `node_modules/nodejs-whisper`.)
2. From the app's install directory, add the module:
   ```sh
   npm install nodejs-whisper
   ```
3. Launch AntroDeck → **Settings → Voice & Assist → Local voice** → toggle on → **Download local
   voice** (fetches the `base.en` model into the app's user-data directory).

Once the module and model are present, L2 records audio, encodes a 16 kHz WAV, and transcribes it
locally (a `…TRANSCRIBING` indicator shows in the status bar). If the module or model is missing, the
app automatically falls back to Web Speech.

## Share preview over LAN

The project drawer's **Share preview** starts a local server that serves your latest build output
(`dist`/`out`/`build`/`public`/`.vite/build`/`.next`, whichever exists) on your LAN and shows a QR
code. It can also detect and reverse-proxy a running dev server (Vite/Next/etc.) so HMR/live-reload
works on a phone. An optional self-signed HTTPS toggle enables camera/mic/gyro for mobile web.

## Cockpit gyro steering (optional)

The cockpit game modes steer from whichever analog stick is active. To steer with the Deck's gyro,
add a Steam Input controller profile that maps **gyro → right stick**; the app reads it as a stick
axis with no extra configuration. Without a gyro mapping, the sticks steer normally.

## Package targets

Electron Forge builds a zip (all platforms), a `.deb`, and an **AppImage** for Linux — see
`forge.config.ts`. Whisper's native binaries are Linux x86_64, matching SteamOS.

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds win32 + linux and publishes a
GitHub Release with the artifacts.

> **Auto-update caveat:** electron-forge's makers don't emit the `latest*.yml` metadata that
> `electron-updater` expects, so in-app update checks report "no update metadata published yet".
> Download new releases from GitHub manually until publishing moves to electron-builder.
