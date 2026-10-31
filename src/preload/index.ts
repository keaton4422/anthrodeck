import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateAvailable } from '../main/releaseNotes';

// Which computer an action is for: this one, or the remote computer set up in Settings.
type Machine = 'local' | 'remote';

// Back online (a hotspot reconnecting, a new Wi-Fi network): the links to the other computer reconnect.
window.addEventListener('online', () => ipcRenderer.send('net:online'));

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Store ──────────────────────────────────────────────────────────────────
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),

  // ── Cockpit mods ───────────────────────────────────────────────────────────
  modsList: () => ipcRenderer.invoke('mods:list'),

  // ── Project ────────────────────────────────────────────────────────────────
  projectOpenDialog: () => ipcRenderer.invoke('project:open-dialog'),
  foldersList: (dir?: string | null, machine?: Machine) => ipcRenderer.invoke('folders:list', dir ?? null, machine ?? 'local'),
  foldersCreate: (parent: string, name: string, machine?: Machine) => ipcRenderer.invoke('folders:create', parent, name, machine ?? 'local'),
  projectGet: () => ipcRenderer.invoke('project:get'),
  projectSet: (p: string, host?: string | null) => ipcRenderer.invoke('project:set', p, host ?? null),
  projectHost: () => ipcRenderer.invoke('project:host'),
  remoteGet: () => ipcRenderer.invoke('remote:get'),
  remoteSet: (host: string | null, away?: string | null) => ipcRenderer.invoke('remote:set', host, away),
  remoteTest: () => ipcRenderer.invoke('remote:test'),
  liveGet: () => ipcRenderer.invoke('live:get'),
  liveRelay: (op: 'install' | 'remove') => ipcRenderer.invoke('live:relay', op),
  steamList: () => ipcRenderer.invoke('steam:list'),
  steamArt: (appid: string) => ipcRenderer.invoke('steam:art', appid),
  steamPlay: (appid: string, name: string) => ipcRenderer.invoke('steam:play', appid, name),
  steamShow: (which: 'deck' | 'game') => ipcRenderer.invoke('steam:show', which),
  steamState: () => ipcRenderer.invoke('steam:state'),
  onSteamPing: (cb: (why: string) => void) => {
    const h = (_: unknown, why: string) => cb(why);
    ipcRenderer.on('steam:ping', h);
    return () => { ipcRenderer.removeListener('steam:ping', h); };
  },
  onSteamState: (cb: (st: unknown) => void) => {
    const h = (_: unknown, st: unknown) => cb(st);
    ipcRenderer.on('steam:state', h);
    return () => { ipcRenderer.removeListener('steam:state', h); };
  },
  claudeOpen: (ref: string, name: string, bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('claude:open', ref, name, bounds),
  claudeEngineSignIn: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('claude:engine-sign-in', bounds),
  claudePlace: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.send('claude:place', bounds),
  claudeHide: () => ipcRenderer.send('claude:hide'),
  claudeShown: (shown: boolean) => ipcRenderer.send('claude:shown', shown),
  claudeScroll: (dy: number) => ipcRenderer.send('claude:scroll', dy),
  claudeBox: () => ipcRenderer.invoke('claude:box'),
  claudeSignedIn: () => ipcRenderer.invoke('claude:signed-in'),
  onClaudeClosed: (cb: () => void) => {
    const h = () => cb();
    ipcRenderer.on('claude:closed', h);
    return () => { ipcRenderer.removeListener('claude:closed', h); };
  },
  rcGet: () => ipcRenderer.invoke('rc:get'),
  rcSet: (on: boolean) => ipcRenderer.invoke('rc:set', on),
  rcSetup: () => ipcRenderer.invoke('rc:setup'),
  onRcState: (cb: (s: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, s: unknown) => cb(s);
    ipcRenderer.on('rc:state', handler);
    return () => ipcRenderer.removeListener('rc:state', handler);
  },
  onLiveState: (cb: (s: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, s: unknown) => cb(s);
    ipcRenderer.on('live:state', handler);
    return () => ipcRenderer.removeListener('live:state', handler);
  },
  planUsage: () => ipcRenderer.invoke('usage:plan'),
  liveWatch: (sessionId: string | null) => ipcRenderer.send('live:watch', sessionId),
  liveSend: (sessionId: string, text: string) => ipcRenderer.invoke('live:send', sessionId, text),
  onLiveTail: (cb: (t: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, t: unknown) => cb(t);
    ipcRenderer.on('live:tail', handler);
    return () => ipcRenderer.removeListener('live:tail', handler);
  },

  // ── File System ────────────────────────────────────────────────────────────
  fsList: (dir?: string) => ipcRenderer.invoke('fs:list', dir),
  fsRead: (relPath: string) => ipcRenderer.invoke('fs:read', relPath),
  fsWrite: (relPath: string, content: string) => ipcRenderer.invoke('fs:write', relPath, content),
  writeUndo: () => ipcRenderer.invoke('write:undo'),

  // ── Git ────────────────────────────────────────────────────────────────────
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitAddAndCommit: (message: string) => ipcRenderer.invoke('git:addAndCommit', message),
  gitPush: () => ipcRenderer.invoke('git:push'),
  gitLog: () => ipcRenderer.invoke('git:log'),

  // ── Shell ──────────────────────────────────────────────────────────────────
  runShell: (code: string, language: string) => ipcRenderer.invoke('shell:run', { code, language }),

  // ── Claude (agentic) ──────────────────────────────────────────────────────
  claudeSend: (data: { text: string; settings: Record<string, unknown> }) => ipcRenderer.send('claude:send', data),
  claudeAbort: () => ipcRenderer.send('claude:abort'),
  claudeReset: () => ipcRenderer.send('claude:reset'),
  claudeRewind: (anchor: string | null) => ipcRenderer.send('claude:rewind', anchor),
  sessionsList: (machine?: Machine) => ipcRenderer.invoke('sessions:list', machine ?? 'local'),
  activityGet: (machine: Machine, cwds: string[]) => ipcRenderer.invoke('activity:get', machine, cwds),
  rcSessions: () => ipcRenderer.invoke('rc:sessions'),
  onRcDone: (cb: (name: string) => void) => {
    const h = (_: unknown, name: string) => cb(name);
    ipcRenderer.on('rc:done', h);
    return () => { ipcRenderer.removeListener('rc:done', h); };
  },
  sessionsResume: (id: string, cwd: string, settings?: Record<string, unknown>, machine?: Machine) =>
    ipcRenderer.invoke('sessions:resume', { id, cwd, settings, machine: machine ?? 'local' }),
  claudeSetMode: (mode: string) => ipcRenderer.invoke('claude:set-mode', mode),
  claudeGetMode: () => ipcRenderer.invoke('claude:get-mode'),

  // Every engine event, for consumers that want more than the chat channels below.
  onEngineEvent: (cb: (ev: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, ev: unknown) => cb(ev);
    ipcRenderer.on('engine:event', handler);
    return () => ipcRenderer.removeListener('engine:event', handler);
  },
  // The engine withdrew a pending card (turn interrupted, session rewound).
  onPromptCancel: (cb: (id: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, id: string) => cb(id);
    ipcRenderer.on('claude:prompt-cancel', handler);
    return () => ipcRenderer.removeListener('claude:prompt-cancel', handler);
  },
  engineStatus: () => ipcRenderer.invoke('engine:status'),
  engineInstall: () => ipcRenderer.invoke('engine:install'),

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

  // Teach mode: Claude is about to run a tool and is asking to proceed.
  onTeach: (
    cb: (data: { id: string; tool: string; input: Record<string, unknown>; why: string; timeout: number }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { id: string; tool: string; input: Record<string, unknown>; why: string; timeout: number },
    ) => cb(data);
    ipcRenderer.on('claude:teach', handler);
    return () => ipcRenderer.removeListener('claude:teach', handler);
  },
  sendTeachDecision: (id: string, action: 'continue' | 'redirect', instruction?: string) => {
    ipcRenderer.send('claude:teach-decision', id, action, instruction);
  },

  // Session flashcards
  onFlashcard: (cb: (card: { id: string; text: string; timestamp: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, card: { id: string; text: string; timestamp: number }) => cb(card);
    ipcRenderer.on('claude:flashcard', handler);
    return () => ipcRenderer.removeListener('claude:flashcard', handler);
  },
  flashcardsGet: () => ipcRenderer.invoke('flashcards:get'),
  flashcardGenerate: () => ipcRenderer.invoke('flashcards:generate'),
  flashcardsClear: () => ipcRenderer.invoke('flashcards:clear'),
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

  // ── Local voice (whisper) ─────────────────────────────────────────────────
  voiceLocalStatus: () => ipcRenderer.invoke('voice:local-status'),
  voiceDownloadModel: () => ipcRenderer.invoke('voice:download-model'),
  voiceTranscribe: (wav: ArrayBuffer) => ipcRenderer.invoke('voice:transcribe', wav),

  // ── API key pairing ───────────────────────────────────────────────────────
  pairStart: () => ipcRenderer.invoke('pair:start'),
  pairStop: () => ipcRenderer.invoke('pair:stop'),
  onPairReceived: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('pair:received', handler);
    return () => ipcRenderer.removeListener('pair:received', handler);
  },

  // ── Auto-updater ──────────────────────────────────────────────────────────
  updaterGetVersion: () => ipcRenderer.invoke('updater:get-version'),
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall: () => ipcRenderer.send('updater:install'),
  updaterLastAvailable: () => ipcRenderer.invoke('updater:last-available'),

  onUpdaterAvailable: (cb: (info: UpdateAvailable) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: UpdateAvailable) => cb(info);
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
