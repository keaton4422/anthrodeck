import { describe, expect, it } from 'vitest';
import {
  firstSentence,
  nextDriveMode,
  normalizeModel,
  parseConfidence,
  resolveEngineSettings,
} from '../engine/config';
import { candidatePaths, locateEngine, readClaudeSignIn, type LocateDeps } from '../engine/locate';
import { displayPath, milestoneFor, proposedContent, SectorBoard, toolLabel } from '../engine/tools';
import { mergePlanUsage, newTranslateState, planUsageFrom, translate } from '../engine/translate';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const msg = (m: unknown) => m as SDKMessage;

describe('engine config', () => {
  it('maps legacy dated model ids onto aliases and rejects junk', () => {
    expect(normalizeModel('claude-opus-4-8')).toBe('opus');
    expect(normalizeModel('claude-sonnet-5')).toBe('sonnet');
    expect(normalizeModel('haiku')).toBe('haiku');
    expect(normalizeModel('gpt-4')).toBe('sonnet');
    expect(normalizeModel(undefined)).toBe('sonnet');
  });

  it('resolves settings with safe defaults and never offers bypass modes', () => {
    expect(resolveEngineSettings(null)).toEqual({
      model: 'sonnet', effort: 'high', thinking: false, mode: 'default', teachMode: false, teachTimeout: 5,
    });
    expect(resolveEngineSettings({ mode: 'bypassPermissions' }).mode).toBe('default');
    expect(resolveEngineSettings({ mode: 'auto' }).mode).toBe('default');
    expect(resolveEngineSettings({ effort: 'ludicrous', teachTimeout: -1 })).toMatchObject({ effort: 'high', teachTimeout: 5 });
  });

  it('cycles drive modes plan → race → push → plan', () => {
    expect(nextDriveMode('plan')).toBe('default');
    expect(nextDriveMode('default')).toBe('acceptEdits');
    expect(nextDriveMode('acceptEdits')).toBe('plan');
  });

  it('parses the trailing confidence tag', () => {
    expect(parseConfidence('Done.\n<confidence>high</confidence>')).toEqual({ confidence: 'high', cleaned: 'Done.' });
    expect(parseConfidence('ok <confidence>medium</confidence>').confidence).toBe('med');
    expect(parseConfidence('no tag').confidence).toBeNull();
  });

  it('takes the first sentence for teach-mode narration', () => {
    expect(firstSentence('I will read the file. Then edit it.')).toBe('I will read the file.');
    expect(firstSentence('')).toBe('');
    expect(firstSentence('x'.repeat(300), 20)).toHaveLength(20);
  });
});

describe('engine locate', () => {
  const deps = (present: string[], over: Partial<LocateDeps> = {}): LocateDeps => ({
    home: '/home/deck', envPath: '/usr/bin:/bin', platform: 'linux', arch: 'x64',
    exists: (p) => present.includes(p), devRoot: null, ...over,
  });

  it('prefers an explicit override, then the official installer location', () => {
    expect(locateEngine('/opt/claude', deps(['/opt/claude', '/home/deck/.local/bin/claude']))?.source).toBe('override');
    expect(locateEngine(null, deps(['/home/deck/.local/bin/claude', '/usr/bin/claude']))).toEqual({
      path: '/home/deck/.local/bin/claude', source: 'installer',
    });
  });

  it('falls back to PATH, then the SDK platform package in dev', () => {
    expect(locateEngine(null, deps(['/usr/bin/claude']))?.source).toBe('path');
    const dev = '/src/anthrodeck/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude';
    expect(locateEngine(null, deps([dev], { devRoot: '/src/anthrodeck' }))?.source).toBe('bundled');
    expect(locateEngine(null, deps([]))).toBeNull();
  });

  it('uses Windows path rules on Windows, whatever the host', () => {
    const win = deps(['C:\\tools\\claude.exe'], { platform: 'win32', home: 'C:\\Users\\deck', envPath: 'D:\\x;C:\\tools' });
    expect(locateEngine(null, win)).toEqual({ path: 'C:\\tools\\claude.exe', source: 'path' });
    expect(candidatePaths(null, win)[0].path).toBe('C:\\Users\\deck\\.local\\bin\\claude.exe');
  });

  it('never looks for the bundled binary in a packaged build', () => {
    expect(candidatePaths(null, deps([])).some((c) => c.source === 'bundled')).toBe(false);
  });
});

