// The in-app folder picker's view of the disk. The system dialog can't be used on the Deck: in
// Game Mode Electron's file chooser goes through the desktop portal, which isn't reachable there
// ("Failed to read portal version property"), so "Open folder" did nothing. An in-app picker also
// works with the D-pad.
//
// Pure (the filesystem is injected) so it unit-tests.

import path from 'path';

export interface FolderEntry {
  name: string;
  path: string;
  git: boolean;      // has a .git, so probably a project
}

export interface FolderListing {
  path: string;
  parent: string | null;   // null at the filesystem root
  folders: FolderEntry[];
  error?: string;
}

export interface FolderDeps {
  readDir(dir: string): { name: string; isDir: boolean }[];
  exists(p: string): boolean;
}

// Subfolders of `dir`: hidden ones left out, git repositories first, then by name.
export function listFolders(dir: string, d: FolderDeps): FolderListing {
  const abs = path.resolve(dir);
  const parent = path.dirname(abs) === abs ? null : path.dirname(abs);
  let entries: { name: string; isDir: boolean }[];
  try {
    entries = d.readDir(abs);
  } catch (e) {
    return { path: abs, parent, folders: [], error: (e as Error).message };
  }
  const folders = entries
    .filter((e) => e.isDir && !e.name.startsWith('.'))
    .map((e) => {
      const p = path.join(abs, e.name);
      return { name: e.name, path: p, git: d.exists(path.join(p, '.git')) };
    })
    .sort((a, b) => (a.git === b.git ? a.name.localeCompare(b.name) : a.git ? -1 : 1));
  return { path: abs, parent, folders };
}

// A new project folder's name: one plain path segment.
export function folderNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the folder a name.';
  if (n === '.' || n === '..') return 'That name is reserved.';
  if (/[/\\\0]/.test(n)) return 'A folder name can\'t contain slashes.';
  if (n.startsWith('.')) return 'Hidden folders (starting with ".") aren\'t shown in the picker.';
  if (n.length > 80) return 'Keep it under 80 characters.';
  return null;
}
