// Pings while a Steam game is on screen (main/beside.ts): a chime, and a line saying why, when a
// session starts waiting on the pilot or finishes its turn. From the main process, so it doesn't
// depend on the hidden window's renderer: the sound plays through PipeWire (pw-play).

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LiveState } from './live';

export interface Heard { asks: Set<string>; busy: Set<string> }

// What's new since `before`: a new question or approval, else a session that stopped working.
export function news(before: Heard | null, st: LiveState): { heard: Heard; ping: string | null } {
  const heard: Heard = {
    asks: new Set(st.requests.map((r) => r.id)),
    busy: new Set(st.live.filter((s) => s.status === 'busy').map((s) => s.sessionId)),
  };
  if (!before) return { heard, ping: null };
  const name = (id: string) => st.live.find((s) => s.sessionId === id)?.name || 'A session';
  const asked = st.requests.find((r) => !before.asks.has(r.id));
  if (asked) return { heard, ping: `${name(asked.sessionId)} needs you` };
  const done = [...before.busy].find((id) => !heard.busy.has(id) && st.live.some((s) => s.sessionId === id));
  return { heard, ping: done ? `${name(done)} finished` : null };
}

// A two-note chime, written once as a WAV.
function chimeFile(): string {
  const file = path.join(os.tmpdir(), 'anthrodeck-chime.wav');
  if (fs.existsSync(file)) return file;
  const rate = 44100;
  const notes: [number, number][] = [[880, 0.16], [1320, 0.28]];
  const samples: number[] = [];
  for (const [f, dur] of notes) {
    const n = Math.floor(rate * dur);
    for (let i = 0; i < n; i++) samples.push(Math.round(9000 * Math.min(1, i / 400) * (1 - i / n) * Math.sin(2 * Math.PI * f * i / rate)));
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}

export function chime(): void {
  try { execFile('pw-play', [chimeFile()], () => { /* no PipeWire: nothing to hear */ }); } catch { /* same */ }
}
