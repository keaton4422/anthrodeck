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
import { EventEmitter } from 'events';
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
import { mergePlanUsage, type PlanUsage } from './translate';
import { generateFlashcard, recordToolCalls, setLastContext } from '../flashcards';
import { pushWrite } from '../writeHistory';
import { detectDevPortFromOutput } from '../network';
import { setDetectedDevPort } from '../previewServer';
import { parseGitStatus, toProjects, toRestoredMessages, toSessionCards, type GitState } from '../sessions';
import {
  addressOf, defaultLabel, remoteExec, remotePython, setAddresses, sshProblem, LOCATE_CLAUDE_SH, LIST_SESSIONS_PY, READ_SESSION_PY, READ_FILE_PY,
  type RemoteTarget,
} from '../remote';
import type { SDKSessionInfo, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { LiveLink, setupRelay, WATCH_PY, type LiveLinkStatus } from '../live';
import { DeckRc, linkSpawner, setupHub, stopHub, type HubResult, type LinkSpawner } from '../rclink';
import { reconnectHeld } from '../held';
import { ACTIVITY_PY, toActivity, type RawActivity } from '../activity';
import { parseRcSessions, RcChats, type RcSession } from '../rcSessions';
import { RemoteAsks } from '../remoteAsks';

interface Pending<T> { resolve: (v: T) => void; fallback: T }

// The other computer's sessions as they change, for the main process too (main/pings.ts).
export const liveEvents = new EventEmitter();

export function registerEngineIpc(store: Store, getWindow: () => BrowserWindow | null): { shutdown(): void; reconnect(): void } {
  let session: EngineSession | null = null;
  let turnText = '';

  // ─── remote computer (see main/remote.ts) ─────────────────────────────────────
  const remoteTarget = (): RemoteTarget | null => {
    const r = store.get('remote', null) as { host?: string; label?: string; away?: string | null } | null;
    return r?.host ? { host: r.host, label: r.label || defaultLabel(r.host), away: r.away || null } : null;
  };
  // SSH tries the home address, then the away address (see Addresses in main/remote.ts).
  const applyAddresses = () => { const t = remoteTarget(); if (t) setAddresses(t.host, t.away); };
  applyAddresses();
  // The open project's computer: null for this one, else the remote host.
  const projectHost = () => (store.get('projectHost', null) as string | null) || null;
  // Where Claude Code lives on each remote computer, found once per run.
  const remoteClaude = new Map<string, string>();
  async function locateRemoteClaude(host: string): Promise<string> {
    const cached = remoteClaude.get(host);
    if (cached) return cached;
    const r = await remoteExec(host, LOCATE_CLAUDE_SH);
    const found = r.stdout.trim().split('\n').pop() ?? '';
    if (r.code !== 0 && !found) throw new Error(sshProblem(r.stderr) ?? (r.stderr.trim() || 'Could not reach that computer.'));
    if (!found) throw new Error('Claude Code isn\'t installed on that computer (or the Claude app hasn\'t set it up yet).');
    remoteClaude.set(host, found);
    return found;
  }
  const remoteReader = (host: string) => (abs: string) =>
    remotePython<{ content: string | null }>(host, READ_FILE_PY, [abs]).then((r) => r.content).catch(() => null);

  const send = (channel: string, ...args: unknown[]) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
    if (channel === 'live:state') liveEvents.emit('state', args[0]);
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

  // ─── live sessions on the remote computer (see main/live.ts) ─────────────────
  // While a remote computer is set up, one SSH link watches its running Claude Code sessions and
  // brings their permission prompts and questions here, as the same cards local sessions use. The
  // live session screen follows one session's conversation over it and sends that session messages.
  //
  // When SSH can't reach that computer at any of its addresses, the same link runs over Remote
  // Control instead (main/rclink): the Deck's own Remote Control session talks to a hub session on
  // that computer, set up from here whenever SSH reaches it.
  let live: LiveLink | null = null;
  let spawner: LinkSpawner | null = null;
  const rcEnabled = () => process.platform !== 'win32' && store.get('rcLink', true) !== false;
  let rc: DeckRc | null = null;
  const deckRc = () => {
    if (!rcEnabled()) return null;
    if (!rc) {
      rc = new DeckRc({ claudePath: () => locate()?.path ?? null });
      rc.onChat = (from, text) => rcChats.received(from, text, rcKnown);
      rc.onUndelivered = (id, reason) => rcChats.undelivered(id, reason);
      rc.onRemote = (from, body) => remoteAsks.receive(from, body);
    }
    return rc;
  };
  // Started with the app on the Deck, so the AnthroDeck plugin on the pilot's computers can find
  // it (not on a desktop: two sessions named anthrodeck-deck would split the plugin's messages).
  if (process.platform === 'linux') {
    setTimeout(() => { void deckRc()?.start().catch(() => { /* no Claude Code here yet */ }); }, 3000);
  }
  // Every Remote Control session on the account, on any computer (main/rcSessions.ts).
  let rcKnown: RcSession[] = [];
  const rcChats = new RcChats((ref, entries) => send('rc:chat', ref, entries));
  // What each Remote Control session last said at the end of a turn (from the plugin), for Home.
  const rcSaid = new Map<string, string>();
  const remoteAsks = new RemoteAsks({
    ask: (card, signal) => ask('claude:ask-user', card, '', signal),
    answer: (to, id, decision) => deckRc()?.sendText(to, `ADK2R ${JSON.stringify({ t: 'answer', id, decision })}`, `ans-${id}`),
    onAsk: (name) => liveEvents.emit('ping', `${name} needs you`),
    onDone: (name, text) => {
      rcSaid.set(name, text);
      const ref = rcKnown.find((x) => x.name === name)?.ref;
      if (ref) rcChats.said(ref, text);
      liveEvents.emit('ping', `${name} finished`);
      send('rc:done', name);
    },
  });
  ipcMain.handle('rc:sessions', async () => {
    const link = deckRc();
    if (!link) return { sessions: [], error: 'Remote Control is off (Settings → Reach it from anywhere).' };
    try {
      const listing = await link.peers();
      if (listing === null) return { sessions: rcKnown, error: 'Remote Control didn\'t answer.' };
      rcKnown = parseRcSessions(listing);
      return { sessions: rcKnown.map((x) => ({ ...x, said: rcSaid.get(x.name) ?? null })), error: null };
    } catch (e) {
      return { sessions: rcKnown, error: (e as Error).message };
    }
  });
  ipcMain.handle('rc:chat:get', (_e, ref: string) => rcChats.get(ref));
  ipcMain.handle('rc:chat:send', (_e, ref: string, text: string) => {
    const s = rcKnown.find((x) => x.ref === ref);
    const link = deckRc();
    if (!s || !link || typeof text !== 'string' || !text.trim()) return { ok: false };
    link.sendText(`${s.name} [${s.ref}]`, text, rcChats.sent(ref, text));
    return { ok: true };
  });
  // The hub on the other computer: put in place (or checked) once a run, the first time SSH gets there.
  let hub: { host: string; result: HubResult | null; error: string | null; at: number } | null = null;
  const ensureHub = async (restart = false) => {
    const t = remoteTarget();
    if (!t || !rcEnabled()) return null;
    try {
      const result = await setupHub(t.host, await locateRemoteClaude(t.host), restart);
      hub = { host: t.host, result, error: null, at: Date.now() };
    } catch (e) {
      hub = { host: t.host, result: null, error: (e as Error).message, at: Date.now() };
    }
    send('rc:state', rcStatus());
    return hub;
  };
  const rcStatus = () => ({
    enabled: rcEnabled(),
    via: spawner?.via() ?? 'ssh',
    deck: rc?.state() ?? { state: 'off' as const },
    hub: hub && hub.host === remoteTarget()?.host ? { result: hub.result, error: hub.error, at: hub.at } : null,
  });
  const liveStatus = () => {
    const t = remoteTarget();
    const st: LiveLinkStatus = live?.current ?? { connected: false, error: null, state: null };
    return t ? { ...st, label: t.label, via: spawner?.via() ?? 'ssh' } : null;
  };
  const relink = () => {
    const t = remoteTarget();
    if (live && live.host === t?.host) return;
    live?.stop();
    spawner?.stop();
    spawner = t ? linkSpawner({
      host: t.host, label: t.label, script: WATCH_PY,
      addresses: () => (remoteTarget()?.away ? 2 : 1),
      rc: deckRc,
      onVia: () => { send('live:state', liveStatus()); send('rc:state', rcStatus()); },
    }) : null;
    live = t && spawner ? new LiveLink(t.host, t.label, {
      ask: (card, signal) => ask('claude:ask-user', card, '', signal),
      onStatus: (st) => {
        send('live:state', liveStatus());
        if (st.connected && spawner?.via() === 'ssh' && rcEnabled() && hub?.host !== t.host) void ensureHub();
      },
      onTail: (tail) => send('live:tail', tail),
      spawnSsh: spawner.spawn,
    }) : null;
    send('live:state', liveStatus());
  };
  relink();
  ipcMain.handle('rc:get', () => rcStatus());
  ipcMain.handle('rc:set', async (_e, on: boolean) => {
    store.set('rcLink', !!on);
    if (!on) {
      rc?.stop();
      rc = null;
      spawner?.preferSsh();
      const t = remoteTarget();
      if (t) await stopHub(t.host).catch(() => null);
      hub = null;
    }
    live?.reconnectNow();
    return rcStatus();
  });
  ipcMain.handle('rc:setup', () => ensureHub(true).then(() => rcStatus()));
  ipcMain.handle('live:get', () => liveStatus());
  // The Claude plan's usage, as last reported by a session run from here (Home's dashboard).
  ipcMain.handle('usage:plan', () => store.get('planUsage', null));
  ipcMain.on('live:watch', (_e, sessionId: string | null) => live?.watch(sessionId));
  ipcMain.handle('live:send', (_e, sessionId: string, text: string) =>
    live ? live.send(sessionId, text) : { id: '', ok: false, error: 'No remote computer set up.' });
  ipcMain.handle('live:relay', async (_e, op: 'install' | 'remove') => {
    const t = remoteTarget();
    if (!t) return { ok: false, error: 'No remote computer set up.' };
    try { await setupRelay(t.host, op); return { ok: true }; } catch (e) { return { ok: false, error: (e as Error).message }; }
  });

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
        case 'plan-usage': store.set('planUsage', mergePlanUsage(store.get('planUsage', null) as PlanUsage | null, ev.usage)); break;
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

  function sessionFor(projectPath: string, raw: Record<string, unknown>, remote?: { host: string; claudePath: string }): EngineSession | string {
    const engine = remote ? null : locate();
    if (!remote && !engine) return 'Claude Code engine not found. Install it from Settings (⚙) → Engine.';
    const settings = resolveEngineSettings({ ...raw, mode: store.get('driveMode', 'default') });
    const env = {
      projectPath,
      executable: engine?.path ?? '',
      apiKey: (store.get('apiKey', '') as string),
      ...(remote ? { remote, readText: remoteReader(remote.host) } : {}),
    };
    // A different folder, or the same path on a different computer, is a different session.
    if (session && (session.projectPath !== projectPath || session.remoteHost !== (remote?.host ?? null))) {
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
  ipcMain.on('claude:send', async (_e, { text, settings }: { text: string; settings?: Record<string, unknown> }) => {
    const projectPath = (store.get('projectPath', null) as string | null) ?? os.homedir();
    const host = projectHost();
    let remote: { host: string; claudePath: string } | undefined;
    if (host) {
      try { remote = { host, claudePath: await locateRemoteClaude(host) }; } catch (e) { send('claude:error', (e as Error).message); return; }
    }
    const s = sessionFor(projectPath, settings ?? {}, remote);
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
  ipcMain.handle('sessions:list', async (_e, machine?: 'local' | 'remote') => {
    if (machine === 'remote') {
      const t = remoteTarget();
      if (!t) return { projects: [], currentId: null, error: 'No remote computer set up. Add one in Settings.' };
      try {
        const data = await remotePython<{ sessions: SDKSessionInfo[]; git: Record<string, string | null> }>(t.host, LIST_SESSIONS_PY);
        const cards = toSessionCards(data.sessions, () => true, 80);   // folders already checked over there
        const git = Object.fromEntries(Object.entries(data.git).map(([k, v]) => [k, v === null ? null : parseGitStatus(v)]));
        const current = session && session.remoteHost === t.host ? session.currentSessionId : null;
        return { projects: toProjects(cards, git), currentId: current };
      } catch (e) {
        return { projects: [], currentId: null, error: (e as Error).message };
      }
    }
    try {
      const cards = toSessionCards(await listSessions({ limit: 80 }), (d) => fs.existsSync(d), 80);
      const cwds = [...new Set(cards.map((c) => c.cwd))].slice(0, 12);
      const states = await Promise.all(cwds.map(gitState));
      const git = Object.fromEntries(cwds.map((c, i) => [c, states[i]]));
      return { projects: toProjects(cards, git), currentId: session && !session.remoteHost ? session.currentSessionId : null };
    } catch (e) {
      return { projects: [], currentId: null, error: (e as Error).message };
    }
  });

  // The drawer: what's been happening in these projects (main/activity.ts), on whichever computer.
  ipcMain.handle('activity:get', async (_e, machine: 'local' | 'remote', cwds: string[]) => {
    const list = JSON.stringify((Array.isArray(cwds) ? cwds : []).filter((c) => typeof c === 'string').slice(0, 10));
    try {
      if (machine === 'remote') {
        const t = remoteTarget();
        if (!t) return { projects: [], error: 'No remote computer set up.' };
        return { projects: toActivity(await remotePython<RawActivity[]>(t.host, ACTIVITY_PY, [list])), error: null };
      }
      const raw = await new Promise<string>((resolve, reject) => {
        execFile('python3', ['-c', ACTIVITY_PY, list], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out)));
      });
      return { projects: toActivity(JSON.parse(raw) as RawActivity[]), error: null };
    } catch (e) {
      return { projects: [], error: (e as Error).message };
    }
  });

  // Reopen one: its folder becomes the project, the engine resumes it on the next send, and its
  // conversation comes back for the chat to show.
  ipcMain.handle('sessions:resume', async (_e, { id, cwd, settings, machine }: { id: string; cwd: string; settings?: Record<string, unknown>; machine?: 'local' | 'remote' }) => {
    if (session?.isBusy) return { error: 'Claude is still working. Stop it first, or wait for it to finish.' };
    if (machine === 'remote') {
      const t = remoteTarget();
      if (!t) return { error: 'No remote computer set up. Add one in Settings.' };
      try {
        const claudePath = await locateRemoteClaude(t.host);
        const entries = await remotePython<SessionMessage[]>(t.host, READ_SESSION_PY, [id], 60_000);
        cancelAllPrompts();
        store.set('projectPath', cwd);
        store.set('projectHost', t.host);
        const s = sessionFor(cwd, settings ?? {}, { host: t.host, claudePath });
        if (typeof s === 'string') return { error: s };
        s.resumeFrom(id);
        return { cwd, history: toRestoredMessages(entries) };
      } catch (e) {
        return { error: (e as Error).message };
      }
    }
    if (!fs.existsSync(cwd)) return { error: `That session's folder is gone: ${cwd}` };
    cancelAllPrompts();
    store.set('projectPath', cwd);
    store.set('projectHost', null);
    const s = sessionFor(cwd, settings ?? {});
    if (typeof s === 'string') return { error: s };
    s.resumeFrom(id);
    const history = toRestoredMessages(await getSessionMessages(id, { dir: cwd }));
    return { cwd, history };
  });

  // The remote computer: what it's called, and a check that SSH, Claude Code and python3 all work.
  ipcMain.handle('remote:get', () => remoteTarget());
  ipcMain.handle('remote:set', (_e, host: string | null, away?: string | null) => {
    const h = host?.trim();
    if (!h) { store.set('remote', null); relink(); return null; }
    remoteClaude.delete(h);
    store.set('remote', { host: h, label: defaultLabel(h), away: away?.trim() || null });
    applyAddresses();
    relink();
    live?.reconnectNow();
    return remoteTarget();
  });
  ipcMain.handle('remote:test', async () => {
    const t = remoteTarget();
    if (!t) return { ok: false, error: 'No remote computer set up.' };
    remoteClaude.delete(t.host);
    try {
      const claudePath = await locateRemoteClaude(t.host);
      const v = await remoteExec(t.host, `${JSON.stringify(claudePath)} --version 2>&1 | head -1; python3 --version 2>&1`);
      const [version = '', python = ''] = v.stdout.trim().split('\n');
      if (!/python 3/i.test(python)) return { ok: false, claudePath, version, error: 'python3 isn\'t available on that computer (needed to list its sessions).' };
      return { ok: true, claudePath, version, via: addressOf(t.host) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
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
    // The Deck woke up or came back online: every link to the other computer reconnects now.
    reconnect() {
      spawner?.preferSsh();
      live?.reconnectNow();
      reconnectHeld();
    },
    shutdown() {
      cancelAllPrompts();
      live?.stop();
      spawner?.stop();
      rc?.stop();
      session?.close();
      session = null;
    },
  };
}
