// Live sessions on the remote computer: the Claude Code sessions running there right now (in the
// Claude desktop app, a terminal, anywhere), and their approvals and questions answered from the Deck.
//
// Two pieces run on that computer, both small python3 scripts:
//
//   * The relay, a Claude Code PermissionRequest hook installed into ~/.claude/settings.json (only
//     when the pilot presses Install). When Claude Code is about to ask for permission or ask a
//     question, the hook runs alongside the normal prompt: if the Deck is connected it posts the
//     request to ~/.anthrodeck/relay/req and waits for an answer. Whichever answers first wins, the
//     Deck or the window on that computer, so nothing there is blocked. With the Deck away the hook
//     returns at once and Claude Code behaves exactly as before.
//
//   * The watcher, started over SSH while the Deck app runs. It keeps the relay's "Deck connected"
//     heartbeat fresh, reports the live sessions (Claude Code's own registry in ~/.claude/sessions)
//     and the waiting requests as JSON lines, and writes the Deck's answers back.
//
// The builders here are pure so they unit-test; LiveLink (bottom) does the I/O.

import { spawn, type ChildProcess } from 'child_process';
import type { ChoiceKind, ChoiceOption } from './engine/session';
import { toolLabel } from './engine/tools';
import { remotePython, shq, sshArgs, sshProblem } from './remote';

export const RELAY_VERSION = 1;

// ─── what the watcher reports ─────────────────────────────────────────────────

export interface LiveSession {
  sessionId: string;
  name: string | null;        // the session's title (the desktop app names them)
  cwd: string;
  status: 'busy' | 'idle' | string;
  entrypoint: string | null;  // 'claude-desktop', 'cli', 'sdk-ts', …
  updatedAt: number;
}

export interface LiveRequest {
  id: string;
  sessionId: string;
  cwd: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  suggestions: unknown[];     // Claude Code's offered "always allow" rules, passed back as-is
  ts: number;
}

export interface LiveState {
  live: LiveSession[];
  requests: LiveRequest[];
  relay: number | null;       // installed relay version, or null
}

export function parseLiveLine(line: string): LiveState | null {
  let d: unknown;
  try { d = JSON.parse(line); } catch { return null; }
  if (!d || typeof d !== 'object') return null;
  const o = d as Partial<LiveState>;
  if (!Array.isArray(o.live) || !Array.isArray(o.requests)) return null;
  return { live: o.live, requests: o.requests, relay: typeof o.relay === 'number' ? o.relay : null };
}

// ─── turning a request into cards for the pilot, and the answers into a decision ─

export type RelayDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string };

export interface LiveCard { kind: ChoiceKind; question: string; detail?: string; options: ChoiceOption[] }

export interface LivePrompt {
  cards: LiveCard[];
  // The pilot's pick on each card, in order -> what the relay hands Claude Code.
  decide(picks: string[]): RelayDecision;
}

const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

// "MacBook-Pro · Fix the login bug" (or the project folder when the session has no title).
export function liveWhere(label: string, req: LiveRequest, live: LiveSession[]): string {
  const s = live.find((x) => x.sessionId === req.sessionId);
  return `${label} · ${s?.name || folder(req.cwd)}`;
}

export function livePrompt(req: LiveRequest, where: string): LivePrompt {
  const input = req.toolInput ?? {};

  if (req.toolName === 'AskUserQuestion') {
    const qs = (Array.isArray(input.questions) ? input.questions as Record<string, unknown>[] : [])
      .map((q) => ({
        text: String(q.question ?? ''),
        options: (Array.isArray(q.options) ? q.options as Record<string, unknown>[] : []).slice(0, 4)
          .map((o) => ({ label: String(o.label ?? ''), value: String(o.label ?? ''), description: String(o.description ?? '') }))
          .filter((o) => o.label),
      }))
      .filter((q) => q.text && q.options.length);
    return {
      cards: qs.map((q) => ({ kind: 'question', question: q.text, detail: where, options: q.options })),
      decide: (picks) => ({
        behavior: 'allow',
        updatedInput: { ...input, answers: Object.fromEntries(qs.map((q, i) => [q.text, picks[i] ?? q.options[0].value])) },
      }),
    };
  }

  if (req.toolName === 'ExitPlanMode') {
    const plan = String(input.plan ?? '').trim();
    return {
      cards: [{
        kind: 'plan',
        question: 'Plan ready. Start building?',
        detail: `${where}\n\n${plan.length > 1800 ? `${plan.slice(0, 1800)}…` : plan}`,
        options: [
          { label: 'Start · Auto-accept edits (edits land on their own)', value: 'acceptEdits' },
          { label: 'Start · Ask permissions (approve each edit)', value: 'default' },
          { label: 'Keep planning', value: 'no' },
        ],
      }],
      decide: ([pick]) => pick === 'acceptEdits' || pick === 'default'
        ? { behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode: pick, destination: 'session' }] }
        : { behavior: 'deny', message: 'The pilot wants to keep planning. Ask what to change.' },
    };
  }

  const options: ChoiceOption[] = [
    { label: 'Allow', value: 'allow' },
    { label: 'Deny', value: 'deny' },
  ];
  const always = Array.isArray(req.suggestions) && req.suggestions.length > 0;
  if (always) options.push({ label: 'Always allow this session', value: 'always' });
  const description = typeof input.description === 'string' ? input.description : '';
  return {
    cards: [{
      kind: 'approval',
      question: description || `Claude wants to use ${req.toolName}`,
      detail: `${where}\n${toolLabel(req.toolName, input, req.cwd)}`,
      options,
    }],
    decide: ([pick]) => {
      if (pick === 'allow') return { behavior: 'allow' };
      if (pick === 'always' && always) return { behavior: 'allow', updatedPermissions: req.suggestions };
      return { behavior: 'deny', message: 'The pilot denied this from the Deck.' };
    },
  };
}

