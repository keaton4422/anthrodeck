// First, before anything else starts: relaunch without Steam's overlay if it was injected.
import './steamOverlayGuard';
import { app, BrowserWindow, ipcMain, dialog, shell, powerMonitor, nativeTheme } from 'electron';
import path from 'path';
import { exec, execFile } from 'child_process';
import os from 'os';
import fs from 'fs';
import Store from 'electron-store';
import { autoUpdater } from 'electron-updater';
import Anthropic from '@anthropic-ai/sdk';
import { liveEvents, registerEngineIpc } from './engine/bridge';
import { chime, news, type Heard } from './pings';
import type { LiveStatus } from '../renderer/types';
import { canHandoff, listSteamGames, startHandoff, steamArt } from './steamGames';
import { Beside, canBeside, realDeps } from './beside';
import { ClaudePage } from './claudePage';
import { updaterErrorMessage } from './updaterMessages';
import { whatsNew, type RawReleaseNotes, type UpdateAvailable } from './releaseNotes';
import { LATEST_RELEASE_API, parseLatestRelease } from './manualUpdate';
import { quitWatchdog } from './quitWatchdog';
import { listFolders, folderNameProblem, type FolderListing } from './folders';
import { remotePython, remoteExec, shq, FOLDERS_PY } from './remote';
import { GIT_LOG_ARGS, parseGitLog, type Commit } from './gitLog';
import { getFlashcards, clearFlashcards, generateFlashcard } from './flashcards';
import { undoLastWrite, recordWrite } from './writeHistory';
import {
  startPreview,
  stopPreview,
  getPreviewStatus,
  detectDevPort,
} from './previewServer';
import { pickLanIp } from './network';
import { startPairing, stopPairing } from './pairingServer';
import {
  getLocalVoiceStatus,
  downloadLocalVoiceModel,
  transcribeWav,
} from './whisperTranscriber';
import { registerModScheme, handleModProtocol, guardModFrames, scanMods, modsDir } from './mods';

// Injected by electron-forge Vite plugin
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

const store = new Store();
// Before 'ready': cockpit mods are served from their own scheme (see mods.ts).
registerModScheme();
let mainWindow: BrowserWindow | null = null;
const LOAD_TIMEOUT_MS = 25_000;

// ─── Software rendering fallback ──────────────────────────────────────────────
// In Game Mode the Deck runs under gamescope, where Electron's GPU compositing can fail and paint
// nothing at all. The window opens, the background colour shows, and the page never appears — which
// is indistinguishable from a hang or a broken build, and cost several rounds of guesswork.
//
// So it self-corrects: a GPU process crash flips this flag, the app relaunches with hardware
// acceleration off, and the flag persists so it stays fixed. `--software-render` (or
// ANTHRODECK_SOFTWARE_RENDER=1) forces it manually; `--gpu` clears it.
const forcedSoftware = process.argv.includes('--software-render')
  || process.env.ANTHRODECK_SOFTWARE_RENDER === '1';
if (process.argv.includes('--gpu')) store.set('softwareRender', false);

if (forcedSoftware || store.get('softwareRender', false)) {
  app.disableHardwareAcceleration();
  // Belt and braces: on some gamescope setups the compositing path fails even with hardware
  // acceleration nominally off.
  app.commandLine.appendSwitch('disable-gpu-compositing');
  console.log('[startup] software rendering enabled');
}

// AnthroDeck is dark throughout; pages it shows (a session's claude.ai page) follow it.
nativeTheme.themeSource = 'dark';

