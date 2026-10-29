// The Remote Control link: AnthroDeck's way to the other computer when SSH can't get there (away
// from home, on a hotspot, with no away address). Both ends are Claude Code sessions connected to
// Remote Control, so the traffic is Claude Code's own cross-session messages through Anthropic's
// servers; see mod.ts for the mod that does the carrying and rcpty.ts for how the sessions run.
//
//   Deck app ──HTTP on 127.0.0.1── the Deck's link session ══Remote Control══ the Mac's hub ── watcher
//
// What rides over it is the same watcher the SSH link runs (live.ts), so LiveLink doesn't know the
// difference: `linkSpawner` hands it either an SSH child process or an RcChannel that looks like one.

import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { PassThrough, Writable } from 'stream';
import { HUB_NAME, MOD_FILES, MOD_VERSION, WRAP_PY } from './mod';
import { RCPTY_PY } from './rcpty';
import { remoteExec, remotePython, unreachable } from '../remote';

export { HUB_NAME, MOD_VERSION } from './mod';

const ROOT = () => path.join(os.homedir(), '.anthrodeck', 'rc');

export type RcState = 'off' | 'starting' | 'connected' | 'needs-consent' | 'exited';

// ─── the listing ───────────────────────────────────────────────────────────────

export interface RcPeer { name: string; ref: string; kind: string; status: string }

// Claude Code's ListAgents rows: "  adk-mac [fa1763]  ·  Remote Control  ·  idle".
export function parsePeers(listing: string): RcPeer[] {
  const out: RcPeer[] = [];
  for (const line of listing.split('\n')) {
    const m = /^\s+(.+?) \[([0-9a-f]{4,})\]\s+·\s+([^·]+?)\s+·\s+(\S+)/.exec(line);
    if (m) out.push({ name: m[1], ref: m[2], kind: m[3].trim(), status: m[4] });
  }
  return out;
}

// The hub to talk to: a live Remote Control session named for it (a hub that went offline when
// the Mac slept is listed too, so prefer one that isn't).
export function pickHub(peers: RcPeer[]): string | null {
  const hubs = peers.filter((p) => p.name === HUB_NAME && p.kind === 'Remote Control');
  const hub = hubs.find((p) => p.status !== 'offline') ?? null;
  return hub ? `${hub.name} [${hub.ref}]` : null;
}

// ─── the Deck's link session ───────────────────────────────────────────────────

interface Waiter<T> { resolve: (v: T) => void; timer: ReturnType<typeof setTimeout> }
interface Outgoing { to: string; body: Record<string, unknown> }

export interface DeckRcDeps {
  claudePath: () => string | null;
  spawnPty?: (args: string[], env: NodeJS.ProcessEnv, cwd: string) => ChildProcess;
}

// The Deck's own Claude Code session with Remote Control, started the first time the link is
// needed and kept while the app runs. Talks to the mod in it over a small HTTP server on 127.0.0.1,
// guarded by a token only that session is given.
export class DeckRc {
  private server: http.Server | null = null;
  private url = '';
  private token = randomBytes(16).toString('hex');
  private child: ChildProcess | null = null;
  private queue: Outgoing[] = [];
  private wantPeers = false;
  private poll: http.ServerResponse | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private peerWaiters: Waiter<string | null>[] = [];
  readonly channels = new Map<string, RcChannel>();
  private stopped = false;

  constructor(private deps: DeckRcDeps) {}

  get dir(): string { return path.join(ROOT(), 'deck'); }

  state(): { state: RcState; session?: string } {
    if (!this.child) return { state: 'off' };
    try {
      const s = JSON.parse(fs.readFileSync(path.join(this.dir, 'status.json'), 'utf8')) as { state: RcState; session?: string };
      return s;
    } catch { return { state: 'starting' }; }
  }

  // Starts the session if it isn't running. Resolves once the HTTP side is listening.
  async start(): Promise<void> {
    if (this.stopped) throw new Error('AnthroDeck is stopping.');
    if (!this.server) await this.listen();
    if (this.child) return;
    const claude = this.deps.claudePath();
    if (!claude) throw new Error('Claude Code isn\'t installed on this Deck.');
    const home = path.join(this.dir, 'home');
    fs.mkdirSync(home, { recursive: true });
    const mod = writeMod(path.join(ROOT(), 'mod'));
    try { fs.unlinkSync(path.join(this.dir, 'status.json')); } catch { /* none yet */ }
    const args = ['-u', '-c', RCPTY_PY, this.dir, '--', claude, '--plugin-dir', mod,
      '--remote-control', 'anthrodeck-deck', '--name', 'anthrodeck-deck'];
    const env = { ...process.env, ADK_RC_ROLE: 'deck', ADK_RC_URL: this.url, ADK_RC_TOKEN: this.token };
    const child = (this.deps.spawnPty ?? ((a, e, cwd) => spawn('python3', a, { env: e, cwd, stdio: 'ignore' })))(args, env, home);
    this.child = child;
    child.on('exit', () => { if (this.child === child) this.child = null; });
    child.on('error', () => { if (this.child === child) this.child = null; });
  }

