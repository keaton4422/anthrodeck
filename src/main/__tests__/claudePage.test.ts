import { describe, it, expect, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: class {}, WebContentsView: class {}, session: {} }));
import { findSession, plainUserAgent, opensWindow } from '../claudePage';

const links = [
  { href: 'https://claude.ai/code/session_01AAA', text: 'Fix login\n2h ago' },
  { href: 'https://claude.ai/code/session_01BBB', text: 'Switch to anthrodeck, lets get working on that again please\nyesterday' },
  { href: 'https://claude.ai/code/session_01CCC', text: 'exportPOs.php subtotal_s warning (fork)' },
  { href: 'https://claude.ai/code/session_01DDD', text: 'exportPOs.php subtotal_s warning' },
  { href: 'https://claude.ai/settings', text: 'Fix login' },
];

describe('a session\'s claude.ai page', () => {
  it('finds the session by its title', () => {
    expect(findSession(links, 'Fix login')).toBe('https://claude.ai/code/session_01AAA');
    expect(findSession(links, 'fix LOGIN')).toBe('https://claude.ai/code/session_01AAA');
  });

  it('prefers the exact title over one that only begins the same', () => {
    expect(findSession(links, 'exportPOs.php subtotal_s warning')).toBe('https://claude.ai/code/session_01DDD');
  });

  it('matches a name the listing shortened', () => {
    expect(findSession(links, 'Switch to anthrodeck, lets get working on that aga...')).toBe('https://claude.ai/code/session_01BBB');
  });

  it('finds nothing for an unknown or too-short name', () => {
    expect(findSession(links, 'Something else')).toBeNull();
    expect(findSession(links, 'Fix...')).toBeNull();
    expect(findSession(links, '')).toBeNull();
  });

  it('looks like an ordinary Chrome to claude.ai', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) anthrodeck/0.9.35 Chrome/138.0.7204.251 Electron/37.10.3 Safari/537.36';
    expect(plainUserAgent(ua)).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.251 Safari/537.36');
  });

  it('gives Google and Apple sign-in a window of their own, and nothing else', () => {
    expect(opensWindow('https://accounts.google.com/o/oauth2/auth?x=1')).toBe(true);
    expect(opensWindow('https://appleid.apple.com/auth')).toBe(true);
    expect(opensWindow('https://github.com/x')).toBe(false);
    expect(opensWindow('not a url')).toBe(false);
  });
});
