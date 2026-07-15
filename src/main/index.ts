import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { exec } from 'child_process';
import os from 'os';
import fs from 'fs';
import Store from 'electron-store';
import { autoUpdater } from 'electron-updater';
import Anthropic from '@anthropic-ai/sdk';
import { runAgentLoop } from './agentLoop';
import { resolveInferenceConfig } from './agentLoop.helpers';
import { getFlashcards, clearFlashcards, generateFlashcard } from './flashcards';
import {
  startPreview,
  stopPreview,
  getPreviewStatus,
  detectDevPort,
} from './previewServer';
import { pickLanIp } from './network';
import {
  getLocalVoiceStatus,
  downloadLocalVoiceModel,
  transcribeWav,
} from './whisperTranscriber';

// Injected by electron-forge Vite plugin
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

const store = new Store();
let mainWindow: BrowserWindow | null = null;
const abortRef = { aborted: false };

function createWindow() {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: !isDev,
    frame: isDev,
    backgroundColor: '#0F0F0F',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11') mainWindow?.setFullScreen(!mainWindow.isFullScreen());
    if (input.key === 'F12') mainWindow?.webContents.toggleDevTools();
    if (input.key === 'Escape' && isDev) mainWindow?.setFullScreen(false);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Store IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('store:get', (_, key: string) => store.get(key));
ipcMain.handle('store:set', (_, key: string, value: unknown) => { store.set(key, value); });

// ─── Project IPC ──────────────────────────────────────────────────────────────
ipcMain.handle('project:open-dialog', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.filePaths[0] ?? null;
});
ipcMain.handle('project:get', () => store.get('projectPath', null));
ipcMain.handle('project:set', (_, p: string) => { store.set('projectPath', p); });

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

ipcMain.handle('fs:list', (_, subDir?: string) => {
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
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
});

// ─── Git IPC ──────────────────────────────────────────────────────────────────
function runGit(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout.trim(), stderr: (stderr || err?.message || '').trim() });
    });
  });
}

ipcMain.handle('git:status', async () => {
  const root = store.get('projectPath', null) as string | null;
  if (!root) return { stdout: '', stderr: 'No project open' };
  return runGit('git status --short', root);
});

ipcMain.handle('git:addAndCommit', async (_, message: string) => {
  const root = store.get('projectPath', null) as string | null;
  if (!root) return { stdout: '', stderr: 'No project open' };
  const add = await runGit('git add .', root);
  if (add.stderr && !add.stderr.includes('warning')) return add;
  return runGit(`git commit -m "${message.replace(/"/g, '\\"')}"`, root);
});

ipcMain.handle('git:push', async () => {
  const root = store.get('projectPath', null) as string | null;
  if (!root) return { stdout: '', stderr: 'No project open' };
  return runGit('git push', root);
});

// ─── Shell Execution IPC ──────────────────────────────────────────────────────
ipcMain.handle('shell:run', async (_, { code, language }: { code: string; language: string }) => {
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

// ─── Claude Agentic IPC ───────────────────────────────────────────────────────
ipcMain.on('claude:send', async (event, {
  messages,
  apiKey,
  projectPath,
  autonomousWrites,
  model,
  extendedThinking,
  effort,
  teachMode,
  teachTimeout,
}: {
  messages: Array<{ role: string; content: string }>;
  apiKey: string;
  projectPath: string | null;
  autonomousWrites: boolean;
  model?: string;
  extendedThinking?: boolean;
  effort?: string;
  teachMode?: boolean;
  teachTimeout?: number;
}) => {
  abortRef.aborted = false;

  if (!apiKey) {
    event.sender.send('claude:error', 'No API key set. Open Settings (⚙) and enter your Anthropic API key.');
    return;
  }

  // Validate/normalize whatever the renderer sent into a safe inference config.
  const base = resolveInferenceConfig({ model, extendedThinking, effort });
  const config = {
    ...base,
    teachMode: !!teachMode,
    teachTimeout: typeof teachTimeout === 'number' && teachTimeout >= 0 ? teachTimeout : 5,
  };

  await runAgentLoop(
    event,
    messages as unknown as Anthropic.MessageParam[],
    apiKey,
    projectPath,
    autonomousWrites,
    config,
    mainWindow,
    abortRef,
  );
});

ipcMain.on('claude:abort', () => { abortRef.aborted = true; });

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
ipcMain.handle('preview:detect-dev', () => detectDevPort());

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

// ─── Flashcards IPC ───────────────────────────────────────────────────────────
ipcMain.handle('flashcards:get', () => getFlashcards(store.get('projectPath', null) as string | null));
ipcMain.handle('flashcards:clear', () => { clearFlashcards(store.get('projectPath', null) as string | null); });
ipcMain.handle('flashcards:generate', async () => {
  const apiKey = store.get('apiKey', '') as string;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return generateFlashcard(client, store.get('projectPath', null) as string | null);
});

// claude:write-decision is handled inside agentLoop via ipcMain.on (per-call listener)

// ─── Auto-updater ─────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
  if (isDev) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:update-available', { version: info.version });
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
    mainWindow?.webContents.send('updater:error', err.message);
  });

  setTimeout(() => autoUpdater.checkForUpdates(), 3000);
}

ipcMain.handle('updater:get-version', () => app.getVersion());
ipcMain.handle('updater:check', async () => {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
  if (isDev) return { dev: true };
  try { return await autoUpdater.checkForUpdates(); }
  catch (e) { return { error: (e as Error).message }; }
});
ipcMain.handle('updater:download', async () => {
  try { await autoUpdater.downloadUpdate(); }
  catch (e) { mainWindow?.webContents.send('updater:error', (e as Error).message); }
});
ipcMain.on('updater:install', () => { autoUpdater.quitAndInstall(false, true); });

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});

app.on('before-quit', () => { void stopPreview(); });
app.on('window-all-closed', () => { void stopPreview(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) { createWindow(); setupAutoUpdater(); }
});