  // Waits for the session to be connected to Remote Control.
  async ready(timeoutMs = 45_000): Promise<void> {
    await this.start();
    const end = Date.now() + timeoutMs;
    for (;;) {
      const s = this.state();
      if (s.state === 'connected') return;
      if (s.state === 'needs-consent') throw new Error('Remote Control needs turning on once: run `claude remote-control` on this Deck and accept.');
      if (Date.now() > end) throw new Error('The Deck\'s Remote Control session didn\'t connect.');
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Claude Code's list of the sessions this one can reach (the other computer's included).
  async peers(timeoutMs = 20_000): Promise<string | null> {
    await this.ready();
    return new Promise((resolve) => {
      const w: Waiter<string | null> = { resolve, timer: setTimeout(() => { this.peerWaiters = this.peerWaiters.filter((x) => x !== w); resolve(null); }, timeoutMs) };
      this.peerWaiters.push(w);
      this.wantPeers = true;
      this.flush();
    });
  }

  send(to: string, body: Record<string, unknown>): void {
    this.queue.push({ to, body });
    this.flush();
  }

  stop(): void {
    this.stopped = true;
    for (const ch of this.channels.values()) ch.kill();
    if (this.poll) { this.poll.end(JSON.stringify({ quit: true })); this.poll = null; }
    this.child?.kill('SIGTERM');
    this.child = null;
    this.server?.close();
    this.server = null;
  }

  private flush(): void {
    const res = this.poll;
    if (!res || (!this.queue.length && !this.wantPeers)) return;
    this.poll = null;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    const msgs = this.queue.splice(0);
    const peers = this.wantPeers;
    this.wantPeers = false;
    res.end(JSON.stringify({ msgs, peers }));
  }

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const a = server.address();
        this.url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
        this.server = server;
        resolve();
      });
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const u = new URL(req.url ?? '/', this.url);
    if (u.searchParams.get('t') !== this.token) { res.statusCode = 403; res.end(); return; }
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && u.pathname === '/out') {
      // A long poll: answered as soon as there's something to send, else empty after 20 s.
      if (this.poll) this.poll.end(JSON.stringify({ msgs: [] }));
      this.poll = res;
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = setTimeout(() => { if (this.poll === res) { this.poll = null; res.end(JSON.stringify({ msgs: [] })); } }, 20_000);
      this.flush();
      return;
    }
    if (req.method === 'POST' && u.pathname === '/in') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (c: string) => { raw += c; });
      req.on('end', () => {
        res.end('{}');
        let m: { kind?: string; listing?: unknown; ch?: unknown; reason?: unknown; body?: Record<string, unknown> };
        try { m = JSON.parse(raw); } catch { return; }
        this.onIn(m);
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  }

  private onIn(m: { kind?: string; listing?: unknown; ch?: unknown; reason?: unknown; body?: Record<string, unknown> }): void {
    if (m.kind === 'peers') {
      const listing = typeof m.listing === 'string' ? m.listing : null;
      for (const w of this.peerWaiters.splice(0)) { clearTimeout(w.timer); w.resolve(listing); }
    } else if (m.kind === 'undelivered' && typeof m.ch === 'string') {
      this.channels.get(m.ch)?.fail(`Remote Control couldn't deliver to the hub (${String(m.reason)}).`);
    } else if (m.kind === 'msg' && m.body && typeof m.body.ch === 'string') {
      this.channels.get(m.body.ch)?.receive(m.body);
    }
  }
}

// The mod's files, written where --plugin-dir can load them. Returns the folder.
export function writeMod(dir: string, files: Record<string, string> = MOD_FILES): string {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) fs.writeFileSync(p, text);
  }
  return dir;
}

// ─── a channel to the hub, shaped like the SSH child process LiveLink expects ──

let channelSeq = 0;

