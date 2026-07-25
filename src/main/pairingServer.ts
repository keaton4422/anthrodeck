import Fastify, { FastifyInstance } from 'fastify';
import os from 'os';
import { pickLanIp } from './network';

// Key pairing over the LAN. Typing an `sk-ant-...` key on the Steam Deck's on-screen keyboard is
// miserable, so instead the Deck stands up a tiny page for a few minutes: open it on a phone or
// laptop that already has the key on its clipboard, paste, send. Zero typing on the Deck.
//
// Security posture — this accepts a secret over the network, so it is deliberately narrow:
//   * bound only while pairing is open, and torn down on success, timeout, or cancel
//   * gated by a 6-digit code shown on the Deck, so another device on the LAN can't just push a key
//   * a hard cap on wrong-code attempts, after which the window closes
//   * a short lifetime (5 minutes)
// It is still plaintext HTTP on your local network — fine for a home LAN, not for a cafe. The UI
// says so, and the window is small.

const PORT = 5758;
const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export interface PairingSession {
  active: boolean;
  url: string | null;
  code: string | null;
  expiresAt: number | null;
}

let server: FastifyInstance | null = null;
let code: string | null = null;
let attempts = 0;
let timer: NodeJS.Timeout | null = null;
let onKey: ((key: string) => void) | null = null;

function makeCode(): string {
  // Not cryptographic secrecy — it's a short-lived confirmation that the person pasting the key is
  // the person looking at the Deck.
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Exported for testing: an Anthropic key has a recognisable shape, and catching a bad paste here is
// far kinder than a 401 three screens later.
export function looksLikeAnthropicKey(v: unknown): boolean {
  return typeof v === 'string' && /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(v.trim());
}

// Exported for testing: constant-ish time compare so the code isn't trivially probeable.
export function codeMatches(expected: string | null, given: unknown): boolean {
  if (!expected || typeof given !== 'string') return false;
  const a = expected;
  const b = given.trim();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function page(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AnthroDeck — send API key</title>
<style>
 body{font-family:system-ui,-apple-system,sans-serif;background:#0F0F0F;color:#ECECEC;margin:0;
      display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
 .c{width:100%;max-width:420px}
 h1{font-size:19px;margin:0 0 6px} p{color:#9A9A9A;font-size:14px;line-height:1.5;margin:0 0 18px}
 label{display:block;font-size:12px;color:#CC785C;letter-spacing:.05em;margin:14px 0 6px}
 input{width:100%;box-sizing:border-box;background:#242424;border:1px solid #3A3A3A;border-radius:8px;
       padding:13px;color:#ECECEC;font-size:16px;font-family:ui-monospace,monospace}
 button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:8px;background:#CC785C;
        color:#fff;font-size:16px;font-weight:600}
 .m{margin-top:14px;font-size:14px;min-height:20px}
 .ok{color:#52A77C}.err{color:#E05252}
</style></head><body><div class="c">
<h1>Send your API key to AnthroDeck</h1>
<p>Paste the key from <b>console.anthropic.com</b>, and the 6-digit code showing on the Deck.</p>
<form id="f">
 <label>PAIRING CODE</label>
 <input name="code" inputmode="numeric" autocomplete="off" placeholder="123456" required>
 <label>ANTHROPIC API KEY</label>
 <input name="key" type="password" autocomplete="off" placeholder="sk-ant-..." required>
 <button type="submit">Send to Deck</button>
</form>
<div class="m" id="m"></div>
</div><script>
document.getElementById('f').onsubmit = async (e) => {
  e.preventDefault();
  const m = document.getElementById('m');
  m.textContent = 'Sending...'; m.className = 'm';
  const fd = new FormData(e.target);
  try {
    const r = await fetch('/pair', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: fd.get('code'), key: fd.get('key') }),
    });
    const j = await r.json();
    m.textContent = j.message;
    m.className = 'm ' + (j.ok ? 'ok' : 'err');
    if (j.ok) e.target.style.display = 'none';
  } catch { m.textContent = 'Could not reach the Deck.'; m.className = 'm err'; }
};
</script></body></html>`;
}

export async function startPairing(handler: (key: string) => void): Promise<PairingSession> {
  await stopPairing();
  onKey = handler;
  code = makeCode();
  attempts = 0;

  const app = Fastify();
  app.get('/', (_req, reply) => reply.type('text/html').send(page()));
  app.post('/pair', async (req, reply) => {
    const body = (req.body ?? {}) as { code?: unknown; key?: unknown };

    if (!codeMatches(code, body.code)) {
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Close the window rather than let it be hammered.
        setTimeout(() => { void stopPairing(); }, 100);
        return reply.send({ ok: false, message: 'Too many wrong codes — pairing closed on the Deck.' });
      }
      return reply.send({ ok: false, message: 'Wrong pairing code.' });
    }
    if (!looksLikeAnthropicKey(body.key)) {
      return reply.send({ ok: false, message: "That doesn't look like an Anthropic key (sk-ant-...)." });
    }

    onKey?.(String(body.key).trim());
    setTimeout(() => { void stopPairing(); }, 250);
    return reply.send({ ok: true, message: 'Sent. The Deck has your key — you can close this.' });
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  server = app;

  const ip = pickLanIp(os.networkInterfaces() as never) ?? `${os.hostname()}.local`;
  timer = setTimeout(() => { void stopPairing(); }, TTL_MS);

  return {
    active: true,
    url: `http://${ip}:${PORT}/`,
    code,
    expiresAt: Date.now() + TTL_MS,
  };
}

export async function stopPairing(): Promise<PairingSession> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (server) {
    try { await server.close(); } catch { /* ignore */ }
    server = null;
  }
  code = null;
  attempts = 0;
  onKey = null;
  return { active: false, url: null, code: null, expiresAt: null };
}

export function isPairing(): boolean {
  return server !== null;
}
