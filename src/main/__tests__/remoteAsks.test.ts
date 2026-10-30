import { describe, it, expect } from 'vitest';
import { RemoteAsks } from '../remoteAsks';

const tick = () => new Promise((r) => setTimeout(r, 0));

function rig(pick: (id: string) => string | Promise<string>) {
  const asked: string[] = [];
  const answers: [string, string, unknown][] = [];
  const pings: string[] = [];
  const done: [string, string][] = [];
  const ra = new RemoteAsks({
    ask: async (card, signal) => {
      asked.push(card.question);
      const p = await pick(card.id);
      return signal.aborted ? '' : p;
    },
    answer: (to, id, decision) => answers.push([to, id, decision]),
    onAsk: (name) => pings.push(name),
    onDone: (name, text) => done.push([name, text]),
  });
  return { ra, asked, answers, pings, done };
}

describe('prompts and finished turns from the AnthroDeck plugin', () => {
  it('asks the pilot and sends the decision back to that session', async () => {
    const { ra, asked, answers, pings } = rig(() => 'allow');
    ra.receive('bridge:session_x', { t: 'ask', id: 'a1', name: 'Fix login', cwd: '/r', tool: 'Bash', input: { command: 'npm test', description: 'Run the tests' } });
    await tick(); await tick();
    expect(pings).toEqual(['Fix login']);
    expect(asked).toEqual(['Run the tests']);
    expect(answers).toEqual([['bridge:session_x', 'a1', { behavior: 'allow' }]]);
  });

  it('takes the card away when the prompt was answered on its own computer, and never answers then', async () => {
    let release: (v: string) => void = () => {};
    const { ra, answers } = rig(() => new Promise<string>((r) => { release = r; }));
    ra.receive('bridge:s', { t: 'ask', id: 'a2', tool: 'Bash', input: {} });
    await tick();
    ra.receive('bridge:s', { t: 'settled', id: 'a2' });
    release('allow');
    await tick(); await tick();
    expect(answers).toEqual([]);
  });

  it('passes a finished turn on, named by session or folder', () => {
    const { ra, done } = rig(() => 'allow');
    ra.receive('bridge:s', { t: 'done', name: 'Fix login', text: 'All tests pass.' });
    ra.receive('bridge:s', { t: 'done', cwd: '/Users/me/app', text: 'Done.' });
    ra.receive('bridge:s', { t: 'done', name: 'Empty', text: '  ' });
    expect(done).toEqual([['Fix login', 'All tests pass.'], ['app', 'Done.']]);
  });
});