export class RcChannel extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly id = `c${Date.now().toString(36)}${(++channelSeq).toString(36)}`;
  private to: string | null = null;
  private pending = '';
  private ended = false;
  private heard = Date.now();
  private pinger: ReturnType<typeof setInterval> | null = null;

  constructor(private rc: DeckRc, private label: string, private script: string) {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _enc, done) => {
        this.pending += chunk.toString();
        this.sendPending();
        done();
      },
    });
    rc.channels.set(this.id, this);
    void this.open();
  }

  get pid(): undefined { return undefined; }

  // Whole lines go to the hub's watcher; until the hub is found they wait here.
  private sendPending(): void {
    const nl = this.pending.lastIndexOf('\n');
    if (nl < 0 || !this.to) return;
    this.rc.send(this.to, { op: 'in', ch: this.id, data: this.pending.slice(0, nl + 1) });
    this.pending = this.pending.slice(nl + 1);
  }

  private async open(): Promise<void> {
    try {
      const listing = await this.rc.peers();
      if (this.ended) return;
      const hub = listing ? pickHub(parsePeers(listing)) : null;
      if (!hub) {
        this.fail(listing
          ? `Remote Control: the AnthroDeck hub on ${this.label} isn't running. Set it up from Settings at home, and keep ${this.label} awake.`
          : 'Remote Control didn\'t answer.');
        return;
      }
      this.to = hub;
      this.rc.send(hub, { op: 'open', ch: this.id, script: this.script, wrap: WRAP_PY });
      this.sendPending();
      this.heard = Date.now();
      this.pinger = setInterval(() => {
        if (Date.now() - this.heard > 60_000) { this.fail(`Remote Control: lost touch with ${this.label}.`); return; }
        if (this.to) this.rc.send(this.to, { op: 'ping', ch: this.id });
      }, 20_000);
    } catch (e) {
      this.fail(`Remote Control: ${(e as Error).message}`);
    }
  }

  receive(body: Record<string, unknown>): void {
    if (this.ended) return;
    this.heard = Date.now();
    if (typeof body.out === 'string') this.stdout.write(body.out);
    if (body.closed) this.fail(typeof body.error === 'string' && body.error ? `Remote Control: ${body.error}` : null);
  }

  fail(why: string | null): void {
    if (this.ended) return;
    if (why) this.stderr.write(`${why}\n`);
    this.finish();
  }

  kill(): boolean {
    if (!this.ended && this.to) this.rc.send(this.to, { op: 'close', ch: this.id });
    this.finish();
    return true;
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.pinger) clearInterval(this.pinger);
    this.rc.channels.delete(this.id);
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => { this.emit('exit', null, null); this.emit('close', null, null); });
  }
}

// ─── choosing SSH or Remote Control for each connection ────────────────────────

export interface LinkSpawner {
  spawn: (args: string[]) => ChildProcess;
  via: () => 'ssh' | 'rc';
  preferSsh: () => void;
  stop: () => void;
}

export interface LinkSpawnerOpts {
  host: string;
  label: string;
  script: string;                       // the watcher, as the SSH link runs it
  addresses: () => number;              // how many addresses SSH has for this computer
  rc: () => DeckRc | null;              // null: the Remote Control link is off
  onVia?: (via: 'ssh' | 'rc') => void;
  spawnSsh?: (args: string[]) => ChildProcess;
  probe?: () => Promise<boolean>;       // can SSH reach it again?
}

// SSH first. When every address has failed as unreachable (not a refused key or a broken command),
// the next connections go over Remote Control, and once a minute a quick SSH probe checks whether
// it can be reached directly again; when it can, the Remote Control channel is dropped so the
// link reconnects over SSH.
export function linkSpawner(o: LinkSpawnerOpts): LinkSpawner {
  let via: 'ssh' | 'rc' = 'ssh';
  let misses = 0;
  let current: ChildProcess | RcChannel | null = null;
  let prober: ReturnType<typeof setInterval> | null = null;
  const probe = o.probe ?? (async () => (await remoteExec(o.host, 'true', undefined, 8000)).code === 0);
  const set = (v: 'ssh' | 'rc') => {
    if (via === v) return;
    via = v;
    o.onVia?.(v);
    if (v === 'rc' && !prober) {
      prober = setInterval(() => {
        void probe().then((ok) => {
          if (!ok || via !== 'rc') return;
          misses = 0;
          set('ssh');
          current?.kill();
        });
      }, 60_000);
    }
    if (v === 'ssh' && prober) { clearInterval(prober); prober = null; }
  };
  return {
    via: () => via,
    preferSsh() { misses = 0; set('ssh'); },
    stop() { if (prober) clearInterval(prober); prober = null; },
    spawn(args) {
      const rc = o.rc();
      if (via === 'rc' && rc) {
        const ch = new RcChannel(rc, o.label, o.script);
        current = ch;
        return ch as unknown as ChildProcess;
      }
      const child = (o.spawnSsh ?? ((a) => spawn('ssh', a, { stdio: ['pipe', 'pipe', 'pipe'] })))(args);
      current = child;
      let err = '';
      let worked = false;
      child.stdout?.once('data', () => { worked = true; misses = 0; });
      child.stderr?.on('data', (s: Buffer | string) => { err += s.toString(); });
      child.on('close', () => {
        if (worked || !unreachable(err)) return;
        misses += 1;
        if (misses >= o.addresses() && o.rc()) set('rc');
      });
      return child;
    },
  };
}

