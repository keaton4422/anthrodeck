import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { resolveEngineSettings } from '../engine/config';
import { EngineSession, friendlyError, type CockpitPort, type EngineEvent, type QueryFn } from '../engine/session';

// A scripted stand-in for Claude Code: for every user turn it receives, it plays back `script`.
function fakeEngine(script: (turn: string, n: number) => unknown[]) {
  const calls: Options[] = [];
  const control = { setPermissionMode: vi.fn(), setModel: vi.fn(), interrupt: vi.fn(), close: vi.fn() };
  const queryFn: QueryFn = ({ prompt, options }) => {
    calls.push(options);
    let n = 0;
    async function* run(): AsyncGenerator<SDKMessage, void> {
      for await (const m of prompt as AsyncIterable<SDKUserMessage>) {
        for (const out of script(String(m.message.content), n++)) yield out as SDKMessage;
      }
    }
    const gen = run();
    return Object.assign(gen, {
      ...control,
      getContextUsage: async () => ({ percentage: 12, totalTokens: 24000, maxTokens: 200000 }),
    }) as unknown as Query;
  };
  return { queryFn, calls, control };
}

function fakePort(overrides: Partial<CockpitPort> = {}) {
  const events: EngineEvent[] = [];
  const port: CockpitPort = {
    emit: (e) => events.push(e),
    askWrite: async () => ({ accepted: true }),
    askChoice: async (req) => req.options[0].value,
    askTeach: async () => ({ action: 'continue' }),
    recordWrite: vi.fn(),
    log: () => {},
    ...overrides,
  };
  return { port, events };
}

const result = (extra: Record<string, unknown> = {}) => ({
  type: 'result', subtype: 'success', is_error: false, duration_ms: 5, total_cost_usd: 0.01,
  result: 'done', usage: {}, modelUsage: {}, ...extra,
});

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(pred: () => boolean) {
  for (let i = 0; i < 50 && !pred(); i++) await tick();
}

const signal = new AbortController().signal;

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthrodeck-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function session(port: CockpitPort, queryFn: QueryFn, settings = {}) {
  return new EngineSession(
    { projectPath: dir, executable: '/bin/claude', apiKey: 'sk-test' },
    resolveEngineSettings(settings),
    port,
    queryFn,
  );
}

