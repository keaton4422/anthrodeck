#!/usr/bin/env python3
# AnthroDeck's PermissionRequest hook: waits for the Deck's answer to a prompt.
#
# A Claude Code mod can't wait on a person (its hooks get seconds), so the two halves split the
# work: this hook, which may wait up to its timeout, leaves the prompt in this session's folder;
# the plugin's mod (register.ts), running in the same session, sends it to the Deck over Remote
# Control and writes the Deck's answer back. The prompt shows on this computer as always, and
# whichever answers first wins. With no Deck reachable the mod isn't marking the session online,
# and this returns at once.
import json, os, sys, time, uuid

ROOT = os.path.join(os.path.expanduser('~'), '.anthrodeck', 'remote')
FRESH = 15          # seconds: the mod marks the session online every few seconds
WAIT = 590          # just under the hook's timeout in hooks.json
SEEN = 300          # seconds: the Deck was reachable from this computer this recently

def age(path):
    try: return time.time() - os.path.getmtime(path)
    except OSError: return float('inf')

def tool_use_id(d):
    # The tool_use this prompt is about, to notice when it's answered on this computer instead.
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

def main():
    try: d = json.load(sys.stdin)
    except Exception: return
    sid = d.get('session_id') or ''
    if not sid or d.get('agent_id'): return
    here = os.path.join(ROOT, sid)
    # A session that just started may not be marked yet: when this computer has seen the Deck
    # lately, give the mod a moment. Without a Deck around, step aside at once.
    patience = 4 if age(os.path.join(ROOT, 'deck-seen')) < SEEN else 0
    end = time.time() + patience
    while age(os.path.join(here, 'online')) > FRESH:
        if time.time() >= end: return
        time.sleep(0.25)
    rid = uuid.uuid4().hex
    req = os.path.join(here, 'req', rid + '.json')
    ans = os.path.join(here, 'ans', rid + '.json')
    os.makedirs(os.path.dirname(req), exist_ok=True)
    os.makedirs(os.path.dirname(ans), exist_ok=True)
    path = d.get('transcript_path') or ''
    try: offset = os.path.getsize(path)
    except OSError: offset = 0
    tid = tool_use_id(d)
    tmp = req + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump({'id': rid, 'tool': d.get('tool_name'), 'input': d.get('tool_input') or {},
                   'suggestions': d.get('permission_suggestions') or [], 'cwd': d.get('cwd')}, fh)
    os.replace(tmp, req)
    try:
        deadline = time.time() + WAIT
        while time.time() < deadline:
            if os.path.exists(ans):
                with open(ans) as fh: decision = json.load(fh)['decision']
                print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PermissionRequest', 'decision': decision}}))
                return
            if tid and answered_here(path, offset, tid): return
            time.sleep(0.3)
    finally:
        for p in (req, ans):
            try: os.remove(p)
            except OSError: pass

if __name__ == '__main__':
    main()
