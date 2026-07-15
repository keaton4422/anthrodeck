import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// Local speech-to-text via whisper.cpp (nodejs-whisper). The native module is intentionally NOT a
// hard dependency — it's require()'d lazily so a machine without the compiled binary (or without
// the model) still builds and runs, falling back to Web Speech in the renderer. Enabling it on the
// Steam Deck is a documented one-time step (see README).

const MODEL = 'base.en';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let whisperMod: any = null;
let triedRequire = false;

function loadWhisper(): unknown {
  if (triedRequire) return whisperMod;
  triedRequire = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    whisperMod = require('nodejs-whisper');
  } catch {
    whisperMod = null;
  }
  return whisperMod;
}

export interface LocalVoiceStatus {
  available: boolean; // native module resolvable
  ready: boolean;     // module + model both present -> transcription will work
  model: string;
  reason?: string;
}

function modelDir(): string {
  return path.join(app.getPath('userData'), 'whisper-models');
}

function modelPresent(): boolean {
  try {
    const dir = modelDir();
    return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.includes(MODEL) && f.endsWith('.bin'));
  } catch {
    return false;
  }
}

export function getLocalVoiceStatus(): LocalVoiceStatus {
  const mod = loadWhisper();
  if (!mod) {
    return {
      available: false,
      ready: false,
      model: MODEL,
      reason: 'nodejs-whisper native module not installed (see README: Local voice on Steam Deck).',
    };
  }
  const ready = modelPresent();
  return {
    available: true,
    ready,
    model: MODEL,
    reason: ready ? undefined : 'Model not downloaded yet — use "Download local voice".',
  };
}

// Download the base.en model into userData. Uses whatever downloader the installed nodejs-whisper
// exposes; tolerant of API differences across versions.
export async function downloadLocalVoiceModel(): Promise<{ ok: boolean; message: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = loadWhisper() as any;
  if (!mod) {
    return { ok: false, message: 'Install the nodejs-whisper native module first (see README).' };
  }
  try {
    fs.mkdirSync(modelDir(), { recursive: true });
    if (typeof mod.downloadModel === 'function') {
      await mod.downloadModel(MODEL, modelDir());
    } else if (typeof mod.nodewhisper === 'function') {
      // Some versions auto-download on first transcription; trigger via the autoDownload option.
      // A tiny silent wav is enough to make it fetch the model.
      const probe = path.join(modelDir(), '_probe.wav');
      fs.writeFileSync(probe, Buffer.alloc(44));
      await mod.nodewhisper(probe, { modelName: MODEL, autoDownloadModelName: MODEL });
      try { fs.unlinkSync(probe); } catch { /* ignore */ }
    } else {
      return { ok: false, message: 'Installed nodejs-whisper has no known download entry point.' };
    }
    return modelPresent()
      ? { ok: true, message: `Downloaded ${MODEL}.` }
      : { ok: false, message: 'Download finished but the model file was not found.' };
  } catch (e) {
    return { ok: false, message: `Download failed: ${(e as Error).message}` };
  }
}

// Transcribe a 16 kHz mono WAV buffer. Returns the text, or null if local voice is unavailable /
// failed (renderer then falls back to Web Speech).
export async function transcribeWav(wav: ArrayBuffer): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = loadWhisper() as any;
  if (!mod || typeof mod.nodewhisper !== 'function' || !modelPresent()) return null;

  const tmp = path.join(app.getPath('temp'), `anthrodeck_voice_${process.hrtime.bigint()}.wav`);
  try {
    fs.writeFileSync(tmp, Buffer.from(wav));
    const result = await mod.nodewhisper(tmp, {
      modelName: MODEL,
      autoDownloadModelName: MODEL,
      whisperOptions: { outputInText: false, splitOnWord: true },
    });
    return cleanTranscript(typeof result === 'string' ? result : String(result ?? ''));
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// whisper output often carries [timestamps] and blank lines — strip to plain text.
export function cleanTranscript(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/\[\d{2}:\d{2}[:.]\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}[:.]\d{2}[.,]\d{3}\]/g, ''))
    .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