describe('engine tools', () => {
  const root = '/proj';

  it('labels calls with project-relative paths', () => {
    expect(toolLabel('Read', { file_path: '/proj/src/App.tsx' }, root)).toBe('read: src/App.tsx');
    expect(toolLabel('Edit', { file_path: '/proj/a.ts' }, root)).toBe('edit: a.ts');
    expect(toolLabel('Bash', { command: 'npm test\nmore' }, root)).toBe('$ npm test');
    expect(toolLabel('mcp__github__create_issue', {}, root)).toBe('tool: github · create_issue');
    expect(displayPath('/elsewhere/x', root)).toBe('/elsewhere/x');
  });

  it('computes the file a write or edit will leave behind', () => {
    expect(proposedContent('Write', { content: 'new' }, null)).toBe('new');
    expect(proposedContent('Edit', { old_string: 'a', new_string: 'b' }, 'a a')).toBe('b a');
    expect(proposedContent('Edit', { old_string: 'a', new_string: 'b', replace_all: true }, 'a a')).toBe('b b');
    expect(proposedContent('Edit', { old_string: '$&', new_string: 'x' }, 'keep $& literal')).toBe('keep x literal');
    expect(proposedContent('Edit', { old_string: 'zzz', new_string: 'b' }, 'a')).toBeNull();
    expect(proposedContent('Edit', { old_string: 'a', new_string: 'b' }, null)).toBeNull();
    expect(proposedContent('MultiEdit', {
      edits: [{ old_string: 'one', new_string: 'two' }, { old_string: 'two', new_string: 'three' }],
    }, 'one')).toBe('three');
  });

  it('recognises real-world milestones in shell runs', () => {
    expect(milestoneFor('npm test', true)).toBe('tests-pass');
    expect(milestoneFor('npx vitest run src', false)).toBe('tests-fail');
    expect(milestoneFor('cargo test', true)).toBe('tests-pass');
    expect(milestoneFor('npm run build', true)).toBe('build-pass');
    expect(milestoneFor('npx tsc --noEmit', false)).toBe('build-fail');
    expect(milestoneFor('git add -A && git commit -m "x"', true)).toBe('commit');
    expect(milestoneFor('git commit -m x && git push', true)).toBe('push');
    expect(milestoneFor('git commit -m x', false)).toBeNull();
    expect(milestoneFor('ls -la', true)).toBeNull();
  });

  it('never scores a piped run on its exit status: the pipe hides the failure', () => {
    // Caught in the live end-to-end run: `npm test | tail` exits 0 with two failing tests.
    const nodeFail = '# tests 2\n# pass 0\n# fail 2\n';
    expect(milestoneFor('npm test 2>&1 | tail -12', true, nodeFail)).toBe('tests-fail');
    expect(milestoneFor('npm test 2>&1 | tail -12', true, '# tests 2\n# pass 2\n# fail 0\n')).toBe('tests-pass');
    expect(milestoneFor('npx vitest run | tail -3', true, ' Tests  3 failed | 199 passed (202)')).toBe('tests-fail');
    expect(milestoneFor('npx vitest run | tail -3', true, ' Tests  202 passed (202)')).toBe('tests-pass');
    expect(milestoneFor('npm test || true', true, 'npm ERR! Test failed.')).toBe('tests-fail');
    // Output that says nothing either way scores nothing.
    expect(milestoneFor('npm test | grep foo', true, 'foo')).toBeNull();
    expect(milestoneFor('npm run build 2>&1 | tail', true, 'done')).toBeNull();
    expect(milestoneFor('npx tsc --noEmit | head', true, "a.ts(1,1): error TS2322: nope")).toBe('build-fail');
  });

  it('reads masked git runs from their output too', () => {
    expect(milestoneFor('git commit -m x 2>&1 | tail -2', true, '[main 1a2b3c4] x\n 1 file changed')).toBe('commit');
    expect(milestoneFor('git commit -m x 2>&1 | tail -2', true, 'nothing to commit, working tree clean')).toBeNull();
    expect(milestoneFor('git push 2>&1 | tail -2', true, '   1a2b..3c4d  main -> main')).toBe('push');
    expect(milestoneFor('git push 2>&1 | tail -2', true, ' ! [rejected]  main -> main (fetch first)')).toBeNull();
    // `&&` keeps exit status meaningful.
    expect(milestoneFor('npm test && git commit -m x', true, '')).toBe('commit');
  });

  it('tracks TodoWrite laps and reports newly completed sectors once', () => {
    const b = new SectorBoard();
    b.applyTodoWrite({ todos: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] });
    const done = b.applyTodoWrite({ todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] });
    expect(done.map((s) => s.title)).toEqual(['A']);
    expect(b.applyTodoWrite({ todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] })).toEqual([]);
  });

  it('tracks TaskCreate/TaskUpdate laps by id', () => {
    const b = new SectorBoard();
    b.taskCreated('1', 'Wire the API');
    b.taskCreated('1', 'dup ignored');
    b.taskCreated('2', 'Add tests');
    b.applyTaskUpdate({ taskId: '1', status: 'in_progress' });
    expect(b.taskCompleted('1').map((s) => s.title)).toEqual(['Wire the API']);
    b.applyTaskUpdate({ taskId: '2', status: 'deleted' });
    expect(b.list()).toEqual([{ id: 'task:1', title: 'Wire the API', status: 'completed' }]);
  });
});

