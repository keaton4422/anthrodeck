import { describe, it, expect } from 'vitest';
import { crossesThreshold, flashcardMessages, extractCardText, CARDS_EVERY } from '../flashcards';
import { cleanTranscript } from '../whisperTranscriber';

describe('crossesThreshold', () => {
  it('is true only when a multiple of CARDS_EVERY is crossed', () => {
    expect(CARDS_EVERY).toBe(10);
    expect(crossesThreshold(9, 1)).toBe(true);   // 9 -> 10
    expect(crossesThreshold(10, 1)).toBe(false); // 10 -> 11
    expect(crossesThreshold(0, 10)).toBe(true);  // 0 -> 10
    expect(crossesThreshold(8, 5)).toBe(true);   // 8 -> 13 crosses 10
    expect(crossesThreshold(11, 8)).toBe(false); // 11 -> 19, no new multiple of 10
    expect(crossesThreshold(15, 5)).toBe(true);  // 15 -> 20 crosses 20
  });

  it('does not fire on zero or negative counts', () => {
    expect(crossesThreshold(5, 0)).toBe(false);
    expect(crossesThreshold(5, -3)).toBe(false);
  });
});

describe('flashcardMessages', () => {
  it('embeds the context and asks for a single sentence', () => {
    const { system, user } = flashcardMessages('read src/App.tsx, ran npm test');
    expect(system.toLowerCase()).toContain('one sentence');
    expect(user).toContain('read src/App.tsx, ran npm test');
  });

  it('handles empty context', () => {
    expect(flashcardMessages('').user).toContain('no context');
  });
});

describe('extractCardText', () => {
  it('joins text blocks and collapses whitespace', () => {
    const content = [
      { type: 'text', text: 'The build   command is' },
      { type: 'thinking', thinking: 'x' },
      { type: 'text', text: 'npm run make.' },
    ];
    expect(extractCardText(content)).toBe('The build command is npm run make.');
  });

  it('returns empty for non-arrays', () => {
    expect(extractCardText(null)).toBe('');
  });
});

describe('cleanTranscript', () => {
  it('strips whisper timestamp brackets and collapses lines', () => {
    const raw = '[00:00:00.000 --> 00:00:02.000]  Hello there\n[00:00:02.000 --> 00:00:03.500]  world';
    expect(cleanTranscript(raw)).toBe('Hello there world');
  });

  it('trims plain text unchanged', () => {
    expect(cleanTranscript('  just text  ')).toBe('just text');
  });
});