// ─── the hub on the other computer ─────────────────────────────────────────────

// Writes the mod and the pty driver to the other computer and starts the hub there if it isn't
// running (or is running an older mod). Needs SSH, so it's done at home; the hub then keeps
// running on its own, through the Deck's SSH logins coming and going.
const HUB_PY = String.raw`
import base64, json, os, shutil, signal, subprocess, sys, time
P = json.loads(base64.b64decode(sys.argv[1]).decode())
root = os.path.expanduser('~/.anthrodeck/rc')
mod = os.path.join(root, 'mod'); hub = os.path.join(root, 'hub'); home = os.path.join(hub, 'home')
os.makedirs(home, exist_ok=True)
for rel, text in P['files'].items():
    p = os.path.join(mod, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as f: f.write(text)
with open(os.path.join(root, 'rcpty.py'), 'w') as f: f.write(P['pty'])
def running():
    try:
        pid = int(open(os.path.join(hub, 'pid')).read())
        os.kill(pid, 0); return pid
    except Exception: return None
def version():
    try: return int(open(os.path.join(hub, 'version')).read())
    except Exception: return None
pid = running()
if pid and (P.get('restart') or version() != P['version']):
    os.kill(pid, signal.SIGTERM); time.sleep(1); pid = None
state = 'running'
if not pid:
    env = dict(os.environ, ADK_RC_ROLE='hub')
    log = open(os.path.join(hub, 'log'), 'a')
    argv = [sys.executable, '-u', os.path.join(root, 'rcpty.py'), hub, '--detached', '--',
            P['claude'], '--plugin-dir', mod, '--remote-control', P['name'], '--name', P['name']]
    # On Linux (SteamOS among them) logind ends what an SSH login started when it closes, new
    # session or not: run the hub as a user service there. A Mac leaves a detached process be.
    if sys.platform.startswith('linux') and shutil.which('systemd-run'):
        subprocess.run(['systemctl', '--user', 'stop', 'anthrodeck-hub'], capture_output=True)
        subprocess.run(['systemctl', '--user', 'reset-failed', 'anthrodeck-hub'], capture_output=True)
        argv = ['systemd-run', '--user', '-q', '--unit', 'anthrodeck-hub', '--working-directory=' + home,
                '--setenv=ADK_RC_ROLE=hub'] + argv
    subprocess.Popen(argv, cwd=home, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    with open(os.path.join(hub, 'version'), 'w') as f: f.write(str(P['version']))
    state = 'started'
    for _ in range(40):
        try:
            if json.load(open(os.path.join(hub, 'status.json'))).get('state') in ('connected', 'needs-consent'): break
        except Exception: pass
        time.sleep(0.5)
try: st = json.load(open(os.path.join(hub, 'status.json')))
except Exception: st = {'state': 'starting'}
print(json.dumps({'ok': True, 'hub': state, 'status': st}))
`;

export interface HubResult { ok: boolean; hub: 'running' | 'started'; status: { state: RcState; session?: string } }

export function setupHub(host: string, claudePath: string, restart = false): Promise<HubResult> {
  const payload = { files: MOD_FILES, pty: RCPTY_PY, claude: claudePath, name: HUB_NAME, version: MOD_VERSION, restart };
  return remotePython<HubResult>(host, HUB_PY, [Buffer.from(JSON.stringify(payload)).toString('base64')], 45_000);
}

// Stops the hub on the other computer (Settings → turn the link off).
export function stopHub(host: string): Promise<{ ok: boolean }> {
  return remotePython(host, String.raw`
import json, os, signal
p = os.path.expanduser('~/.anthrodeck/rc/hub/pid')
try: os.kill(int(open(p).read()), signal.SIGTERM)
except Exception: pass
print(json.dumps({'ok': True}))
`);
}