describe('EngineSession', () => {
  it('runs one long-lived Claude Code session with the pilot setup and cockpit prompt', async () => {
    const eng = fakeEngine(() => [
      { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'sonnet', cwd: dir },
      result(),
    ]);
    const { port, events } = fakePort();
    const s = session(port, eng.queryFn);

    s.send('first');
    await until(() => events.some((e) => e.type === 'context'));
    s.send('second');
    await until(() => events.filter((e) => e.type === 'result').length === 2);

    expect(eng.calls).toHaveLength(1);
    const o = eng.calls[0];
    expect(o.cwd).toBe(dir);
    expect(o.settingSources).toEqual(['user', 'project', 'local']);
    expect(o.permissionMode).toBe('default');
    expect(o.pathToClaudeCodeExecutable).toBe('/bin/claude');
    expect(o.env?.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(o.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
    expect(s.currentSessionId).toBe('sess-1');
    expect(s.isBusy).toBe(false);
    expect(events).toContainEqual({ type: 'context', percentage: 12, totalTokens: 24000, maxTokens: 200000 });
  });

  it('lets Claude Code use its own login when no API key is paired', () => {
    const eng = fakeEngine(() => []);
    const s = new EngineSession({ projectPath: dir, executable: '/bin/claude', apiKey: '' }, resolveEngineSettings({}), fakePort().port, eng.queryFn);
    s.send('hi');
    expect(eng.calls[0].env).not.toHaveProperty('ANTHROPIC_API_KEY', '');
  });

  it('shows the full resulting file for an Edit and passes rejection feedback back to Claude', async () => {
    fs.writeFileSync(path.join(dir, 'a.ts'), 'const x = 1;\n');
    const askWrite = vi.fn(async () => ({ accepted: false, feedback: 'use 2' }));
    const eng = fakeEngine(() => []);
    const s = session(fakePort({ askWrite }).port, eng.queryFn);
    s.send('go');
    const r = await eng.calls[0].canUseTool!('Edit', {
      file_path: path.join(dir, 'a.ts'), old_string: '1', new_string: '3',
    }, { signal, toolUseID: 't' } as never);
    expect(askWrite).toHaveBeenCalledWith(expect.objectContaining({ path: 'a.ts', content: 'const x = 3;\n' }), signal);
    expect(r).toEqual({ behavior: 'deny', message: 'The pilot rejected this change: use 2' });
  });

  it('only offers "always allow" when Claude Code proposed a scoped rule', async () => {
    const askChoice = vi.fn(async (_req: { question: string; options: { value: string }[] }) => 'always');
    const eng = fakeEngine(() => []);
    const s = session(fakePort({ askChoice }).port, eng.queryFn);
    s.send('go');
    const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'session' }];
    const r = await eng.calls[0].canUseTool!('Bash', { command: 'npm test', description: 'Run tests' }, { signal, suggestions } as never);
    expect(askChoice.mock.calls[0][0]).toMatchObject({
      question: 'Run tests',
      options: [{ value: 'allow' }, { value: 'deny' }, { value: 'always' }],
    });
    expect(r).toEqual({ behavior: 'allow', updatedInput: { command: 'npm test', description: 'Run tests' }, updatedPermissions: suggestions });

    await eng.calls[0].canUseTool!('Bash', { command: 'rm -rf build' }, { signal } as never);
    expect(askChoice.mock.calls[1]![0].options.map((o) => o.value)).toEqual(['allow', 'deny']);
  });

  it('answers AskUserQuestion with the labels the pilot picked', async () => {
    const askChoice = vi.fn(async (req: { options: { value: string }[] }) => req.options[1].value);
    const eng = fakeEngine(() => []);
    const s = session(fakePort({ askChoice }).port, eng.queryFn);
    s.send('go');
    const questions = [{ question: 'Which DB?', header: 'DB', multiSelect: false, options: [
      { label: 'Postgres', description: 'relational' }, { label: 'SQLite', description: 'file' },
    ] }];
    const r = await eng.calls[0].canUseTool!('AskUserQuestion', { questions }, { signal } as never);
    expect(r).toEqual({ behavior: 'allow', updatedInput: { questions, answers: { 'Which DB?': 'SQLite' } } });
  });

  it('turns plan approval into lights-out and switches drive mode', async () => {
    const eng = fakeEngine(() => []);
    const { port, events } = fakePort();
    const s = session(port, eng.queryFn, { mode: 'plan' });
    s.send('go');
    const r = await eng.calls[0].canUseTool!('ExitPlanMode', { plan: '1. do it' }, { signal } as never);
    expect(r).toMatchObject({ behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] });
    expect(events).toContainEqual({ type: 'mode', mode: 'acceptEdits' });
  });

  it('commits undo snapshots only for writes that actually ran', async () => {
    const file = path.join(dir, 'b.txt');
    fs.writeFileSync(file, 'before');
    const recordWrite = vi.fn();
    const eng = fakeEngine(() => []);
    const { port, events } = fakePort({ recordWrite });
    const s = session(port, eng.queryFn);
    s.send('go');
    const hooks = eng.calls[0].hooks!;
    const pre = hooks.PreToolUse![0].hooks[0];
    const post = hooks.PostToolUse![0].hooks[0];
    const opts = { signal } as never;

    await pre({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: file }, tool_use_id: 'w1' } as never, 'w1', opts);
    await pre({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: file }, tool_use_id: 'w2' } as never, 'w2', opts);
    await post({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: 'w1' } as never, 'w1', opts);

    expect(recordWrite).toHaveBeenCalledTimes(1);
    expect(recordWrite).toHaveBeenCalledWith({ absPath: file, relPath: 'b.txt', previous: 'before' });
    expect(events).toContainEqual({ type: 'file-written', path: 'b.txt' });
  });

  it('runs a remote project\'s Claude Code over SSH, previews from that machine, and keeps its writes out of undo', async () => {
    const recordWrite = vi.fn();
    const askWrite = vi.fn(async () => ({ accepted: true }));
    const eng = fakeEngine(() => []);
    const { port, events } = fakePort({ recordWrite, askWrite });
    const remoteFile = '/Users/me/app/main.ts';
    const readText = vi.fn(async (p: string) => (p === remoteFile ? 'let a = 1;\n' : null));
    const s = new EngineSession(
      { projectPath: '/Users/me/app', executable: '/bin/claude', apiKey: '', remote: { host: 'me@mac', claudePath: '/Users/me/.local/bin/claude' }, readText },
      resolveEngineSettings({}), port, eng.queryFn,
    );
    s.send('go');
    const o = eng.calls[0];
    expect(o.pathToClaudeCodeExecutable).toBe('/Users/me/.local/bin/claude');
    expect(typeof o.spawnClaudeCodeProcess).toBe('function');
    expect(o.cwd).toBe('/Users/me/app');

    await o.canUseTool!('Edit', { file_path: remoteFile, old_string: '1', new_string: '2' }, { signal, toolUseID: 'e' } as never);
    expect(readText).toHaveBeenCalledWith(remoteFile);
    expect(askWrite).toHaveBeenCalledWith(expect.objectContaining({ path: 'main.ts', content: 'let a = 2;\n' }), signal);

    const pre = o.hooks!.PreToolUse![0].hooks[0];
    const post = o.hooks!.PostToolUse![0].hooks[0];
    await pre({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: remoteFile }, tool_use_id: 'r1' } as never, 'r1', { signal } as never);
    await post({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'r1' } as never, 'r1', { signal } as never);
    expect(recordWrite).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'file-written', path: 'main.ts' });
  });

  it('teach mode pauses before tools and a redirect denies with the instruction', async () => {
    const askTeach = vi.fn(async () => ({ action: 'redirect' as const, instruction: 'check the docs first' }));
    const eng = fakeEngine(() => []);
    const s = session(fakePort({ askTeach }).port, eng.queryFn, { teachMode: true });
    s.send('go');
    const pre = eng.calls[0].hooks!.PreToolUse![0].hooks[0];
    const out = await pre({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'x' } as never, 'x', { signal } as never);
    expect(askTeach).toHaveBeenCalledWith(expect.objectContaining({ tool: '$ ls' }), signal);
    expect(out).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });

    const quiet = await pre({ hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_input: {}, tool_use_id: 'y' } as never, 'y', { signal } as never);
    expect(quiet).toEqual({});
    expect(askTeach).toHaveBeenCalledTimes(1);
  });

  it('turns the task list into sectors and announces completions', async () => {
    const eng = fakeEngine((_t, n) => n === 0 ? [
      { type: 'assistant', uuid: 'a', parent_tool_use_id: null, message: { content: [
        { type: 'tool_use', id: 't1', name: 'TodoWrite', input: { todos: [{ content: 'Build API', status: 'in_progress' }] } },
      ] } },
      { type: 'assistant', uuid: 'b', parent_tool_use_id: null, message: { content: [
        { type: 'tool_use', id: 't2', name: 'TodoWrite', input: { todos: [{ content: 'Build API', status: 'completed' }] } },
      ] } },
      result(),
    ] : []);
    const { port, events } = fakePort();
    session(port, eng.queryFn).send('go');
    await until(() => events.some((e) => e.type === 'result'));
    expect(events.filter((e) => e.type === 'sector-done')).toEqual([
      { type: 'sector-done', sector: { id: 'todo:Build API', title: 'Build API', status: 'completed' } },
    ]);
  });

  it('picks up a session from the dashboard: the next send resumes it, not a fork', async () => {
    const eng = fakeEngine(() => [result()]);
    const { port, events } = fakePort();
    const s = session(port, eng.queryFn);
    s.resumeFrom('old-session');
    s.send('carry on');
    expect(eng.calls[0]).toMatchObject({ resume: 'old-session' });
    expect(eng.calls[0].resumeSessionAt).toBeUndefined();
    expect(eng.calls[0].forkSession).toBeUndefined();
    expect(events).toContainEqual({ type: 'sectors', sectors: [] });
  });

  it('rewinds by resuming a fork at the chosen turn', async () => {
    const eng = fakeEngine(() => [
      { type: 'system', subtype: 'init', session_id: 'sess-9', model: 'sonnet', cwd: dir },
      result(),
    ]);
    const { port, events } = fakePort();
    const s = session(port, eng.queryFn);
    s.send('one');
    await until(() => events.some((e) => e.type === 'result'));
    s.rewind('anchor-uuid');
    s.send('two');
    expect(eng.calls[1]).toMatchObject({ resume: 'sess-9', resumeSessionAt: 'anchor-uuid', forkSession: true });

    s.reset();
    s.send('three');
    expect(eng.calls[2].resume).toBeUndefined();
  });

  it('restarts and resumes when effort or thinking change, but switches mode and model live', async () => {
    const eng = fakeEngine(() => [{ type: 'system', subtype: 'init', session_id: 's1', model: 'sonnet', cwd: dir }, result()]);
    const { port, events } = fakePort();
    const s = session(port, eng.queryFn);
    s.send('one');
    await until(() => events.some((e) => e.type === 'result'));

    s.updateSettings(resolveEngineSettings({ mode: 'acceptEdits', model: 'opus' }));
    expect(eng.control.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
    expect(eng.control.setModel).toHaveBeenCalledWith('opus');

    s.updateSettings(resolveEngineSettings({ mode: 'acceptEdits', model: 'opus', effort: 'max' }));
    s.send('two');
    expect(eng.calls).toHaveLength(2);
    expect(eng.calls[1]).toMatchObject({ resume: 's1', effort: 'max', permissionMode: 'acceptEdits' });
  });
});

