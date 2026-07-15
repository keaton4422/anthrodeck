// Pure audio helpers for the local-voice pipeline: downsample captured mic PCM to 16 kHz mono and
// encode it as a 16-bit WAV. whisper.cpp wants 16 kHz mono WAV, and doing the conversion in JS
// avoids an ffmpeg dependency. Pure + unit-tested.

export const WHISPER_RATE = 16000;

// Linear-average downsample from an arbitrary input rate to a target rate. Returns the input
// untouched when already at (or below) the target.
export function downsample(input: Float32Array, inputRate: number, targetRate = WHISPER_RATE): Float32Array {
  if (targetRate <= 0 || inputRate <= 0) return input;
  if (inputRate <= targetRate) return input;
  const ratio = inputRate / targetRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) { sum += input[j]; count++; }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

function clamp(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

// Encode mono float samples [-1,1] as a 16-bit PCM WAV. Returns the full file as an ArrayBuffer.
export function encodeWav(samples: Float32Array, sampleRate = WHISPER_RATE): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);      // fmt chunk size
  view.setUint16(20, 1, true);       // PCM
  view.setUint16(22, 1, true);       // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = clamp(samples[i]);
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

// Convenience: downsample then encode in one step.
export function pcmToWav(input: Float32Array, inputRate: number): ArrayBuffer {
  return encodeWav(downsample(input, inputRate), WHISPER_RATE);
}
