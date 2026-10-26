// D-pad focus movement for panels full of ordinary controls (Settings, drawers): from the focused
// control, go to the nearest one in the pressed direction by on-screen position. Stacked rows,
// side-by-side chips and a toggle at the end of a line all behave the way they look.
//
// Pure (rects in, index out) so it unit-tests.

export interface Box { x: number; y: number; w: number; h: number }
export type Dir = 'up' | 'down' | 'left' | 'right';

const center = (b: Box) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 });

// Index of the box to move to, or `from` when nothing lies that way.
export function pickNext(boxes: Box[], from: number, dir: Dir): number {
  if (!boxes.length) return -1;
  if (from < 0 || from >= boxes.length) return 0;
  const cur = boxes[from];
  const a = center(cur);
  const vertical = dir === 'down' || dir === 'up';
  let best = from;
  let bestScore = Infinity;
  boxes.forEach((b, i) => {
    if (i === from) return;
    const c = center(b);
    const dx = c.cx - a.cx;
    const dy = c.cy - a.cy;
    const ahead = dir === 'down' ? dy : dir === 'up' ? -dy : dir === 'right' ? dx : -dx;
    if (ahead <= 2) return;
    // Sideways distance is the gap between the boxes, not between centres: a full-width button
    // straight below a small one is right there, even though its centre is far to the side.
    const gap = vertical
      ? Math.max(0, b.x - (cur.x + cur.w), cur.x - (b.x + b.w))
      : Math.max(0, b.y - (cur.y + cur.h), cur.y - (b.y + b.h));
    // Only things roughly that way count: sharing the column (up/down) or row (left/right), or
    // within a cone, about 30 degrees for up/down and a tighter 14 for left/right. Left/right keeps
    // to the row: from the last card in a row it stays put rather than climbing to a close button
    // up in the corner, and a full-width field just above a chip doesn't count as "right" of it.
    const drift = Math.abs(vertical ? dx : dy);
    if (gap > 0 && drift >= ahead * (vertical ? 0.6 : 0.25)) return;
    // Ties (several controls equally close, all overlapping) go to the one most directly ahead.
    const cross = gap + drift * 0.04;
    // Nearest wins, with sideways drift weighted more so "down" prefers what's straight below.
    const score = ahead + cross * 2.5;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}
