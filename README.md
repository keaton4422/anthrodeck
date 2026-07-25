# AnthroDeck

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

SteamOS is Arch-based with a read-only rootfs, so the `.deb` isn't the easy path — use the
**AppImage**. (The `.deb` is published for ordinary Debian/Ubuntu machines; the Linux zip works too
if you'd rather extract and run the `anthrodeck` binary.)

> **Plugging the Deck into a PC over USB-C does not mount it as a drive.** The Deck doesn't act as a
> USB mass-storage gadget, so you can't drag the file across. Use one of the three routes below.

### 1. Download it on the Deck (simplest — no PC involved)

**Steam button → Power → Switch to Desktop**, then open Konsole:

```sh
mkdir -p ~/Applications && cd ~/Applications
curl -LO https://github.com/keaton4422/anthrodeck/releases/latest/download/AnthroDeck-x64.AppImage
chmod +x AnthroDeck-*.AppImage
./AnthroDeck-*.AppImage
```

If the versioned filename differs, grab the exact URL from the
[latest release](https://github.com/keaton4422/anthrodeck/releases/latest). Or just download it in
the browser and, in Dolphin, right-click → **Properties → Permissions → ✅ Is executable**.

### 2. From this PC over the network

SSH is present but off by default. On the Deck (Desktop Mode), give the `deck` user a password once
and enable it:

```sh
passwd
sudo systemctl enable --now sshd
```

Then from the PC (`ip addr` on the Deck gives you the address):

```sh
scp AnthroDeck-*.AppImage deck@<deck-ip>:~/Applications/
```

### 3. USB stick / microSD

Copy the AppImage onto a stick and plug it into the Deck's USB-C port (a dock or hub helps), or
write it to the microSD card.

## Run it from Game Mode — this is the recommended way

Adding it to Steam isn't cosmetic; it's how the controller actually works.

1. Desktop Mode → **Steam → Games → Add a Non-Steam Game to My Library → Browse** → pick the AppImage.
2. Back in Game Mode, open it from your library.
3. Press **STEAM → Controller icon** and choose a **Gamepad** template (e.g. "Gamepad with Joystick
   Trackpad").

Why it matters: in Desktop Mode the Deck's sticks and buttons behave as mouse and keyboard, so the
browser Gamepad API sees nothing and none of the pad bindings work. Launched through Steam, Steam
Input presents a standard gamepad and everything lights up. It's also the only way to get the
optional **gyro → right stick** mapping that gives the flight mode tilt steering (add a Gyro action
in the controller layout and bind it to Joystick Move).

Text entry uses the Steam on-screen keyboard: **STEAM + X**. For the API key specifically, don't —
use pairing (below) instead.

## Signing in

There's no account, and no "sign in with Google" — the Anthropic API authenticates with an API key,
not an OAuth identity. You can *log into* console.anthropic.com with Google, but what you leave with
is a key. Open **Settings (⚙)** and give AnthroDeck that key from
[console.anthropic.com](https://console.anthropic.com). It's stored locally on the Deck via
`electron-store` and never leaves the device except in calls to Anthropic's API.

### Pairing — get the key onto the Deck without typing it

An `sk-ant-...` key is 100-odd case-sensitive characters, and the Deck's on-screen keyboard makes
that genuinely miserable. So don't type it:

1. **Settings → "Send key from my phone or PC"**. The Deck shows a QR code, a URL and a 6-digit code.
2. Scan the QR (or open the URL) on a phone or laptop that already has the key on its clipboard.
3. Paste the key, enter the 6-digit code, hit send. Done — the Deck saves it immediately.

The pairing window is deliberately narrow, because it accepts a secret over the network:

| Guard | Behaviour |
| --- | --- |
| Lifetime | 5 minutes, then the server shuts itself down |
| Teardown | Closes on success, on cancel, on timeout, and when the app quits |
| Code gate | 6 random digits shown only on the Deck's screen |
| Brute force | 5 wrong codes closes the window entirely |
| Key handling | Validated in main and written straight to `electron-store` — never touches the renderer |

It's plaintext HTTP on your **local network** — fine at home, not on shared or public Wi-Fi. If
you're somewhere untrusted, type the key by hand or use `STEAM + X` with a paired Bluetooth keyboard.

**Two lower-tech alternatives** if you'd rather not run a server at all:

- **Desktop Mode + clipboard.** Switch to Desktop Mode, open a browser, log into the Anthropic
  console, copy the key, and paste it into AnthroDeck with `Ctrl+V`. No typing either.
- **A Bluetooth keyboard.** Pairs in Deck settings and works everywhere in the UI.

## Updating

> **Renamed in v0.6.4: `AntroDeck` → `AnthroDeck`** (the product name was missing its `h`; the
> package, binary and repo were always `anthrodeck`). Release artifacts are renamed with it, so an
> existing Steam shortcut pointing at `AntroDeck-linux-x64/anthrodeck` will break. Point the shortcut
> at the new path, or use the AppImage and keep a stable filename so future updates are a drop-in
> replace.

**Use the AppImage and updates take care of themselves.** From v0.7.1 the release publishes the
`latest-linux.yml` manifest electron-updater needs, so AnthroDeck checks GitHub on launch, tells you
when a new version exists, and downloads and swaps itself in place. It replaces the AppImage at its
current path, so a Steam shortcut pointing at `~/Applications/AnthroDeck.AppImage` keeps working
across every future update — you never touch Desktop Mode again.

This only works when you are running the **AppImage**. The `.deb` and the extracted `.zip` cannot
replace themselves in place; on those builds the updater says so and points you back here.

### Getting it onto the Deck the first time

One manual step, unavoidable — after that, in-app updates take over. Easiest first, no terminal:

1. **Desktop Mode** (Steam → Power → Switch to Desktop).
2. Open the releases page in Firefox and download the **`.AppImage`**. Save it to
   `~/Applications` (create the folder if it isn't there).
3. In Dolphin, right-click the file → **Properties → Permissions** → tick **Is executable**.
4. Steam → **Add a Non-Steam Game** → **Browse** → pick the AppImage.
5. Back in Game Mode, launch it and pair your API key from your phone (see Signing in).

If you would rather use the terminal, steps 2-3 collapse to one line in Konsole:

```bash
mkdir -p ~/Applications && curl -L -o ~/Applications/AnthroDeck.AppImage "$(curl -s https://api.github.com/repos/keaton4422/anthrodeck/releases/latest | grep -o 'https://[^"]*\.AppImage')" && chmod +x ~/Applications/AnthroDeck.AppImage
```

That always fetches the newest release, so it doesn't go stale as versions move.

Windows self-update is **not** wired up — electron-updater needs an NSIS installer there and forge
only produces a zip. Windows is a development convenience, not a target platform, so this is
deliberate rather than pending.

## Publishing to the Steam store

Worth separating two things that sound alike:

- **In your Steam library** — that's the Non-Steam Game shortcut above. Free, instant, and what you
  almost certainly want. It shows up in Game Mode with full controller support.
- **On the Steam Store, publicly** — that's Steam Direct: a Steamworks account, business and tax
  paperwork, a **$100 USD recoupable fee per title**, store assets, and Valve review before release.
  Steam Deck "Verified" status is a further, separate certification pass.

Store publishing is a poor fit here regardless of cost: AnthroDeck is a developer tool rather than a
game, and it requires each user to supply their own paid Anthropic API key — which is awkward
against storefront expectations. The Non-Steam shortcut gets you the same Game Mode experience.

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
3. Launch AnthroDeck → **Settings → Voice & Assist → Local voice** → toggle on → **Download local
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

The release job also runs `tools/updateManifest.mjs`, which hashes the built AppImage and writes the
`latest-linux.yml` that `electron-updater` needs. electron-forge's makers don't emit it, so without
this step in-app update checks 404 — generating the one missing file is a far smaller change than
migrating the whole build to electron-builder.

> **Linux only.** Windows self-update would need an NSIS installer and forge only makes a zip, so
> `latest.yml` is deliberately not generated. Windows is a dev convenience here, not a target.
