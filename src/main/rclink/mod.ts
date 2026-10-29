// The anthrodeck-link mod: a Claude Code mod (Claude Code ≥ 2.1.308) that carries AnthroDeck's link
// to the other computer over Remote Control, so the Deck reaches the Mac through Anthropic's
// servers when SSH can't (away from home, on a hotspot). AnthroDeck writes these files out and
// loads them with --plugin-dir into two sessions of its own, each started with --remote-control:
//
//   * the HUB, on the Mac (ADK_RC_ROLE=hub). The Deck asks it to open a channel; the hub runs the
//     same watcher the SSH link runs (live.ts WATCH_PY) and streams its output back, and feeds it
//     the Deck's commands. So the session list, following a session, messages into it and the
//     relay's approvals all work as they do over SSH.
//   * the Deck's own session (ADK_RC_ROLE=deck). It long-polls AnthroDeck on 127.0.0.1 for
//     messages to send, sends them, and posts back whatever arrives.
//
// Messages are Claude Code's own cross-session messages: "ADK1 {json}" one way, "ADK1R {json}"
// back. Both sessions consume every message they get, so Claude never reads one and no turn starts.

export const MOD_VERSION = 1;
export const HUB_NAME = 'anthrodeck-hub';

export const PLUGIN_JSON = JSON.stringify({
  name: 'anthrodeck-link',
  version: `0.${MOD_VERSION}.0`,
  description: 'Carries AnthroDeck\'s link to this computer over Remote Control',
  author: { name: 'AnthroDeck' },
}, null, 2);

export const HOOKS_JSON = JSON.stringify({ description: 'AnthroDeck link', modules: ['./register.js'] }, null, 2);

// Runs the watcher with its standard input fed from a file the hub appends the Deck's commands to:
// a mod can't write to a running child's stdin. Exits with the session that started it.
export const WRAP_PY = String.raw`import os, sys, threading, time
cmd, script = sys.argv[1], sys.argv[2]
r, w = os.pipe()
parent = os.getppid()
def feed():
    pos = 0
    while True:
        if os.getppid() != parent: os._exit(0)
        try:
            with open(cmd, 'rb') as f:
                f.seek(pos); data = f.read()
        except OSError: data = b''
        if data:
            pos += len(data); os.write(w, data)
        time.sleep(0.1)
threading.Thread(target=feed, daemon=True).start()
sys.stdin = os.fdopen(r)
exec(compile(open(script).read(), script, 'exec'), {'__name__': '__main__'})
`;

