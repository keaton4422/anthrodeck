// The Steam games installed on this Deck, for the game menu, and the hand-off that plays one.
//
// Steam runs one game at a time, and AnthroDeck is the one running (a non-Steam shortcut), so a
// Steam game can't start beside it. Playing one is a hand-off instead: AnthroDeck starts a small
// helper as a user service and quits; the helper starts the game once AnthroDeck is gone, and while
// it's played, chimes when a session on the other computer finishes or asks for something; when the
// game ends it starts AnthroDeck again (through Steam, by AnthroDeck's own Steam id), back to Home.
//
// Claude keeps working meanwhile wherever it runs on the other computer (sessions there, and those
// started from the Deck, run on their own: see held.ts). A session running on the Deck itself
// stops when AnthroDeck quits, so the game menu warns first.

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface SteamGame {
  appid: string;
  name: string;
  lastPlayed: number;       // epoch seconds, 0 if never
}

const STEAM_ROOTS = () => [
  path.join(os.homedir(), '.local', 'share', 'Steam'),
  path.join(os.homedir(), '.steam', 'steam'),
];

// Steam's own runtimes and tools are installed like games but aren't ones.
const TOOL = /^(Proton\b|Steam Linux Runtime|Steamworks Common|SteamVR|Steam Audio)/i;

// The "key" "value" pairs of a Valve KeyValues text file, at any depth (enough for these files).
export function vdfPairs(text: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m[1], m[2].replace(/\\\\/g, '\\')]);
  return out;
}

export function parseManifest(text: string): SteamGame | null {
  const kv = new Map<string, string>();
  for (const [k, v] of vdfPairs(text)) if (!kv.has(k)) kv.set(k, v);
  const appid = kv.get('appid');
  const name = kv.get('name');
  const flags = Number(kv.get('StateFlags') ?? 0);
  // StateFlags: 4 fully installed, 2 installed with an update waiting (Steam updates it on launch).
  if (!appid || !name || !(flags & 6) || TOOL.test(name) || appid === '228980') return null;
  return { appid, name, lastPlayed: Number(kv.get('LastPlayed') ?? 0) };
}

export function steamRoot(): string | null {
  return STEAM_ROOTS().find((r) => fs.existsSync(path.join(r, 'steamapps', 'libraryfolders.vdf'))) ?? null;
}

// Every installed game across the Deck's libraries (its own storage and the SD card), most recently
// played first. Empty off a Steam machine.
export function listSteamGames(root = steamRoot()): SteamGame[] {
  if (!root) return [];
  let libs: string[] = [root];
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    libs = [...new Set([root, ...vdfPairs(vdf).filter(([k]) => k === 'path').map(([, v]) => v)])];
  } catch { /* the main library only */ }
  const games = new Map<string, SteamGame>();
  for (const lib of libs) {
    let files: string[] = [];
    try { files = fs.readdirSync(path.join(lib, 'steamapps')).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const g = parseManifest(fs.readFileSync(path.join(lib, 'steamapps', f), 'utf8'));
        if (g) games.set(g.appid, g);
      } catch { /* unreadable manifest: skip it */ }
    }
  }
  return [...games.values()].sort((a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name));
}

