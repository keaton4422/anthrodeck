import { useCallback, useEffect, useMemo, useRef } from 'react';
import { pickNext, type Box, type Dir } from '../lib/spatialNav';

// Controller focus for a panel of ordinary controls. The D-pad moves a visible ring between the
// panel's buttons and fields by on-screen position, A presses the one under it (a text field gets
// keyboard focus, so STEAM + X brings up the on-screen keyboard), and the focused control is kept
// scrolled into view. The parent routes pad input here through the returned PadFocus; arrow keys and
// Enter work too.

export interface PadFocus {
  move(dir: Dir): void;
  activate(): void;
  // Right stick: scroll the panel by `dy` pixels; the ring follows onto a visible control.
  scroll(dy: number): void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [data-pad-focusable]';
const RING = 'pad-focus';

// `resetKey`: when it changes, the ring goes back to the start (e.g. a new folder listing).
// `start`: where the ring begins (default: the first control), e.g. the game already being played.
export function usePadFocus(
  root: React.RefObject<HTMLElement>,
  resetKey?: unknown,
  start?: () => HTMLElement | null | undefined,
): PadFocus {
  const startRef = useRef(start);
  startRef.current = start;
  const current = useRef<HTMLElement | null>(null);

  const controls = useCallback((): HTMLElement[] => {
    const el = root.current;
    if (!el) return [];
    return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }, [root]);

  const focusOn = useCallback((target: HTMLElement | undefined) => {
    if (!target || target === current.current) return;
    current.current?.classList.remove(RING);
    target.classList.add(RING);
    // Instant, not smooth: the next press measures positions, and they must have settled.
    target.scrollIntoView({ block: 'nearest' });
    current.current = target;
  }, []);

  // Start on the first control so the ring is visible as soon as the panel opens. A timeout, not
  // requestAnimationFrame: frames pause while the window is hidden, and the first press would
  // then only reveal the ring instead of moving it.
  useEffect(() => {
    const id = window.setTimeout(() => {
      current.current?.classList.remove(RING);
      current.current = null;
      focusOn(startRef.current?.() ?? controls()[0]);
    }, 0);
    return () => {
      window.clearTimeout(id);
      current.current?.classList.remove(RING);
      current.current = null;
    };
  }, [controls, focusOn, resetKey]);

  const nav = useMemo<PadFocus>(() => ({
    move(dir) {
      const list = controls();
      if (!list.length) return;
      // Measured fresh each press: sections fold open and closed, and the panel scrolls.
      const boxes: Box[] = list.map((c) => {
        const r = c.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
      const from = current.current ? list.indexOf(current.current) : -1;
      focusOn(list[pickNext(boxes, from, dir)]);
    },
    activate() {
      const el = current.current;
      if (!el || !el.isConnected) return;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        el.focus();
        return;
      }
      const r = el.getBoundingClientRect();
      el.click();
      // A control can remove itself when pressed ("Use an API key instead" opens the key form in
      // its place). Put the ring on whatever now sits there instead of losing it.
      window.setTimeout(() => {
        if (el.isConnected) return;
        const list = controls();
        if (!list.length) return;
        const near = (c: HTMLElement) => {
          const b = c.getBoundingClientRect();
          return Math.hypot(b.left - r.left, b.top - r.top);
        };
        current.current = null;
        focusOn(list.reduce((a, b) => (near(b) < near(a) ? b : a)));
      }, 50);
    },
    scroll(dy) {
      const rootEl = root.current;
      if (!rootEl) return;
      // The panel's scrolling area: the root itself, or the first scrollable thing inside it.
      const scrollable = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1
        && /(auto|scroll)/.test(getComputedStyle(el).overflowY);
      const area = scrollable(rootEl) ? rootEl
        : [...rootEl.querySelectorAll<HTMLElement>('*')].find(scrollable);
      if (!area) return;
      area.scrollTop += dy;
      // If the ring scrolled out of view, move it to the first control that's fully in view.
      const view = area.getBoundingClientRect();
      const inView = (c: HTMLElement) => {
        const b = c.getBoundingClientRect();
        return b.top >= view.top && b.bottom <= view.bottom;
      };
      const cur = current.current;
      if (cur && cur.isConnected && inView(cur)) return;
      const visible = controls().filter((c) => area.contains(c) && inView(c));
      const next = dy > 0 ? visible[0] : visible[visible.length - 1];
      if (next && next !== cur) {
        cur?.classList.remove(RING);
        next.classList.add(RING);
        current.current = next;
      }
    },
  }), [controls, focusOn, root]);

  // Arrow keys and Enter do the same, for a Bluetooth keyboard (and the desktop). Left alone while
  // typing in a field, where the arrows move the cursor.
  useEffect(() => {
    const keys: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (keys[e.key]) { e.preventDefault(); nav.move(keys[e.key]); }
      else if (e.key === 'Enter' && current.current) { e.preventDefault(); nav.activate(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  return nav;
}
