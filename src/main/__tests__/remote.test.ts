import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { defaultLabel, shq, sshArgs, forwardedEnv, remoteClaudeCommand, sshProblem } from '../remote';

describe('remote builders', () => {
  it('labels a host by its machine name', () => {
    expect(defaultLabel('Admin@MacBook-Pro.local')).toBe('MacBook-Pro');
    expect(defaultLabel('studio')).toBe('studio');
    expect(defaultLabel('me@192.168.1.232')).toBe('192.168.1.232');
  });

  it('quotes for a POSIX shell, including single quotes', () => {
    expect(execFileSync('sh', ['-c', `printf %s ${shq("it's a \"test\" $HOME")}`]).toString()).toBe(`it's a "test" $HOME`);
  });

  it('connects non-interactively, so a missing key fails fast instead of prompting', () => {
    const a = sshArgs('me@mac', 'echo hi');
    expect(a).toContain('BatchMode=yes');
    expect(a.slice(-2)).toEqual(['me@mac', 'echo hi']);
  });

  it('forwards only Claude Code and SDK variables, never the Deck\'s PATH or HOME', () => {
    expect(forwardedEnv({
      PATH: '/usr/bin', HOME: '/home/deck', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', ANTHROPIC_API_KEY: 'k', MCP_TIMEOUT: '5', X: undefined,
    })).toEqual({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', ANTHROPIC_API_KEY: 'k', MCP_TIMEOUT: '5' });
  });

  it('starts Claude Code in the project folder with the SDK\'s arguments, safely quoted', () => {
    const cmd = remoteClaudeCommand('/Users/me/Library/Application Support/Claude/claude', "/Users/me/it's", ['--output-format', 'stream-json'], { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' });
    expect(cmd).toBe(`cd '/Users/me/it'\\''s' && exec env CLAUDE_CODE_ENTRYPOINT='sdk-ts' '/Users/me/Library/Application Support/Claude/claude' '--output-format' 'stream-json'`);
    // And a shell parses it back to the same words.
    const echo = execFileSync('sh', ['-c', `set -- ${['--output-format', 'stream-json'].map(shq).join(' ')}; printf '%s|' "$@"`]).toString();
    expect(echo).toBe('--output-format|stream-json|');
  });

  it('explains SSH failures in plain language', () => {
    expect(sshProblem('ssh: connect to host mac port 22: Connection refused')).toMatch(/Remote Login/);
    expect(sshProblem('me@mac: Permission denied (publickey).')).toMatch(/key/);
    expect(sshProblem('ssh: Could not resolve hostname macx: nodename nor servname')).toMatch(/find that computer/);
    expect(sshProblem('Traceback (most recent call last)')).toBeNull();
  });
});
