import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  budgetLevel,
  budgetFraction,
  formatTokens,
  suggestPrunes,
} from './pilot';

describe('estimateTokens', () => {
  it('approximates ~4 chars per token, min 1 for non-empty', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('12345678')).toBe(2);
  });
});

describe('budgetLevel', () => {
  it('is ok below 70%, warn at 70-90%, crit at/above 90%', () => {
    expect(budgetLevel(0, 200_000)).toBe('ok');
    expect(budgetLevel(139_000, 200_000)).toBe('ok');
    expect(budgetLevel(140_000, 200_000)).toBe('warn');
    expect(budgetLevel(179_000, 200_000)).toBe('warn');
    expect(budgetLevel(180_000, 200_000)).toBe('crit');
    expect(budgetLevel(250_000, 200_000)).toBe('crit');
  });

  it('is ok when budget is non-positive', () => {
    expect(budgetLevel(50, 0)).toBe('ok');
  });
});

describe('budgetFraction', () => {
  it('clamps to [0, 1]', () => {
    expect(budgetFraction(0, 200_000)).toBe(0);
    expect(budgetFraction(100_000, 200_000)).toBe(0.5);
    expect(budgetFraction(400_000, 200_000)).toBe(1);
    expect(budgetFraction(10, 0)).toBe(0);
  });
});

describe('formatTokens', () => {
  it('formats sub-1K, K, and M ranges', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(45_200)).toBe('45K');
    expect(formatTokens(1_200_000)).toBe('1.2M');
  });
});

describe('suggestPrunes', () => {
  it('flags an earlier assistant read superseded by a later read of the same file', () => {
    const messages = [
      { id: 'a1', role: 'assistant', content: 'looking… `read: src/App.tsx`' },
      { id: 'u1', role: 'user', content: 'now change it' },
      { id: 'a2', role: 'assistant', content: 're-reading `read: src/App.tsx` then editing' },
    ];
    expect(suggestPrunes(messages)).toEqual(['a1']);
  });

  it('does not flag a file read only once', () => {
    const messages = [
      { id: 'a1', role: 'assistant', content: '`read: src/A.ts`' },
      { id: 'a2', role: 'assistant', content: '`read: src/B.ts`' },
    ];
    expect(suggestPrunes(messages)).toEqual([]);
  });

  it('ignores user messages', () => {
    const messages = [
      { id: 'u1', role: 'user', content: '`read: x` `read: x`' },
      { id: 'a1', role: 'assistant', content: 'no reads here' },
    ];
    expect(suggestPrunes(messages)).toEqual([]);
  });
});
