import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Store ──────────────────────────────────────────────────────────────────
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),

  // ── Project ────────────────────────────────────────────────────────────────
  projectOpenDialog: () => ipcRenderer.invoke('project:open-dialog'),
  projectGet: () => ipcRenderer.invoke('project:get'),
  projectSet: (p: string) => ipcRenderer.invoke('project:set', p),

  // ── File System ────────────────────────────────────────────────────────────
  fsList: (dir?: string) => ipcRenderer.invoke('fs:list', dir),
  fsRead: (relPath: string) => ipcRenderer.invoke('fs:read', relPath),
  fsWrite: (relPath: string, content: string) => ipcRenderer.invoke('fs:write', relPath, content),

  // ── Git ────────────────────────────────────────────────────────────────────
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitAddAndCommit: (message: string) => ipcRenderer.invoke('git:addAndCommit', message),
  gitPush: () => ipcRenderer.invoke('git:push'),

  // ── Shell ──────────────────────────────────────────────────────────────────
  runShell: (code: string, language: string) => ipcRenderer.invoke('shell:run', { code, language }),

  // ── Claude (agentic) ──────────────────────────────────────────────────────
  claudeSend: (data: {
    messages: Array<{ role: string; content: string }>;
    apiKey: string;
    projectPath: string | null;
    autonomousWrites: boolean;
    model: string;
    extendedThinking: boolean;
    effort: string;
  }) => ipcRenderer.send('claude:send', data),

  claudeAbort: () => ipcRenderer.send('claude:abort'),

  onClaudeDelta: (cb: (text: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on('claude:delta', handler);
    return () => ipcRenderer.removeListener('claude:delta', handler);
  },

  // Extended-thinking reasoning stream (separate channel from the answer text).
  onClaudeThinkingDelta: (cb: (text: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, text: string) => cb(text);
    ipcRenderer.on('claude:thinking-delta', handler);
    return () => ipcRenderer.removeListener('claude:thinking-delta', handler);
  },

  onClaudeDone: (
    cb: (usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      thinkingTokens: number;
      confidence: 'high' | 'med' | 'low' | null;
    }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      u: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        thinkingTokens: number;
        confidence: 'high' | 'med' | 'low' | null;
      },
    ) => cb(u);
    ipcRenderer.on('claude:done', handler);
    return () => ipcRenderer.removeListener('claude:done', handler);
  },

  // ask_user: Claude wants the pilot to pick between 2-4 options.
  onAskUser: (
    cb: (data: { id: string; question: string; options: { label: string; value: string }[] }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { id: string; question: string; options: { label: string; value: string }[] },
    ) => cb(data);
    ipcRenderer.on('claude:ask-user', handler);
    return () => ipcRenderer.removeListener('claude:ask-user', handler);
  },
  sendAskUserDecision: (id: string, value: string) => {
    ipcRenderer.send('claude:ask-user-decision', id, value);
  },
  onClaudeError: (cb: (msg: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, msg: string) => cb(msg);
    ipcRenderer.on('claude:error', handler);
    return () => ipcRenderer.removeListener('claude:error', handler);
  },

  // Tool activity label shown inline in chat (e.g. `read: src/App.tsx`)
  onClaudeToolActivity: (cb: (label: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, label: string) => cb(label);
    ipcRenderer.on('claude:tool-activity', handler);
    return () => ipcRenderer.removeListener('claude:tool-activity', handler);
  },

  // Write preview: Claude wants to write a file
  onWritePreview: (cb: (data: { id: string; path: string; content: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { id: string; path: string; content: string }) => cb(data);
    ipcRenderer.on('claude:write-preview', handler);
    return () => ipcRenderer.removeListener('claude:write-preview', handler);
  },
  sendWriteDecision: (id: string, accepted: boolean, feedback?: string) => {
    ipcRenderer.send('claude:write-decision', id, accepted, feedback);
  },

  // Autonomous mode: file was written — show a toast
  onFileWritten: (cb: (filePath: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, filePath: string) => cb(filePath);
    ipcRenderer.on('claude:file-written', handler);
    return () => ipcRenderer.removeListener('claude:file-written', handler);
  },

  // ── Preview / LAN sharing ─────────────────────────────────────────────────
  previewStart: (opts: { port?: number; https?: boolean; devPort?: number | null }) =>
    ipcRenderer.invoke('preview:start', opts),
  previewStop: () => ipcRenderer.invoke('preview:stop'),
  previewStatus: () => ipcRenderer.invoke('preview:status'),
  previewDetectDev: () => ipcRenderer.invoke('preview:detect-dev'),

  // ── Auto-updater ──────────────────────────────────────────────────────────
  updaterGetVersion: () => ipcRenderer.invoke('updater:get-version'),
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall: () => ipcRenderer.send('updater:install'),

  onUpdaterAvailable: (cb: (info: { version: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: { version: string }) => cb(info);
    ipcRenderer.on('updater:update-available', handler);
    return () => ipcRenderer.removeListener('updater:update-available', handler);
  },
  onUpdaterUpToDate: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('updater:up-to-date', handler);
    return () => ipcRenderer.removeListener('updater:up-to-date', handler);
  },
  onUpdaterProgress: (cb: (p: { percent: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, p: { percent: number }) => cb(p);
    ipcRenderer.on('updater:progress', handler);
    return () => ipcRenderer.removeListener('updater:progress', handler);
  },
  onUpdaterReady: (cb: (info: { version: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: { version: string }) => cb(info);
    ipcRenderer.on('updater:ready', handler);
    return () => ipcRenderer.removeListener('updater:ready', handler);
  },
  onUpdaterError: (cb: (msg: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, msg: string) => cb(msg);
    ipcRenderer.on('updater:error', handler);
    return () => ipcRenderer.removeListener('updater:error', handler);
  },
});
