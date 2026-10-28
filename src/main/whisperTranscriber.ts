import { app } from 'electron';
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// On-device speech-to-text with whisper.cpp's whisper-cli. Chromium's speech API doesn't work inside
// Electron, so this is the only way the app hears the pilot.
//
// The Linux build ships the engine and a small English model in resources/whisper
// (tools/linux/build-whisper.sh), so voice works on the Deck straight from the install. Elsewhere
// it uses a whisper-cli on PATH (macOS: `brew install whisper-cpp`) or ANTHRODECK_WHISPER_CLI, with
// the model downloaded into user data from Settings.

export const MODEL = 'base.en';
const MODEL_FILE = 'ggml-base.en-q5_1.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`;
const MODEL_SHA256 = '4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f';

export interface LocalVoiceStatus {
  available: boolean; // the engine is here
  ready: boolean;     // engine and model both present: transcription will work
  bundled: boolean;   // both came with the install
  model: string;
  reason?: string;
}

const bundledDir = () => path.join(process.resourcesPath ?? '', 'whisper');
const userModel = () => path.join(app.getPath('userData'), 'whisper-models', MODEL_FILE);

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

function engine(): { cli: string | null; model: string | null; bundled: boolean } {
  const cli = path.join(bundledDir(), 'whisper-cli');
  const model = path.join(bundledDir(), MODEL_FILE);
  if (fs.existsSync(cli) && fs.existsSync(model)) return { cli, model, bundled: true };
  return {
    cli: process.env.ANTHRODECK_WHISPER_CLI || onPath('whisper-cli'),
    model: fs.existsSync(userModel()) ? userModel() : null,
    bundled: false,
  };
}

export function getLocalVoiceStatus(): LocalVoiceStatus {
  const e = engine();
  if (!e.cli) {
    return {
      available: false, ready: false, bundled: false, model: MODEL,
      reason: 'No speech engine on this computer. Install whisper.cpp (macOS: brew install whisper-cpp).',
    };
  }
  return {
    available: true, ready: !!e.model, bundled: e.bundled, model: MODEL,
    reason: e.model ? undefined : 'Download the speech model to turn voice on.',
  };
}

// Fetch the model into user data, checked against its known hash.
export async function downloadLocalVoiceModel(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) return { ok: false, message: `Download failed (HTTP ${res.status}).` };
    const data = Buffer.from(await res.arrayBuffer());
    if (crypto.createHash('sha256').update(data).digest('hex') !== MODEL_SHA256) {
      return { ok: false, message: 'The downloaded model didn\'t match its checksum, so it wasn\'t saved.' };
    }
    fs.mkdirSync(path.dirname(userModel()), { recursive: true });
    fs.writeFileSync(`${userModel()}.part`, data);
    fs.renameSync(`${userModel()}.part`, userModel());
    return { ok: true, message: `Downloaded ${MODEL}.` };
  } catch (e) {
    return { ok: false, message: `Download failed: ${(e as Error).message}` };
  }
}

// Transcribe a 16 kHz mono WAV. Returns the text, or null if there's no engine or it failed.
export async function transcribeWav(wav: ArrayBuffer): Promise<string | null> {
  const { cli, model } = engine();
  if (!cli || !model) return null;
  const tmp = path.join(app.getPath('temp'), `anthrodeck_voice_${process.hrtime.bigint()}.wav`);
  try {
    fs.writeFileSync(tmp, Buffer.from(wav));
    const threads = String(Math.max(1, Math.min(4, os.cpus().length)));
    const out = await new Promise<string>((resolve, reject) => {
      execFile(cli, ['-m', model, '-f', tmp, '-l', 'en', '-t', threads, '-nt', '-np'],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    return cleanTranscript(out);
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// whisper output can carry [timestamps], [BLANK_AUDIO]-style tags and blank lines: strip to text.
export function cleanTranscript(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/\[\d{2}:\d{2}[:.]\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}[:.]\d{2}[.,]\d{3}\]/g, ''))
    .map((line) => line.replace(/\[[A-Z_ ]+\]|\([a-z ]+\)/g, ''))
    .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
