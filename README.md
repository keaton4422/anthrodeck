<p align="center"><img src="assets/icon.png" width="128" alt="AnthroDeck"></p>

# AnthroDeck

A gamepad-driven cockpit for doing your Claude Code development work on a Steam Deck. The human is
the **pilot**; **Claude Code** is the **engine**. Voice, touch and controller steer real Claude Code
sessions (through the [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)), using the
same projects, sessions, tasks and permission modes as Claude Desktop, laid out for a handheld.

It's meant to make the work more fun as well as more convenient. Home shows every project with its
git state and sessions to resume or start. While Claude works you can play one of the cockpit
games, which react to what Claude is actually doing (see [docs/GAMES.md](docs/GAMES.md)). Finished tasks,
passing tests, commits and pushes earn XP and pilot ranks, from Cadet to Ace.

## How it fits together

AnthroDeck is **not** a second agent harness. Claude Code owns the agent loop, tools, context
management and compaction, and it loads your own `CLAUDE.md`, skills, plugins, MCP servers and
permission rules. AnthroDeck is the steering wheel and the dashboard:

| Cockpit | What it does |
|---|---|
| `src/main/engine/session.ts` | One long-lived Claude Code session per project (streaming input). Routes every decision Claude Code wants a human for (edit approvals, command approvals, `AskUserQuestion`, plan approval, teach-mode pauses) to face-button cards. |
| `src/main/engine/translate.ts` | Claude Code's message stream → cockpit events (text, tools, milestones, usage, context). |
| `src/main/engine/tools.ts` | Tool labels, full-file previews for `Edit`/`MultiEdit`, milestone detection, the task board. |
| `src/main/engine/bridge.ts` | Electron IPC. Every engine event is also published on `engine:event`. |
| `src/main/sessions.ts` | This device's Claude Code sessions and projects for Home (git state, resume history). |
| `src/renderer/lib/season.ts` | The career: XP, levels, pilot ranks, achievements. Pure and unit-tested. |

**Permission modes** are Claude Code's, under Claude Desktop's names: *Plan mode* (`plan`: Claude
explores and proposes), *Ask permissions* (`default`: every edit and command asks), *Auto-accept edits*
(`acceptEdits`: edits land, commands still ask). R1 cycles them. There is deliberately no mode where
nothing asks.

**Scoring rule:** points come from outcomes, never activity. Tokens burned and tools called are worth
nothing; finished tasks, passing tests, clean builds, commits and pushes are.

Electron + React + Vite + TypeScript, packaged with Electron Forge.

## Develop

```sh
npm install
npm start          # electron-forge start (Vite HMR for the renderer)
npm run typecheck  # tsc --noEmit
npm run test       # vitest
npm run make       # build distributables (runs typecheck + tests first)
```

`npm run make` is gated at both ends. `premake` runs `typecheck && test`; afterwards
`verify:package` opens the artifact that was just built and checks it can actually start. The
release workflow runs `make`, so releases are gated too.

That last gate exists because it was missing. Until v0.7.2 the packaged app had **never launched**:
electron-forge's Vite plugin excludes `node_modules` from the package, and `vite.main.config.ts`
marked electron-store, the Anthropic SDK, fastify, chokidar and selfsigned as `external`, so they
were neither bundled nor shipped. Every build died at startup with `Cannot find module
'electron-store'` while typecheck, tests and `make` all reported green — none of them ever ran the
artifact. `verify:package` now walks every emitted chunk for bare `require()` calls, asserts each
resolves against what physically shipped, and then loads the shipped packages inside the app's own
Electron runtime. See the packaging contract at the top of `vite.main.config.ts` before adding
anything to `external`.

## Configure

**Engine.** AnthroDeck drives the Claude Code binary rather than bundling it (it is ~275 MB per
platform and updates itself). **Settings (⚙) → Engine** shows whether it is installed and has a
one-press install that runs the official installer (`curl -fsSL https://claude.ai/install.sh | bash`,
which puts it in `~/.local/bin`). In development, `npm start` uses the copy the Agent SDK installs into
`node_modules`, so nothing global is needed.

