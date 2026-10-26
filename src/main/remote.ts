// Remote computers: run Claude Code on another machine (your Mac) and drive it from the Deck.
//
// Everything goes over SSH with key-only, non-interactive login. Claude Code itself runs on the
// remote machine, in its folders, under its own sign-in; the Agent SDK's spawnClaudeCodeProcess
// hook streams it back here, so cards, approvals and the cockpit work as they do locally. Listing
// sessions and folders, and reading files for edit previews, run small read-only scripts there.
//
// The builders here are pure so they unit-test; remoteExec/remoteSpawn do the I/O.

import { spawn, execFile, type ChildProcess } from 'child_process';

export interface RemoteTarget {
  host: string;     // what ssh connects to: "user@host", "host", or a ~/.ssh/config alias
  label: string;    // shown in the UI, e.g. "MacBook-Pro"
}

// "Admin@MacBook-Pro.local" -> "MacBook-Pro"
export function defaultLabel(host: string): string {
  const h = host.split('@').pop() ?? host;
  return h.replace(/\.local$/i, '') || host;
}

// Single-quote for a POSIX shell.
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function sshArgs(host: string, remoteCommand: string): string[] {
  return [
    '-T',
    '-o', 'BatchMode=yes',            // keys only: never hang on a password prompt
    '-o', 'ConnectTimeout=8',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    host,
    remoteCommand,
  ];
}

// Find Claude Code on the remote machine: a standard install, or the copy bundled with the Claude
// desktop app on a Mac (versioned path, newest first). Prints the path, or nothing.
export const LOCATE_CLAUDE_SH = [
  'for c in "$(command -v claude 2>/dev/null)" "$HOME/.local/bin/claude" "$HOME/.claude/local/claude"; do',
  '  [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; exit 0; }',
  'done',
  'ls -d "$HOME/Library/Application Support/Claude/claude-code/"*/*/claude.app/Contents/MacOS/claude 2>/dev/null | sort -V | tail -1',
].join('\n');

// Only Claude Code's and the SDK's own variables cross over: the Deck's PATH, HOME and the rest
// mean nothing on the other machine.
export function forwardedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (/^(CLAUDE|ANTHROPIC|MCP_|DEBUG_CLAUDE|DISABLE_)/.test(k)) out[k] = v;
  }
  return out;
}

// The remote shell command that starts Claude Code in `cwd` with the SDK's arguments.
export function remoteClaudeCommand(claudePath: string, cwd: string, args: string[], env: Record<string, string>): string {
  const exports = Object.entries(env).map(([k, v]) => `${k}=${shq(v)}`).join(' ');
  const argv = args.map(shq).join(' ');
  return `cd ${shq(cwd)} && exec env ${exports} ${shq(claudePath)} ${argv}`.replace(/\s+$/, '');
}

export interface ExecResult { code: number; stdout: string; stderr: string }

export function remoteExec(host: string, command: string, input?: string, timeoutMs = 20_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile('ssh', sshArgs(host, command), { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr || (err && !stderr ? err.message : '')) });
      });
    if (input !== undefined) { child.stdin?.end(input); }
  });
}

// Runs a Python script (sent on stdin) on the remote machine and parses its JSON output.
export async function remotePython<T>(host: string, script: string, args: string[] = [], timeoutMs = 30_000): Promise<T> {
  const r = await remoteExec(host, `python3 - ${args.map(shq).join(' ')}`, script, timeoutMs);
  if (r.code !== 0) throw new Error(sshProblem(r.stderr) ?? (r.stderr.trim().split('\n').pop() || `exit ${r.code}`));
  return JSON.parse(r.stdout) as T;
}

// The SDK's spawnClaudeCodeProcess hook, pointed at the remote machine. The SDK's own command and
// cwd are local notions; the remote side gets its Claude path and the project folder instead.
export function remoteSpawner(host: string, claudePath: string, cwd: string) {
  return (opts: { args: string[]; env: Record<string, string | undefined>; signal?: AbortSignal }): ChildProcess => {
    // ANTHRODECK_SESSION: this session's prompts already come to the Deck, so the live relay
    // (main/live.ts) leaves them alone.
    const cmd = remoteClaudeCommand(claudePath, cwd, opts.args, { ...forwardedEnv(opts.env), ANTHRODECK_SESSION: '1' });
    return spawn('ssh', sshArgs(host, cmd), { stdio: ['pipe', 'pipe', 'pipe'], signal: opts.signal });
  };
}

