import { describe, it, expect } from 'vitest';
import path from 'path';
import { listFolders, folderNameProblem, type FolderDeps } from '../folders';

// Built with path.resolve so the same test holds on Windows (where '/home/deck' is 'D:\\home\\deck').
const HOME = path.resolve('/home/deck');
const tree: Record<string, { name: string; isDir: boolean }[]> = {
  [HOME]: [
    { name: 'zeta', isDir: true },
    { name: 'alpha', isDir: true },
    { name: 'my-app', isDir: true },
    { name: '.config', isDir: true },
    { name: 'notes.txt', isDir: false },
  ],
};
const deps: FolderDeps = {
  readDir: (d) => { if (!tree[d]) throw new Error(`EACCES: ${d}`); return tree[d]; },
  exists: (p) => p === path.join(HOME, 'my-app', '.git'),
};

describe('listFolders', () => {
  it('lists subfolders: projects (git) first, then by name, hidden and files left out', () => {
    const l = listFolders(HOME, deps);
    expect(l.parent).toBe(path.dirname(HOME));
    expect(l.folders.map((f) => [f.name, f.git])).toEqual([['my-app', true], ['alpha', false], ['zeta', false]]);
    expect(l.folders[0].path).toBe(path.join(HOME, 'my-app'));
  });

  it('reports an unreadable folder instead of throwing, and knows the root has no parent', () => {
    const l = listFolders('/root', deps);
    expect(l.folders).toEqual([]);
    expect(l.error).toMatch(/EACCES/);
    expect(listFolders(path.parse(HOME).root, { readDir: () => [], exists: () => false }).parent).toBeNull();
  });
});

describe('folderNameProblem', () => {
  it('accepts a plain name and rejects paths, reserved and hidden names', () => {
    expect(folderNameProblem('racing-game')).toBeNull();
    expect(folderNameProblem('  ')).toMatch(/name/);
    expect(folderNameProblem('..')).toMatch(/reserved/);
    expect(folderNameProblem('a/b')).toMatch(/slashes/);
    expect(folderNameProblem('.secret')).toMatch(/Hidden/);
    expect(folderNameProblem('x'.repeat(81))).toMatch(/80/);
  });
});