function createWindow() {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: !isDev,
    frame: isDev,
    backgroundColor: '#0F0F0F',
    // Linux takes the window icon from here (Windows and macOS use the executable's).
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(app.getAppPath(), 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // A window that opens and stays black gives you nothing to go on — no error, no log, no way to
  // tell "still loading" from "the renderer is missing" from "the GPU process died". That cost
  // several rounds of guessing, so every one of those now announces itself.
  const wc = mainWindow.webContents;
  guardModFrames(wc);

  wc.on('did-fail-load', (_e, code, desc, url) => {
    // -3 is ERR_ABORTED, which fires on ordinary in-app navigation.
    if (code === -3) return;
    const msg = `Failed to load the interface.\n\n${desc} (${code})\n${url}`;
    console.error(`[renderer] ${msg}`);
    dialog.showErrorBox('AnthroDeck', msg);
  });

  wc.on('render-process-gone', (_e, details) => {
    const msg = `The interface process stopped: ${details.reason}`;
    console.error(`[renderer] ${msg}`);
    dialog.showErrorBox('AnthroDeck', msg);
  });

  // Nothing rendered within the watchdog window. On a Deck this is the difference between "slow"
  // and "never going to appear", and without it the only signal is a black screen.
  const watchdog = setTimeout(() => {
    const where = isDev ? MAIN_WINDOW_VITE_DEV_SERVER_URL : 'the packaged interface';
    console.error(`[startup] ${LOAD_TIMEOUT_MS / 1000}s with no load event from ${where}`);
    dialog.showErrorBox(
      'AnthroDeck',
      `The interface did not finish loading after ${LOAD_TIMEOUT_MS / 1000} seconds.\n\n`
      + 'If the screen is blank, try launching with software rendering:\n'
      + '  AnthroDeck.AppImage --software-render\n\n'
      + 'That works around GPU compositing failures, which are common under Game Mode.',
    );
  }, LOAD_TIMEOUT_MS);
  wc.on('did-finish-load', () => {
    clearTimeout(watchdog);
    console.log('[startup] interface loaded');
  });
  mainWindow.on('closed', () => clearTimeout(watchdog));

  // Surface renderer console output on stdout so launching from a terminal actually tells you
  // something. Errors only — this is a diagnostic channel, not a firehose.
  wc.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`);
  });

  if (isDev) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    wc.openDevTools({ mode: 'detach' });
  } else {
    const entry = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    // Check before loading: loadFile on a missing path fails in a way that is easy to miss, and
    // this exact file was absent from every packaged build up to v0.7.4.
    if (!fs.existsSync(entry)) {
      const msg = `The interface is missing from this build.\n\nExpected:\n${entry}\n\n`
        + 'This is a packaging fault, not a configuration problem. Please report it.';
      console.error(`[startup] ${msg}`);
      dialog.showErrorBox('AnthroDeck', msg);
    }
    console.log(`[startup] AnthroDeck ${app.getVersion()} loading ${entry}`);
    mainWindow.loadFile(entry);
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11') mainWindow?.setFullScreen(!mainWindow.isFullScreen());
    if (input.key === 'F12') mainWindow?.webContents.toggleDevTools();
    if (input.key === 'Escape' && isDev) mainWindow?.setFullScreen(false);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Store IPC ────────────────────────────────────────────────────────────────
// The Deck's own Steam games. In Game Mode they play beside AnthroDeck (main/beside.ts); otherwise
// AnthroDeck hands off to them and comes back after (main/steamGames.ts).
const beside = canBeside() ? new Beside(process.env.SteamAppId!, realDeps()) : null;
beside?.on('state', (st) => mainWindow?.webContents.send('steam:state', st));
beside?.start();
// While a Steam game is on screen: a chime, and the reason as a toast for when AnthroDeck is back.
let heard: Heard | null = null;
// The same for prompts and finished turns arriving over Remote Control (main/remoteAsks.ts).
liveEvents.on('ping', (why: string) => {
  if (beside && !beside.state().shown) { chime(); mainWindow?.webContents.send('steam:ping', why); }
});
liveEvents.on('state', (st: LiveStatus) => {
  if (!st?.state) return;
  const n = news(heard, st.state);
  heard = n.heard;
  if (n.ping && beside && !beside.state().shown) {
    chime();
    mainWindow?.webContents.send('steam:ping', n.ping);
  }
});
const canPlaySteam = () => !!beside || canHandoff().ok;
ipcMain.handle('steam:list', () => ({ games: canPlaySteam() ? listSteamGames() : [], canPlay: canPlaySteam(), beside: !!beside }));
ipcMain.handle('steam:art', (_, appid: string) => steamArt(appid));
ipcMain.handle('steam:state', () => beside?.state() ?? null);
ipcMain.handle('steam:play', (_, appid: string, name: string) => {
  if (!/^\d+$/.test(appid)) return { ok: false, beside: false };
  if (beside) {
    beside.play(appid, typeof name === 'string' ? name : appid);
    return { ok: true, beside: true };
  }
  const h = canHandoff();
  if (!h.ok || !h.back || !h.backApp) return { ok: false, beside: false };
  const remote = store.get('remote', null) as { host?: string } | null;
  startHandoff({ game: appid, back: h.back, backApp: h.backApp, host: remote?.host ?? null, pid: process.pid });
  setTimeout(() => app.quit(), 400);
  return { ok: true, beside: false };
});
ipcMain.handle('steam:show', (_, which: 'deck' | 'game') => beside?.show(which === 'game' ? 'game' : 'deck'));
ipcMain.handle('store:get', (_, key: string) => store.get(key));

// ─── A session's claude.ai page (main/claudePage.ts) ────────────────────────────
let claudePage: ClaudePage | null = null;
function page(): ClaudePage | null {
  if (!claudePage && mainWindow) {
    const win = mainWindow;
    claudePage = new ClaudePage(win, {
      remembered: () => store.get('claudePages', {}) as Record<string, string>,
      remember: (ref, url) => store.set('claudePages', { ...(store.get('claudePages', {}) as Record<string, string>), [ref]: url }),
      onClose: () => win.webContents.send('claude:closed'),
    });
    win.on('closed', () => { claudePage = null; });
  }
  return claudePage;
}
type Bounds = { x: number; y: number; width: number; height: number };
const whole = (b: Bounds) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.width)), height: Math.max(1, Math.round(b.height)) });
ipcMain.handle('claude:open', (_, ref: string, name: string, b: Bounds) => page()?.open(String(ref), String(name), whole(b)));
ipcMain.on('claude:place', (_, b: Bounds) => claudePage?.place(whole(b)));
ipcMain.on('claude:hide', () => claudePage?.hide());
ipcMain.on('claude:shown', (_, shown: boolean) => claudePage?.shown(!!shown));
ipcMain.on('claude:scroll', (_, dy: number) => claudePage?.scroll(Number(dy) || 0));
ipcMain.handle('claude:box', () => claudePage?.focusBox() ?? false);
ipcMain.handle('claude:signed-in', () => page()?.signedIn() ?? false);
ipcMain.handle('store:set', (_, key: string, value: unknown) => { store.set(key, value); });

// ─── Cockpit mods IPC ─────────────────────────────────────────────────────────
// Manifests only. A mod's code is never loaded here; the renderer frames it from anthrodeck-mod://.
ipcMain.handle('mods:list', () => {
  const scan = scanMods(modsDir());
  for (const p of scan.problems) console.warn(`[mods] ${p.folder}: ${p.message}`);
  return scan;
});

// ─── Project IPC ──────────────────────────────────────────────────────────────
ipcMain.handle('project:open-dialog', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.filePaths[0] ?? null;
});
ipcMain.handle('project:get', () => store.get('projectPath', null));
// `host`: the remote computer the project lives on (main/remote.ts), or null for this one.
ipcMain.handle('project:set', (_, p: string, host?: string | null) => { store.set('projectPath', p); store.set('projectHost', host ?? null); });
ipcMain.handle('project:host', () => (store.get('projectHost', null) as string | null) || null);

// Some actions only make sense on this device's disk. For a project on the remote computer they
// explain themselves instead of quietly acting on the wrong machine.
const remoteProject = () => !!store.get('projectHost', null);
const LOCAL_ONLY = 'This project is on your other computer. File, git and run buttons work on this device\'s projects for now; ask Claude to do it instead.';

// ─── File System IPC (scoped to project root) ─────────────────────────────────
const IGNORE_DIRS = new Set(['node_modules', '.git', '.vite', 'out', 'dist', '__pycache__', '.DS_Store']);

function listFilesRecursive(dir: string, rootDir: string, depth = 0, max = 3): string[] {
  if (depth >= max) return [];
  const results: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const rel = path.relative(rootDir, path.join(dir, e.name)).replace(/\\/g, '/');
    results.push(e.isDirectory() ? `${rel}/` : rel);
    if (e.isDirectory()) results.push(...listFilesRecursive(path.join(dir, e.name), rootDir, depth + 1, max));
  }
  return results;
}

// ─── Folder picker IPC (the in-app one; see folders.ts) ────────────────────────
const folderDeps = {
  readDir: (d: string) => fs.readdirSync(d, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() })),
  exists: (p: string) => fs.existsSync(p),
};
const remoteHostFor = (machine?: string) => (machine === 'remote'
  ? ((store.get('remote', null) as { host?: string } | null)?.host ?? null)
  : null);
ipcMain.handle('folders:list', async (_, dir?: string | null, machine?: 'local' | 'remote') => {
  const host = remoteHostFor(machine);
  if (host) {
    try { return await remotePython<FolderListing>(host, FOLDERS_PY, ['list', dir || '~']); }
    catch (e) { return { path: dir || '~', parent: null, folders: [], error: (e as Error).message }; }
  }
  const start = dir || (store.get('projectPath', null) as string | null) || os.homedir();
  return listFolders(start, folderDeps);
});
ipcMain.handle('folders:create', async (_, parent: string, name: string, machine?: 'local' | 'remote') => {
  const problem = folderNameProblem(name);
  if (problem) return { error: problem };
  const host = remoteHostFor(machine);
  if (host) {
    try { return await remotePython<{ path?: string; error?: string }>(host, FOLDERS_PY, ['mkdir', `${parent.replace(/\/$/, '')}/${name.trim()}`]); }
    catch (e) { return { error: (e as Error).message }; }
  }
  const target = path.join(path.resolve(parent), name.trim());
  if (fs.existsSync(target)) return { error: 'A folder with that name is already here.' };
  try {
    fs.mkdirSync(target);
    return { path: target };
  } catch (e) {
    return { error: (e as Error).message };
  }
});

ipcMain.handle('fs:list', (_, subDir?: string) => {
  if (remoteProject()) return [];
  const root = store.get('projectPath', null) as string | null;
  if (!root) return [];
  const base = subDir ? path.join(root, subDir) : root;
  return listFilesRecursive(base, root);
});

ipcMain.handle('fs:read', (_, relPath: string) => {
  const root = store.get('projectPath', null) as string | null;
  if (!root) throw new Error('No project open');
  return fs.readFileSync(path.join(root, relPath), 'utf-8');
});

ipcMain.handle('fs:write', (_, relPath: string, content: string) => {
  const root = store.get('projectPath', null) as string | null;
  if (!root) throw new Error('No project open');
  const abs = path.join(root, relPath);
  recordWrite(abs, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
});

// Undo the most recent file write (L1+Y chord / radial menu).
ipcMain.handle('write:undo', () => undoLastWrite());

// ─── Git IPC ──────────────────────────────────────────────────────────────────
function runGit(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout.trim(), stderr: (stderr || err?.message || '').trim() });
    });
  });
}

ipcMain.handle('git:status', async () => {
  if (remoteProject()) return { stdout: '', stderr: LOCAL_ONLY };
  const root = store.get('projectPath', null) as string | null;
  if (!root) return { stdout: '', stderr: 'No project open' };
  return runGit('git status --short', root);
});

ipcMain.handle('git:addAndCommit', async (_, message: string) => {
  if (remoteProject()) return { stdout: '', stderr: LOCAL_ONLY };
  const root = store.get('projectPath', null) as string | null;
  if (!root) return { stdout: '', stderr: 'No project open' };
  const add = await runGit('git add .', root);
  if (add.stderr && !add.stderr.includes('warning')) return add;
  return runGit(`git commit -m "${message.replace(/"/g, '\\"')}"`, root);
});

