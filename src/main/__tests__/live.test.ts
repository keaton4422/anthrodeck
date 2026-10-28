import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import {
  livePrompt, liveWhere, parseLiveLine, LiveLink, RELAY_PY, SETUP_PY, WATCH_PY,
  type LiveRequest, type LiveLinkStatus, type LiveTail,
} from '../live';

const req = (over: Partial<LiveRequest> = {}): LiveRequest => ({
  id: 'a'.repeat(32), sessionId: 's1', cwd: '/Users/me/app', toolName: 'Bash',
  toolInput: { command: 'npm test', description: 'Run the tests' }, suggestions: [], ts: 1, ...over,
});

describe('live prompts', () => {
  it('names the computer and the session the prompt came from', () => {
    expect(liveWhere('MacBook-Pro', req(), [{ sessionId: 's1', name: 'Fix login', cwd: '/x', status: 'busy', entrypoint: 'claude-desktop', updatedAt: 0 }]))
      .toBe('MacBook-Pro · Fix login');
    expect(liveWhere('MacBook-Pro', req(), [])).toBe('MacBook-Pro · app');
  });

  it('asks allow or deny for a tool, and only offers "always" when Claude Code suggested a rule', () => {
    const p = livePrompt(req(), 'Mac · app');
    expect(p.cards).toHaveLength(1);
    expect(p.cards[0]).toMatchObject({ kind: 'approval', question: 'Run the tests' });
    expect(p.cards[0].detail).toContain('$ npm test');
    expect(p.cards[0].options.map((o) => o.value)).toEqual(['allow', 'deny']);
    expect(p.decide(['allow'])).toEqual({ behavior: 'allow' });
    expect(p.decide(['deny'])).toMatchObject({ behavior: 'deny' });

    const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'session' };
    const q = livePrompt(req({ suggestions: [rule] }), 'Mac · app');
    expect(q.cards[0].options.map((o) => o.value)).toContain('always');
    expect(q.decide(['always'])).toEqual({ behavior: 'allow', updatedPermissions: [rule] });
  });

  it('answers each of Claude\'s questions and hands the answers back', () => {
    const p = livePrompt(req({
      toolName: 'AskUserQuestion',
      toolInput: { questions: [
        { question: 'Which color?', header: 'Color', options: [{ label: 'Red' }, { label: 'Blue' }], multiSelect: false },
        { question: 'Which size?', header: 'Size', options: [{ label: 'S' }, { label: 'L' }], multiSelect: false },
      ] },
    }), 'Mac · app');
    expect(p.cards.map((c) => c.question)).toEqual(['Which color?', 'Which size?']);
    const d = p.decide(['Blue', 'L']);
    expect(d.behavior).toBe('allow');
    expect((d as { updatedInput: Record<string, unknown> }).updatedInput.answers).toEqual({ 'Which color?': 'Blue', 'Which size?': 'L' });
  });

  it('starts a plan in the chosen mode, or keeps planning', () => {
    const p = livePrompt(req({ toolName: 'ExitPlanMode', toolInput: { plan: '1. do it' } }), 'Mac · app');
    expect(p.cards[0].kind).toBe('plan');
    expect(p.decide(['acceptEdits'])).toEqual({ behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] });
    expect(p.decide(['no']).behavior).toBe('deny');
  });

  it('reads the watcher\'s lines and ignores anything else', () => {
    expect(parseLiveLine('{"live":[],"requests":[],"relay":1}')).toEqual({ live: [], requests: [], relay: 1 });
    expect(parseLiveLine('{"live":[],"requests":[],"relay":null}')?.relay).toBeNull();
    expect(parseLiveLine('Warning: something')).toBeNull();
    expect(parseLiveLine('{"other":1}')).toBeNull();
  });
});

// The scripts themselves, run with this machine's python3 against temp folders.
const hasPython = process.platform !== 'win32' && (() => {
  try { execFileSync('python3', ['--version']); return true; } catch { return false; }
})();