// ─── scripts that run on the remote computer ──────────────────────────────────

// The hook. `permission` holds a PermissionRequest for the Deck while the Deck is connected.
export const RELAY_PY = String.raw`# AnthroDeck relay v${RELAY_VERSION}: lets the AnthroDeck app on your Steam Deck answer Claude Code's
# permission prompts and questions. Installed and removed from AnthroDeck's Settings. With the
# Deck away it exits at once, so Claude Code behaves exactly as without it.
import json, os, signal, sys, time, uuid
ROOT = os.environ.get('ANTHRODECK_RELAY_ROOT') or os.path.expanduser('~/.anthrodeck/relay')
FRESH = 10      # seconds: the Deck's watcher touches 'online' every second

def online():
    try: return time.time() - os.path.getmtime(os.path.join(ROOT, 'online')) < FRESH
    except OSError: return False

def tool_use_id(d):
    # The tool_use this prompt is about, from the end of the transcript, to notice when the
    # prompt gets answered on this computer instead.
    try:
        with open(d['transcript_path'], 'rb') as fh:
            fh.seek(0, 2); size = fh.tell(); fh.seek(max(0, size - 512 * 1024))
            lines = fh.read().splitlines()
    except Exception:
        return None
    for raw in reversed(lines):
        try: e = json.loads(raw)
        except Exception: continue
        if e.get('type') != 'assistant': continue
        for b in reversed((e.get('message') or {}).get('content') or []):
            if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('name') == d.get('tool_name') and b.get('input') == d.get('tool_input'):
                return b.get('id')
    return None

def answered_here(path, offset, tid):
    try:
        with open(path, 'rb') as fh:
            fh.seek(offset)
            return tid.encode() in fh.read()
    except Exception:
        return False

def permission(d):
    # Sessions the Deck itself is driving already bring their prompts to the Deck.
    if not online() or os.environ.get('ANTHRODECK_SESSION'): return
    rid = uuid.uuid4().hex
    req = os.path.join(ROOT, 'req', rid + '.json')
    ans = os.path.join(ROOT, 'ans', rid + '.json')
    os.makedirs(os.path.dirname(req), exist_ok=True)
    os.makedirs(os.path.dirname(ans), exist_ok=True)
    def cleanup(*_):
        for p in (req, ans):
            try: os.remove(p)
            except OSError: pass
    def bye(*_):
        cleanup(); os._exit(0)
    for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP): signal.signal(s, bye)
    path = d.get('transcript_path') or ''
    try: offset = os.path.getsize(path)
    except OSError: offset = 0
    tid = tool_use_id(d)
    tmp = req + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump({'id': rid, 'pid': os.getpid(), 'sessionId': d.get('session_id'), 'cwd': d.get('cwd'),
                   'toolName': d.get('tool_name'), 'toolInput': d.get('tool_input') or {},
                   'suggestions': d.get('permission_suggestions') or [], 'ts': int(time.time() * 1000)}, fh)
    os.replace(tmp, req)
    try:
        deadline = time.time() + 590
        while time.time() < deadline:
            if os.path.exists(ans):
                with open(ans) as fh: decision = json.load(fh)['decision']
                print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PermissionRequest', 'decision': decision}}))
                return
            if not online(): return
            if tid and answered_here(path, offset, tid): return
            time.sleep(0.3)
    finally:
        cleanup()

if __name__ == '__main__':
    try: d = json.load(sys.stdin)
    except Exception: sys.exit(0)
    if sys.argv[1:2] == ['permission']: permission(d)
`;