describe('engine translate', () => {
  it('streams main-loop text and thinking, ignoring subagent chatter', () => {
    const st = newTranslateState('/proj');
    const delta = (text: string, parent: string | null = null) => msg({
      type: 'stream_event', parent_tool_use_id: parent,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    });
    expect(translate(delta('Hi'), st)).toEqual([{ type: 'delta', text: 'Hi' }]);
    expect(translate(delta('sub', 'toolu_1'), st)).toEqual([]);
    expect(translate(msg({
      type: 'stream_event', parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
    }), st)).toEqual([{ type: 'thinking', text: 'hmm' }]);
    expect(st.narration).toBe('Hi');
  });

  it('pairs tool calls with results and raises milestones from Bash', () => {
    const st = newTranslateState('/proj');
    const call = translate(msg({
      type: 'assistant', uuid: 'u1', parent_tool_use_id: null, session_id: 's',
      message: { content: [
        { type: 'text', text: 'Running tests.' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
      ] },
    }), st);
    expect(call).toEqual([expect.objectContaining({ type: 'tool', id: 't1', name: 'Bash', label: '$ npm test', quiet: false })]);
    const res = translate(msg({
      type: 'user', parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] },
    }), st);
    expect(res).toEqual([
      { type: 'tool-result', id: 't1', name: 'Bash', ok: true },
      { type: 'milestone', kind: 'tests-pass', command: 'npm test' },
    ]);
  });

  it('summarises a turn with session totals, confidence and a rewind anchor', () => {
    const st = newTranslateState('/proj');
    translate(msg({
      type: 'assistant', uuid: 'anchor-1', parent_tool_use_id: null, session_id: 's',
      message: { content: [{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: '/proj/a' } }] },
    }), st);
    const [ev] = translate(msg({
      type: 'result', subtype: 'success', is_error: false, duration_ms: 1200, total_cost_usd: 0.42,
      result: 'Fixed it.\n<confidence>low</confidence>',
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {
        sonnet: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 10, cacheCreationInputTokens: 5, costUSD: 0.4 },
        haiku: { inputTokens: 20, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.02 },
      },
    }), st);
    expect(ev).toEqual({
      type: 'result',
      summary: {
        inputTokens: 120, outputTokens: 55, cacheReadTokens: 10, cacheCreationTokens: 5, thinkingTokens: 0,
        costUsd: 0.42, durationMs: 1200, toolCalls: 1, confidence: 'low', anchor: 'anchor-1', isError: false, errors: [],
      },
    });
    expect(st.toolCalls).toBe(0);
  });

  it('surfaces session start, compaction and retries', () => {
    const st = newTranslateState('/proj');
    expect(translate(msg({ type: 'system', subtype: 'init', session_id: 'abc', model: 'sonnet', cwd: '/proj' }), st))
      .toEqual([{ type: 'session', sessionId: 'abc', model: 'sonnet', cwd: '/proj' }]);
    expect(translate(msg({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 9000, post_tokens: 2000 } }), st))
      .toEqual([{ type: 'compacted', preTokens: 9000, postTokens: 2000 }]);
    expect(translate(msg({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 4, retry_delay_ms: 500 }), st))
      .toEqual([{ type: 'retry', attempt: 1, maxRetries: 4, delayMs: 500 }]);
  });
});

