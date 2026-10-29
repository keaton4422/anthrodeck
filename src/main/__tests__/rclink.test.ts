import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';
import { DeckRc, RcChannel, linkSpawner, parsePeers, pickHub, writeMod } from '../rclink';
import { MOD_FILES, REGISTER_JS } from '../rclink/mod';

const LISTING = `This session is anthrodeck-deck [d96df7] — the name other sessions use to message it.

Peer sessions (3):
  Fix the login bug [f95f46]  ·  Remote Control  ·  running
  anthrodeck-hub [0a1b2c]  ·  Remote Control  ·  offline
  anthrodeck-hub [fa1763]  ·  Remote Control  ·  idle`;

describe('the Remote Control listing', () => {
  it('reads ListAgents rows', () => {
    expect(parsePeers(LISTING)).toEqual([
      { name: 'Fix the login bug', ref: 'f95f46', kind: 'Remote Control', status: 'running' },
      { name: 'anthrodeck-hub', ref: '0a1b2c', kind: 'Remote Control', status: 'offline' },
      { name: 'anthrodeck-hub', ref: 'fa1763', kind: 'Remote Control', status: 'idle' },
    ]);
  });
  it('picks the hub that is online, addressed the way SendMessage names it', () => {
    expect(pickHub(parsePeers(LISTING))).toBe('anthrodeck-hub [fa1763]');
    expect(pickHub(parsePeers(LISTING.replace('idle', 'offline')))).toBeNull();
  });
});