// Runs for as long as the Deck is connected: heartbeat, state lines out, answers in.
export const WATCH_PY = String.raw`
import glob, json, os, re, select, signal, sys, time
ROOT = os.environ.get('ANTHRODECK_RELAY_ROOT') or os.path.expanduser('~/.anthrodeck/relay')
REG = os.path.join(os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude'), 'sessions')
for d in ('req', 'ans'): os.makedirs(os.path.join(ROOT, d), exist_ok=True)
ONLINE = os.path.join(ROOT, 'online')

def bye(*_):
    try: os.remove(ONLINE)
    except OSError: pass
    os._exit(0)
for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP): signal.signal(s, bye)

def alive(pid):
    try: os.kill(int(pid), 0); return True
    except PermissionError: return True
    except Exception: return False

def load(p):
    try:
        with open(p) as fh: return json.load(fh)
    except Exception: return None

def relay_version():
    try:
        with open(os.path.join(ROOT, 'relay.py')) as fh: m = re.search(r'AnthroDeck relay v(\d+)', fh.read(200))
        return int(m.group(1)) if m else None
    except OSError: return None

last, last_at = None, 0
while True:
    with open(ONLINE, 'a'): pass
    os.utime(ONLINE, None)
    live = []
    for f in glob.glob(os.path.join(REG, '*.json')):
        e = load(f)
        if not e or not e.get('sessionId') or not alive(e.get('pid', 0)): continue
        live.append({'sessionId': e['sessionId'], 'name': e.get('name'), 'cwd': e.get('cwd') or '',
                     'status': e.get('status') or 'idle', 'entrypoint': e.get('entrypoint'),
                     'updatedAt': e.get('updatedAt') or e.get('startedAt') or 0})
    live.sort(key=lambda s: -s['updatedAt'])
    reqs = []
    for f in glob.glob(os.path.join(ROOT, 'req', '*.json')):
        r = load(f)
        if not r: continue
        if not alive(r.get('pid', 0)):
            try: os.remove(f)
            except OSError: pass
            continue
        r.pop('pid', None); reqs.append(r)
    reqs.sort(key=lambda r: r.get('ts', 0))
    out = json.dumps({'live': live, 'requests': reqs, 'relay': relay_version()}, sort_keys=True)
    if out != last or time.time() - last_at > 15:
        sys.stdout.write(out + '\n'); sys.stdout.flush()
        last, last_at = out, time.time()
    if select.select([sys.stdin], [], [], 1.0)[0]:
        line = sys.stdin.readline()
        if not line: bye()
        try: cmd = json.loads(line)
        except Exception: continue
        if cmd.get('op') == 'answer' and re.fullmatch(r'[0-9a-f]{32}', str(cmd.get('id'))):
            p = os.path.join(ROOT, 'ans', cmd['id'] + '.json')
            with open(p + '.tmp', 'w') as fh: json.dump({'decision': cmd['decision']}, fh)
            os.replace(p + '.tmp', p)
`;

// Installs or removes the relay: the script, plus one PermissionRequest hook in Claude Code's user
// settings (marked, so removal touches nothing else; the original file is backed up once).
export const SETUP_PY = String.raw`
import json, os, shutil, sys
op = sys.argv[1]
ROOT = os.environ.get('ANTHRODECK_RELAY_ROOT') or os.path.expanduser('~/.anthrodeck/relay')
RELAY = os.path.join(ROOT, 'relay.py')
SETTINGS = os.path.join(os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude'), 'settings.json')
MARK = '# added by AnthroDeck'
try:
    with open(SETTINGS) as fh: s = json.load(fh)
except FileNotFoundError:
    s = {}
hooks = s.setdefault('hooks', {})
def ours(group): return any(MARK in (h.get('command') or '') for h in group.get('hooks', []))
for ev in list(hooks):
    hooks[ev] = [g for g in hooks[ev] if not ours(g)]
    if not hooks[ev]: del hooks[ev]
if op == 'install':
    os.makedirs(ROOT, exist_ok=True)
    with open(RELAY, 'w') as fh: fh.write(sys.argv[2])
    # The python3 on PATH (on a Mac, /usr/bin/python3) rather than sys.executable, which there is
    # a path inside Xcode or the Command Line Tools that moves when they're updated or switched.
    py = shutil.which('python3') or sys.executable
    cmd = "'%s' '%s' permission  %s" % (py, RELAY, MARK)
    hooks.setdefault('PermissionRequest', []).append({'hooks': [{'type': 'command', 'command': cmd, 'timeout': 600}]})
elif op == 'remove':
    try: os.remove(RELAY)
    except OSError: pass
if not hooks: s.pop('hooks', None)
if op in ('install', 'remove'):
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    backup = SETTINGS + '.anthrodeck-backup'
    if os.path.exists(SETTINGS) and not os.path.exists(backup):
        with open(SETTINGS) as a, open(backup, 'w') as b: b.write(a.read())
    with open(SETTINGS + '.tmp', 'w') as fh: json.dump(s, fh, indent=2); fh.write('\n')
    os.replace(SETTINGS + '.tmp', SETTINGS)
print(json.dumps({'ok': True}))
`;