describe('plan usage', () => {
  it('reads the 5-hour and weekly windows Claude Code reports with each turn', () => {
    const info = {
      status: 'allowed', resetsAt: 1793170200, rateLimitType: 'five_hour',
      unifiedWindows: {
        five_hour: { utilization: 0.13, resetsAt: 1793170200, status: 'allowed' },
        seven_day: { utilization: 0.29, resetsAt: 1793530800, status: 'allowed' },
      },
    };
    expect(planUsageFrom(info, 5)).toEqual({
      fiveHour: { used: 0.13, resetsAt: 1793170200000 },
      week: { used: 0.29, resetsAt: 1793530800000 },
      limited: false,
      at: 5,
    });
    const msg = { type: 'rate_limit_event', rate_limit_info: info, uuid: 'u', session_id: 's' } as unknown as SDKMessage;
    expect(translate(msg, newTranslateState('/p'))[0]).toMatchObject({ type: 'plan-usage', usage: { fiveHour: { used: 0.13 } } });
  });

  it('notices a hit limit, and ignores reports without usage figures', () => {
    expect(planUsageFrom({ status: 'rejected', unifiedWindows: { five_hour: { utilization: 1.2 } } })).toMatchObject({
      fiveHour: { used: 1, resetsAt: null }, week: null, limited: true,
    });
    expect(planUsageFrom({ status: 'allowed', resetsAt: 1 })).toBeNull();
    expect(planUsageFrom(null)).toBeNull();
  });

  it('reads the documented single-window report, and keeps the other window from the last one', () => {
    const week = planUsageFrom({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.81, resetsAt: 100 }, 7);
    expect(week).toEqual({ fiveHour: null, week: { used: 0.81, resetsAt: 100_000 }, limited: false, at: 7 });
    const five = planUsageFrom({ status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: 50 }, 9)!;
    expect(mergePlanUsage(week, five)).toEqual({
      fiveHour: { used: 1, resetsAt: 50_000 }, week: { used: 0.81, resetsAt: 100_000 }, limited: true, at: 9,
    });
    expect(planUsageFrom({ status: 'allowed', rateLimitType: 'overage', utilization: 0.5 })).toBeNull();
  });
});

describe('readClaudeSignIn', () => {
  it('reads the signed-in account Claude Code records', () => {
    const json = JSON.stringify({ oauthAccount: { emailAddress: 'pilot@example.com', organizationName: 'Pilot Co' }, other: 1 });
    expect(readClaudeSignIn(json)).toEqual({ signedIn: true, email: 'pilot@example.com', org: 'Pilot Co' });
  });

  it('is signed out without an account, a file, or valid JSON', () => {
    expect(readClaudeSignIn(JSON.stringify({ numStartups: 3 })).signedIn).toBe(false);
    expect(readClaudeSignIn(null).signedIn).toBe(false);
    expect(readClaudeSignIn('{not json').signedIn).toBe(false);
  });
});