describe('EngineSession failures', () => {
  it('a not-logged-in turn reaches the pilot once, as an instruction, and the engine exit is quiet', async () => {
    const queryFn: QueryFn = ({ prompt }) => {
      async function* run(): AsyncGenerator<SDKMessage, void> {
        for await (const _m of prompt as AsyncIterable<SDKUserMessage>) {
          yield { type: 'assistant', uuid: 'x', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } } as unknown as SDKMessage;
          yield result({ is_error: true, result: 'Not logged in · Please run /login' }) as unknown as SDKMessage;
          throw new Error('Claude Code process exited with code 1');
        }
      }
      return Object.assign(run(), { getContextUsage: async () => { throw new Error('gone'); }, close: () => {} }) as unknown as Query;
    };
    const { port, events } = fakePort();
    session(port, queryFn).send('hi');
    await until(() => events.some((e) => e.type === 'result'));
    await tick(); await tick();
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toEqual([{ type: 'error', message: 'Claude Code isn\'t signed in on this device. Sign in once from Desktop Mode (run claude), or add an API key in Settings (⚙).' }]);
    expect(events.findIndex((e) => e.type === 'error')).toBeLessThan(events.findIndex((e) => e.type === 'result'));
  });

  it('a crash mid-lap reports once and frees the session for a retry', async () => {
    const calls: number[] = [];
    const queryFn: QueryFn = ({ prompt }) => {
      calls.push(1);
      async function* run(): AsyncGenerator<SDKMessage, void> {
        for await (const _m of prompt as AsyncIterable<SDKUserMessage>) throw new Error('spawn /x/claude ENOENT');
      }
      return Object.assign(run(), { close: () => {} }) as unknown as Query;
    };
    const { port, events } = fakePort();
    const s = session(port, queryFn);
    s.send('hi');
    await until(() => events.some((e) => e.type === 'error'));
    await tick();
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
    expect(s.isBusy).toBe(false);
    s.send('again');
    expect(calls).toHaveLength(2);
  });
});

describe('friendlyError', () => {
  it('translates engine failures into pilot instructions', () => {
    expect(friendlyError('401 invalid x-api-key')).toMatch(/API key/);
    expect(friendlyError('spawn /x/claude ENOENT')).toMatch(/Install it from Settings/);
    expect(friendlyError('Your credit balance is too low')).toMatch(/credit/);
    expect(friendlyError('something else')).toBe('something else');
  });
});