// A plain-language reason for a failed SSH connection, or null if it wasn't SSH's fault.
export function sshProblem(stderr: string): string | null {
  if (/Connection refused/i.test(stderr)) return 'The computer refused SSH. Turn on Remote Login (System Settings → General → Sharing).';
  if (/Permission denied/i.test(stderr)) return 'SSH needs this Deck\'s key on that computer (key login isn\'t set up yet).';
  if (/Could not resolve hostname|Name or service not known/i.test(stderr)) return 'Can\'t find that computer on the network. Check the name, or use its IP address.';
  if (/timed out|No route to host|Network is unreachable/i.test(stderr)) return 'Can\'t reach that computer. Is it awake and on the same network?';
  if (/Host key verification failed/i.test(stderr)) return 'That computer\'s identity changed or isn\'t known yet. Connect once from a terminal to confirm it.';
  return null;
}

// ─── Scripts that run on the remote machine (python3, read-only except mkdir) ─────────────────

// This machine's Claude Code sessions, newest first, with the git state of each project.
export const LIST_SESSIONS_PY = String.raw`
import json, os, glob, subprocess, sys
root = os.path.expanduser('~/.claude/projects')
files = sorted(glob.glob(os.path.join(root, '*', '*.jsonl')), key=os.path.getmtime, reverse=True)[:80]
out = []
for f in files:
    sid = os.path.basename(f)[:-6]
    info = {'sessionId': sid, 'lastModified': int(os.path.getmtime(f) * 1000)}
    first = None; summary = None; title = None; cwd = None; branch = None
    try:
        with open(f, 'r', errors='replace') as fh:
            for line in fh:
                try: e = json.loads(line)
                except Exception: continue
                if e.get('isSidechain'): continue
                cwd = cwd or e.get('cwd')
                branch = e.get('gitBranch') or branch
                t = e.get('type')
                if t == 'summary' and e.get('summary'): summary = e['summary']
                if t == 'custom-title' and e.get('customTitle'): title = e['customTitle']
                if t == 'user' and first is None:
                    c = (e.get('message') or {}).get('content')
                    if isinstance(c, list): c = ' '.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
                    if isinstance(c, str) and c.strip() and not c.lstrip().startswith(('<command-', '<local-command-', 'Caveat:', '<system-reminder>')): first = c.strip()[:300]
    except Exception:
        continue
    if not cwd or not os.path.isdir(cwd): continue
    info.update({'cwd': cwd, 'gitBranch': branch, 'summary': title or summary or first or 'Untitled session', 'firstPrompt': first})
    out.append(info)
git = {}
for cwd in list(dict.fromkeys(s['cwd'] for s in out))[:12]:
    try:
        r = subprocess.run(['git', '-C', cwd, 'status', '--porcelain=v1', '-b'], capture_output=True, text=True, timeout=3)
        git[cwd] = r.stdout if r.returncode == 0 else None
    except Exception:
        git[cwd] = None
print(json.dumps({'sessions': out, 'git': git}))
`;

// A session's conversation for putting a reopened session back on screen: main chain only, and
// only the text (tool calls and results can be megabytes, and the chat shows just the words).
export const READ_SESSION_PY = String.raw`
import json, os, glob, sys
sid = sys.argv[1]
hits = glob.glob(os.path.join(os.path.expanduser('~/.claude/projects'), '*', sid + '.jsonl'))
out = []
if hits:
    with open(hits[0], 'r', errors='replace') as fh:
        for line in fh:
            try: e = json.loads(line)
            except Exception: continue
            if e.get('type') not in ('user', 'assistant') or e.get('isSidechain'): continue
            c = (e.get('message') or {}).get('content')
            if isinstance(c, list):
                c = [{'type': 'text', 'text': b.get('text', '')} for b in c if isinstance(b, dict) and b.get('type') == 'text']
            if not c and e['type'] == 'user': continue
            out.append({'type': e['type'], 'uuid': e.get('uuid', ''), 'message': {'content': c}, 'parent_tool_use_id': e.get('parent_tool_use_id')})
print(json.dumps(out))
`;

// Subfolders of a folder (the folder picker), or create one.
export const FOLDERS_PY = String.raw`
import json, os, sys
op, path = sys.argv[1], os.path.expanduser(sys.argv[2] or '~')
if op == 'mkdir':
    try:
        os.mkdir(path); print(json.dumps({'path': path}))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
    sys.exit(0)
path = os.path.abspath(path)
parent = os.path.dirname(path)
res = {'path': path, 'parent': None if parent == path else parent, 'folders': []}
try:
    for e in os.scandir(path):
        if e.is_dir() and not e.name.startswith('.'):
            res['folders'].append({'name': e.name, 'path': e.path, 'git': os.path.isdir(os.path.join(e.path, '.git'))})
    res['folders'].sort(key=lambda f: (not f['git'], f['name'].lower()))
except Exception as e:
    res['error'] = str(e)
print(json.dumps(res))
`;

// A text file's contents (edit previews), capped.
export const READ_FILE_PY = String.raw`
import json, sys
try:
    with open(sys.argv[1], 'r', errors='replace') as fh: data = fh.read(2_000_001)
    print(json.dumps({'content': None if len(data) > 2_000_000 else data}))
except FileNotFoundError:
    print(json.dumps({'content': None}))
`;