// The game's cover (its portrait library capsule, else its header) as a data: URL, or null.
export function steamArt(appid: string, root = steamRoot()): string | null {
  if (!root || !/^\d+$/.test(appid)) return null;
  const dir = path.join(root, 'appcache', 'librarycache', appid);
  const pick = (d: string, depth: number): string | null => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return null; }
    for (const want of ['library_600x900.jpg', 'library_capsule.jpg', 'header.jpg']) {
      if (entries.some((e) => e.isFile() && e.name === want)) return path.join(d, want);
    }
    if (depth > 0) for (const e of entries) if (e.isDirectory()) { const p = pick(path.join(d, e.name), depth - 1); if (p) return p; }
    return null;
  };
  const file = pick(dir, 2);
  if (!file) return null;
  try { return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`; } catch { return null; }
}

// ─── the hand-off ──────────────────────────────────────────────────────────────

export const HANDOFF_PY = String.raw`
import json, math, os, struct, subprocess, sys, time, wave
P = json.loads(sys.argv[1])
def steam(gid):
    subprocess.Popen(['steam', 'steam://rungameid/' + str(gid)], stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
def running(appid):
    r = subprocess.run(['pgrep', '-f', 'SteamLaunch AppId=%s( |$)' % appid], capture_output=True)
    return r.returncode == 0
def alive(pid):
    try: os.kill(pid, 0); return True
    except OSError: return False

# A two-note chime for "a session on your Mac wants you", made once.
CHIME = '/tmp/anthrodeck-chime.wav'
if not os.path.exists(CHIME):
    with wave.open(CHIME, 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
        frames = b''
        for f, dur in ((880, 0.16), (1320, 0.28)):
            n = int(44100 * dur)
            for i in range(n):
                env = min(1, i / 400) * (1 - i / n)
                frames += struct.pack('<h', int(9000 * env * math.sin(2 * math.pi * f * i / 44100)))
        w.writeframes(frames)
def chime(): subprocess.run(['pw-play', CHIME], capture_output=True)

# What the other computer's sessions are doing, over SSH (at home; away, nothing to hear).
SNAP = r'''
import glob, json, os
reg = os.path.expanduser('~/.claude/sessions'); rel = os.path.expanduser('~/.anthrodeck/relay/req')
out = {}
for f in glob.glob(os.path.join(reg, '*.json')):
    try: e = json.load(open(f))
    except Exception: continue
    if e.get('sessionId'): out[e['sessionId']] = e.get('status') or 'idle'
print(json.dumps({'s': out, 'asks': len(glob.glob(os.path.join(rel, '*.json')))}))
'''
def snapshot():
    if not P.get('host'): return None
    try:
        r = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', P['host'], 'python3 -c ' + json.dumps(SNAP)],
                           capture_output=True, text=True, timeout=20)
        return json.loads(r.stdout) if r.returncode == 0 else None
    except Exception: return None

# 1. AnthroDeck quits; 2. the game starts; 3. while it runs, chime on news; 4. back to AnthroDeck.
for _ in range(60):
    if not alive(P['pid']): break
    time.sleep(0.5)
time.sleep(1.5)
steam(P['game'])
for _ in range(120):
    if running(P['game']): break
    time.sleep(1)
last = snapshot()
while running(P['game']):
    time.sleep(15)
    now = snapshot()
    if now and last:
        finished = any(st != 'busy' and last['s'].get(sid) == 'busy' for sid, st in now['s'].items())
        if finished or now['asks'] > last['asks']: chime()
    if now: last = now
# Steam takes a few seconds to let go of a game that was just quit, and drops a launch asked for
# meanwhile: ask again until AnthroDeck is running (a minute at most).
time.sleep(3)
for _ in range(12):
    steam(P['back'])
    for _ in range(10):
        time.sleep(0.5)
        if running(P['backApp']): sys.exit(0)
    time.sleep(1)
`;

// `back` is AnthroDeck's Steam game id (to launch it again), `backApp` its app id (to see it running).
export interface HandoffOpts { game: string; back: string; backApp: string; host: string | null; pid: number }

// Starts the hand-off helper as a user service (so it outlives AnthroDeck); the caller then quits.
export function startHandoff(o: HandoffOpts): void {
  const args = ['--user', '-q', '--unit', `anthrodeck-handoff-${Date.now()}`, 'python3', '-u', '-c', HANDOFF_PY, JSON.stringify(o)];
  spawn('systemd-run', args, { detached: true, stdio: 'ignore' }).unref();
}

// Whether this AnthroDeck can hand off to a Steam game: launched by Steam on a systemd Linux.
export function canHandoff(): { ok: boolean; back: string | null; backApp: string | null } {
  const back = process.env.SteamGameId ?? null;
  const backApp = process.env.SteamAppId ?? null;
  return { ok: process.platform === 'linux' && !!back && !!backApp && fs.existsSync('/usr/bin/systemd-run'), back, backApp };
}
