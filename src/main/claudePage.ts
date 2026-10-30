// A Remote Control session's own claude.ai page, inside AnthroDeck: the full transcript, prompts
// and approvals the way the Claude phone app has them, with nothing installed on the computer the
// session runs on. It signs in once with the pilot's own Claude account and keeps that sign-in in
// its own storage (partition persist:claude), apart from AnthroDeck's interface.
//
// Claude Code's session listing names a session but doesn't give its claude.ai address, so the
// page opens claude.ai's own session list and goes to the session with that name; once found, the
// address is remembered. If the name isn't found the list stays up for the pilot to tap.

import { BrowserWindow, WebContentsView, session, type Rectangle, type WebContents } from 'electron';

export const CLAUDE_CODE_URL = 'https://claude.ai/code';
const PARTITION = 'persist:claude';
const FIND_MS = 12_000;

export interface PageLink { href: string; text: string }

// The listing shortens long names ("Switch to anthrodeck, lets get working on that aga...").
const bare = (s: string) => s.replace(/(\.\.\.|…)$/, '').trim().toLowerCase();

// The session list's link for `name`: an exact title first, else one the shortened name begins.
export function findSession(links: PageLink[], name: string): string | null {
  const want = bare(name);
  if (!want) return null;
  const titled = links
    .filter((l) => /\/code\/session_[A-Za-z0-9]+/.test(l.href))
    .map((l) => ({ href: l.href, title: bare(l.text.split('\n').map((t) => t.trim()).find(Boolean) ?? '') }));
  return (titled.find((l) => l.title === want) ?? titled.find((l) => want.length >= 12 && l.title.startsWith(want)))?.href ?? null;
}

// claude.ai sees an ordinary Chrome, not Electron: some sign-in pages refuse embedded browsers.
export function plainUserAgent(ua: string): string {
  return ua.replace(/\s(Electron|anthrodeck|AnthroDeck)\/\S+/g, '');
}

// Sign-in with Google or Apple opens a window of its own; anything else stays in the page.
export function opensWindow(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'accounts.google.com' || h === 'appleid.apple.com';
  } catch { return false; }
}

const LINKS_JS = `[...document.querySelectorAll('a[href*="/code/session_"]')].map((a) => ({ href: a.href, text: a.innerText || a.textContent || '' }))`;
const FOCUS_BOX_JS = `(() => {
  const boxes = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter((e) => e.offsetParent);
  const box = boxes[boxes.length - 1];
  if (box) { box.focus(); box.scrollIntoView({ block: 'nearest' }); }
  return !!box;
})()`;

// The controller inside the page and its sign-in windows. Chromium hands the pad only to the page
// that has focus, so AnthroDeck's own interface doesn't see B while claude.ai does. This runs in
// its own isolated world there (the page can't see or change it) and reports presses on the
// console, where main reads them: B, X, and the D-pad and right stick for scrolling.
export const PAD_MARK = '__anthrodeck_pad:';
const PAD_JS = `(() => {
  if (window.__anthrodeckPad) return;
  window.__anthrodeckPad = true;
  let held = {}, wheel = 0, last = 0;
  const tell = (what) => console.log('${PAD_MARK}' + what);
  const loop = (t) => {
    const pad = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean);
    if (pad && document.hasFocus()) {
      for (const [i, name] of [[1, 'B'], [2, 'X'], [12, 'up'], [13, 'down']]) {
        const down = !!pad.buttons[i]?.pressed;
        if (down && !held[i]) tell(name);
        held[i] = down;
      }
      const y = pad.axes[3] ?? 0;
      if (Math.abs(y) > 0.2) wheel += y * 18;
      if (wheel && t - last > 50) { tell('scroll:' + Math.round(wheel)); wheel = 0; last = t; }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})()`;

export type PadPress = 'B' | 'X' | 'up' | 'down' | { scroll: number };

export function padPress(message: string): PadPress | null {
  if (!message.startsWith(PAD_MARK)) return null;
  const what = message.slice(PAD_MARK.length);
  if (what === 'B' || what === 'X' || what === 'up' || what === 'down') return what;
  const m = /^scroll:(-?\d+)$/.exec(what);
  return m ? { scroll: Number(m[1]) } : null;
}

// Watch the controller in `wc` from now on, through every page it loads.
function watchPad(wc: WebContents, onPress: (p: PadPress) => void): void {
  const inject = () => { void wc.executeJavaScriptInIsolatedWorld(PAD_WORLD, [{ code: PAD_JS }]).catch(() => {}); };
  wc.on('dom-ready', inject);
  wc.on('console-message', (e) => {
    const p = padPress(e.message);
    if (p) onPress(p);
  });
}
const PAD_WORLD = 1077;

