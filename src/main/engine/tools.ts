// Pure helpers over Claude Code's built-in tools: how a call is labelled on the cockpit, what a file
// edit will produce (so the pilot reviews the result, not a diff fragment), and which shell runs
// count as real-world milestones. No SDK import — inputs are plain records — so all of it tests.

import path from 'path';

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

// Project-relative path for display; absolute paths outside the project stay absolute.
export function displayPath(p: string, root: string): string {
  if (!p) return '';
  if (!path.isAbsolute(p) || !root) return p;
  const rel = path.relative(root, p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p;
}

export function filePathOf(input: Input): string {
  return str(input.file_path) || str(input.notebook_path) || str(input.path);
}

// Inline activity line appended to the assistant bubble. The leading word of each label is what
// the renderer's collapse filter keys on (see TOOL_LINE in renderer/lib/pilot.ts) — keep in sync.
export function toolLabel(name: string, input: Input, root: string): string {
  const p = displayPath(filePathOf(input), root);
  switch (name) {
    case 'Read': return `read: ${p}`;
    case 'Write': return `write: ${p}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': return `edit: ${p}`;
    case 'Bash': return `$ ${str(input.command).split('\n')[0].slice(0, 120)}`;
    case 'Glob': return `glob: ${str(input.pattern)}`;
    case 'Grep': return `grep: ${str(input.pattern)}`;
    case 'WebFetch': return `web: ${str(input.url)}`;
    case 'WebSearch': return `web: ${str(input.query)}`;
    case 'AskUserQuestion': return 'ask: question for the pilot';
    case 'Agent':
    case 'Task': return `agent: ${str(input.description) || str(input.subagent_type) || 'subagent'}`;
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate': return 'plan: sectors updated';
    default: return `tool: ${name.replace(/^mcp__/, '').replace(/__/g, ' · ')}`;
  }
}

// Tools that only feed the HUD and would be noise as chat lines.
export function isQuietTool(name: string): boolean {
  return name === 'TodoWrite' || name === 'TaskCreate' || name === 'TaskUpdate' || name === 'TaskList'
    || name === 'TaskGet';
}

function applyEdit(content: string, oldS: string, newS: string, all: boolean): string | null {
  if (!oldS) return null;
  if (!content.includes(oldS)) return null;
  return all ? content.split(oldS).join(newS) : content.replace(oldS, () => newS);
}

// The full file content a write/edit will leave behind, so the existing write-preview card can show
// the pilot exactly what lands. `current` is the file on disk (null when it does not exist yet).
// Returns null when the result can't be computed (e.g. old_string not found) — the caller falls
// back to a plain approve/deny card and lets Claude Code report the failure itself.
export function proposedContent(name: string, input: Input, current: string | null): string | null {
  if (name === 'Write') return str(input.content);
  if (name === 'Edit') {
    if (current === null) return null;
    return applyEdit(current, str(input.old_string), str(input.new_string), !!input.replace_all);
  }
  if (name === 'MultiEdit') {
    if (current === null || !Array.isArray(input.edits)) return null;
    let out: string | null = current;
    for (const e of input.edits as Input[]) {
      if (out === null) return null;
      out = applyEdit(out, str(e.old_string), str(e.new_string), !!e.replace_all);
    }
    return out;
  }
  return null;
}

// ─── Milestones: shell runs that mean something happened in the real world ──────
export type Milestone = 'tests-pass' | 'tests-fail' | 'build-pass' | 'build-fail' | 'commit' | 'push';

const TEST_RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|npx\s+(?:vitest|jest|playwright\s+test)|vitest|jest|pytest|go\s+test|cargo\s+test|mix\s+test|rspec|phpunit|dotnet\s+test)\b/;
const BUILD_RE = /\b(?:(?:npm|pnpm|yarn|bun)\s+run\s+(?:build|typecheck|lint)|tsc\b|cargo\s+build|go\s+build|make(?:\s|$)|gradle\w*\s+build|xcodebuild)/;

export function milestoneFor(command: string, ok: boolean): Milestone | null {
  const cmd = command.trim();
  if (!cmd) return null;
  // Order matters: `git commit && git push` is a push.
  if (/\bgit\s+push\b/.test(cmd)) return ok ? 'push' : null;
  if (/\bgit\s+commit\b/.test(cmd)) return ok ? 'commit' : null;
  if (TEST_RE.test(cmd)) return ok ? 'tests-pass' : 'tests-fail';
  if (BUILD_RE.test(cmd)) return ok ? 'build-pass' : 'build-fail';
  return null;
}

// ─── Sectors: Claude's own task list, rendered as the lap ──────────────────────
export type SectorStatus = 'pending' | 'in_progress' | 'completed';
export interface Sector { id: string; title: string; status: SectorStatus }

const isStatus = (s: unknown): s is SectorStatus =>
  s === 'pending' || s === 'in_progress' || s === 'completed';

// Tracks the lap across both task-list flavours Claude Code has shipped: TodoWrite (the whole list
// replaced each call) and TaskCreate/TaskUpdate (incremental, ids from the TaskCreated hook).
export class SectorBoard {
  private sectors: Sector[] = [];

  list(): Sector[] {
    return this.sectors.map((s) => ({ ...s }));
  }

  reset(): void {
    this.sectors = [];
  }

  // Returns the sectors that flipped to completed in this update.
  private diff(before: Sector[]): Sector[] {
    const was = new Map(before.map((s) => [s.id, s.status]));
    return this.sectors.filter((s) => s.status === 'completed' && was.get(s.id) !== 'completed');
  }

  applyTodoWrite(input: Input): Sector[] {
    if (!Array.isArray(input.todos)) return [];
    const before = this.sectors;
    this.sectors = (input.todos as Input[]).map((t, i) => ({
      // TodoWrite has no ids; content is the stable key across rewrites of the same list.
      id: `todo:${str(t.content) || i}`,
      title: str(t.content),
      status: isStatus(t.status) ? t.status : 'pending',
    }));
    return this.diff(before);
  }

  taskCreated(id: string, subject: string): void {
    if (!id || this.sectors.some((s) => s.id === `task:${id}`)) return;
    this.sectors = [...this.sectors, { id: `task:${id}`, title: subject, status: 'pending' }];
  }

  applyTaskUpdate(input: Input): Sector[] {
    const id = `task:${str(input.taskId)}`;
    const before = this.sectors;
    if (input.status === 'deleted') {
      this.sectors = this.sectors.filter((s) => s.id !== id);
      return [];
    }
    this.sectors = this.sectors.map((s) => s.id !== id ? s : {
      ...s,
      title: str(input.subject) || s.title,
      status: isStatus(input.status) ? input.status : s.status,
    });
    return this.diff(before);
  }

  taskCompleted(id: string): Sector[] {
    return this.applyTaskUpdate({ taskId: id, status: 'completed' });
  }
}