// Recent commits, on whichever computer the project is on.
ipcMain.handle('git:log', async (): Promise<{ commits: Commit[]; error: string | null }> => {
  const root = store.get('projectPath', null) as string | null;
  if (!root) return { commits: [], error: 'No project open' };
  const host = store.get('projectHost', null) as string | null;
  try {
    if (host) {
      const r = await remoteExec(host, `git -C ${shq(root)} ${GIT_LOG_ARGS.map(shq).join(' ')}`);
      return r.code === 0 ? { commits: parseGitLog(r.stdout), error: null } : { commits: [], error: r.stderr.trim() || 'git log failed' };
    }
    const stdout = await new Promise<string>((resolve, reject) =>
      execFile('git', GIT_LOG_ARGS, { cwd: root, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }, (err, out, errOut) =>
        (err ? reject(new Error(String(errOut || err.message).trim())) : resolve(out))));
    return { commits: parseGitLog(stdout), error: null };
  } catch (e) {
    return { commits: [], error: (e as Error).message };
  }
});

ipcMain.handle('git:push', async () => {
  if (remoteProject()) return { stdout: '', stderr: LOCAL_ONLY };
  const root = store.get('projectPath', null) as string | null;
  if (!root) return { stdout: '', stderr: 'No project open' };
  return runGit('git push', root);
});

