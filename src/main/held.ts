// Mac sessions that outlive the connection. A session the Deck starts on the remote computer used to
// run as the SSH command itself, so a hotspot dropping out, a tunnel, or putting the Deck to sleep
// killed Claude partway through its turn. Now Claude runs there under a small holder that's detached
// from SSH: its input and output go through files (~/.anthrodeck/held/<id>/in and out), and SSH just
// carries them. When the link drops, Claude keeps working; the Deck reattaches when it can, picks
// the output up where it left off, and resends any input that didn't make it.
//
// To the Agent SDK this is one ordinary process (its spawnClaudeCodeProcess hook): the reconnects
// happen underneath.

import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'stream';
import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { addressFailed, addressWorked, forwardedEnv, remoteClaudeCommand, remoteExec, shq, sshArgs, sshProblem, unreachable } from './remote';

// Runs on the remote computer. `start <id> <cmd>` starts the holder (detached, in its own session)
// and attaches; `attach <id> <offset>` streams the output from that byte and appends what comes in
// to the input; `stop <id> <bytes>` closes Claude's input once it has read that much; `kill <id>
// <signal>` signals Claude. An attach prints `@@adk in=<bytes>` first (how much input arrived, so the
// Deck resends the rest) and `@@adk exit=<code>` when Claude has exited and all its output is sent.
export const HOLD_PY = String.raw`
import os, sys, time, signal, subprocess, threading, shutil
ROOT = os.path.expanduser('~/.anthrodeck/held')
IDLE = 12 * 3600
op, rid = sys.argv[1], sys.argv[2]
d = os.path.join(ROOT, rid)
def p(n): return os.path.join(d, n)
def read(n):
    try:
        with open(p(n)) as f: return f.read().strip()
    except Exception: return None
def write(n, v):
    with open(p(n) + '.tmp', 'w') as f: f.write(str(v))
    os.replace(p(n) + '.tmp', p(n))
def touch(n):
    with open(p(n), 'a'): pass
    os.utime(p(n), None)

def hold(cmd):
    out = open(p('out'), 'ab', buffering=0)
    err = open(p('err'), 'ab', buffering=0)
    try:
        proc = subprocess.Popen(['/bin/sh', '-c', cmd], stdin=subprocess.PIPE, stdout=out, stderr=err)
    except Exception as e:
        err.write(str(e).encode()); write('exit', 127); return
    write('pid', proc.pid)
    def feed():
        got = 0
        with open(p('in'), 'rb', buffering=0) as f:
            while proc.poll() is None:
                b = f.read(65536)
                if b:
                    got += len(b)
                    try: proc.stdin.write(b); proc.stdin.flush()
                    except Exception: return
                    continue
                stop = read('stop')
                if stop is not None and got >= int(stop): break
                if not os.path.isdir(d): break       # cleaned up from under it
                try:
                    # Nobody has looked in for half a day: let Claude finish and end.
                    if time.time() - os.path.getmtime(p('alive')) > IDLE: break
                except Exception: pass
                time.sleep(0.05)
        try: proc.stdin.close()
        except Exception: pass
    threading.Thread(target=feed, daemon=True).start()
    write('exit', proc.wait())

def attach(pos):
    if not os.path.isdir(d):
        sys.stdout.write('@@adk gone\n'); sys.stdout.flush(); return
    me = str(os.getpid())
    write('attach', me)          # one connection at a time: an older, dead one stops
    touch('alive')
    sys.stdout.write('@@adk in=%d\n' % os.path.getsize(p('in'))); sys.stdout.flush()
    def pump():
        with open(p('in'), 'ab', buffering=0) as f:
            while True:
                b = os.read(0, 65536)
                if not b or read('attach') != me: return
                f.write(b)
    threading.Thread(target=pump, daemon=True).start()
    o = sys.stdout.buffer
    last = 0
    with open(p('out'), 'rb', buffering=0) as f:
        f.seek(pos)
        while read('attach') == me:
            now = time.time()
            if now - last > 5: touch('alive'); last = now
            b = f.read(65536)
            if b: o.write(b); o.flush(); continue
            if os.path.exists(p('exit')):
                b = f.read()
                if b: o.write(b); o.flush(); continue
                code = read('exit') or '1'
                if code != '0':
                    try:
                        with open(p('err'), 'rb') as e: sys.stderr.buffer.write(e.read()[-4000:]); sys.stderr.flush()
                    except Exception: pass
                o.write(b'\n@@adk exit=' + code.encode() + b'\n'); o.flush()
                return
            time.sleep(0.05)

if op == 'start':
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        try:
            if time.time() - os.path.getmtime(os.path.join(ROOT, old, 'exit')) > 86400:
                shutil.rmtree(os.path.join(ROOT, old), ignore_errors=True)
        except Exception: pass
    if not os.path.isdir(d):
        os.makedirs(d)
        for n in ('in', 'out', 'err'): open(p(n), 'ab').close()
        touch('alive')
        if os.fork() == 0:
            os.setsid()
            if os.fork() == 0:
                n = os.open(os.devnull, os.O_RDWR)
                for fd in (0, 1, 2): os.dup2(n, fd)
                try: hold(sys.argv[3])
                finally: os._exit(0)
            os._exit(0)
        os.wait()
    attach(0)
elif op == 'attach':
    attach(int(sys.argv[3]))
elif op == 'stop':
    if os.path.isdir(d): write('stop', sys.argv[3])
elif op == 'kill':
    pid = read('pid')
    try: os.kill(int(pid), getattr(signal, sys.argv[3], signal.SIGTERM))
    except Exception: pass
`;

