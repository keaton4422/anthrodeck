import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Persistent store ────────────────────────────────────────────────
  storeGet: (key: string): Promise<unknown> =>
    ipcRenderer.invoke('store:get', key),

  storeSet: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('store:set', key, value),

  // ─── Shell code execution ────────────────────────────────────────────
  runShell: (code: string, language: string): Promise<{
    stdout: string;
    stderr: string;
    error: string | null;
  }> => ipcRenderer.invoke('shell:run', { code, language }),

  // ─── Claude streaming ────────────────────────────────────────────────
  claudeSend: (data: {
    messages: Array<{ role: string; content: string }>;
    apiKey: string;
  }): void => {
    ipcRenderer.send('claude:send', data);
  },

  claudeAbort: (): void => {
    ipcRenderer.send('claude:abort');
  },

  onClaudeDelta: (callback: (delta: string) => void): (() => void) => {
    const handler = (_: unknown, delta: string) => callback(delta);
    ipcRenderer.on('claude:delta', handler);
    return () => ipcRenderer.removeListener('claude:delta', handler);
  },

  onClaudeDone: (callback: (usage: { inputTokens: number; outputTokens: number }) => void): (() => void) => {
    const handler = (_: unknown, usage: { inputTokens: number; outputTokens: number }) => callback(usage);
    ipcRenderer.on('claude:done', handler);
    return () => ipcRenderer.removeListener('claude:done', handler);
  },

  onClaudeError: (callback: (error: string) => void): (() => void) => {
    const handler = (_: unknown, error: string) => callback(error);
    ipcRenderer.on('claude:error', handler);
    return () => ipcRenderer.removeListener('claude:error', handler);
  },

  // ─── Auto-updater ────────────────────────────────────────────────────
  updaterGetVersion: (): Promise<string> =>
    ipcRenderer.invoke('updater:get-version'),

  updaterCheck: (): Promise<unknown> =>
    ipcRenderer.invoke('updater:check'),

  updaterDownload: (): Promise<void> =>
    ipcRenderer.invoke('updater:download'),

  updaterInstall: (): void =>
    ipcRenderer.send('updater:install'),

  onUpdaterAvailable: (callback: (info: { version: string }) => void): (() => void) => {
    const handler = (_: unknown, info: { version: string }) => callback(info);
    ipcRenderer.on('updater:update-available', handler);
    return () => ipcRenderer.removeListener('updater:update-available', handler);
  },

  onUpdaterUpToDate: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('updater:up-to-date', handler);
    return () => ipcRenderer.removeListener('updater:up-to-date', handler);
  },

  onUpdaterProgress: (callback: (info: { percent: number; bytesPerSecond: number }) => void): (() => void) => {
    const handler = (_: unknown, info: { percent: number; bytesPerSecond: number }) => callback(info);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  },

  onUpdaterReady: (callback: (info: { version: string }) => void): (() => void) => {
    const handler = (_: unknown, info: { version: string }) => callback(info);
    ipcRenderer.on('updater:ready', handler);
    return () => ipcRenderer.removeListener('updater:ready', handler);
  },

  onUpdaterError: (callback: (error: string) => void): (() => void) => {
    const handler = (_: unknown, error: string) => callback(error);
    ipcRenderer.on('updater:error', handler);
    return () => ipcRenderer.removeListener('updater:error', handler);
  },
});