// ─── Shell Execution IPC ──────────────────────────────────────────────────────
ipcMain.handle('shell:run', async (_, { code, language }: { code: string; language: string }) => {
  if (remoteProject()) return { stdout: '', stderr: LOCAL_ONLY, error: LOCAL_ONLY };
  return new Promise<{ stdout: string; stderr: string; error: string | null }>((resolve) => {
    const projectPath = store.get('projectPath', null) as string | null;
    const cwd = projectPath ?? os.tmpdir();
    const tmpDir = os.tmpdir();
    const extMap: Record<string, string> = {
      python: 'py', python3: 'py', javascript: 'js', js: 'js',
      typescript: 'ts', ts: 'ts', bash: 'sh', sh: 'sh', ruby: 'rb',
    };
    const ext = extMap[language.toLowerCase()] ?? 'txt';
    const tmpFile = path.join(tmpDir, `anthrodeck_${Date.now()}.${ext}`);

    try { fs.writeFileSync(tmpFile, code, 'utf-8'); }
    catch (e) { return resolve({ stdout: '', stderr: '', error: `Failed to write temp file: ${(e as Error).message}` }); }

    const cmdMap: Record<string, string> = {
      py: process.platform === 'win32' ? `python "${tmpFile}"` : `python3 "${tmpFile}"`,
      js: `node "${tmpFile}"`,
      sh: `bash "${tmpFile}"`,
      rb: `ruby "${tmpFile}"`,
    };
    const cmd = cmdMap[ext];

    if (!cmd) {
      fs.unlinkSync(tmpFile);
      return resolve({ stdout: '', stderr: `Running ${language} files is not supported yet.`, error: null });
    }

    exec(cmd, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), error: error && !stderr ? error.message : null });
    });
  });
});

