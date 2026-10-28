import { describe, expect, it } from 'vitest';
import { stickDirections } from './useGamepad';

const UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const held = (r: Record<number, boolean>) => Object.entries(r).filter(([, v]) => v).map(([k]) => Number(k));

describe('left stick as a D-pad', () => {
  it('pushes one direction, the dominant axis, once past the push point', () => {
    expect(held(stickDirections(0, -0.9, {}))).toEqual([UP]);
    expect(held(stickDirections(0.8, 0.5, {}))).toEqual([RIGHT]);     // a diagonal moves one way
    expect(held(stickDirections(-0.3, 0.2, {}))).toEqual([]);          // a light touch does nothing
  });

  it('keeps holding until the stick comes well back, so hold-to-repeat doesn\'t stutter', () => {
    const pushed = stickDirections(0, 0.9, {});
    expect(held(stickDirections(0, 0.45, pushed))).toEqual([DOWN]);
    expect(held(stickDirections(0, 0.2, pushed))).toEqual([]);
    expect(held(stickDirections(-0.7, 0, {}))).toEqual([LEFT]);
  });
});