describe.skipIf(!hasPython)('live scripts', () => {
  let dir = '';
  let env: NodeJS.ProcessEnv = {};
  const children: ChildProcess[] = [];
  const setup = () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthrodeck-live-'));
    env = { ...process.env, ANTHRODECK_RELAY_ROOT: path.join(dir, 'relay'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude') };
    fs.mkdirSync(path.join(dir, 'claude', 'sessions'), { recursive: true });
  };
  afterEach(() => {
    for (const c of children.splice(0)) c.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const py = (script: string, args: string[] = [], input?: string) =>
    execFileSync('python3', ['-c', script, ...args], { env, input, encoding: 'utf8' });

  it('installs one marked hook, keeps the pilot\'s own hooks, and removes cleanly', () => {
    setup();
    const settings = path.join(dir, 'claude', 'settings.json');
    const theirs = { theme: 'auto', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
    fs.writeFileSync(settings, JSON.stringify(theirs));

    py(SETUP_PY, ['install', RELAY_PY]);
    py(SETUP_PY, ['install', RELAY_PY]);   // twice: still one hook
    const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
    expect(s.theme).toBe('auto');
    expect(s.hooks.Stop).toEqual(theirs.hooks.Stop);
    expect(s.hooks.PermissionRequest).toHaveLength(1);
    expect(s.hooks.PermissionRequest[0].hooks[0].command).toMatch(/relay\.py' permission {2}# added by AnthroDeck$/);
    // The python3 on PATH, not the interpreter's real location (inside Xcode on a Mac).
    const onPath = execFileSync('sh', ['-c', 'command -v python3'], { env, encoding: 'utf8' }).trim();
    expect(s.hooks.PermissionRequest[0].hooks[0].command.startsWith(`'${onPath}' `)).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'relay', 'relay.py'), 'utf8')).toBe(RELAY_PY);
    expect(JSON.parse(fs.readFileSync(`${settings}.anthrodeck-backup`, 'utf8'))).toEqual(theirs);

    py(SETUP_PY, ['remove']);
    expect(JSON.parse(fs.readFileSync(settings, 'utf8'))).toEqual(theirs);
    expect(fs.existsSync(path.join(dir, 'relay', 'relay.py'))).toBe(false);
  });

  it('lets Claude Code carry on at once when the Deck isn\'t connected', () => {
    setup();
    const t0 = Date.now();
    const out = py(RELAY_PY, ['permission'], JSON.stringify({ session_id: 's1', tool_name: 'Bash', tool_input: {} }));
    expect(out).toBe('');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('stops waiting when the prompt is answered on that computer instead', async () => {
    setup();
    fs.mkdirSync(path.join(dir, 'relay'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'relay', 'online'), '');   // the Deck is connected
    const transcript = path.join(dir, 't.jsonl');
    const input = { command: 'rm -rf build' };
    fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input }] } })}\n`);

    const hook = spawn('python3', ['-c', RELAY_PY, 'permission'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(hook);
    let out = '';
    hook.stdout.on('data', (b) => { out += b; });
    hook.stdin.end(JSON.stringify({ session_id: 's1', cwd: '/x', transcript_path: transcript, tool_name: 'Bash', tool_input: input }));
    await waitFor(() => fs.existsSync(path.join(dir, 'relay', 'req')) && fs.readdirSync(path.join(dir, 'relay', 'req')).length === 1);

    // The pilot clicked Allow in the desktop app: the tool ran and its result was written.
    fs.appendFileSync(transcript, `${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] } })}\n`);
    expect(await new Promise((r) => hook.on('close', r))).toBe(0);
    expect(out).toBe('');
    expect(fs.readdirSync(path.join(dir, 'relay', 'req'))).toEqual([]);
  }, 20_000);

  it('carries a prompt from a live session to the Deck and the answer back', async () => {
    setup();
    // A live session in Claude Code's registry (this test process stands in for it).
    fs.writeFileSync(path.join(dir, 'claude', 'sessions', `${process.pid}.json`), JSON.stringify({
      pid: process.pid, sessionId: 's1', cwd: '/Users/me/app', name: 'Fix login', status: 'busy', entrypoint: 'claude-desktop', updatedAt: 5,
    }));

    const statuses: LiveLinkStatus[] = [];
    const asked: string[] = [];
    const link = new LiveLink('mac', 'MacBook-Pro', {
      spawnSsh: () => {
        const c = spawn('python3', ['-u', '-c', WATCH_PY], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        children.push(c);
        return c;
      },
      onStatus: (s) => statuses.push(s),
      ask: async (card) => { asked.push(`${card.kind}: ${card.question} [${card.detail}]`); return 'allow'; },
    });
    try {
      await waitFor(() => statuses.some((s) => s.state?.live.length));
      expect(statuses.at(-1)?.state?.live[0]).toMatchObject({ sessionId: 's1', name: 'Fix login', status: 'busy' });

      // Claude Code runs the hook for a permission prompt in that session.
      const hook = spawn('python3', ['-c', RELAY_PY, 'permission'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      children.push(hook);
      let out = '';
      hook.stdout.on('data', (b) => { out += b; });
      hook.stdin.end(JSON.stringify({
        session_id: 's1', cwd: '/Users/me/app', transcript_path: '', tool_name: 'Bash',
        tool_input: { command: 'npm test', description: 'Run the tests' },
      }));
      const code = await new Promise<number | null>((r) => hook.on('close', r));

      expect(code).toBe(0);
      expect(asked).toEqual(['approval: Run the tests [MacBook-Pro · Fix login\n$ npm test]']);
      expect(JSON.parse(out)).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
      // The request is cleaned up once answered.
      await waitFor(() => statuses.at(-1)?.state?.requests.length === 0);
    } finally {
      link.stop();
    }
  }, 20_000);

  it('follows the open session\'s conversation and delivers the pilot\'s messages to its inbox', async () => {
    setup();
    const sid = 'c0ffee00-1111-2222-3333-444455556666';
    // The session's transcript, as Claude Code writes it.
    const proj = path.join(dir, 'claude', 'projects', '-Users-me-app');
    fs.mkdirSync(proj, { recursive: true });
    const transcript = path.join(proj, `${sid}.jsonl`);
    const line = (o: object) => `${JSON.stringify(o)}\n`;
    fs.writeFileSync(transcript, [
      line({ type: 'user', uuid: 'u1', message: { content: 'Fix the login bug' } }),
      line({ type: 'user', uuid: 'u0', message: { content: '<command-name>/clear</command-name>' } }),
      line({ type: 'assistant', uuid: 'a1', message: { content: [
        { type: 'text', text: 'Looking at it.' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', other: 'x'.repeat(5000) } },
      ] } }),
      line({ type: 'assistant', uuid: 'side', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent chatter' }] } }),
    ].join(''));
    // Its inbox: a socket listed in the registry, and the key published beside its entry.
    const sock = path.join(dir, 'in.sock');
    const got: string[] = [];
    const server = net.createServer((c) => { c.setEncoding('utf8'); c.on('data', (d: string) => got.push(...d.split('\n').filter(Boolean))); });
    await new Promise<void>((r) => server.listen(sock, r));
    const reg = path.join(dir, 'claude', 'sessions');
    fs.writeFileSync(path.join(reg, `${process.pid}.json`), JSON.stringify({
      pid: process.pid, sessionId: sid, cwd: '/Users/me/app', name: 'Fix login', status: 'idle', messagingSocketPath: sock, updatedAt: 5,
    }));
    fs.writeFileSync(path.join(reg, `${process.pid}.${'ab'.repeat(32)}.key`), JSON.stringify({ peerToken: 'f'.repeat(32) }));

    const tails: LiveTail[] = [];
    const statuses: LiveLinkStatus[] = [];
    const link = new LiveLink('mac', 'MacBook-Pro', {
      spawnSsh: () => {
        const c = spawn('python3', ['-u', '-c', WATCH_PY], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        children.push(c);
        return c;
      },
      onStatus: (s) => statuses.push(s),
      onTail: (t) => tails.push(t),
      ask: async () => '',
    });
    try {
      await waitFor(() => statuses.some((s) => s.connected));
      link.watch(sid);
      await waitFor(() => tails.length > 0);
      expect(tails[0].reset).toBe(true);
      expect(tails[0].entries.map((e) => [e.role, e.text])).toEqual([
        ['user', 'Fix the login bug'],
        ['assistant', 'Looking at it.'],
        ['tool', '$ npm test'],
      ]);

      // The pilot sends a message: it reaches the inbox, authenticated, marked as from the Deck.
      const sent = await link.send(sid, 'Also add a test');
      expect(sent).toMatchObject({ ok: true, error: null });
      await waitFor(() => got.length >= 2);
      expect(JSON.parse(got[0])).toEqual({ type: 'auth', token: 'f'.repeat(32) });
      expect(JSON.parse(got[1])).toEqual({
        type: 'user', session_id: sid,
        message: { role: 'user', content: 'From the user, sent from AnthroDeck on their Steam Deck:\nAlso add a test' },
      });

      // Claude Code queues it and runs it; the Deck sees its own words, not Claude Code's wrapper.
      fs.appendFileSync(transcript, [
        line({ type: 'queue-operation', operation: 'enqueue', timestamp: 'T1', content: 'From the user, sent from AnthroDeck on their Steam Deck:\nAlso add a test' }),
        line({ type: 'user', uuid: 'u2', isMeta: true, origin: { kind: 'peer', from: 'unknown' },
          message: { content: 'Another Claude session sent a message:\nFrom the user, sent from AnthroDeck on their Steam Deck:\nAlso add a test\n\nThis came from another Claude session — not typed by your user…' } }),
        line({ type: 'user', uuid: 'u3', isMeta: true, origin: { kind: 'peer', from: 'uds:/tmp/x.sock' },
          message: { content: 'Another Claude session sent a message:\nI finished the API part.\n\nThis came from another Claude session — …' } }),
        line({ type: 'user', uuid: 'r1', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
        line({ type: 'assistant', uuid: 'a2', message: { content: [{ type: 'text', text: 'Adding one.' }] } }),
      ].join(''));
      await waitFor(() => tails.flatMap((t) => t.entries).some((e) => e.text === 'Adding one.'));
      expect(tails.slice(1).flatMap((t) => t.entries).map((e) => [e.role, e.text, e.deck ?? false])).toEqual([
        ['queued', 'Also add a test', false],
        ['user', 'Also add a test', true],
        ['peer', 'I finished the API part.', false],
        ['assistant', 'Adding one.', false],
      ]);

      // A session that has ended can't take messages.
      expect(await link.send('gone-session', 'hello')).toMatchObject({ ok: false, error: expect.stringMatching(/isn't running/) });
    } finally {
      link.stop();
      server.close();
    }
  }, 20_000);
});

async function waitFor(ok: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
