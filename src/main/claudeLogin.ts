// Claude Code's own sign-in (`claude auth login`), run from AnthroDeck so the pilot never needs
// Desktop Mode and a terminal for it. Claude Code opens its sign-in address through $BROWSER; here
// that's a two-line script handing the address to AnthroDeck, which shows it on the claude.ai page
// (main/claudePage.ts). Signing in there sends the browser back to Claude Code's own listener on
// localhost, Claude Code saves its sign-in, and exits. AnthroDeck never sees the account's tokens.

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const WAIT_MS = 15 * 60_000;

// The sign-in address, if `text` is one: Claude's own pages over https, nothing else.
export function loginUrl(text: string): string | null {
  try {
    const u = new URL(text.trim());
    const ok = u.protocol === 'https:' && /(^|\.)(claude\.com|claude\.ai|anthropic\.com)$/.test(u.hostname);
    return ok ? u.toString() : null;
  } catch { return null; }
}

export interface Login { done: Promise<boolean>; cancel(): void }

// Start `claude auth login`; `onUrl` gets its sign-in address once. Done: true once signed in.
export function runLogin(bin: string, onUrl: (url: string) => void): Login {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthrodeck-login-'));
  const urlFile = path.join(dir, 'url');
  const env: NodeJS.ProcessEnv = { ...process.env, ANTHRODECK_LOGIN_URL: urlFile };
  // Windows has no sh: Claude Code opens the system browser there itself.
  if (process.platform !== 'win32') {
    const opener = path.join(dir, 'open');
    fs.writeFileSync(opener, '#!/bin/sh\nprintf \'%s\' "$1" > "$ANTHRODECK_LOGIN_URL"\n', { mode: 0o700 });
    env.BROWSER = opener;
  }
  // stdin stays open: Claude Code also offers to take a pasted code there, and must keep waiting.
  const child = spawn(bin, ['auth', 'login', '--claudeai'], { env, stdio: ['pipe', 'ignore', 'ignore'] });
  let told = false;
  const poll = setInterval(() => {
    if (told) return;
    let text = '';
    try { text = fs.readFileSync(urlFile, 'utf8'); } catch { return; }
    const url = loginUrl(text);
    if (url) { told = true; onUrl(url); }
  }, 250);
  const timer = setTimeout(() => child.kill(), WAIT_MS);
  const done = new Promise<boolean>((resolve) => {
    const end = (ok: boolean) => {
      clearInterval(poll);
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      resolve(ok);
    };
    child.on('error', () => end(false));
    child.on('exit', (code) => end(code === 0));
  });
  return { done, cancel: () => { child.kill(); } };
}
