import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ACTIVITY_PY, toActivity, type RawActivity } from '../activity';

describe('the drawer\'s project activity', () => {
  it.skipIf(process.platform === 'win32')('reads the branch, the latest release and what landed since, and the last commits', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-activity-'));
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=T', '-c', 'user.email=t@t', ...a]);
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'first');
    git('tag', 'v1.0');
    git('commit', '-q', '--allow-empty', '-m', 'second');
    git('commit', '-q', '--allow-empty', '-m', 'third');
    fs.writeFileSync(path.join(repo, 'wip.txt'), 'x');
    const out = execFileSync('python3', ['-c', ACTIVITY_PY, JSON.stringify([repo, os.tmpdir()])]).toString();
    const [p, ...rest] = toActivity(JSON.parse(out) as RawActivity[]);
    expect(rest).toEqual([]);                         // not a repository: left out
    expect(p.git).toMatchObject({ branch: 'main', changes: 1 });
    expect(p.release).toMatchObject({ tag: 'v1.0', since: 2 });
    expect(p.today).toBe(3);
    expect(p.commits.map((c) => c.subject)).toEqual(['third', 'second', 'first']);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});
