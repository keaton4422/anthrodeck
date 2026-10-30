import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Runs the real launcher script against a stand-in binary that reports the LD_PRELOAD it got.
const LAUNCHER = path.join(__dirname, '../../../tools/linux/anthrodeck-launch');
const STEAM_PRELOAD = '/home/deck/.local/share/Steam/ubuntu12_32/gameoverlayrenderer.so:'
  + '/home/deck/.local/share/Steam/ubuntu12_64/gameoverlayrenderer.so';

function launch(preload: string | undefined, args: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-launch-'));
  fs.copyFileSync(LAUNCHER, path.join(dir, 'anthrodeck-launch'));
  fs.chmodSync(path.join(dir, 'anthrodeck-launch'), 0o755);
  fs.writeFileSync(path.join(dir, 'anthrodeck'), '#!/bin/sh\necho "preload=${LD_PRELOAD-<unset>} args=$*"\n', { mode: 0o755 });
  // Started through a symlink, the way AppRun -> usr/bin/anthrodeck-launch reaches it.
  fs.symlinkSync(path.join(dir, 'anthrodeck-launch'), path.join(dir, 'AppRun'));
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  if (preload !== undefined) env.LD_PRELOAD = preload;
  return execFileSync(path.join(dir, 'AppRun'), args, { env, encoding: 'utf8' }).trim();
}

// A POSIX shell script for the Linux AppImage: there's no sh to run it on Windows.
describe.skipIf(process.platform === 'win32')('linux launcher', () => {
  it('removes Steam\'s overlay before the binary starts, keeping the arguments', () => {
    expect(launch(STEAM_PRELOAD, ['--software-render', 'a b'])).toBe('preload=<unset> args=--software-render a b');
  });

  it('keeps other preloaded libraries', () => {
    expect(launch(`/usr/lib/libfoo.so ${STEAM_PRELOAD}`)).toBe('preload=/usr/lib/libfoo.so args=');
  });

  it('drops Steam\'s input module, which makes every key arrive twice, and keeps any other', () => {
    const im = (value: string) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-launch-'));
      fs.copyFileSync(LAUNCHER, path.join(dir, 'anthrodeck-launch'));
      fs.writeFileSync(path.join(dir, 'anthrodeck'), '#!/bin/sh\necho "im=${GTK_IM_MODULE-<unset>}"\n', { mode: 0o755 });
      return execFileSync('sh', [path.join(dir, 'anthrodeck-launch')], { env: { PATH: process.env.PATH, GTK_IM_MODULE: value }, encoding: 'utf8' }).trim();
    };
    expect(im('Steam')).toBe('im=<unset>');
    expect(im('ibus')).toBe('im=ibus');
  });

  // Process groups via setsid: Linux only (the Deck, and Ubuntu CI).
  it.skipIf(process.platform !== 'linux')('on a signal, ends the app and everything it started at once', async () => {
    // A stand-in app that starts a child of its own (like Chromium's helpers or a Claude Code
    // process) and then hangs, the way Electron does after Steam's "Exit game".
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-launch-'));
    fs.copyFileSync(LAUNCHER, path.join(dir, 'anthrodeck-launch'));
    fs.chmodSync(path.join(dir, 'anthrodeck-launch'), 0o755);
    const pidFile = path.join(dir, 'pids');
    fs.writeFileSync(path.join(dir, 'anthrodeck'),
      `#!/bin/sh\nsleep 300 &\necho "$$ $!" > "${pidFile}"\ntrap '' TERM\nwhile :; do sleep 1; done\n`, { mode: 0o755 });
    const launcher = spawn(path.join(dir, 'anthrodeck-launch'), [], { stdio: 'ignore' });
    for (let i = 0; i < 50 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
    const [appPid, childPid] = fs.readFileSync(pidFile, 'utf8').trim().split(' ').map(Number);
    // A killed process can linger as a zombie until something reaps it; that counts as gone.
    const alive = (p: number) => {
      try { return !/^\S+ \(.*\) Z/.test(fs.readFileSync(`/proc/${p}/stat`, 'utf8')); } catch { return false; }
    };
    expect(alive(appPid) && alive(childPid)).toBe(true);

    const t0 = Date.now();
    launcher.kill('SIGTERM');
    await new Promise((r) => launcher.once('exit', r));
    await new Promise((r) => setTimeout(r, 100));
    expect(Date.now() - t0).toBeLessThan(1500);   // the app ignores SIGTERM; the launcher doesn't wait on it
    expect(alive(appPid)).toBe(false);
    expect(alive(childPid)).toBe(false);
  });

  it('leaves the environment alone when nothing is preloaded', () => {
    expect(launch(undefined)).toBe('preload=<unset> args=');
  });
});
