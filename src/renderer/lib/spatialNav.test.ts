import { describe, expect, it } from 'vitest';
import { pickNext, type Box } from './spatialNav';

// A Settings-like layout: a full-width field, a row of three chips, a toggle at the right edge.
const field: Box = { x: 0, y: 0, w: 500, h: 40 };
const chipA: Box = { x: 0, y: 60, w: 150, h: 30 };
const chipB: Box = { x: 170, y: 60, w: 150, h: 30 };
const chipC: Box = { x: 340, y: 60, w: 150, h: 30 };
const toggle: Box = { x: 450, y: 120, w: 46, h: 26 };
const boxes = [field, chipA, chipB, chipC, toggle];

describe('pickNext', () => {
  it('moves along a row with left/right and between rows with up/down', () => {
    expect(pickNext(boxes, 1, 'right')).toBe(2);
    expect(pickNext(boxes, 2, 'right')).toBe(3);
    expect(pickNext(boxes, 2, 'left')).toBe(1);
    expect(pickNext(boxes, 2, 'up')).toBe(0);
    expect(pickNext(boxes, 0, 'down')).toBe(2); // the chip nearest straight below the field's centre
  });

  it('prefers what is straight ahead over something far to the side', () => {
    expect(pickNext(boxes, 3, 'down')).toBe(4);
    expect(pickNext(boxes, 4, 'up')).toBe(3);
  });

  it('goes to a wide control straight below before a small one further down the same edge', () => {
    // Settings: the close button top-right, a full-width model button below it, a toggle lower down.
    const close: Box = { x: 450, y: 0, w: 30, h: 30 };
    const model: Box = { x: 0, y: 100, w: 490, h: 60 };
    const toggleLow: Box = { x: 440, y: 400, w: 46, h: 26 };
    expect(pickNext([close, model, toggleLow], 0, 'down')).toBe(1);
  });

  it('left/right keeps to the row: the last card stays put rather than jumping to a corner button', () => {
    // The cockpit's game menu at 1280 px: three cards a row, the close button up in the corner.
    const close: Box = { x: 1100, y: 25, w: 30, h: 30 };
    const cards: Box[] = [
      { x: 150, y: 102, w: 238, h: 92 }, { x: 398, y: 102, w: 238, h: 92 }, { x: 645, y: 102, w: 238, h: 92 },
      { x: 150, y: 235, w: 238, h: 92 },
    ];
    const boxes = [close, ...cards];
    expect(pickNext(boxes, 3, 'right')).toBe(3);   // last card in the row
    expect(pickNext(boxes, 2, 'right')).toBe(3);   // still moves along the row
    expect(pickNext(boxes, 1, 'down')).toBe(4);    // and down to the next row
  });

  it('stays put at an edge, and starts at the top when nothing is focused', () => {
    expect(pickNext(boxes, 0, 'up')).toBe(0);
    expect(pickNext(boxes, 3, 'right')).toBe(3);
    expect(pickNext(boxes, -1, 'down')).toBe(0);
    expect(pickNext([], 0, 'down')).toBe(-1);
  });
});
