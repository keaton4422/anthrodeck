// This device's Claude Code sessions, for the home dashboard: what to show on each card, and the
// conversation to put back on screen when one is reopened.
//
// Claude Code keeps sessions per machine (~/.claude/projects), so a Deck lists the sessions run on
// the Deck. The SDK's listSessions / getSessionMessages read them; this file only shapes the result.
// Pure, so it unit-tests; the bridge does the I/O.

import path from 'path';
import type { SDKSessionInfo, SessionMessage } from '@anthropic-ai/claude-agent-sdk';

export interface SessionCard {
  id: string;
  title: string;
  project: string;          // folder name, for the card
  cwd: string;
  branch: string | null;
  lastModified: number;
}

// A turn restored into the chat. Same shape the renderer's ChatMessage needs.
export interface RestoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  anchor?: string | null;   // assistant turns: the uuid a rewind to this turn resumes from
}

const MAX_TITLE = 90;

function shorten(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_TITLE ? `${one.slice(0, MAX_TITLE - 1).trimEnd()}…` : one;
}

// Newest first. Sessions without a folder, or whose folder isn't on this device any more, can't be
// resumed, so they're left out rather than shown as dead ends.
export function toSessionCards(infos: SDKSessionInfo[], exists: (dir: string) => boolean, limit = 30): SessionCard[] {
  return infos
    .filter((s) => !!s.cwd && exists(s.cwd))
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, limit)
    .map((s) => ({
      id: s.sessionId,
      title: shorten(s.customTitle || s.summary || s.firstPrompt || 'Untitled session'),
      project: path.basename(s.cwd!) || s.cwd!,
      cwd: s.cwd!,
      // Claude Code records "HEAD" outside a git repo (and when detached): no branch to show.
      branch: s.gitBranch && s.gitBranch !== 'HEAD' ? s.gitBranch : null,
      lastModified: s.lastModified,
    }));
}

type Block = { type?: string; text?: string };

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Block[])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('\n');
}

// Claude Code writes its own bookkeeping into the user turns: slash-command echoes, local command
// output, the "Caveat:" preamble. None of it is something the pilot said.
const NOT_FROM_PILOT = /^\s*(<command-|<local-command-|<system-reminder>|Caveat:)/;
const CONFIDENCE = /\s*<confidence>\s*(?:high|medium|med|low)\s*<\/confidence>\s*$/i;

// The conversation as the chat shows it: the pilot's prompts and Claude's replies. Tool calls,
// tool results and subagent traffic are left out. Claude Code stores one assistant message per
// content block, so a turn's consecutive assistant messages are merged into one bubble whose
// anchor is the last of them, which is where a rewind to that turn resumes.
export function toRestoredMessages(msgs: SessionMessage[], now: number = Date.now()): RestoredMessage[] {
  const out: RestoredMessage[] = [];
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue;
    const message = (m.message ?? {}) as { content?: unknown };
    if (m.type === 'user') {
      const text = textOf(message.content).trim();
      if (!text || NOT_FROM_PILOT.test(text)) continue;
      out.push({ id: m.uuid, role: 'user', content: text, timestamp: now });
    } else if (m.type === 'assistant') {
      const text = textOf(message.content).replace(CONFIDENCE, '').trim();
      const last = out[out.length - 1];
      if (last && last.role === 'assistant') {
        if (text) last.content = last.content ? `${last.content}\n\n${text}` : text;
        last.anchor = m.uuid;
      } else if (text) {
        out.push({ id: m.uuid, role: 'assistant', content: text, timestamp: now, anchor: m.uuid });
      }
    }
  }
  return out;
}

// ─── Projects: the pit wall's programs ────────────────────────────────────────

export interface GitState {
  branch: string | null;    // null = detached HEAD
  ahead: number;
  behind: number;
  changes: number;          // uncommitted files (staged, unstaged, untracked)
}

export interface ProjectTile {
  cwd: string;
  name: string;
  lastModified: number;     // the latest stint in it
  sessions: SessionCard[];  // newest first
  git: GitState | null;     // null = not a git repository (or git unavailable)
}

// `git status --porcelain=v1 -b`: a "## branch...upstream [ahead 1, behind 2]" header, then one
// line per changed file.
export function parseGitStatus(out: string): GitState {
  const [head = '', ...files] = out.split('\n');
  let branch: string | null = null;
  const h = head.replace(/^##\s*/, '');
  const noCommits = /^No commits yet on (.+)$/.exec(h);
  if (noCommits) branch = noCommits[1];
  else if (!/^HEAD \(no branch\)/.test(h)) branch = h.split('...')[0].split(' ')[0] || null;
  const ahead = /ahead (\d+)/.exec(h);
  const behind = /behind (\d+)/.exec(h);
  return {
    branch,
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    changes: files.filter((l) => l.trim()).length,
  };
}

// Group the session cards into projects, most recently worked on first.
export function toProjects(cards: SessionCard[], git: Record<string, GitState | null> = {}, limit = 12): ProjectTile[] {
  const byCwd = new Map<string, SessionCard[]>();
  for (const c of cards) {
    const list = byCwd.get(c.cwd) ?? [];
    list.push(c);
    byCwd.set(c.cwd, list);
  }
  return [...byCwd.entries()]
    .map(([cwd, sessions]) => {
      sessions.sort((a, b) => b.lastModified - a.lastModified);
      return { cwd, name: sessions[0].project, lastModified: sessions[0].lastModified, sessions, git: git[cwd] ?? null };
    })
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, limit);
}