// ─── Claude Code engine IPC ───────────────────────────────────────────────────
// Claude Code (through the Agent SDK) is the engine; see engine/bridge.ts for the channels.
const engine = registerEngineIpc(store, () => mainWindow);
// The network came back (the renderer sees it first): same as waking.
ipcMain.on('net:online', () => engine.reconnect());

// ─── Preview / LAN sharing IPC ────────────────────────────────────────────────
ipcMain.handle('preview:start', async (_, opts: { port?: number; https?: boolean; devPort?: number | null }) => {
  const root = store.get('projectPath', null) as string | null;
  const projectPath = root ?? os.homedir();
  try {
    return await startPreview({
      projectPath,
      port: opts?.port,
      https: opts?.https,
      devPort: opts?.devPort ?? null,
    });
  } catch (e) {
    return { ...getPreviewStatus(), running: false, error: (e as Error).message };
  }
});
ipcMain.handle('preview:stop', async () => { await stopPreview(); return getPreviewStatus(); });
ipcMain.handle('preview:status', () => {
  const status = getPreviewStatus();
  // Surface a LAN IP even when idle so the share sheet can preview the URL.
  const lanIp = status.lanIp ?? pickLanIp(os.networkInterfaces() as never) ?? null;
  return { ...status, lanIp };
});
// Never proxy AnthroDeck's own renderer dev server: in `npm start`, electron-forge serves it on
// Vite's default port (5173) — which is also the first port we'd otherwise probe.
function ownDevServerPorts(): number[] {
  try {
    const url = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    if (!url) return [];
    const parsed = new URL(url);
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 ? [port] : [];
  } catch {
    return [];
  }
}

