import { describe, it, expect } from 'vitest';
import { downsample, encodeWav, pcmToWav, WHISPER_RATE } from './audio';

function str(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('downsample', () => {
  it('reduces length by the rate ratio', () => {
    const input = new Float32Array(48000).fill(0.5);
    const out = downsample(input, 48000, 16000);
    expect(out.length).toBe(16000);
    expect(out[0]).toBeCloseTo(0.5, 5);
  });

  it('passes through when already at or below target', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsample(input, 16000, 16000)).toBe(input);
    expect(downsample(input, 8000, 16000)).toBe(input);
  });
});

describe('encodeWav', () => {
  it('writes a valid RIFF/WAVE header sized to the samples', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buf = encodeWav(samples, WHISPER_RATE);
    const view = new DataView(buf);
    expect(buf.byteLength).toBe(44 + samples.length * 2);
    expect(str(view, 0, 4)).toBe('RIFF');
    expect(str(view, 8, 4)).toBe('WAVE');
    expect(str(view, 36, 4)).toBe('data');
    expect(view.getUint16(22, true)).toBe(1);            // mono
    expect(view.getUint32(24, true)).toBe(WHISPER_RATE); // sample rate
    expect(view.getUint16(34, true)).toBe(16);           // bits/sample
    expect(view.getUint32(40, true)).toBe(samples.length * 2); // data size
  });

  it('clamps and encodes samples to 16-bit PCM', () => {
    const buf = encodeWav(new Float32Array([1, -1, 0]), WHISPER_RATE);
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getInt16(48, true)).toBe(0);
  });
});

describe('pcmToWav', () => {
  it('downsamples then encodes at 16k', () => {
    const input = new Float32Array(48000).fill(0.25);
    const buf = pcmToWav(input, 48000);
    const view = new DataView(buf);
    expect(view.getUint32(24, true)).toBe(WHISPER_RATE);
    expect(buf.byteLength).toBe(44 + 16000 * 2);
  });
});
