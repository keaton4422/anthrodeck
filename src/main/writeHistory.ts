import fs from 'fs';
import path from 'path';

// Remembers the previous contents of files the agent writes so the L1+Y / radial "undo last write"
// chord can roll one back. In-memory only and intentionally shallow (a small stack, newest last) —
// this is an oops-button for the pilot, not a version-control substitute.

export interface WriteRecord {
  absPath: string;
  relPath: string;
  previous: string | null; // null => the file did not exist before this write
}

const MAX_HISTORY = 20;
const history: WriteRecord[] = [];

// Call immediately BEFORE writing so we capture the pre-write state.
export function recordWrite(absPath: string, relPath: string): void {
  let previous: string | null = null;
  try {
    previous = fs.readFileSync(absPath, 'utf-8');
  } catch {
    previous = null; // new file
  }
  history.push({ absPath, relPath, previous });
  if (history.length > MAX_HISTORY) history.shift();
}

export function lastWrite(): WriteRecord | null {
  return history.length > 0 ? history[history.length - 1] : null;
}

export function clearWriteHistory(): void {
  history.length = 0;
}

export interface UndoResult {
  ok: boolean;
  message: string;
  relPath?: string;
}

// Restore the most recent write: rewrite the previous content, or delete the file if the write
// created it. Pops the entry either way so repeated undos walk backwards.
export function undoLastWrite(): UndoResult {
  const rec = history.pop();
  if (!rec) return { ok: false, message: 'Nothing to undo.' };

  try {
    if (rec.previous === null) {
      if (fs.existsSync(rec.absPath)) fs.unlinkSync(rec.absPath);
      return { ok: true, message: `Removed ${rec.relPath} (it was newly created).`, relPath: rec.relPath };
    }
    fs.mkdirSync(path.dirname(rec.absPath), { recursive: true });
    fs.writeFileSync(rec.absPath, rec.previous, 'utf-8');
    return { ok: true, message: `Reverted ${rec.relPath}.`, relPath: rec.relPath };
  } catch (e) {
    return { ok: false, message: `Undo failed: ${(e as Error).message}` };
  }
}
