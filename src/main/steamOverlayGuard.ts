// Imported first by index.ts: when Steam has injected its overlay, relaunch without it and exit
// before anything else starts. See steamOverlay.ts for why.
//
// The AppImage never gets here with the overlay: its launcher (tools/linux/anthrodeck-launch)
// strips it before the binary starts. This is the fallback for the unzipped Linux build. It is
// slow in Game Mode (Chromium stalls on the crashed zygote for about 90 s before any JS runs), but it
// does recover.
import { spawn } from 'child_process';
import fs from 'fs';
import { envWithoutOverlay, relaunchTarget } from './steamOverlay';

const env = envWithoutOverlay(process.env);
if (env) {
  const { command, args } = relaunchTarget(process.env, process.execPath, process.argv);
  if (fs.existsSync(command)) {
    console.log('[startup] Steam overlay preloaded; relaunching without it');
    // spawn() has created the process by the time it returns, so leave right here: waiting for an
    // event would let the rest of main run on and start opening a window in this doomed process.
    // SIGKILL, not process.exit(): with its zygote crashed this process can hang on a normal exit
    // (seen on the Deck), which would leave it running alongside the relaunched app.
    spawn(command, args, { env, stdio: 'inherit' });
    process.kill(process.pid, 'SIGKILL');
  }
  console.error(`[startup] Steam overlay preloaded but ${command} is missing; continuing as-is`);
}
