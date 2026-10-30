// AnthroDeck for Claude Code: this computer's sessions, answered and followed from AnthroDeck on a
// Steam Deck, over Remote Control, the way the Claude phone app reaches them. No SSH, no address.
//
// Prompts: a mod's hooks get seconds, too short to wait on a person, so the waiting is done by the
// plugin's PermissionRequest command hook (wait.py), which leaves each prompt in this session's
// folder under ~/.anthrodeck/remote. This mod, while the Deck's Remote Control session
// ("anthrodeck-deck") is reachable, marks the session online for that hook, sends the Deck each
// prompt, and writes the Deck's answer back for the hook to hand Claude Code. The prompt shows on
// this computer too, and whichever answers first wins.
//
// Turn ends: the session's last reply goes to the Deck, which chimes and shows it.
//
// Messages are Claude Code's own cross-session messages: "ADK2 {json}" to the Deck, "ADK2R {json}"
// back. A Deck answer names the prompt by a random id only the Deck was sent.

import type { EngineInterface, Register } from 'claude-code';

const OUT = 'ADK2 ';
const BACK = 'ADK2R ';
const DECK = 'anthrodeck-deck';
const FIND_EVERY_MS = 60_000;
const TICK_MS = 2000;

let found: { deck: string | null; me: string | null; at: number } | null = null;
let ticking = false;
const forwarded = new Set<string>();      // prompts sent to the Deck and still waiting here

// The Deck's session and this one's name, from Claude Code's list of reachable sessions.
async function look($: EngineInterface): Promise<{ deck: string | null; me: string | null }> {
  if (found && Date.now() - found.at < FIND_EVERY_MS) return found;
  let listing = '';
  try {
    const r = await $.tool.call({ tool: 'ListAgents' });
    const v = (r as { result?: unknown })?.result ?? r;
    listing = typeof v === 'string' ? v : JSON.stringify(v);
    try { const j = JSON.parse(listing); if (typeof j.listing === 'string') listing = j.listing; } catch { /* plain text */ }
  } catch { /* no list: no Deck */ }
  const me = /This session is (.+?) \[[0-9a-f]+\]/.exec(listing)?.[1] ?? null;
  // ANTHRODECK_DECK: another name for the Deck's session, for testing against a stand-in.
  const name = (await $.env.get('ANTHRODECK_DECK')) || DECK;
  const row = new RegExp(`^\\s+${name} \\[([0-9a-f]+)\\]\\s+·\\s+[^·]+?·\\s+(\\S+)`, 'm').exec(listing);
  const deck = row && row[2] !== 'offline' ? `${name} [${row[1]}]` : null;
  found = { deck, me, at: Date.now() };
  await trace($, 'look', { deck, me });
  return found;
}

// ANTHRODECK_DEBUG=<file>: a line there for each thing this does, for troubleshooting.
async function trace($: EngineInterface, what: string, data: unknown = null): Promise<void> {
  const file = await $.env.get('ANTHRODECK_DEBUG');
  if (!file) return;
  const line = JSON.stringify({ at: await $.clock.now(), what, data }) + '\n';
  try { await $.process.run(['sh', '-c', 'cat >> "$1"', 'sh', file], { stdin: line }); } catch { /* nowhere to write */ }
}

// AnthroDeck's own plumbing sessions (the Deck's and the hub) have nothing to send it.
async function plumbing($: EngineInterface): Promise<boolean> {
  return !!(await $.env.get('ADK_RC_ROLE'));
}

// This session's folder, shared with wait.py.
async function folder($: EngineInterface): Promise<string> {
  return `${await $.env.get('HOME')}/.anthrodeck/remote/${await $.session.id()}`;
}

// Every couple of seconds: online while the Deck is reachable, and the new prompts sent to it.
async function tick($: EngineInterface): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const { deck, me } = await look($);
    if (!deck) return;
    const dir = await folder($);
    await $.process.run(['mkdir', '-p', `${dir}/req`, `${dir}/ans`]);
    await $.fs.write(`${dir}/online`, String(Date.now()));
    await $.fs.write(`${dir}/../deck-seen`, String(Date.now()));
    const names = (await $.fs.list(`${dir}/req`)).map((f) => f.name).filter((n) => /^[0-9a-f]{32}\.json$/.test(n));
    const waiting = new Set(names.map((n) => n.slice(0, -5)));
    for (const id of waiting) {
      if (forwarded.has(id)) continue;
      let req: Record<string, unknown>;
      try { req = JSON.parse(String(await $.fs.read(`${dir}/req/${id}.json`))); } catch { continue; }
      const sent = await $.session.send({
        to: deck,
        text: OUT + JSON.stringify({ t: 'ask', id, name: me, sid: await $.session.id(), cwd: req.cwd, tool: req.tool, input: req.input, suggestions: req.suggestions }),
      });
      await trace($, 'ask', { id, tool: req.tool, sent });
      if (sent.isDelivered) forwarded.add(id); else found = null;
    }
    // Settled here (or given up on): the Deck can drop its card.
    for (const id of [...forwarded]) {
      if (waiting.has(id)) continue;
      forwarded.delete(id);
      await $.session.send({ to: deck, text: OUT + JSON.stringify({ t: 'settled', id }) });
    }
  } catch (err) {
    await trace($, 'tick failed', String(err));
  } finally {
    ticking = false;
  }
}

function parse(text: string, tag: string): Record<string, unknown> | null {
  const i = text.indexOf(tag);
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i + tag.length).split('\n')[0]); } catch { return null; }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const r = await next(e);
    if (!(await plumbing($))) {
      void tick($);
      $.clock.every(TICK_MS, () => { void tick($); });
    }
    return r;
  });

  on('classic.Stop', async ($, e, next) => {
    const r = await next(e);
    if (e.agent_id || e.stop_hook_active || await plumbing($)) return r;
    const { deck, me } = await look($);
    const text = (e.last_assistant_message ?? '').trim();
    await trace($, 'stop', { deck, chars: text.length });
    if (deck && text) {
      await $.session.send({ to: deck, text: OUT + JSON.stringify({ t: 'done', name: me, sid: e.session_id, cwd: e.cwd, text: text.slice(0, 6000) }) });
    }
    return r;
  });

  // The Deck's answers: written back for wait.py, and kept out of the conversation.
  on('session.receive', async ($, e, next) => {
    const a = parse(e.text, BACK);
    if (!a) return next(e);
    if (a.t === 'answer' && typeof a.id === 'string' && forwarded.has(a.id)) {
      await $.fs.write(`${await folder($)}/ans/${a.id}.json`, JSON.stringify({ decision: a.decision }));
      await trace($, 'answer', { id: a.id, decision: a.decision });
    }
    return { consumed: 'AnthroDeck' };
  });
};