export const setupRelay = (host: string, op: 'install' | 'remove') =>
  remotePython<{ ok: boolean }>(host, SETUP_PY, op === 'install' ? [op, RELAY_PY] : [op]);

// ─── the link: one SSH session per remote computer while the app runs ─────────

export interface LiveLinkStatus { connected: boolean; error: string | null; state: LiveState | null }

export interface LiveLinkDeps {
  ask(card: LiveCard & { id: string }, signal: AbortSignal): Promise<string>;
  onStatus(s: LiveLinkStatus): void;
  spawnSsh?: (args: string[]) => ChildProcess;
}

export class LiveLink {
  private child: ChildProcess | null = null;
  private stopped = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 2000;
  private status: LiveLinkStatus = { connected: false, error: null, state: null };
  private seen = new Set<string>();
  private queue: LiveRequest[] = [];
  private asking: { id: string; abort: AbortController } | null = null;
  private stderr = '';

  constructor(readonly host: string, readonly label: string, private deps: LiveLinkDeps) {
    this.connect();
  }

  get current(): LiveLinkStatus { return this.status; }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.asking?.abort.abort();
    this.child?.kill();
    this.child = null;
  }

  private connect(): void {
    if (this.stopped) return;
    this.stderr = '';
    const args = sshArgs(this.host, `python3 -u -c ${shq(WATCH_PY)}`);
    const child = (this.deps.spawnSsh ?? ((a) => spawn('ssh', a, { stdio: ['pipe', 'pipe', 'pipe'] })))(args);
    this.child = child;
    let buf = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const state = parseLiveLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (state) this.onState(state);
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (s: string) => { this.stderr = (this.stderr + s).slice(-2000); });
    child.on('error', (e) => { this.stderr += e.message; });
    child.on('close', () => {
      if (this.child !== child) return;
      this.child = null;
      this.asking?.abort.abort();
      this.setStatus({
        connected: false,
        state: null,
        error: this.stopped ? null : (sshProblem(this.stderr) ?? (this.stderr.trim().split('\n').pop() || 'Lost the connection.')),
      });
      if (this.stopped) return;
      this.retry = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    });
  }

  private setStatus(s: LiveLinkStatus): void {
    this.status = s;
    this.deps.onStatus(s);
  }

  private onState(state: LiveState): void {
    this.backoff = 2000;
    this.setStatus({ connected: true, error: null, state });
    const ids = new Set(state.requests.map((r) => r.id));
    // Answered on that computer (or withdrawn): take the card down.
    if (this.asking && !ids.has(this.asking.id)) this.asking.abort.abort();
    this.queue = this.queue.filter((r) => ids.has(r.id));
    for (const r of state.requests) {
      if (this.seen.has(r.id)) continue;
      this.seen.add(r.id);
      this.queue.push(r);
    }
    void this.next();
  }

  private async next(): Promise<void> {
    if (this.asking || !this.queue.length) return;
    const req = this.queue.shift()!;
    const abort = new AbortController();
    this.asking = { id: req.id, abort };
    try {
      const prompt = livePrompt(req, liveWhere(this.label, req, this.status.state?.live ?? []));
      const picks: string[] = [];
      for (const [i, card] of prompt.cards.entries()) {
        const pick = await this.deps.ask({ ...card, id: `live-${req.id}-${i}` }, abort.signal);
        if (abort.signal.aborted) return;
        // Withdrawn on the Deck without an answer (the cockpit cleared its cards): never answer for
        // the pilot. Forget it, so it comes back with the watcher's next report.
        if (!pick) { this.seen.delete(req.id); return; }
        picks.push(pick);
      }
      if (!prompt.cards.length) return;    // nothing the pilot can answer here: leave it to that computer
      this.child?.stdin?.write(`${JSON.stringify({ op: 'answer', id: req.id, decision: prompt.decide(picks) })}\n`);
    } finally {
      this.asking = null;
      void this.next();
    }
  }
}