ipcMain.handle('preview:detect-dev', () => detectDevPort(ownDevServerPorts()));

// ─── Local voice (whisper) IPC ────────────────────────────────────────────────
ipcMain.handle('voice:local-status', () => getLocalVoiceStatus());
ipcMain.handle('voice:download-model', () => downloadLocalVoiceModel());
ipcMain.handle('voice:transcribe', async (_, wav: ArrayBuffer) => {
  try {
    return await transcribeWav(wav);
  } catch {
    return null;
  }
});

// ─── Key pairing IPC ──────────────────────────────────────────────────────────
// Saves the key straight into electron-store in MAIN, so a paired key never has to travel back
// through the renderer just to be persisted.
ipcMain.handle('pair:start', async () => {
  try {
    return await startPairing((key) => {
      store.set('apiKey', key);
      mainWindow?.webContents.send('pair:received');
    });
  } catch (e) {
    return { active: false, url: null, code: null, expiresAt: null, error: (e as Error).message };
  }
});
ipcMain.handle('pair:stop', () => stopPairing());

// ─── Flashcards IPC ───────────────────────────────────────────────────────────
ipcMain.handle('flashcards:get', () => getFlashcards(store.get('projectPath', null) as string | null));
ipcMain.handle('flashcards:clear', () => { clearFlashcards(store.get('projectPath', null) as string | null); });
ipcMain.handle('flashcards:generate', async () => {
  const apiKey = store.get('apiKey', '') as string;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return generateFlashcard(client, store.get('projectPath', null) as string | null);
});

// ─── Auto-updater ─────────────────────────────────────────────────────────────
// The launch check fires before the pilot opens Settings, where the update UI lives, so the result
// is kept here for Settings to read when it mounts.
let lastAvailable: UpdateAvailable | null = null;

// The Windows build is a plain zip: no installer, no update manifest, nothing electron-updater can
// apply. It still checks GitHub for a newer release and links the pilot to its page.
const MANUAL_UPDATES = process.platform === 'win32';

async function checkManually(): Promise<void> {
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github.html+json', 'User-Agent': 'AnthroDeck' },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const found = parseLatestRelease(await res.json(), app.getVersion());
    if (found) {
      lastAvailable = found;
      mainWindow?.webContents.send('updater:update-available', found);
    } else {
      mainWindow?.webContents.send('updater:up-to-date');
    }
  } catch (e) {
    mainWindow?.webContents.send('updater:error', updaterErrorMessage((e as Error).message));
  }
}

