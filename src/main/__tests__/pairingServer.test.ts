import { describe, it, expect } from 'vitest';
import { looksLikeAnthropicKey, codeMatches } from '../pairingServer';

// The pairing endpoint accepts a secret from the network, so the two gates in front of it are
// worth pinning down: the code check must not be sloppy, and the key check must not accept junk.

describe('codeMatches', () => {
  it('accepts the exact code', () => {
    expect(codeMatches('482913', '482913')).toBe(true);
  });

  it('tolerates surrounding whitespace from a mobile keyboard', () => {
    expect(codeMatches('482913', ' 482913 ')).toBe(true);
  });

  it('rejects a wrong code', () => {
    expect(codeMatches('482913', '482914')).toBe(false);
  });

  it('rejects a prefix — a partial code must not slip through', () => {
    expect(codeMatches('482913', '4829')).toBe(false);
  });

  it('rejects when no pairing session is open', () => {
    // Guards the window between stopPairing() and a stray in-flight request.
    expect(codeMatches(null, '482913')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(codeMatches('482913', 482913)).toBe(false);
    expect(codeMatches('482913', undefined)).toBe(false);
    expect(codeMatches('482913', { toString: () => '482913' })).toBe(false);
  });
});

describe('looksLikeAnthropicKey', () => {
  it('accepts a well-formed key', () => {
    expect(looksLikeAnthropicKey(`sk-ant-api03-${'a1B2c3D4e5'.repeat(3)}`)).toBe(true);
  });

  it('trims — phone clipboards routinely add a trailing newline', () => {
    expect(looksLikeAnthropicKey(`  sk-ant-api03-${'x'.repeat(30)}\n`)).toBe(true);
  });

  it('rejects the wrong prefix', () => {
    expect(looksLikeAnthropicKey(`sk-proj-${'x'.repeat(30)}`)).toBe(false);
  });

  it('rejects a truncated paste', () => {
    expect(looksLikeAnthropicKey('sk-ant-api03-abc')).toBe(false);
  });

  it('rejects empty and non-strings', () => {
    expect(looksLikeAnthropicKey('')).toBe(false);
    expect(looksLikeAnthropicKey(null)).toBe(false);
    expect(looksLikeAnthropicKey(12345)).toBe(false);
  });

  it('rejects a key with spaces in the middle', () => {
    expect(looksLikeAnthropicKey(`sk-ant-api03-${'x'.repeat(15)} ${'y'.repeat(15)}`)).toBe(false);
  });
});
