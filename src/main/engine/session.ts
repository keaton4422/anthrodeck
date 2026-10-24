// EngineSession — one long-lived Claude Code session, driven from the cockpit.
//
// AnthroDeck is not a harness. Claude Code (via the Agent SDK) owns the agent loop, the tools,
// context management, compaction, CLAUDE.md, skills, MCP and the user's permission rules. This
// class only does the cockpit's half of the job:
//   * turns pilot input into user turns on a streaming-input session
//   * routes every decision Claude Code wants a human for (edit approvals, command approvals,
//     AskUserQuestion, plan approval, teach-mode pauses) to the face-button cards
//   * translates the engine's message stream into telemetry the HUD and games consume
//
// Everything that touches Electron sits behind CockpitPort, so the session is tested with a fake
// port and a scripted query function.

import fs from 'fs';
import path from 'path';
import type {
  CanUseTool,
  HookCallback,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { COCKPIT_PROMPT, DRIVE_MODE_LABELS, firstSentence, type DriveMode, type EngineSettings } from './config';
import { displayPath, filePathOf, isQuietTool, isWriteTool, proposedContent, toolLabel, SectorBoard, type Sector } from './tools';
import { newTranslateState, translate, type CockpitEvent, type TranslateState } from './translate';

export type EngineEvent =
  | CockpitEvent
  | { type: 'sectors'; sectors: Sector[] }
  | { type: 'sector-done'; sector: Sector }
  | { type: 'file-written'; path: string }
  | { type: 'mode'; mode: DriveMode }
  | { type: 'context'; percentage: number; totalTokens: number; maxTokens: number }
  | { type: 'error'; message: string };

export interface ChoiceOption { label: string; value: string; description?: string }

export interface CockpitPort {
  emit(ev: EngineEvent): void;
  askWrite(req: { id: string; path: string; content: string }, signal: AbortSignal): Promise<{ accepted: boolean; feedback?: string }>;
  askChoice(req: { id: string; question: string; detail?: string; options: ChoiceOption[] }, signal: AbortSignal): Promise<string>;
  askTeach(req: { id: string; tool: string; input: Record<string, unknown>; why: string; timeout: number }, signal: AbortSignal): Promise<{ action: 'continue' | 'redirect'; instruction?: string }>;
  // Commit a pre-write snapshot to the undo stack.
  recordWrite(rec: { absPath: string; relPath: string; previous: string | null }): void;
  log(line: string): void;
}

export interface EngineEnv {
  projectPath: string;
  executable: string;
  apiKey: string; // '' → Claude Code uses its own configured auth
}

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

// Minimal async queue: the streaming-input prompt for the session.
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  private ended = false;

  push(m: SDKUserMessage) {
    const w = this.waiters.shift();
    if (w) w({ value: m, done: false });
    else this.items.push(m);
  }

  end() {
    this.ended = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

let seq = 0;
const nextId = () => `ad-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export class EngineSession {
  private q: Query | null = null;
  private input: InputQueue | null = null;
  private st: TranslateState;
  private board = new SectorBoard();
  private sessionId: string | null = null;
  // Set by rewind: the next query resumes the session at this assistant message, on a fork.
  private resumeAt: string | null = null;
  private needsRestart = false;
  private busy = false;
  // tool_use_id → pre-write snapshot, committed to the undo stack on PostToolUse.
  private snapshots = new Map<string, { absPath: string; relPath: string; previous: string | null }>();

  constructor(
    private env: EngineEnv,
    private settings: EngineSettings,
    private port: CockpitPort,
    private queryFn: QueryFn,
  ) {
    this.st = newTranslateState(env.projectPath);
  }

  get isBusy() { return this.busy; }
  get currentSessionId() { return this.sessionId; }
  get projectPath() { return this.env.projectPath; }

  send(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.needsRestart && !this.busy) this.stop();
    if (!this.q) this.start();
    this.busy = true;
    this.input!.push({
      type: 'user',
      message: { role: 'user', content: trimmed },
      parent_tool_use_id: null,
    });
  }

  async interrupt(): Promise<void> {
    if (!this.q || !this.busy) return;
    try { await this.q.interrupt(); } catch (e) { this.port.log(`interrupt failed: ${(e as Error).message}`); }
  }

  async setMode(mode: DriveMode): Promise<void> {
    this.settings = { ...this.settings, mode };
    this.port.emit({ type: 'mode', mode });
    if (this.q) {
      try { await this.q.setPermissionMode(mode); } catch (e) { this.port.log(`setPermissionMode: ${(e as Error).message}`); }
    }
  }

  async setModel(model: EngineSettings['model']): Promise<void> {
    this.settings = { ...this.settings, model };
    if (this.q) {
      try { await this.q.setModel(model); } catch (e) { this.port.log(`setModel: ${(e as Error).message}`); }
    }
  }

  // Settings that can't be changed on a live query (effort, thinking) take effect on the next
  // turn: the session restarts and resumes, so the conversation carries over.
  updateSettings(next: EngineSettings): void {
    const restart = next.effort !== this.settings.effort || next.thinking !== this.settings.thinking;
    const modeChanged = next.mode !== this.settings.mode;
    const modelChanged = next.model !== this.settings.model;
    this.settings = next;
    if (restart) this.needsRestart = true;
    if (modeChanged) void this.setMode(next.mode);
    if (modelChanged) void this.setModel(next.model);
  }

  updateEnv(env: Partial<EngineEnv>): void {
    const changed = (Object.keys(env) as (keyof EngineEnv)[]).some((k) => env[k] !== undefined && env[k] !== this.env[k]);
    this.env = { ...this.env, ...env };
    if (changed) this.needsRestart = true;
  }

  // Rewind the conversation to just after the turn whose last assistant message is `anchor`
  // (null = back to an empty session). The next send resumes a fork from that point.
  rewind(anchor: string | null): void {
    this.stop();
    if (anchor && this.sessionId) {
      this.resumeAt = anchor;
    } else {
      this.sessionId = null;
      this.resumeAt = null;
      this.board.reset();
      this.port.emit({ type: 'sectors', sectors: [] });
    }
  }

  // New session: forget everything.
  reset(): void {
    this.rewind(null);
  }

  close(): void {
    this.stop();
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private stop(): void {
    const q = this.q;
    this.q = null;
    this.input?.end();
    this.input = null;
    this.needsRestart = false;
    this.snapshots.clear();
    if (this.busy) {
      this.busy = false;
      this.port.emit({ type: 'error', message: 'Aborted' });
    }
    if (q) {
      try { q.close(); } catch { /* already gone */ }
    }
  }

  private start(): void {
    const input = new InputQueue();
    this.input = input;
    this.st = newTranslateState(this.env.projectPath);

    const options: Options = {
      cwd: this.env.projectPath,
      model: this.settings.model,
      effort: this.settings.effort,
      thinking: this.settings.thinking ? { type: 'adaptive', display: 'summarized' } : { type: 'disabled' },
      permissionMode: this.settings.mode,
      includePartialMessages: true,
      // The pilot's own Claude Code setup applies: CLAUDE.md, skills, plugins, permission rules.
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: COCKPIT_PROMPT },
      canUseTool: this.canUseTool,
      hooks: {
        PreToolUse: [{ hooks: [this.preToolUse] }],
        PostToolUse: [{ hooks: [this.postToolUse] }],
        TaskCreated: [{ hooks: [this.taskHook] }],
        TaskCompleted: [{ hooks: [this.taskHook] }],
      },
      pathToClaudeCodeExecutable: this.env.executable,
      env: {
        ...process.env,
        ...(this.env.apiKey ? { ANTHROPIC_API_KEY: this.env.apiKey } : {}),
      },
      stderr: (d) => this.port.log(d.trimEnd()),
    };
    if (this.sessionId) {
      options.resume = this.sessionId;
      if (this.resumeAt) {
        options.resumeSessionAt = this.resumeAt;
        options.forkSession = true;
      }
    }
    this.resumeAt = null;

    const q = this.queryFn({ prompt: input, options });
    this.q = q;
    void this.pump(q);
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const msg of q) {
        if (this.q !== q) break; // superseded by a rewind/restart
        await this.handle(msg, q);
      }
    } catch (e) {
      if (this.q === q) this.port.emit({ type: 'error', message: friendlyError((e as Error).message) });
    } finally {
      if (this.q === q) {
        this.q = null;
        this.input = null;
        if (this.busy) {
          this.busy = false;
          this.port.emit({ type: 'error', message: 'Claude Code stopped unexpectedly. Send again to restart it.' });
        }
      }
    }
  }

  private async handle(msg: SDKMessage, q: Query): Promise<void> {
    for (const ev of translate(msg, this.st)) {
      if (ev.type === 'session') this.sessionId = ev.sessionId;

      if (ev.type === 'tool') {
        let done: Sector[] | null = null;
        if (ev.name === 'TodoWrite') done = this.board.applyTodoWrite(ev.input);
        else if (ev.name === 'TaskUpdate') done = this.board.applyTaskUpdate(ev.input);
        if (done) this.emitSectors(done);
      }

      if (ev.type === 'result') {
        this.busy = false;
        this.port.emit(ev);
        if (ev.summary.isError && ev.summary.errors.length) {
          this.port.emit({ type: 'error', message: friendlyError(ev.summary.errors.join('\n')) });
        }
        try {
          const ctx = await q.getContextUsage();
          this.port.emit({ type: 'context', percentage: ctx.percentage, totalTokens: ctx.totalTokens, maxTokens: ctx.maxTokens });
        } catch { /* older engines: no context gauge */ }
        continue;
      }

      this.port.emit(ev);
    }
  }

  private emitSectors(done: Sector[]): void {
    this.port.emit({ type: 'sectors', sectors: this.board.list() });
    for (const sector of done) this.port.emit({ type: 'sector-done', sector });
  }

  private abs(p: string): string {
    return path.isAbsolute(p) ? p : path.join(this.env.projectPath, p);
  }

  // ─── decisions Claude Code hands to the pilot ───────────────────────────────

  private canUseTool: CanUseTool = async (toolName, input, { signal, suggestions, decisionReason }) => {
    if (toolName === 'AskUserQuestion') return this.answerQuestions(input, signal);
    if (toolName === 'ExitPlanMode') return this.approvePlan(input, signal);

    if (isWriteTool(toolName)) {
      const abs = this.abs(filePathOf(input));
      let current: string | null = null;
      try { current = fs.readFileSync(abs, 'utf-8'); } catch { current = null; }
      const content = proposedContent(toolName, input, current);
      if (content !== null) {
        const d = await this.port.askWrite({ id: nextId(), path: displayPath(abs, this.env.projectPath), content }, signal);
        if (d.accepted) return { behavior: 'allow', updatedInput: input };
        return {
          behavior: 'deny',
          message: d.feedback
            ? `The pilot rejected this change: ${d.feedback}`
            : 'The pilot rejected this change. Revise it, or ask what they want instead.',
        };
      }
    }

    // Everything else: a three-way card. A = allow, B = deny, X = allow for the rest of the session
    // (only when Claude Code offered a scoped rule — never a blanket allow for a whole tool).
    const options: ChoiceOption[] = [
      { label: 'Allow', value: 'allow' },
      { label: 'Deny', value: 'deny' },
    ];
    if (suggestions?.length) options.push({ label: 'Always allow this session', value: 'always' });
    const description = typeof input.description === 'string' ? input.description : '';
    const pick = await this.port.askChoice({
      id: nextId(),
      question: description || `Claude wants to use ${toolName}`,
      detail: [toolLabel(toolName, input, this.env.projectPath), decisionReason].filter(Boolean).join('\n'),
      options,
    }, signal);
    if (pick === 'allow') return { behavior: 'allow', updatedInput: input };
    if (pick === 'always') return { behavior: 'allow', updatedInput: input, updatedPermissions: suggestions };
    return { behavior: 'deny', message: 'The pilot denied this. Find another way or ask why.' };
  };

  private async answerQuestions(input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    const questions = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : [];
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const text = String(q.question ?? '');
      const opts = (Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : [])
        .slice(0, 4)
        .map((o) => ({ label: String(o.label ?? ''), value: String(o.label ?? ''), description: String(o.description ?? '') }))
        .filter((o) => o.label);
      if (!text || opts.length === 0) continue;
      answers[text] = await this.port.askChoice({ id: nextId(), question: text, detail: q.header ? String(q.header) : undefined, options: opts }, signal);
    }
    return { behavior: 'allow', updatedInput: { ...input, answers } };
  }

  // Leaving plan mode is "lights out": the pilot picks how hard to push the implementation.
  private async approvePlan(input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    const plan = String(input.plan ?? '').trim();
    const pick = await this.port.askChoice({
      id: nextId(),
      question: 'Formation lap done. Lights out?',
      detail: plan.length > 1800 ? `${plan.slice(0, 1800)}…` : plan,
      options: [
        { label: `Go · ${DRIVE_MODE_LABELS.acceptEdits} (edits land on their own)`, value: 'acceptEdits' },
        { label: `Go · ${DRIVE_MODE_LABELS.default} (approve each edit)`, value: 'default' },
        { label: 'Keep planning', value: 'no' },
      ],
    }, signal);
    if (pick === 'no') {
      return { behavior: 'deny', message: 'The pilot wants to keep planning. Ask what to change.' };
    }
    const mode = pick as DriveMode;
    this.settings = { ...this.settings, mode };
    this.port.emit({ type: 'mode', mode });
    return {
      behavior: 'allow',
      updatedInput: input,
      updatedPermissions: [{ type: 'setMode', mode, destination: 'session' }],
    };
  }

  private preToolUse: HookCallback = async (raw, toolUseId, { signal }) => {
    const input = raw as { tool_name?: string; tool_input?: unknown; tool_use_id?: string };
    const name = input.tool_name ?? '';
    const toolInput = (input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {}) as Record<string, unknown>;

    if (this.settings.teachMode && name !== 'AskUserQuestion' && name !== 'ExitPlanMode' && !isQuietTool(name)) {
      const d = await this.port.askTeach({
        id: nextId(),
        tool: toolLabel(name, toolInput, this.env.projectPath),
        input: toolInput,
        why: firstSentence(this.st.narration),
        timeout: this.settings.teachTimeout,
      }, signal);
      if (d.action === 'redirect') {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `The pilot redirected instead of running ${name}: ${d.instruction || 'reconsider your approach'}`,
          },
        };
      }
    }

    const id = input.tool_use_id ?? toolUseId;
    if (isWriteTool(name) && id) {
      const abs = this.abs(filePathOf(toolInput));
      let previous: string | null = null;
      try { previous = fs.readFileSync(abs, 'utf-8'); } catch { previous = null; }
      this.snapshots.set(id, { absPath: abs, relPath: displayPath(abs, this.env.projectPath), previous });
    }
    return {};
  };

  private postToolUse: HookCallback = async (raw, toolUseId) => {
    const input = raw as { tool_name?: string; tool_use_id?: string };
    const id = input.tool_use_id ?? toolUseId;
    const snap = id ? this.snapshots.get(id) : undefined;
    if (id && snap) {
      this.snapshots.delete(id);
      this.port.recordWrite(snap);
      this.port.emit({ type: 'file-written', path: snap.relPath });
    }
    return {};
  };

  private taskHook: HookCallback = async (raw) => {
    const input = raw as { hook_event_name?: string; task_id?: string; task_subject?: string };
    if (input.hook_event_name === 'TaskCreated' && input.task_id) {
      this.board.taskCreated(input.task_id, input.task_subject ?? '');
      this.emitSectors([]);
    } else if (input.hook_event_name === 'TaskCompleted' && input.task_id) {
      this.emitSectors(this.board.taskCompleted(input.task_id));
    }
    return {};
  };
}

// Turn the engine's raw failures into something a pilot can act on from the couch.
export function friendlyError(raw: string): string {
  if (/invalid x-api-key|authentication_error|401/i.test(raw)) {
    return 'Claude rejected the API key. Re-pair or paste a new key in Settings (⚙).';
  }
  if (/not logged in|please run \/login|no api key|ANTHROPIC_API_KEY/i.test(raw)) {
    return 'Claude Code is not signed in. Pair an API key in Settings (⚙).';
  }
  if (/ENOENT|spawn .*claude|native cli binary|not found/i.test(raw)) {
    return 'Claude Code engine not found. Install it from Settings (⚙) → Engine.';
  }
  if (/credit balance|billing/i.test(raw)) {
    return 'The Anthropic account is out of credit. Top it up in the Console, then send again.';
  }
  if (/overloaded|529/i.test(raw)) return 'Claude is overloaded right now. Give it a moment and send again.';
  return raw;
}
