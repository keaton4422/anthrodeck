import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { exec } from 'child_process';
import os from 'os';
import fs from 'fs';
import Store from 'electron-store';
import Anthropic from '@anthropic-ai/sdk';
import { autoUpdater } from 'electron-updater';

// Injected by electron-forge Vite plugin
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

const store = new Store();
let mainWindow: BrowserWindow | null = null;
let currentStreamAborted = false;

const SYSTEM_PROMPT = `You are AntroDeck — an AI assistant built into a Steam Deck. You help the user code, create, deploy, and accomplish anything through voice and touch.

Guidelines:
- Keep responses clear and concise since the user is reading on a handheld screen
- When providing code, always use fenced code blocks with the language specified (e.g. \`\`\`python)
- Prefer practical, runnable examples over lengthy explanations
- If the user asks you to write a file or run a command, provide the exact code/command
- The user can click "Run" on code blocks to execute them on their Steam Deck
- Be encouraging and treat every request as achievable`;

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

  // Dev shortcuts
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11') {
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
    }
    if (input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools();
    }
    if (input.key === 'Escape' && isDev) {
      mainWindow?.setFullScreen(false);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Store IPC ────────────────────────────────────────────────────────────────
ipcMain.handle('store:get', (_, key: string) => {
  return store.get(key);
});

ipcMain.handle('store:set', (_, key: string, value: unknown) => {
  store.set(key, value);
});

// ─── Shell Execution IPC ──────────────────────────────────────────────────────
ipcMain.handle('shell:run', async (_, { code, language }: { code: string; language: string }) => {
  return new Promise<{ stdout: string; stderr: string; error: string | null }>((resolve) => {
    const tmpDir = os.tmpdir();
    const extMap: Record<string, string> = {
      python: 'py',
      python3: 'py',
      javascript: 'js',
      js: 'js',
      typescript: 'ts',
      ts: 'ts',
      bash: 'sh',
      sh: 'sh',
      ruby: 'rb',
    };
    const ext = extMap[language.toLowerCase()] ?? 'txt';
    const tmpFile = path.join(tmpDir, `anthrodeck_${Date.now()}.${ext}`);

    try {
      fs.writeFileSync(tmpFile, code, 'utf-8');
    } catch (e) {
      return resolve({ stdout: '', stderr: '', error: `Failed to write temp file: ${(e as Error).message}` });
    }

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

    exec(cmd, { timeout: 30_000 }, (error, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: error && !stderr ? error.message : null,
      });
    });
  });
});

// ─── Claude Streaming IPC ─────────────────────────────────────────────────────
ipcMain.on('claude:send', async (event, { messages, apiKey }: { messages: Array<{ role: string; content: string }>; apiKey: string }) => {
  currentStreamAborted = false;

  if (!apiKey) {
    event.sender.send('claude:error', 'No API key set. Open Settings (⚙) and enter your Anthropic API key.');
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 8192,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      thinking: { type: 'adaptive' } as any,
      system: SYSTEM_PROMPT,
      messages: messages as Anthropic.MessageParam[],
    });

    for await (const chunk of stream) {
      if (currentStreamAborted || event.sender.isDestroyed()) break;

      if (chunk.type === 'content_block_delta') {
        if (chunk.delta.type === 'text_delta' && chunk.delta.text) {
          event.sender.send('claude:delta', chunk.delta.text);
        }
      }
    }

    if (!currentStreamAborted && !event.sender.isDestroyed()) {
      const final = await stream.finalMessage();
      event.sender.send('claude:done', {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      });
    }
  } catch (err) {
    if (!currentStreamAborted && !event.sender.isDestroyed()) {
      const msg = (err as Error).message ?? 'Unknown error';
      event.sender.send('claude:error', msg.includes('401') ? 'Invalid API key. Check your key in Settings.' : msg);
    }
  }
});

ipcMain.on('claude:abort', () => {
  currentStreamAborted = true;
});

// ─── Auto-updater ─────────────────────────────────────────────────────────────
// Only runs in packaged builds (not dev mode)
function setupAutoUpdater() {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
  if (isDev) return; // electron-updater doesn't work in dev mode

  autoUpdater.autoDownload = false; // Let the user choose when to download
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
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

  // Check silently on startup after a short delay
  setTimeout(() => autoUpdater.checkForUpdates(), 3000);
}

ipcMain.handle('updater:get-version', () => app.getVersion());

ipcMain.handle('updater:check', async () => {
  const isDev = !!MAIN_WINDOW_VITE_DEV_SERVER_URL;
  if (isDev) return { dev: true };
  try {
    return await autoUpdater.checkForUpdates();
  } catch (e) {
    return { error: (e as Error).message };
  }
});

ipcMain.handle('updater:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    mainWindow?.webContents.send('updater:error', (e as Error).message);
  }
});

ipcMain.on('updater:install', () => {
  autoUpdater.quitAndInstall(false, true);
});

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    setupAutoUpdater();
  }
});
