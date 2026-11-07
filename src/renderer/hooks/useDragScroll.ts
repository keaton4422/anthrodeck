import { useEffect, type RefObject } from 'react';

// Dragging a finger scrolls `ref`, also when Steam hands the touchscreen over as a mouse (Game
// Mode can), where Chromium would otherwise select text instead. A drag isn't a tap: the click
// it ends on is dropped. Real touch scrolls natively and is left alone; so are text boxes.
const SLOP = 8;

export function useDragScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { y: number; top: number } | null = null;
    let dragged = false;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
      start = { y: e.clientY, top: el.scrollTop };
      dragged = false;
    };
    const move = (e: PointerEvent) => {
      if (!start || !(e.buttons & 1)) { start = null; return; }
      const dy = e.clientY - start.y;
      if (!dragged && Math.abs(dy) < SLOP) return;
      dragged = true;
      el.scrollTop = start.top - dy;
      e.preventDefault();
    };
    const up = () => { start = null; };
    const click = (e: MouseEvent) => {
      if (!dragged) return;
      dragged = false;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('click', click, true);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('click', click, true);
    };
  }, [ref]);
}