export const holdCommand = (op: string, id: string, arg: string) => `python3 -u -c ${shq(HOLD_PY)} ${op} ${id} ${shq(arg)}`;

export type LinkState = 'reconnecting' | 'connected';

export interface HeldDeps {
  // Starts `ssh <args>`; tests run the command locally instead.
  spawnSsh?: (args: string[]) => ChildProcess;
  exec?: (host: string, command: string) => Promise<{ code: number }>;
  onLink?: (state: LinkState) => void;
  signal?: AbortSignal;
}

const CONTROL = Buffer.from('@@adk ');
const MAX_DELAY = 10_000;

// Every held process this run, so waking the Deck can reconnect them all at once.
const held = new Set<HeldProcess>();
export function reconnectHeld(): void { for (const h of held) h.reconnectNow(); }

export class HeldProcess extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  private child: ChildProcess | null = null;
  private started = false;          // the holder exists there: reconnect with attach, not start
  private ready = false;            // this connection said how much input arrived: input can flow
  private unacked = Buffer.alloc(0); // input from byte `base` on, not yet known to have arrived
  private base = 0;
  private outPos = 0;               // output bytes passed on to the SDK
  private buf = Buffer.alloc(0);
  private stopAt: number | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private delay = 1000;
  private quick = false;
  private done = false;
  private lost = false;
  private errText = '';

  constructor(readonly host: string, readonly id: string, private cmd: string, private deps: HeldDeps = {}) {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer, _enc, cb) => {
        this.unacked = Buffer.concat([this.unacked, chunk]);
        if (this.ready) this.child?.stdin?.write(chunk);
        cb();
      },
      // The SDK is done with the session: Claude's input closes once all of it has arrived.
      final: (cb) => { this.stopAt = this.base + this.unacked.length; this.sendStop(); cb(); },
    });
    deps.signal?.addEventListener('abort', () => this.kill('SIGTERM'));
    held.add(this);
    this.connect();
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.done) return false;
    this.killed = true;
    if (this.started) void this.exec(holdCommand('kill', this.id, signal));
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.child) this.child.kill();
    else this.finish(null, signal);
    return true;
  }

  // The Deck just woke, or the network changed: don't wait out the backoff (or a connection that
  // went stale while asleep), reattach now. Picks up exactly where it left off.
  reconnectNow(): void {
    if (this.done || !this.started) return;
    this.delay = 1000;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; this.connect(); }
    else if (this.child) { this.quick = true; this.child.kill(); }
  }

  private exec(command: string) {
    return (this.deps.exec ?? remoteExec)(this.host, command).catch(() => ({ code: 1 }));
  }

  private sendStop(): void {
    if (this.stopAt === null) return;
    if (!this.started) { if (!this.child) this.finish(0, null); return; }
    const at = this.stopAt;
    void this.exec(holdCommand('stop', this.id, String(at))).then((r) => { if (r.code === 0 && this.stopAt === at) this.stopAt = null; });
  }

  private connect(): void {
    this.retry = null;
    if (this.done) return;
    this.ready = false;
    this.buf = Buffer.alloc(0);
    this.errText = '';
    const command = this.started ? holdCommand('attach', this.id, String(this.outPos)) : holdCommand('start', this.id, this.cmd);
    const args = sshArgs(this.host, command);
    const child = (this.deps.spawnSsh ?? ((a) => spawn('ssh', a, { stdio: ['pipe', 'pipe', 'pipe'] })))(args);
    this.child = child;
    child.stdin?.on('error', () => { /* the link dropped; close handles it */ });
    child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
    child.stderr?.on('data', (s: Buffer) => { this.errText = (this.errText + s.toString()).slice(-4000); });
    child.on('error', (e) => { this.errText += e.message; });
    child.on('close', (code) => this.onClose(child, code));
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    let nl: number;
    while ((nl = this.buf.indexOf(10)) >= 0) {
      const line = this.buf.subarray(0, nl);
      this.buf = this.buf.subarray(nl + 1);
      if (line.subarray(0, CONTROL.length).equals(CONTROL)) this.onControl(line.subarray(CONTROL.length).toString());
      else if (this.ready) {
        this.outPos += line.length + 1;
        if (line.length) this.stdout.write(Buffer.concat([line, Buffer.from('\n')]));
      }
    }
  }

  private onControl(msg: string): void {
    const inBytes = /^in=(\d+)$/.exec(msg);
    if (inBytes) {
      // Through. The holder has the first N bytes of input; send it the rest.
      addressWorked(this.host);
      this.started = true;
      this.ready = true;
      this.delay = 1000;
      const n = Number(inBytes[1]);
      if (n > this.base) { this.unacked = this.unacked.subarray(Math.min(this.unacked.length, n - this.base)); this.base = n; }
      if (this.unacked.length) this.child?.stdin?.write(this.unacked);
      if (this.lost) { this.lost = false; this.deps.onLink?.('connected'); }
      if (this.stopAt !== null) this.sendStop();
      return;
    }
    const exit = /^exit=(-?\d+)$/.exec(msg);
    if (exit) { this.finish(Number(exit[1]), null); return; }
    if (msg === 'gone') {
      this.stderr.write('That session is gone from the other computer (it restarted, or the session was cleaned up).\n');
      this.finish(1, null);
    }
  }

  private onClose(child: ChildProcess, code: number | null): void {
    if (this.child !== child) return;
    this.child = null;
    this.ready = false;
    if (this.done) return;
    if (this.killed) { this.finish(null, 'SIGTERM'); return; }
    const away = unreachable(this.errText);
    const another = away && addressFailed(this.host);
    if (!this.started && !another) {
      // Never got going (no key, no python3, nothing at either address): fail like a process
      // that couldn't start, so the cockpit says why.
      this.stderr.write(`${sshProblem(this.errText) ?? this.errText.trim()}\n`);
      this.finish(code ?? 1, null);
      return;
    }
    // A deliberate reconnect (the Deck woke) usually takes a moment: say nothing unless it fails.
    if (!this.lost && !this.quick) { this.lost = true; this.deps.onLink?.('reconnecting'); }
    const wait = this.quick || another ? 0 : this.delay;
    this.quick = false;
    if (!another) this.delay = Math.min(this.delay * 2, MAX_DELAY);
    this.retry = setTimeout(() => this.connect(), wait);
  }

  private finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.done) return;
    this.done = true;
    held.delete(this);
    if (this.retry) clearTimeout(this.retry);
    this.exitCode = code;
    this.signalCode = signal;
    if (this.lost) this.deps.onLink?.('connected');
    this.stdout.end();
    this.stderr.end();
    this.emit('exit', code, signal);
  }
}

// The SDK's spawnClaudeCodeProcess hook, pointed at the remote computer. The SDK's own command and
// cwd are local notions; the remote side gets its Claude path and the project folder instead.
export function remoteSpawner(host: string, claudePath: string, cwd: string, onLink?: (s: LinkState) => void) {
  return (opts: { args: string[]; env: Record<string, string | undefined>; signal?: AbortSignal }): HeldProcess => {
    // ANTHRODECK_SESSION: this session's prompts already come to the Deck, so the live relay
    // (main/live.ts) leaves them alone.
    const cmd = remoteClaudeCommand(claudePath, cwd, opts.args, { ...forwardedEnv(opts.env), ANTHRODECK_SESSION: '1' });
    return new HeldProcess(host, randomBytes(8).toString('hex'), cmd, { onLink, signal: opts.signal });
  };
}
