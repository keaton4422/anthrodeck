import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
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

  it('leaves the environment alone when nothing is preloaded', () => {
    expect(launch(undefined)).toBe('preload=<unset> args=');
  });
});
