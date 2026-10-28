import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, execFile, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { HeldProcess, reconnectHeld } from '../held';

// The holder script runs for real here, on this machine, with `cat` standing in for Claude Code:
// what goes in comes back out. "SSH" is a local shell, so cutting the link is killing that shell.

let home: string;
let links: ChildProcess[];
const env = () => ({ ...process.env, HOME: home });
const deps = () => ({
  spawnSsh: (args: string[]) => {
    const c = spawn('sh', ['-c', args[args.length - 1]], { stdio: ['pipe', 'pipe', 'pipe'], env: env() });
    links.push(c);
    return c;
  },
  exec: (_host: string, command: string) => new Promise<{ code: number }>((resolve) =>
    execFile('sh', ['-c', command], { env: env() }, (err) => resolve({ code: err ? 1 : 0 }))),
});
const lines = (h: HeldProcess) => {
  const got: string[] = [];
  let buf = '';
  h.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) { got.push(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  });
  return got;
};
const until = async (ok: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 30));
  }
};
const exited = (h: HeldProcess) => new Promise<number | null>((r) => h.once('exit', (code) => r(code)));

beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-held-')); links = []; });
afterEach(() => { for (const c of links) c.kill('SIGKILL'); fs.rmSync(home, { recursive: true, force: true }); });

describe('held sessions', () => {
  it('passes input and output through, and ends cleanly when the input closes', async () => {
    const h = new HeldProcess('mac', 'a1', 'cat', deps());
    const got = lines(h);
    h.stdin.write('{"n":1}\n');
    await until(() => got.length === 1);
    const done = exited(h);
    h.stdin.end('{"n":2}\n');
    expect(await done).toBe(0);
    expect(got).toEqual(['{"n":1}', '{"n":2}']);
  });

  it('keeps Claude running when the link drops, and loses nothing either way', async () => {
    const states: string[] = [];
    const h = new HeldProcess('mac', 'b2', 'cat', { ...deps(), onLink: (s) => states.push(s) });
    const got = lines(h);
    h.stdin.write('one\n');
    await until(() => got.length === 1);

    // The hotspot drops. Claude (cat) is untouched; what's written meanwhile waits on the Deck.
    links[0].kill('SIGKILL');
    await until(() => states.includes('reconnecting'));
    h.stdin.write('two\n');
    h.stdin.write('three\n');
    await until(() => got.length === 3);
    expect(states).toEqual(['reconnecting', 'connected']);
    expect(got).toEqual(['one', 'two', 'three']);

    // Output written on the Mac while the Deck was away arrives once, in order.
    links[links.length - 1].kill('SIGKILL');
    const dir = path.join(home, '.anthrodeck', 'held', 'b2');
    await until(() => states.length === 3);
    fs.appendFileSync(path.join(dir, 'in'), 'four\n');
    reconnectHeld();
    await until(() => got.length === 4);
    expect(got).toEqual(['one', 'two', 'three', 'four']);

    const done = exited(h);
    h.stdin.end();
    expect(await done).toBe(0);
  });

  it('reports a session that is gone from the other computer as an exit', async () => {
    const h = new HeldProcess('mac', 'c3', 'cat', deps());
    const got = lines(h);
    h.stdin.write('x\n');
    await until(() => got.length === 1);
    links[0].kill('SIGKILL');
    fs.rmSync(path.join(home, '.anthrodeck', 'held', 'c3'), { recursive: true, force: true });
    expect(await exited(h)).toBe(1);
  });

  it('kills Claude on the other computer when the SDK kills it', async () => {
    const h = new HeldProcess('mac', 'd4', 'sleep 30', deps());
    await until(() => fs.existsSync(path.join(home, '.anthrodeck', 'held', 'd4', 'pid')));
    const done = exited(h);
    h.kill('SIGTERM');
    await done;
    const pid = Number(fs.readFileSync(path.join(home, '.anthrodeck', 'held', 'd4', 'pid'), 'utf8'));
    await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
  });
});