export interface ClaudePageDeps {
  remembered: () => Record<string, string>;          // session ref → its claude.ai address
  remember: (ref: string, url: string) => void;
  onClose: () => void;                               // Escape in the page: back to AnthroDeck
}

export class ClaudePage {
  private view: WebContentsView | null = null;
  private finding = 0;

  constructor(private win: BrowserWindow, private deps: ClaudePageDeps) {}

  private make(): WebContentsView {
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(plainUserAgent(ses.getUserAgent()));
    // The microphone for claude.ai's own dictation and the clipboard for its copy buttons; nothing else.
    ses.setPermissionRequestHandler((_wc, permission, done, details) => {
      const audioOnly = permission === 'media' && 'mediaTypes' in details && (details.mediaTypes ?? []).every((t) => t === 'audio');
      done(permission === 'clipboard-sanitized-write' || audioOnly);
    });
    const view = new WebContentsView({
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (opensWindow(url)) {
        return { action: 'allow', overrideBrowserWindowOptions: { parent: this.win, modal: true, width: 900, height: 700, autoHideMenuBar: true } };
      }
      if (/^https?:/.test(url)) void wc.loadURL(url);
      return { action: 'deny' };
    });
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !input.alt && !input.control) {
        e.preventDefault();
        this.deps.onClose();
      }
    });
    watchPad(wc, (p) => {
      if (p === 'B') this.deps.onClose();
      else if (p === 'X') void this.focusBox();
      else if (p === 'up') this.scroll(-160);
      else if (p === 'down') this.scroll(160);
      else this.scroll(p.scroll);
    });
    // A sign-in window: B or Escape closes it, back to the page (it has no other way out in Game Mode).
    wc.on('did-create-window', (popup) => {
      const close = () => { if (!popup.isDestroyed()) popup.close(); };
      watchPad(popup.webContents, (p) => { if (p === 'B') close(); });
      popup.webContents.on('before-input-event', (e, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); close(); }
      });
    });
    view.setBackgroundColor('#262624');
    return view;
  }

  // Show the page for a session (by its ref and name) where the interface leaves room for it.
  open(ref: string, name: string, bounds: Rectangle): void {
    if (!this.view) this.view = this.make();
    const view = this.view;
    if (!this.win.contentView.children.includes(view)) this.win.contentView.addChildView(view);
    view.setBounds(bounds);
    view.setVisible(true);
    const known = this.deps.remembered()[ref];
    const finding = ++this.finding;
    void view.webContents.loadURL(known ?? CLAUDE_CODE_URL).then(
      () => { if (!known) void this.find(finding, ref, name); },
      () => { /* offline, or signed out mid-load: the page says so itself */ },
    );
    view.webContents.focus();
  }

  place(bounds: Rectangle): void { this.view?.setBounds(bounds); }

  // Stepping aside for a card or menu the interface draws where the page is, and back.
  shown(on: boolean): void {
    const v = this.view;
    if (!v || !this.win.contentView.children.includes(v)) return;
    v.setVisible(on);
    if (on) v.webContents.focus(); else this.win.webContents.focus();
  }

  hide(): void {
    this.finding++;
    if (!this.view) return;
    for (const w of this.win.getChildWindows()) if (!w.isDestroyed()) w.close();
    this.view.setVisible(false);
    this.win.contentView.removeChildView(this.view);
    this.win.webContents.focus();
  }

  // The right stick and D-pad scroll the page; X puts the cursor in its message box.
  scroll(dy: number): void {
    const v = this.view;
    if (!v) return;
    const b = v.getBounds();
    v.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(b.width / 2), y: Math.round(b.height / 2), deltaX: 0, deltaY: -dy });
  }

  async focusBox(): Promise<boolean> {
    if (!this.view) return false;
    this.view.webContents.focus();
    return this.view.webContents.executeJavaScript(FOCUS_BOX_JS).catch(() => false);
  }

  // claude.ai's session list draws after the page loads (and only once signed in), so look a few times.
  private async find(finding: number, ref: string, name: string): Promise<void> {
    const wc = this.view?.webContents;
    const until = Date.now() + FIND_MS;
    while (wc && finding === this.finding && Date.now() < until) {
      const links = (await wc.executeJavaScript(LINKS_JS).catch(() => [])) as PageLink[];
      const href = findSession(links, name);
      if (href && finding === this.finding) {
        this.deps.remember(ref, href);
        await wc.loadURL(href).catch(() => {});
        return;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}
