// Play beside: a Steam game runs next to AnthroDeck instead of replacing it (Game Mode on the Deck).
//
// Steam starts a game while AnthroDeck runs as long as the launch comes from a clean user service
// rather than from inside AnthroDeck (a launch inheriting AnthroDeck's Steam environment is ignored).
// What's on screen is gamescope's choice, steered by the GAMESCOPECTRL_BASELAYER_APPID list on the
// root window: the first app in it that has a window is shown. Steam writes that list when the
// pilot uses the Steam menu; AnthroDeck writes it to switch, and must put itself back first when the
// game ends, or gamescope keeps showing the quit game's last frame.
//
// So AnthroDeck keeps running (sessions here keep working, the queue stays live), switching is
// instant both ways, and its own games pause while it's hidden.

import { execFile, spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';

// Steam's own interface in gamescope (the library, the Steam menu).
export const STEAM_UI = '769';
// How long a game gets to start (an update or a shader compile can come first).
export const START_MS = 5 * 60_000;
const POLL_MS = 1000;
// Gamescope keeps its focus properties on its first X display, Steam's own. Games, AnthroDeck
// among them, get the next one (:1), so a plain `xprop -root` from here sees none of them.
const GS_DISPLAY = ':0';

export interface BesideState {
  game: { appid: string; name: string } | null;
  starting: boolean;      // asked for, not running yet
  shown: boolean;         // AnthroDeck is the app on screen
}

export interface BesideDeps {
  run: (cmd: string, args: string[]) => Promise<string>;   // resolves stdout, '' on failure
  launch: (appid: string) => void;
  now: () => number;
}

// The order gamescope picks from: what to show, then what to fall back to.
export function baseLayer(front: string, ...rest: (string | null)[]): string {
  return [front, ...rest, STEAM_UI].filter((x, i, a): x is string => !!x && a.indexOf(x) === i).join(', ');
}

// The app gamescope is drawing (GAMESCOPE_FOCUSED_APP is where input goes, which stays on Steam's
// own interface for a while after one of its prompts even with AnthroDeck on screen).
export function parseFocused(xpropOut: string): string | null {
  const m = /GAMESCOPE_FOCUSED_APP_GFX\(CARDINAL\) = (\d+)/.exec(xpropOut);
  return m ? m[1] : null;
}

export class Beside extends EventEmitter {
  private game: { appid: string; name: string } | null = null;
  private askedAt = 0;
  private seen = false;
  private shown = true;
  private timer: NodeJS.Timeout | null = null;

  constructor(private self: string, private deps: BesideDeps) { super(); }

  state(): BesideState {
    return { game: this.game, starting: !!this.game && !this.seen, shown: this.shown };
  }

  play(appid: string, name: string): void {
    this.game = { appid, name };
    this.askedAt = this.deps.now();
    this.seen = false;
    this.deps.launch(appid);
    this.emit('state', this.state());
    if (!this.timer) this.timer = setInterval(() => { void this.poll(); }, POLL_MS);
  }

  // Put AnthroDeck or the game on screen.
  async show(which: 'deck' | 'game'): Promise<void> {
    const g = this.game?.appid ?? null;
    const order = which === 'game' && g ? baseLayer(g, this.self) : baseLayer(this.self, g);
    await this.setBase(order);
    await this.poll();
  }

  async poll(): Promise<void> {
    if (!this.game) return;
    const [focused, running] = await Promise.all([
      this.deps.run('xprop', ['-display', GS_DISPLAY, '-root', 'GAMESCOPE_FOCUSED_APP_GFX']).then(parseFocused),
      this.deps.run('pgrep', ['-f', `reaper SteamLaunch AppId=${this.game.appid}( |$)`]).then((o) => o.trim() !== ''),
    ]);
    if (!running && (this.seen || this.deps.now() - this.askedAt > START_MS)) return this.end();
    const shown = focused === null || focused === this.self;
    if (shown === this.shown && running === this.seen) return;
    this.seen = this.seen || running;
    this.shown = shown;
    this.emit('state', this.state());
  }

  // The game quit (or never started): AnthroDeck back on screen, and stop watching.
  private async end(): Promise<void> {
    this.game = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    await this.setBase(baseLayer(this.self));
    this.shown = true;
    this.emit('state', this.state());
  }

  private setBase(order: string): Promise<string> {
    return this.deps.run('xprop', ['-display', GS_DISPLAY, '-root', '-f', 'GAMESCOPECTRL_BASELAYER_APPID', '32c', '-set', 'GAMESCOPECTRL_BASELAYER_APPID', order]);
  }

  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}

// Whether this AnthroDeck can play beside: launched by Steam inside gamescope, with xprop to steer it.
export function canBeside(env: NodeJS.ProcessEnv = process.env): boolean {
  return process.platform === 'linux' && !!env.SteamAppId && !!env.GAMESCOPE_WAYLAND_DISPLAY && !!env.DISPLAY
    && fs.existsSync('/usr/bin/xprop') && fs.existsSync('/usr/bin/systemd-run');
}

export function realDeps(): BesideDeps {
  return {
    run: (cmd, args) => new Promise((resolve) => {
      execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
    }),
    // As a user service: its environment is the session's, not AnthroDeck's (see the top).
    launch: (appid) => {
      spawn('systemd-run', ['--user', '-q', '--collect', 'steam', `steam://rungameid/${appid}`], { detached: true, stdio: 'ignore' }).unref();
    },
    now: () => Date.now(),
  };
}
