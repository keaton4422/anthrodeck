// Imported first by index.ts: when Steam has injected its overlay, relaunch without it and exit
// before anything else starts. See steamOverlay.ts for why.
import { spawn } from 'child_process';
import fs from 'fs';
import { envWithoutOverlay, relaunchTarget } from './steamOverlay';

const env = envWithoutOverlay(process.env);
if (env) {
  const { command, args } = relaunchTarget(process.env, process.execPath, process.argv);
  if (fs.existsSync(command)) {
    console.log('[startup] Steam overlay preloaded; relaunching without it');
    // spawn() has created the process by the time it returns, so exit right here: waiting for an
    // event would let the rest of main run on and start opening a window in this doomed process.
    spawn(command, args, { env, stdio: 'inherit' });
    process.exit(0);
  }
  console.error(`[startup] Steam overlay preloaded but ${command} is missing; continuing as-is`);
}