**Key.** Paste or pair an Anthropic API key; AnthroDeck hands it to Claude Code. Pick a model alias
(`sonnet` default, `opus` for hard jobs, `haiku` for speed; aliases track the current generation),
toggle extended thinking, and choose an effort level.

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

### Library art

Non-Steam shortcuts show a blank tile until they get art. `assets/steam/png/` has the four images
(rendered from the SVGs beside them by `npx electron tools/renderSteamArt.cjs`). Copy them into
`~/.local/share/Steam/userdata/<your id>/config/grid/` as `<appid>p.png` (portrait),
`<appid>.png` (wide), `<appid>_hero.png` and `<appid>_logo.png`, where `<appid>` is the shortcut's
id (stored in `config/shortcuts.vdf`), then
restart Steam. Or set each image by hand: select the tile → **Manage → Set custom artwork**.

Text entry uses the Steam on-screen keyboard: **STEAM + X**. For the API key specifically, don't —
use pairing (below) instead.

## Signing in

There's no account, and no "sign in with Google" — the Anthropic API authenticates with an API key,
not an OAuth identity. You can *log into* console.anthropic.com with Google, but what you leave with
is a key. Open **Settings (⚙)** and give AnthroDeck that key from
[console.anthropic.com](https://console.anthropic.com). It's stored locally on the Deck via
`electron-store` and never leaves the device except in calls to Anthropic's API.

AnthroDeck passes the key to Claude Code. With no key paired, Claude Code falls back to whatever
sign-in it already has on that machine.

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

## Your other computer

AnthroDeck can pilot Claude Code on another computer, like your Mac, over SSH:

1. On the Mac, turn on **System Settings → General → Sharing → Remote Login**, and add the Deck's
   public key (`~/.ssh/id_ed25519.pub` on the Deck) to the Mac's `~/.ssh/authorized_keys`.
2. On the Deck, **Settings → Remote computer**: enter `you@your-mac.local` and press **Save & test**.

Home then switches between this device and the Mac (**Y**). On the Mac side you get:

- **Its projects and sessions.** Resume one or start a new one; Claude Code runs on the Mac, in its
  folders, under its own sign-in.
- **What's running right now.** The sessions open in the Claude app or a terminal on the Mac are
  listed at the top as **LIVE**, each marked working, idle or **NEEDS YOU**. Press **A** on one to
  open it on the live session screen: its conversation streams in as it works, and you can send it
  messages (type, or hold **L2** and talk). The session keeps running where it is. A message
  reaches a working session when its current turn ends, and an idle one starts on it at once.
  Claude Code passes it through its own session inbox, so Claude sees it as a message from another
  session that you sent from the Deck. A session that skips permission prompts holds such messages
  for you to review in its own window instead, and the Deck says so. **B** goes back to Home.
- **Their approvals and questions.** In **Settings → Remote computer**, press **Install on <Mac>**
  under "Approvals from <Mac>". This adds one `PermissionRequest` hook to Claude Code's settings on
  the Mac (`~/.claude/settings.json`, backed up first). From then on, when a session on the Mac asks
  for permission, asks a question or has a plan ready, the same card pops up on the Deck wherever
  you are, game included. Answer on whichever is closer: the first answer wins, and the other
  closes. While the Deck isn't connected, the hook returns at once and changes nothing.
  **Remove** takes it out again.

### Taking the Deck out

- **Remote Control.** `your-mac.local` only works on the same network. When SSH can't reach the Mac
  (a phone's hotspot, another Wi-Fi), the Deck reaches it through Anthropic's servers instead, the
  way the Claude app on a phone does, with Claude Code's
  [Remote Control](https://code.claude.com/docs/en/remote-control): the Mac's sessions, following
  and messaging them, and their approvals keep working. Nothing to install: whenever the Deck reaches
  the Mac at home it sets up a small Claude Code session there named `anthrodeck-hub` (with the
  `anthrodeck-link` mod, `~/.anthrodeck/rc/`), and runs one of its own when it needs it. It needs a
  claude.ai sign-in on both, Claude Code 2.1.308 or later, and the Mac awake (**System Settings →
  Energy → Prevent automatic sleeping**). Turn it off in **Settings → Remote computer**. Sessions
  started from the Deck on the Mac still run over SSH: they keep running while it's away, and the
  Deck picks them back up when it can reach the Mac again.
- **Away address.** Or give SSH a way there from anywhere: put [Tailscale](https://tailscale.com)
  (or another private network) on the Mac and the Deck, and enter the Mac's name there (e.g.
  `your-mac.tail1234.ts.net`) under **Away address** in **Settings → Remote computer**. The Deck
  tries the home address first, then the away one, then Remote Control.
- **Dropped connections and sleep.** A session started from the Deck runs on the Mac under a small
  holder that doesn't depend on the connection (`~/.anthrodeck/held/`), so a hotspot dropping out
  or putting the Deck to sleep doesn't stop Claude. The Deck reattaches as soon as it can, right
  away on waking, and picks up where it left off; nothing sent either way is lost.

## Controls

- **L2** — hold to talk (push-to-talk); release to send.
- **Y** — project drawer · **B / Start** — settings · **right stick** — scroll.
- **L3** — project drawer · **R3** — settings.
- **Home**: **D-pad** moves between projects and their sessions · **A** opens · **B** back to the
  current session. The header logo (or radial → New session) returns to Home.
- **Live session screen** (a LIVE session from the other computer): **A** to the message box ·
  **L2** talk · **D-pad ↑↓ / right stick** scroll · **B** back to Home.
- **D-pad ← / →** — collapse / expand tool detail lines in the transcript.
- **Write approval**: **A** apply · **X** reject · **B** reject with voice · **D-pad ↑↓** scroll the diff.
- **ask_user / teach prompts**: face buttons **A/B/X/Y** map to the on-screen options.
- **Approvals** (commands, tools): **A** allow · **B** deny · **X** always allow this session (only
  when Claude Code proposes a scoped rule).
- **R1** — permission mode: Plan mode → Ask permissions → Auto-accept edits. Works mid-game too.
- **L1 + R2** — brake: interrupt Claude while it's working.
- **L1 + face button** — meta chords: **A** git status · **B** git commit · **X** run tests ·
  **Y** undo last write.
- **Hold Select** — radial menu (git status / run tests / deploy / undo write / compact / permission mode /
  new session); aim
  with the right stick, release to pick. Map **trackpad center-click → Select** in Steam Input to get
  the trackpad radial.
- **🎮 (status bar)** — open the cockpit game layer.

Haptics and sound cues are on by default and can be muted in Settings.

## Voice

Hold **L2** (or the mic button) and talk; let go to send. Speech is transcribed on the device with
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) and the `base.en` model, so nothing leaves it.
Chromium's speech API doesn't work inside Electron, so this is the only voice path.

- **Steam Deck / Linux:** built in. The release job builds `whisper-cli` and fetches the model with
  `tools/linux/build-whisper.sh`, and both ship in the AppImage as `resources/whisper`.
- **macOS / Windows:** install whisper.cpp so `whisper-cli` is on your PATH (macOS:
  `brew install whisper-cpp`), or point `ANTHRODECK_WHISPER_CLI` at it, then **Settings → Voice →
  Download the speech model** (about 60 MB, checked against its hash).

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
`forge.config.ts`. The Linux builds include the speech engine, built for the Deck's x86_64 CPU.

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds win32 + linux and publishes a
GitHub Release with the artifacts.

The release job also runs `tools/updateManifest.mjs`, which hashes the built AppImage and writes the
`latest-linux.yml` that `electron-updater` needs. electron-forge's makers don't emit it, so without
this step in-app update checks 404 — generating the one missing file is a far smaller change than
migrating the whole build to electron-builder.

> **Linux only.** Windows self-update would need an NSIS installer and forge only makes a zip, so
> `latest.yml` is deliberately not generated. Windows is a dev convenience here, not a target.
