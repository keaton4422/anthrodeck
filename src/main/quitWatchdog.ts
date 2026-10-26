// Steam waits for every process a game started to end before it lets go of "Exiting". On the Deck a
// graceful quit once stalled indefinitely (the main process sat idle after Exit game, with nothing in
// the log), and Steam showed "Exiting" until the processes were killed by hand.
//
// So once a quit starts, a watchdog gives it a few seconds, then forces it: app.exit() skips the
// remaining quit handlers, and if even that doesn't land, the process kills itself.
//
// Pure (timers and exits are injected) so it unit-tests.

export interface WatchdogDeps {
  setTimer(fn: () => void, ms: number): void;
  exit(code: number): void;     // app.exit: leave now, skipping quit handlers
  kill(): void;                 // last resort: SIGKILL ourselves
  log(msg: string): void;
}

export const QUIT_GRACE_MS = 4000;
export const EXIT_GRACE_MS = 2000;

// Returns arm(): call it when a quit begins. Arming twice is harmless.
export function quitWatchdog(d: WatchdogDeps, graceMs = QUIT_GRACE_MS, exitGraceMs = EXIT_GRACE_MS): () => void {
  let armed = false;
  return () => {
    if (armed) return;
    armed = true;
    d.setTimer(() => {
      d.log(`[quit] still running ${graceMs} ms after quitting; forcing exit`);
      d.exit(0);
      d.setTimer(() => {
        d.log('[quit] exit did not land; killing the process');
        d.kill();
      }, exitGraceMs);
    }, graceMs);
  };
}
