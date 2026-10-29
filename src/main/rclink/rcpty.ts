// Remote Control only connects an interactive Claude Code session (one in a terminal: `claude -p`
// ignores --remote-control), so AnthroDeck runs its two link sessions, the Deck's and the Mac's
// hub, inside this small pseudo-terminal driver (python3, no packages). It:
//
//   * answers the terminal's identity query, which Claude Code waits on before it reads any keys;
//   * gets a fresh install past its one-time screens: the text style, the security notes, trusting
//     the session's own folder (an empty one AnthroDeck makes for it) and the renderer offer. It
//     never accepts Remote Control's own consent; it reports it, for the pilot to accept once;
//   * writes <dir>/status.json: starting | connected (with the session's claude.ai address) |
//     needs-consent | exited, and keeps the last of the screen in <dir>/screen.txt;
//   * starts Claude Code again if it exits, and quits with the app that started it (unless run
//     with --detached, as the Mac's hub is, to outlive the SSH login that started it).

export const RCPTY_PY = String.raw`
import json, os, pty, re, select, signal, struct, sys, time
import fcntl, termios
argv = sys.argv[1:]
detached = '--detached' in argv
if detached: argv.remove('--detached')
d = argv[0]; cmd = argv[argv.index('--') + 1:]
os.makedirs(d, exist_ok=True)
parent = os.getppid()
with open(os.path.join(d, 'pid'), 'w') as f: f.write(str(os.getpid()))

def status(state, **kw):
    # A driver being replaced by a newer one leaves the status to it.
    try:
        if open(os.path.join(d, 'pid')).read().strip() != str(os.getpid()): return
    except OSError: pass
    kw.update(state=state, at=int(time.time() * 1000))
    tmp = os.path.join(d, 'status.json.tmp')
    with open(tmp, 'w') as f: json.dump(kw, f)
    os.replace(tmp, os.path.join(d, 'status.json'))

ANSI = re.compile(r'\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78]')
# One-time screens, matched on their words with spacing squeezed out (cursor moves stand in for
# spaces), and the keys that pass each, sent one key at a time: an arrow key's bytes go together,
# or Claude Code reads its Escape alone, as "cancel".
SCREENS = [
    ('choosethetextstyle', ['\r']),
    ('pressentertocontinue', ['\r']),
    ('yesitrustthisfolder', ['\x1b[B', '\r']),
    ('trythenewfullscreenrenderer', ['\x1b[B', '\r']),
]
child = None
def stop(*_):
    if child:
        try: os.kill(child, signal.SIGTERM)
        except OSError: pass
    status('exited'); os._exit(0)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGHUP, signal.SIG_IGN if detached else stop)

def run():
    global child
    pid, fd = pty.fork()
    if pid == 0:
        os.environ['TERM'] = 'xterm-256color'
        os.execvp(cmd[0], cmd)
    child = pid
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    status('starting')
    seen, text, connected = '', '', False
    while True:
        if not detached and os.getppid() != parent: stop()
        r, _, _ = select.select([fd], [], [], 0.5)
        if r:
            try: data = os.read(fd, 65536)
            except OSError: break
            if not data: break
            if b'\x1b[c' in data: os.write(fd, b'\x1b[?62;22c')
            plain = ANSI.sub('', data.decode('utf-8', 'replace'))
            text = (text + plain)[-6000:]
            seen = (seen + re.sub(r'[^a-z]', '', plain.lower()))[-3000:]
            with open(os.path.join(d, 'screen.txt'), 'w') as f: f.write(text[-3000:])
            for words, keys in SCREENS:
                if words in seen:
                    seen = ''
                    for k in keys:
                        time.sleep(0.6); os.write(fd, k.encode())
            if 'enableremotecontrol' in seen and not connected:
                status('needs-consent')
            m = re.search(r'https://claude\.ai/code/(session_[A-Za-z0-9]+)', text)
            if m and not connected:
                connected = True
                status('connected', session=m.group(1))
        try:
            if os.waitpid(pid, os.WNOHANG)[0]: break
        except ChildProcessError: break
    try: os.close(fd)
    except OSError: pass
    try: os.waitpid(pid, 0)
    except ChildProcessError: pass
    child = None

wait = 5
while True:
    started = time.time()
    run()
    status('exited')
    wait = 5 if time.time() - started > 120 else min(wait * 2, 120)
    time.sleep(wait)
`;
