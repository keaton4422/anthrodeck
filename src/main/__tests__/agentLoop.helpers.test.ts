import { describe, it, expect } from 'vitest';
import {
  accumulateUsage,
  emptyUsage,
  extractToolUses,
  resolveInferenceConfig,
  isModelId,
  isEffort,
  parseConfidence,
  textFromContent,
  firstSentence,
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
  type RawUsage,
} from '../agentLoop.helpers';

describe('accumulateUsage', () => {
  it('starts from a zeroed total', () => {
    expect(emptyUsage()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      thinkingTokens: 0,
    });
  });

  it('sums input/output/cache/thinking across multiple iterations', () => {
    const call1: RawUsage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 0,
      output_tokens_details: { thinking_tokens: 10 },
    };
    // Second call reads the cache the first one wrote (the whole point of caching).
    const call2: RawUsage = {
      input_tokens: 5,
      output_tokens: 40,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 200,
      output_tokens_details: { thinking_tokens: 8 },
    };

    let total = emptyUsage();
    total = accumulateUsage(total, call1);
    total = accumulateUsage(total, call2);

    expect(total).toEqual({
      inputTokens: 105,
      outputTokens: 90,
      cacheReadTokens: 200,
      cacheCreationTokens: 200,
      thinkingTokens: 18,
    });
  });

  it('treats missing / null fields as zero', () => {
    const partial: RawUsage = { input_tokens: 7, output_tokens: null };
    const total = accumulateUsage(emptyUsage(), partial);
    expect(total.inputTokens).toBe(7);
    expect(total.outputTokens).toBe(0);
    expect(total.cacheReadTokens).toBe(0);
    expect(total.thinkingTokens).toBe(0);
  });

  it('is a no-op for null/undefined usage', () => {
    const base = { ...emptyUsage(), inputTokens: 3 };
    expect(accumulateUsage(base, null)).toBe(base);
    expect(accumulateUsage(base, undefined)).toBe(base);
  });
});

describe('extractToolUses', () => {
  it('pulls tool_use blocks and ignores text/thinking blocks', () => {
    const content = [
      { type: 'thinking', thinking: 'hmm', signature: 'sig' },
      { type: 'text', text: 'I will read the file.' },
      { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'src/App.tsx' } },
      { type: 'tool_use', id: 'tu_2', name: 'run_shell', input: { command: 'npm test' } },
    ];
    expect(extractToolUses(content)).toEqual([
      { id: 'tu_1', name: 'read_file', input: { path: 'src/App.tsx' } },
      { id: 'tu_2', name: 'run_shell', input: { command: 'npm test' } },
    ]);
  });

  it('defaults a missing input to an empty object', () => {
    const content = [{ type: 'tool_use', id: 'tu_3', name: 'list_files' }];
    expect(extractToolUses(content)).toEqual([{ id: 'tu_3', name: 'list_files', input: {} }]);
  });

  it('skips malformed blocks (missing id/name) and non-arrays', () => {
    const content = [
      { type: 'tool_use', name: 'no_id' },
      { type: 'tool_use', id: 'has_id_no_name' },
      null,
      'not a block',
    ];
    expect(extractToolUses(content)).toEqual([]);
    expect(extractToolUses(undefined)).toEqual([]);
    expect(extractToolUses('nope')).toEqual([]);
  });
});

describe('resolveInferenceConfig', () => {
  it('passes through valid values', () => {
    expect(
      resolveInferenceConfig({ model: 'claude-opus-4-8', extendedThinking: true, effort: 'xhigh' }),
    ).toEqual({ model: 'claude-opus-4-8', extendedThinking: true, effort: 'xhigh' });
  });

  it('falls back to safe defaults for unknown / missing values', () => {
    expect(resolveInferenceConfig({ model: 'gpt-4', effort: 'ludicrous' })).toEqual({
      model: DEFAULT_MODEL,
      extendedThinking: false,
      effort: DEFAULT_EFFORT,
    });
    expect(resolveInferenceConfig(null)).toEqual({
      model: DEFAULT_MODEL,
      extendedThinking: false,
      effort: DEFAULT_EFFORT,
    });
  });

  it('coerces extendedThinking to a boolean', () => {
    expect(resolveInferenceConfig({ extendedThinking: undefined }).extendedThinking).toBe(false);
  });
});

describe('textFromContent', () => {
  it('joins text blocks and ignores non-text blocks', () => {
    const content = [
      { type: 'thinking', thinking: 'x', signature: 's' },
      { type: 'text', text: 'Hello ' },
      { type: 'tool_use', id: 't', name: 'n', input: {} },
      { type: 'text', text: 'world' },
    ];
    expect(textFromContent(content)).toBe('Hello world');
  });

  it('returns empty string for non-arrays', () => {
    expect(textFromContent(null)).toBe('');
    expect(textFromContent('nope')).toBe('');
  });
});

describe('parseConfidence', () => {
  it('extracts a trailing high/med/low tag and strips it', () => {
    expect(parseConfidence('Done.\n<confidence>high</confidence>')).toEqual({
      confidence: 'high',
      cleaned: 'Done.',
    });
    expect(parseConfidence('Fixed it. <confidence>low</confidence>')).toEqual({
      confidence: 'low',
      cleaned: 'Fixed it.',
    });
  });

  it('normalizes "medium" to "med"', () => {
    expect(parseConfidence('ok <confidence>medium</confidence>').confidence).toBe('med');
    expect(parseConfidence('ok <confidence>MED</confidence>').confidence).toBe('med');
  });

  it('returns null + unchanged text when no tag present', () => {
    expect(parseConfidence('no tag here')).toEqual({ confidence: null, cleaned: 'no tag here' });
  });

  it('only matches a tag at the very end', () => {
    // A tag mid-text is not treated as the turn confidence.
    const text = 'saw <confidence>high</confidence> in the middle, more after';
    expect(parseConfidence(text).confidence).toBeNull();
  });
});

describe('firstSentence', () => {
  it('returns the first sentence', () => {
    expect(firstSentence('Read the file. Then edit it. Done.')).toBe('Read the file.');
    expect(firstSentence('Running the tests now!')).toBe('Running the tests now!');
  });

  it('caps very long single sentences with an ellipsis', () => {
    const long = 'x'.repeat(200);
    const out = firstSentence(long, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles empty input', () => {
    expect(firstSentence('')).toBe('');
    expect(firstSentence('   ')).toBe('');
  });
});

describe('type guards', () => {
  it('isModelId only accepts the shipped model ids', () => {
    expect(isModelId('claude-sonnet-5')).toBe(true);
    expect(isModelId('claude-opus-4-6')).toBe(false);
    expect(isModelId(42)).toBe(false);
  });

  it('isEffort only accepts the five effort levels', () => {
    expect(isEffort('max')).toBe(true);
    expect(isEffort('high')).toBe(true);
    expect(isEffort('turbo')).toBe(false);
  });
});