export const REGISTER_JS = String.raw`// anthrodeck-link v${MOD_VERSION}: see AnthroDeck's src/main/rclink/mod.ts.
const REQ = 'ADK1 ';
const RES = 'ADK1R ';
const PIECE = 24000;          // characters of watcher output per message
const IDLE_MS = 90000;        // a channel the Deck stopped pinging is closed

const channels = new Map();   // hub: channel id -> { to, cmd, stream, lastSeen, buf, flushing }

function body(text, tag) {
  const i = text.indexOf(tag);
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i + tag.length).split('\n')[0]); } catch { return null; }
}
// Who sent it: the envelope's address ("bridge:session_..." for another machine's session).
function sender(text) {
  return /<cross-session-message[^>]*\sfrom="([^"]+)"/.exec(text)?.[1] ?? null;
}

async function dir($) {
  return (await $.env.get('HOME')) + '/.anthrodeck/rc';
}

// ─── the Deck's side ───────────────────────────────────────────────────────────

async function post($, payload) {
  const url = await $.env.get('ADK_RC_URL');
  const token = await $.env.get('ADK_RC_TOKEN');
  try {
    await $.http.fetch(url + '/in?t=' + token, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
  } catch { /* AnthroDeck is gone; the next poll finds out */ }
}

async function peers($) {
  const r = await $.tool.call({ tool: 'ListAgents' });
  const v = r?.result ?? r;
  if (typeof v === 'string') {
    try { return JSON.parse(v).listing ?? v; } catch { return v; }
  }
  return v?.listing ?? JSON.stringify(v);
}

async function deckLoop($) {
  const url = await $.env.get('ADK_RC_URL');
  const token = await $.env.get('ADK_RC_TOKEN');
  for (;;) {
    let out = null;
    try {
      const r = await $.http.fetch(url + '/out?t=' + token);
      out = r.ok ? JSON.parse(r.text) : null;
      if (!r.ok) await $.clock.sleep(1000);
    } catch {
      await $.clock.sleep(1000);
      continue;
    }
    if (!out) continue;
    if (out.quit) return;
    if (out.peers) await post($, { kind: 'peers', listing: await peers($) });
    for (const m of out.msgs ?? []) {
      const sent = await $.session.send({ to: m.to, text: REQ + JSON.stringify(m.body) });
      if (!sent.isDelivered) await post($, { kind: 'undelivered', ch: m.body.ch, reason: sent.reason ?? 'not delivered' });
    }
  }
}

// ─── the hub's side ────────────────────────────────────────────────────────────

async function reply($, ch, msg) {
  await $.session.send({ to: ch.to, text: RES + JSON.stringify({ ch: ch.id, ...msg }) });
}

async function flush($, ch) {
  ch.flushing = false;
  while (ch.buf) {
    const piece = ch.buf.slice(0, PIECE);
    ch.buf = ch.buf.slice(PIECE);
    await reply($, ch, { out: piece });
  }
}

async function open($, to, req) {
  const old = channels.get(req.ch);
  if (old) await close($, old, null);
  const d = (await dir($)) + '/hub';
  await $.process.run(['mkdir', '-p', d]);
  const cmd = d + '/' + req.ch + '.in';
  const script = d + '/watch.py';
  const wrap = d + '/wrap.py';
  await $.fs.write(cmd, '');
  await $.fs.write(script, req.script);
  await $.fs.write(wrap, req.wrap);
  const stream = $.process.spawn({ argv: ['python3', '-u', wrap, cmd, script] });
  const ch = { id: req.ch, to, cmd, stream, lastSeen: await $.clock.now(), buf: '', flushing: false, closed: false };
  channels.set(req.ch, ch);
  void (async () => {
    let end = null;
    try {
      for await (const piece of stream) {
        if (piece.stream !== 'stdout') continue;
        ch.buf += piece.text;
        if (!ch.flushing) { ch.flushing = true; $.clock.after(150, () => flush($, ch)); }
      }
    } catch (err) {
      end = String(err?.message ?? err);
    }
    if (ch.closed) return;
    ch.closed = true;
    channels.delete(ch.id);
    await flush($, ch);
    await reply($, ch, { closed: true, error: end });
  })();
}

async function close($, ch, why) {
  if (ch.closed) return;
  ch.closed = true;
  channels.delete(ch.id);
  try { await ch.stream.return?.(); } catch { /* already over */ }
  if (why) await reply($, ch, { closed: true, error: why });
}

async function hubRequest($, to, req) {
  const ch = channels.get(req.ch);
  if (req.op === 'open') return open($, to, req);
  if (!ch) return reply($, { id: req.ch, to }, { closed: true, error: 'That channel is closed.' });
  ch.lastSeen = await $.clock.now();
  ch.to = to;
  if (req.op === 'in') await $.process.run(['sh', '-c', 'cat >> "$1"', 'sh', ch.cmd], { stdin: req.data });
  else if (req.op === 'ping') await reply($, ch, { pong: true });
  else if (req.op === 'close') await close($, ch, null);
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    const role = await $.env.get('ADK_RC_ROLE');
    if (role === 'deck') void deckLoop($);
    if (role === 'hub') {
      $.clock.every(15000, async () => {
        const now = await $.clock.now();
        for (const ch of [...channels.values()]) {
          if (now - ch.lastSeen > IDLE_MS) await close($, ch, 'The Deck stopped answering.');
        }
      });
    }
    return next(e);
  });

  // These sessions are AnthroDeck's plumbing: nothing that arrives is for Claude.
  on('session.receive', async ($, e, next) => {
    const role = await $.env.get('ADK_RC_ROLE');
    if (role !== 'deck' && role !== 'hub') return next(e);
    const from = sender(e.text);
    if (role === 'deck') {
      const res = body(e.text, RES);
      if (res) await post($, { kind: 'msg', from, body: res });
    } else {
      const req = body(e.text, REQ);
      if (req && from && typeof req.ch === 'string') {
        try { await hubRequest($, from, req); } catch (err) {
          await $.session.send({ to: from, text: RES + JSON.stringify({ ch: req.ch, closed: true, error: String(err?.message ?? err) }) });
        }
      }
    }
    return { consumed: 'AnthroDeck link' };
  }).catch(() => ({ consumed: 'AnthroDeck link' }));
}
`;

export const MOD_FILES: Record<string, string> = {
  '.claude-plugin/plugin.json': PLUGIN_JSON,
  'hooks/hooks.json': HOOKS_JSON,
  'hooks/register.js': REGISTER_JS,
};
