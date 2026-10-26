// Launched from Steam, every game gets Steam's overlay injected via LD_PRELOAD
// (gameoverlayrenderer.so). In Chromium that crashes the zygote, the process every renderer and
// the GPU process are forked from, so the GPU process never starts and Electron aborts with
// "GPU process isn't usable. Goodbye." before a window ever paints. That was the Deck's
// "doesn't boot" in both the July build and v0.8.4.
//
// The zygote is started before any of our code runs, so clearing the variable for this process is
// too late. Instead, the first thing main does is relaunch the app with the overlay removed and
// exit. Steam tracks the game by its systemd scope, so the relaunched process still counts as the
// game (and is stopped with it).
//
// Pure helpers, so they unit-test; steamOverlayGuard.ts does the relaunch.

const OVERLAY = /(^|\/)gameoverlayrenderer\.so$/;
export const RELAUNCHED_FLAG = 'ANTHRODECK_OVERLAY_STRIPPED';

// The environment to relaunch with, or null when no relaunch is needed: not Linux, no overlay in
// LD_PRELOAD, or this already is the relaunched process (the flag stops a loop if stripping it
// ever fails to take).
export function envWithoutOverlay(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv | null {
  if (platform !== 'linux') return null;
  if (env[RELAUNCHED_FLAG] === '1') return null;
  const preload = env.LD_PRELOAD ?? '';
  // ld.so accepts both colons and spaces as separators.
  const entries = preload.split(/[:\s]+/).filter(Boolean);
  if (!entries.some((e) => OVERLAY.test(e))) return null;
  const kept = entries.filter((e) => !OVERLAY.test(e));
  const next: NodeJS.ProcessEnv = { ...env, [RELAUNCHED_FLAG]: '1' };
  if (kept.length) next.LD_PRELOAD = kept.join(':');
  else delete next.LD_PRELOAD;
  return next;
}

// What to run. An AppImage must be relaunched through the AppImage itself: its files are mounted
// only while the process that mounted them lives, and this one is about to exit. Anything else
// (the unzipped build, a dev run) relaunches its own executable.
export function relaunchTarget(
  env: NodeJS.ProcessEnv,
  execPath: string,
  argv: string[],
): { command: string; args: string[] } {
  const args = argv.slice(1);
  if (env.APPIMAGE) return { command: env.APPIMAGE, args };
  return { command: execPath, args };
}
