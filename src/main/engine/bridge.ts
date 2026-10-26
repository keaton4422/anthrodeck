// Electron glue for the engine: owns the EngineSession for the open project, implements CockpitPort
// over IPC, and registers the claude:* / engine:* channels.
//
// Renderer contract:
//   * The original channels keep their meaning (claude:delta, claude:thinking-delta,
//     claude:tool-activity, claude:file-written, claude:done, claude:error and the
//     write-preview / ask-user / teach request-response pairs), so the chat, telemetry and haptics
//     consumers did not have to change shape.
//   * Every engine event is ALSO published on `engine:event`. New consumers (sectors, milestones,
//     drive mode, context gauge) subscribe there instead of growing a channel each.

import { exec, execFile } from 'child_process';
import { app, BrowserWindow, ipcMain, IpcMainEvent } from 'electron';
import os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { query, listSessions, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import type Store from 'electron-store';
import { normalizeDriveMode, resolveEngineSettings } from './config';
import { defaultLocateDeps, engineVersion, INSTALL_COMMAND, locateEngine, readClaudeSignIn } from './locate';
import path from 'path';
import { EngineSession, type CockpitPort, type EngineEvent } from './session';
import { generateFlashcard, recordToolCalls, setLastContext } from '../flashcards';
import { pushWrite } from '../writeHistory';
import { detectDevPortFromOutput } from '../network';
import { setDetectedDevPort } from '../previewServer';
import { parseGitStatus, toProjects, toRestoredMessages, toSessionCards, type GitState } from '../sessions';

interface Pending<T> { resolve: (v: T) => void; fallback: T }

export function registerEngineIpc(store: Store, getWindow: () => BrowserWindow | null): { shutdown(): void } {
  let session: EngineSession | null = null;
  let turnText = '';

  const send = (channel: string, ...args: unknown[]) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  };

  // ─── request/response with the renderer, cancellable by the engine's AbortSignal ──
  const pending = new Map<string, Pending<unknown>>();
  function ask<T>(channel: string, payload: { id: string }, fallback: T, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve) => {
      if (signal.aborted) return resolve(fallback);
      pending.set(payload.id, { resolve: resolve as (v: unknown) => void, fallback });
      signal.addEventListener('abort', () => {
        if (!pending.has(payload.id)) return;
        pending.delete(payload.id);
        send('claude:prompt-cancel', payload.id);
        resolve(fallback);
      }, { once: true });
      send(channel, payload);
    });
  }
  const settle = (id: string, value: unknown) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p.resolve(value);
  };
  const cancelAllPrompts = () => {
    for (const [id, p] of pending) { send('claude:prompt-cancel', id); p.resolve(p.fallback); }
    pending.clear();
  };

  ipcMain.on('claude:write-decision', (_: IpcMainEvent, id: string, accepted: boolean, feedback?: string) =>
    settle(id, { accepted, feedback }));
  ipcMain.on('claude:ask-user-decision', (_: IpcMainEvent, id: string, value: string) => settle(id, value));
  ipcMain.on('claude:teach-decision', (_: IpcMainEvent, id: string, action: 'continue' | 'redirect', instruction?: string) =>
    settle(id, { action, instruction }));

  // ─── the port ───────────────────────────────────────────────────────────────
  const port: CockpitPort = {
    emit(ev: EngineEvent) {
      send('engine:event', ev);
      switch (ev.type) {
        case 'delta': turnText += ev.text; send('claude:delta', ev.text); break;
        case 'thinking': send('claude:thinking-delta', ev.text); break;
        case 'tool': if (!ev.quiet) send('claude:tool-activity', `\n\`${ev.label}\`\n`); break;
        case 'file-written': send('claude:file-written', ev.path); break;
        case 'error': send('claude:error', ev.message); break;
        case 'result': {
          send('claude:done', ev.summary);
          void afterTurn(ev.summary.toolCalls);
          break;
        }
        default: break;
      }
    },
    askWrite: (req, signal) => ask('claude:write-preview', req, { accepted: false }, signal),
    askChoice: (req, signal) => ask('claude:ask-user', req, 'deny', signal),
    askTeach: (req, signal) => ask('claude:teach', req, { action: 'continue' as const }, signal),
    recordWrite: (rec) => pushWrite(rec),
    log: (line) => {
      if (!line) return;
      console.log(`[engine] ${line}`);
      // Claude Code's dev-server output lands here too; keep LAN preview's port detection working.
      const devPort = detectDevPortFromOutput(line);
      if (devPort) setDetectedDevPort(devPort);
    },
  };

  // Session flashcards: best-effort, only when there is an API key to mint them with.
  async function afterTurn(toolCalls: number) {
    const projectPath = store.get('projectPath', null) as string | null;
    const text = turnText;
    turnText = '';
    if (!projectPath) return;
    try {
      setLastContext(projectPath, text);
      const apiKey = store.get('apiKey', '') as string;
      if (recordToolCalls(projectPath, toolCalls) && apiKey) {
        const card = await generateFlashcard(new Anthropic({ apiKey, maxRetries: 2 }), projectPath);
        if (card) send('claude:flashcard', card);
      }
    } catch { /* never fails a turn */ }
  }

  const locate = () => locateEngine(
    (store.get('enginePath', '') as string) || null,
    defaultLocateDeps(app.isPackaged ? null : app.getAppPath()),
  );

  function sessionFor(projectPath: string, raw: Record<string, unknown>): EngineSession | string {
    const engine = locate();
    if (!engine) return 'Claude Code engine not found. Install it from Settings (⚙) → Engine.';
    const settings = resolveEngineSettings({ ...raw, mode: store.get('driveMode', 'default') });
    const env = { projectPath, executable: engine.path, apiKey: (store.get('apiKey', '') as string) };
    if (session && session.projectPath !== projectPath) {
      session.close();
      session = null;
    }
    if (!session) {
      session = new EngineSession(env, settings, port, query);
    } else {
      session.updateEnv(env);
      session.updateSettings(settings);
    }
    return session;
  }

  // ─── channels ───────────────────────────────────────────────────────────────
  ipcMain.on('claude:send', (_e, { text, settings }: { text: string; settings?: Record<string, unknown> }) => {
    const projectPath = (store.get('projectPath', null) as string | null) ?? os.homedir();
    const s = sessionFor(projectPath, settings ?? {});
    if (typeof s === 'string') { send('claude:error', s); return; }
    if (s.isBusy) { send('claude:error', 'Claude is still working. Stop it first, or wait for it to finish.'); return; }
    turnText = '';
    s.send(text);
  });

  // ─── home dashboard ─────────────────────────────────────────────────────────
  // Home: this device's projects (from its Claude Code sessions), each with its git state and its
  // sessions newest first, plus which session the cockpit has open right now.
  const gitState = (cwd: string) => new Promise<GitState | null>((resolve) => {
    execFile('git', ['-C', cwd, 'status', '--porcelain=v1', '-b'], { timeout: 3000 }, (err, stdout) => {
      resolve(err ? null : parseGitStatus(stdout));
    });
  });
  ipcMain.handle('sessions:list', async () => {
    try {
      const cards = toSessionCards(await listSessions({ limit: 80 }), (d) => fs.existsSync(d), 80);
      const cwds = [...new Set(cards.map((c) => c.cwd))].slice(0, 12);
      const states = await Promise.all(cwds.map(gitState));
      const git = Object.fromEntries(cwds.map((c, i) => [c, states[i]]));
      return { projects: toProjects(cards, git), currentId: session?.currentSessionId ?? null };
    } catch (e) {
      return { projects: [], currentId: null, error: (e as Error).message };
    }
  });

  // Reopen one: its folder becomes the project, the engine resumes it on the next send, and its
  // conversation comes back for the chat to show.
  ipcMain.handle('sessions:resume', async (_e, { id, cwd, settings }: { id: string; cwd: string; settings?: Record<string, unknown> }) => {
    if (session?.isBusy) return { error: 'Claude is still working. Stop it first, or wait for it to finish.' };
    if (!fs.existsSync(cwd)) return { error: `That session's folder is gone: ${cwd}` };
    cancelAllPrompts();
    store.set('projectPath', cwd);
    const s = sessionFor(cwd, settings ?? {});
    if (typeof s === 'string') return { error: s };
    s.resumeFrom(id);
    const history = toRestoredMessages(await getSessionMessages(id, { dir: cwd }));
    return { cwd, history };
  });

  ipcMain.on('claude:abort', () => { void session?.interrupt(); });
  ipcMain.on('claude:reset', () => { cancelAllPrompts(); session?.reset(); });
  ipcMain.on('claude:rewind', (_e, anchor: string | null) => { cancelAllPrompts(); session?.rewind(anchor); });

  ipcMain.handle('claude:set-mode', async (_e, raw: unknown) => {
    const mode = normalizeDriveMode(raw);
    store.set('driveMode', mode);
    if (session) await session.setMode(mode);
    else send('engine:event', { type: 'mode', mode });
    return mode;
  });
  ipcMain.handle('claude:get-mode', () => normalizeDriveMode(store.get('driveMode', 'default')));

  ipcMain.handle('engine:status', async () => {
    const engine = locate();
    return {
      found: !!engine,
      path: engine?.path ?? null,
      source: engine?.source ?? null,
      version: engine ? await engineVersion(engine.path) : null,
      installCommand: INSTALL_COMMAND,
      hasApiKey: !!store.get('apiKey', ''),
      claude: readClaudeSignIn((() => {
        try { return fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'); } catch { return null; }
      })()),
    };
  });

  // Runs Claude Code's official installer — only ever when the pilot presses the button.
  ipcMain.handle('engine:install', () => new Promise<{ ok: boolean; output: string }>((resolve) => {
    if (process.platform === 'win32') {
      resolve({ ok: false, output: 'On Windows, install Claude Code from PowerShell: irm https://claude.ai/install.ps1 | iex' });
      return;
    }
    exec(INSTALL_COMMAND, { shell: '/bin/bash', timeout: 5 * 60_000, env: process.env }, (err, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`.trim().split('\n').slice(-12).join('\n');
      resolve({ ok: !err && !!locate(), output: output || (err ? err.message : 'Installed.') });
    });
  }));

  return {
    shutdown() {
      cancelAllPrompts();
      session?.close();
      session = null;
    },
  };
}