describe('the mod', () => {
  it('is written out once and left alone when unchanged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-mod-'));
    writeMod(dir);
    expect(fs.readFileSync(path.join(dir, 'hooks/register.js'), 'utf8')).toBe(REGISTER_JS);
    expect(Object.keys(MOD_FILES).every((f) => fs.existsSync(path.join(dir, f)))).toBe(true);
    const t = fs.statSync(path.join(dir, 'hooks/register.js')).mtimeMs;
    writeMod(dir);
    expect(fs.statSync(path.join(dir, 'hooks/register.js')).mtimeMs).toBe(t);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// A stand-in for the mod in the Deck's link session: it long-polls the app, answers a peers
// request with a listing, and plays the hub's side of a channel.
function fakeMod(env: NodeJS.ProcessEnv, hub: (to: string, body: Record<string, unknown>, post: (b: object) => Promise<void>) => void) {
  let on = true;
  const post = (b: object) => fetch(`${env.ADK_RC_URL}/in?t=${env.ADK_RC_TOKEN}`, { method: 'POST', body: JSON.stringify(b) }).then(() => undefined, () => undefined);
  void (async () => {
    while (on) {
      const r = await fetch(`${env.ADK_RC_URL}/out?t=${env.ADK_RC_TOKEN}`).then((x) => x.json()).catch(() => null) as
        { quit?: boolean; peers?: boolean; msgs?: { to: string; body: Record<string, unknown> }[] } | null;
      if (!r || r.quit) return;
      if (r.peers) await post({ kind: 'peers', listing: LISTING });
      for (const m of r.msgs ?? []) hub(m.to, m.body, (b) => post({ kind: 'msg', from: 'bridge:session_x', body: { ch: m.body.ch, ...b } }));
    }
  })();
  return () => { on = false; };
}

describe('the Deck\'s link session', () => {
  let home: string;
  let prevHome: string | undefined;
  let rc: DeckRc;
  let stopMod: (() => void) | null = null;
  const seen: { to: string; body: Record<string, unknown> }[] = [];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-rc-'));
    prevHome = process.env.HOME;
    process.env.HOME = home;
    seen.length = 0;
    rc = new DeckRc({
      claudePath: () => '/bin/claude',
      spawnPty: (_args, env) => {
        // "Claude Code" comes up connected, and its mod starts polling.
        fs.mkdirSync(path.join(home, '.anthrodeck/rc/deck'), { recursive: true });
        fs.writeFileSync(path.join(home, '.anthrodeck/rc/deck/status.json'), JSON.stringify({ state: 'connected', session: 'session_deck' }));
        stopMod = fakeMod(env, (to, body, reply) => {
          seen.push({ to, body });
          if (body.op === 'open') void reply({ out: '{"live":[],"requests":[],"relay":1}\n' });
          if (body.op === 'in') void reply({ out: `${JSON.stringify({ sent: { id: 's1', ok: true } })}\n` });
          if (body.op === 'close') void reply({ closed: true });
        });
        const child = new EventEmitter() as ChildProcess;
        child.kill = () => true;
        return child;
      },
    });
  });
  afterEach(() => {
    stopMod?.();
    rc.stop();
    process.env.HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('opens a channel to the hub that behaves like the watcher over SSH', async () => {
    const ch = new RcChannel(rc, 'MacBook-Pro', 'print("watcher")');
    const lines: string[] = [];
    ch.stdout.setEncoding('utf8');
    ch.stdout.on('data', (d: string) => lines.push(...d.split('\n').filter(Boolean)));
    ch.stdin.write('{"op":"send","id":"s1","sessionId":"abc","text":"hi"}\n');
    await expect.poll(() => lines.length, { timeout: 5000 }).toBe(2);
    expect(JSON.parse(lines[0])).toEqual({ live: [], requests: [], relay: 1 });
    expect(JSON.parse(lines[1])).toEqual({ sent: { id: 's1', ok: true } });
    const open = seen.find((m) => m.body.op === 'open')!;
    expect(open.to).toBe('anthrodeck-hub [fa1763]');
    expect(open.body.script).toBe('print("watcher")');
    // What was written before the hub was found waited, then went in whole.
    expect(seen.find((m) => m.body.op === 'in')?.body.data).toBe('{"op":"send","id":"s1","sessionId":"abc","text":"hi"}\n');

    const closed = new Promise((r) => ch.on('close', r));
    ch.kill();
    await closed;
    await expect.poll(() => seen.some((m) => m.body.op === 'close'), { timeout: 5000 }).toBe(true);
  });

  it('closes with the reason when there is no hub to reach', async () => {
    (rc as unknown as { peers: () => Promise<string> }).peers = async () => 'Peer sessions (0):';
    const ch = new RcChannel(rc, 'MacBook-Pro', '');
    let err = '';
    ch.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    await new Promise((r) => ch.on('close', r));
    expect(err).toMatch(/hub on MacBook-Pro isn't running/);
  });
});

describe('choosing SSH or Remote Control', () => {
  const sshChild = (stderr: string, out = '') => {
    const c = new EventEmitter() as ChildProcess & { stdout: PassThrough; stderr: PassThrough };
    c.stdout = new PassThrough(); c.stderr = new PassThrough();
    c.kill = () => true;
    setImmediate(() => {
      if (out) c.stdout.write(out);
      c.stderr.write(stderr);
      setImmediate(() => c.emit('close', 255));
    });
    return c;
  };
  const rc = {} as DeckRc;

  it('moves to Remote Control once every address is unreachable, and not for other failures', async () => {
    const vias: string[] = [];
    const s = linkSpawner({
      host: 'mac', label: 'Mac', script: '', addresses: () => 2, rc: () => rc, onVia: (v) => vias.push(v),
      spawnSsh: () => sshChild('ssh: Could not resolve hostname mac.local'),
      probe: async () => false,
    });
    s.spawn([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.via()).toBe('ssh');           // one address of two failed: SSH tries the other
    s.spawn([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.via()).toBe('rc');
    expect(vias).toEqual(['rc']);
    s.preferSsh();                         // the Deck woke: try SSH first again
    expect(s.via()).toBe('ssh');
    s.stop();

    const denied = linkSpawner({
      host: 'mac', label: 'Mac', script: '', addresses: () => 1, rc: () => rc,
      spawnSsh: () => sshChild('Permission denied (publickey).'),
    });
    denied.spawn([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(denied.via()).toBe('ssh');
    denied.stop();
  });

  it('stays on SSH when the Remote Control link is off', async () => {
    const s = linkSpawner({
      host: 'mac', label: 'Mac', script: '', addresses: () => 1, rc: () => null,
      spawnSsh: () => sshChild('ssh: connect to host mac port 22: Operation timed out'),
    });
    s.spawn([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.via()).toBe('ssh');
    s.stop();
  });
});
