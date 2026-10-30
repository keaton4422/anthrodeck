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

describe('the controller inside the page', () => {
  it('reads the presses the page reports, and nothing else on its console', async () => {
    const { padPress, PAD_MARK } = await import('../claudePage');
    expect(padPress(`${PAD_MARK}B`)).toBe('B');
    expect(padPress(`${PAD_MARK}down`)).toBe('down');
    expect(padPress(`${PAD_MARK}scroll:-36`)).toEqual({ scroll: -36 });
    expect(padPress(`${PAD_MARK}scroll:lots`)).toBeNull();
    expect(padPress('B')).toBeNull();
    expect(padPress('Uncaught TypeError')).toBeNull();
  });
});

describe('the page\'s place and sign-in', () => {
  it('sits in a column in the middle, zoomed to claude.ai\'s narrow layout', async () => {
    const { column } = await import('../claudePage');
    expect(column({ x: 0, y: 110, width: 1280, height: 690 })).toEqual({ bounds: { x: 180, y: 110, width: 920, height: 690 }, zoom: 920 / 600 });
    expect(column({ x: 0, y: 0, width: 500, height: 400 })).toEqual({ bounds: { x: 0, y: 0, width: 500, height: 400 }, zoom: 1 });
  });

  it('knows a page past sign-in from one of its steps', async () => {
    const { pastSignIn } = await import('../claudePage');
    expect(pastSignIn('https://claude.ai/code')).toBe(true);
    expect(pastSignIn('https://claude.ai/new')).toBe(true);
    expect(pastSignIn('https://claude.ai/login?returnTo=%2Fcode')).toBe(false);
    expect(pastSignIn('https://claude.ai/magic-link#abc')).toBe(false);
    expect(pastSignIn('https://accounts.google.com/signin')).toBe(false);
  });
});
