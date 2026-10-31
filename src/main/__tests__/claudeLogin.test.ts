import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loginUrl, runLogin } from '../claudeLogin';

describe('Claude Code\'s sign-in, run from AnthroDeck', () => {
  it('takes only Claude\'s own sign-in pages', () => {
    expect(loginUrl('https://claude.com/cai/oauth/authorize?client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A41457%2Fcallback\n'))
      .toBe('https://claude.com/cai/oauth/authorize?client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A41457%2Fcallback');
    expect(loginUrl('https://platform.claude.com/oauth/authorize')).not.toBeNull();
    expect(loginUrl('http://claude.com/cai/oauth/authorize')).toBeNull();
    expect(loginUrl('https://claude.com.example.net/oauth')).toBeNull();
    expect(loginUrl('file:///etc/passwd')).toBeNull();
    expect(loginUrl('')).toBeNull();
  });

  // A stand-in for Claude Code: opens its sign-in address through $BROWSER, then exits.
  it.skipIf(process.platform === 'win32')('hands over the address Claude Code opens, then says it is done', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, '#!/bin/sh\n[ "$1 $2" = "auth login" ] || exit 2\n"$BROWSER" "https://claude.com/cai/oauth/authorize?x=1"\nsleep 0.6\nexit 0\n', { mode: 0o755 });
    const urls: string[] = [];
    const login = runLogin(bin, (u) => urls.push(u));
    expect(await login.done).toBe(true);
    expect(urls).toEqual(['https://claude.com/cai/oauth/authorize?x=1']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')('is not done when cancelled', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
    const login = runLogin(bin, () => {});
    setTimeout(() => login.cancel(), 100);
    expect(await login.done).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
