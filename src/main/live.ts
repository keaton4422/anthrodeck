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
//     and the waiting requests as JSON lines, and writes the Deck's answers back. It also streams
//     the conversation of the session the Deck has open, and delivers the pilot's messages to it
//     through Claude Code's own session inbox: the socket each running session lists in that
//     registry, the one Claude sessions use to message each other. Claude Code shows such a message
//     as coming from another session, and a session that skips permission prompts holds it for
//     review in its own window rather than acting on it.
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

// The conversation of the session the Deck has open, as the watcher reads it from its transcript.
// 'queued': the Deck's message reached the session's queue; 'peer': a message from another session.
export interface LiveEntry {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'peer' | 'queued';
  text: string;
  deck?: boolean;             // a user message sent from the Deck
}
// `mode`: the session's permission mode as of its latest turn ('plan', 'default', 'acceptEdits',
// 'bypassPermissions', 'auto'…), null until it has one.
export interface LiveTail { sessionId: string; reset: boolean; entries: LiveEntry[]; mode: string | null }
export interface LiveSent { id: string; ok: boolean; error: string | null }

interface RawEntry { id?: unknown; role?: unknown; text?: unknown; deck?: unknown; name?: unknown; input?: unknown }

// The watcher's other lines: a piece of the open session's conversation, or a send's outcome.
// Tool calls arrive as name + input and become the same one-line labels the cockpit uses.
export function parseLiveEvent(line: string, cwd: string): { tail: LiveTail } | { sent: LiveSent } | null {
  let d: { tail?: { sessionId?: unknown; reset?: unknown; entries?: unknown; mode?: unknown }; sent?: { id?: unknown; ok?: unknown; error?: unknown } };
  try { d = JSON.parse(line); } catch { return null; }
  if (d?.tail && typeof d.tail.sessionId === 'string' && Array.isArray(d.tail.entries)) {
    const entries: LiveEntry[] = [];
    for (const e of d.tail.entries as RawEntry[]) {
      const role = e?.role;
      if (role === 'tool') {
        const input = (e.input && typeof e.input === 'object' ? e.input : {}) as Record<string, unknown>;
        entries.push({ id: String(e.id ?? ''), role, text: toolLabel(String(e.name ?? ''), input, cwd) });
      } else if ((role === 'user' || role === 'assistant' || role === 'peer' || role === 'queued') && typeof e.text === 'string') {
        entries.push({ id: String(e.id ?? ''), role, text: e.text, ...(e.deck === true && { deck: true }) });
      }
    }
    const mode = typeof d.tail.mode === 'string' ? d.tail.mode : null;
    return { tail: { sessionId: d.tail.sessionId, reset: d.tail.reset === true, entries, mode } };
  }
  if (d?.sent && typeof d.sent.id === 'string') {
    return { sent: { id: d.sent.id, ok: d.sent.ok === true, error: typeof d.sent.error === 'string' ? d.sent.error : null } };
  }
  return null;
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

CONFIG = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')
DECK = 'From the user, sent from AnthroDeck on their Steam Deck:\n'
PEER_HEAD = 'Another Claude session sent a message:\n'
PEER_TAIL = '\n\nThis came from another Claude session'
SKIP = ('<command-', '<local-command-', 'Caveat:', '<system-reminder>', '<task-notification>')
TOOL_KEYS = ('command', 'description', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'subagent_type')

def emit(o):
    sys.stdout.write(json.dumps(o) + '\n'); sys.stdout.flush()

def clip(s, n=4000):
    return s if len(s) <= n else s[:n] + '…'

def entries(e):
    # One transcript line -> what the Deck shows: words from either side, and a line per tool call.
    if e.get('isSidechain'): return []
    t, uid, msg = e.get('type'), e.get('uuid') or '', e.get('message') or {}
    c = msg.get('content')
    if t == 'queue-operation':
        # The Deck's message got into the session's queue (a session that skips permission prompts
        # holds outside messages for review in its own window instead, so this never shows up).
        q = e.get('content')
        if e.get('operation') == 'enqueue' and isinstance(q, str) and q.startswith(DECK):
            return [{'id': 'q-%s' % e.get('timestamp', ''), 'role': 'queued', 'text': clip(q[len(DECK):])}]
        return []
    if t == 'user':
        origin = e.get('origin') or {}
        if e.get('isMeta'):
            # A message delivered through Claude Code's session inbox: the Deck's own, or another
            # session's. Show the words that were sent, not the wrapper Claude Code adds.
            if origin.get('kind') != 'peer' or not isinstance(c, str): return []
            body = c[len(PEER_HEAD):] if c.startswith(PEER_HEAD) else c
            body = body.split(PEER_TAIL)[0]
            if body.startswith(DECK): return [{'id': uid, 'role': 'user', 'text': clip(body[len(DECK):]), 'deck': True}]
            return [{'id': uid, 'role': 'peer', 'text': clip(body)}]
        if isinstance(c, list):
            c = '\n'.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
        if not isinstance(c, str) or not c.strip() or c.lstrip().startswith(SKIP): return []
        return [{'id': uid, 'role': 'user', 'text': clip(c.strip())}]
    if t == 'assistant' and isinstance(c, list):
        out = []
        for i, b in enumerate(c):
            if not isinstance(b, dict): continue
            if b.get('type') == 'text' and b.get('text', '').strip():
                out.append({'id': '%s-%d' % (uid, i), 'role': 'assistant', 'text': clip(b['text'].strip())})
            elif b.get('type') == 'tool_use':
                inp = b.get('input') or {}
                out.append({'id': '%s-%d' % (uid, i), 'role': 'tool', 'name': b.get('name') or '',
                            'input': {k: clip(str(inp[k]), 300) for k in TOOL_KEYS if k in inp}})
        return out
    return []

watching = None     # the session the Deck has open: {'sid', 'path', 'offset', 'mode'}

def parse(chunk, w):
    # Also notes the session's permission mode, which Claude Code stamps on each of the user's turns.
    out = []
    for raw in chunk.splitlines():
        try:
            e = json.loads(raw)
            if isinstance(e.get('permissionMode'), str): w['mode'] = e['permissionMode']
            out += entries(e)
        except Exception: pass
    return out

def watch(sid):
    global watching
    watching = None
    if not sid or not re.fullmatch(r'[0-9A-Za-z_-]{1,100}', sid): return
    hits = glob.glob(os.path.join(CONFIG, 'projects', '*', sid + '.jsonl'))
    if not hits:
        emit({'tail': {'sessionId': sid, 'reset': True, 'entries': []}}); return
    path = hits[0]
    with open(path, 'rb') as fh:
        fh.seek(0, 2); size = fh.tell(); fh.seek(max(0, size - 1024 * 1024))
        data = fh.read()
    if size > len(data): data = data.split(b'\n', 1)[-1]    # drop the partial first line
    end = data.rfind(b'\n') + 1
    w = {'sid': sid, 'path': path, 'offset': size - len(data) + end, 'mode': None}
    got = parse(data[:end].decode('utf-8', 'replace'), w)[-80:]
    watching = w
    emit({'tail': {'sessionId': sid, 'reset': True, 'entries': got, 'mode': w['mode']}})

def follow():
    w = watching
    if not w: return
    try:
        with open(w['path'], 'rb') as fh:
            fh.seek(w['offset']); data = fh.read(4 * 1024 * 1024)
    except OSError:
        return
    end = data.rfind(b'\n') + 1
    if not end: return
    w['offset'] += end
    mode = w['mode']
    new = parse(data[:end].decode('utf-8', 'replace'), w)
    if new or w['mode'] != mode: emit({'tail': {'sessionId': w['sid'], 'reset': False, 'entries': new, 'mode': w['mode']}})

def deliver(sid, text):
    # Into a running session through Claude Code's own session inbox: the socket it lists in the
    # registry, opened with the key it publishes beside its entry (readable only by this user).
    import socket
    for f in glob.glob(os.path.join(REG, '*.json')):
        e = load(f)
        if not e or e.get('sessionId') != sid or not alive(e.get('pid', 0)): continue
        sock = e.get('messagingSocketPath')
        if not sock: return 'That session can\'t take messages (its Claude Code is too old).'
        keys = glob.glob(os.path.join(REG, '%s.*.key' % e['pid']))
        key = load(keys[0]) if keys else None
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(5)
        try:
            s.connect(sock)
            if key and key.get('peerToken'):
                s.sendall((json.dumps({'type': 'auth', 'token': key['peerToken']}) + '\n').encode())
            s.sendall((json.dumps({'type': 'user', 'session_id': sid,
                                   'message': {'role': 'user', 'content': DECK + text}}) + '\n').encode())
        finally:
            s.close()
        return None
    return 'That session isn\'t running any more.'

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
    follow()
    if select.select([sys.stdin], [], [], 1.0)[0]:
        line = sys.stdin.readline()
        if not line: bye()
        try: cmd = json.loads(line)
        except Exception: continue
        if cmd.get('op') == 'answer' and re.fullmatch(r'[0-9a-f]{32}', str(cmd.get('id'))):
            p = os.path.join(ROOT, 'ans', cmd['id'] + '.json')
            with open(p + '.tmp', 'w') as fh: json.dump({'decision': cmd['decision']}, fh)
            os.replace(p + '.tmp', p)
        elif cmd.get('op') == 'watch':
            try: watch(cmd.get('sessionId'))
            except Exception: watching = None
        elif cmd.get('op') == 'send' and isinstance(cmd.get('text'), str) and cmd['text'].strip():
            try: err = deliver(str(cmd.get('sessionId')), cmd['text'].strip())
            except Exception as ex: err = 'Couldn\'t reach that session (%s).' % ex
            emit({'sent': {'id': cmd.get('id'), 'ok': err is None, 'error': err}})
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
  onTail?(t: LiveTail): void;
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
  // The session the Deck has open (its conversation streams in as tail lines), kept across reconnects.
  private watching: { sessionId: string; cwd: string } | null = null;
  private sends = new Map<string, (r: LiveSent) => void>();
  private sendSeq = 0;

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
    this.failSends('AnthroDeck stopped.');
  }

  // Follow one session's conversation (null: stop following).
  watch(sessionId: string | null): void {
    const s = sessionId ? this.status.state?.live.find((x) => x.sessionId === sessionId) : null;
    this.watching = sessionId ? { sessionId, cwd: s?.cwd ?? '' } : null;
    this.write({ op: 'watch', sessionId });
  }

  // Send the pilot's message into a running session. Resolves once that computer has handed it to
  // the session's inbox (or couldn't).
  send(sessionId: string, text: string, timeoutMs = 15_000): Promise<LiveSent> {
    const id = `s${++this.sendSeq}`;
    if (!this.child?.stdin?.writable || !this.status.connected) {
      return Promise.resolve({ id, ok: false, error: `Not connected to ${this.label}.` });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.sends.delete(id); resolve({ id, ok: false, error: `${this.label} didn't answer.` }); }, timeoutMs);
      this.sends.set(id, (r) => { clearTimeout(timer); resolve(r); });
      this.write({ op: 'send', id, sessionId, text });
    });
  }

  private write(cmd: object): void {
    if (this.child?.stdin?.writable) this.child.stdin.write(`${JSON.stringify(cmd)}\n`);
  }

  private failSends(error: string): void {
    for (const [id, done] of this.sends) done({ id, ok: false, error });
    this.sends.clear();
  }

  private onEvent(line: string): void {
    const ev = parseLiveEvent(line, this.watching?.cwd ?? '');
    if (!ev) return;
    if ('sent' in ev) {
      const done = this.sends.get(ev.sent.id);
      this.sends.delete(ev.sent.id);
      done?.(ev.sent);
    } else if (ev.tail.sessionId === this.watching?.sessionId) {
      this.deps.onTail?.(ev.tail);
    }
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
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const state = parseLiveLine(line);
        if (state) this.onState(state);
        else this.onEvent(line);
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (s: string) => { this.stderr = (this.stderr + s).slice(-2000); });
    child.on('error', (e) => { this.stderr += e.message; });
    child.on('close', () => {
      if (this.child !== child) return;
      this.child = null;
      this.asking?.abort.abort();
      this.failSends(`Lost the connection to ${this.label}.`);
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
    // First report on a fresh connection: pick the open session back up.
    if (!this.status.connected && this.watching) this.write({ op: 'watch', sessionId: this.watching.sessionId });
    if (this.watching && !this.watching.cwd) {
      this.watching.cwd = state.live.find((x) => x.sessionId === this.watching?.sessionId)?.cwd ?? '';
    }
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