function setupAutoUpdater() {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
  if (isDev) return;
  if (MANUAL_UPDATES) {
    setTimeout(() => void checkManually(), 3000);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Notes for every release newer than this one, not just the latest: a Deck that skipped a few
  // versions should hear about all of them.
  autoUpdater.fullChangelog = true;

  // Point the updater at the GitHub releases explicitly. electron-forge (unlike electron-builder)
  // does not bake an app-update.yml into the package, so without this the updater throws
  // "app-update.yml not found" before it ever reaches the network.
  try {
    autoUpdater.setFeedURL({ provider: 'github', owner: 'keaton4422', repo: 'anthrodeck' });
  } catch (e) {
    mainWindow?.webContents.send('updater:error', (e as Error).message);
  }

  autoUpdater.on('update-available', (info) => {
    lastAvailable = { version: info.version, notes: whatsNew(info.releaseNotes as RawReleaseNotes) };
    mainWindow?.webContents.send('updater:update-available', lastAvailable);
  });
  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('updater:up-to-date');
  });
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('updater:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('updater:ready', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    // Raw updater errors are opaque; translate to something the pilot can act on.
    mainWindow?.webContents.send('updater:error', updaterErrorMessage(err?.message ?? String(err)));
  });

  setTimeout(() => autoUpdater.checkForUpdates(), 3000);
}

ipcMain.handle('updater:get-version', () => app.getVersion());
ipcMain.handle('updater:last-available', () => lastAvailable);
ipcMain.handle('updater:check', async () => {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
  if (isDev) return { dev: true };
  if (MANUAL_UPDATES) { await checkManually(); return null; }
  try { return await autoUpdater.checkForUpdates(); }
  catch (e) { return { error: (e as Error).message }; }
});
ipcMain.handle('updater:download', async () => {
  // Manual builds download from the release page. parseLatestRelease only accepts this repo's
  // release URLs, so this can't be pointed anywhere else.
  if (MANUAL_UPDATES) { if (lastAvailable?.manualUrl) await shell.openExternal(lastAvailable.manualUrl); return; }
  try { await autoUpdater.downloadUpdate(); }
  catch (e) { mainWindow?.webContents.send('updater:error', (e as Error).message); }
});
ipcMain.on('updater:install', () => { autoUpdater.quitAndInstall(false, true); });

// ─── App lifecycle ─────────────────────────────────────────────────────────────
// `AnthroDeck.AppImage --version` prints the version and exits without opening a window. Trivial,
// but there was no way to answer "which build is this Deck actually running?" — and when a stale
// binary and a broken one both present as a black screen, that question is the whole diagnosis.
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(app.getVersion());
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  // Only one AnthroDeck: Steam starts a second copy when AnthroDeck is picked while it's running
  // (from the library, or the Steam menu during a game). The first one comes forward instead.
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (beside?.state().game) { void beside.show('deck'); return; }
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(() => {
    handleModProtocol();
    createWindow();
    setupAutoUpdater();
    // Waking the Deck (the power button is a console's pause): reconnect to the other computer
    // straight away instead of waiting for SSH to notice the old connection died.
    powerMonitor.on('resume', () => engine.reconnect());
    powerMonitor.on('unlock-screen', () => engine.reconnect());
  });
}

// A dead GPU process is the specific failure that paints nothing. Rather than leave someone
// staring at a black rectangle, record it, relaunch into software rendering, and stay there.
app.on('child-process-gone', (_e, details) => {
  if (details.type !== 'GPU') return;
  console.error(`[gpu] GPU process gone: ${details.reason}`);
  if (store.get('softwareRender', false)) return;   // already fell back; don't loop
  store.set('softwareRender', true);
  console.error('[gpu] relaunching with software rendering');
  app.relaunch();
  app.exit(0);
});

// A quit that stalls must not leave Steam stuck on "Exiting": see quitWatchdog.ts.
const armQuitWatchdog = quitWatchdog({
  setTimer: (fn, ms) => { setTimeout(fn, ms).unref(); },
  exit: (code) => app.exit(code),
  kill: () => process.kill(process.pid, 'SIGKILL'),
  log: (msg) => console.error(msg),
});

app.on('before-quit', () => { armQuitWatchdog(); beside?.stop(); engine.shutdown(); void stopPreview(); void stopPairing(); });
app.on('window-all-closed', () => { void stopPreview(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) { createWindow(); setupAutoUpdater(); }
});
