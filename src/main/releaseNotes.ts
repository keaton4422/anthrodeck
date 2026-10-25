// Turns the release notes electron-updater hands us into a short "what's new" for the pilot.
//
// They arrive as HTML from the GitHub releases feed, GitHub's auto-generated notes: a "What's
// Changed" list of PR titles ("fix(game): a race that lasts… by @user in #3") and a "Full
// Changelog" link. Two problems: HTML must never reach the renderer as markup, and none of that
// reads well on a Deck. So this extracts plain text and strips the developer noise.
//
// Pure — no Electron — so it unit-tests.

export interface WhatsNew {
  version: string | null;
  items: string[];
}

// What the renderer is told when an update is found.
export interface UpdateAvailable {
  version: string;
  notes: WhatsNew[];
  // Set when this build can't update itself (Windows zip): the release page to download from.
  manualUrl?: string;
}

// electron-updater's UpdateInfo.releaseNotes: one HTML string for the latest release, or (with
// fullChangelog on) one note per release newer than the installed version, newest first.
export type RawReleaseNotes = string | { version: string; note: string | null }[] | null | undefined;

const MAX_VERSIONS = 3;
const MAX_ITEMS = 6;
const MAX_ITEM_CHARS = 140;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function toText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

// "fix(game): a race that lasts the session by @keaton4422 in #3" → "A race that lasts the session"
export function cleanItem(raw: string): string {
  let s = raw
    .replace(/\s+by @[\w-]+(\[bot\])?\s+in\s+(#\d+|https?:\/\/\S+)\s*$/i, '')
    .replace(/\s+in\s+(#\d+|https?:\/\/\S+)\s*$/i, '')
    .replace(/^(feat|fix|chore|ci|docs|refactor|perf|test|build|style)(\([^)]*\))?!?:\s*/i, '')
    .trim();
  if (s) s = s[0].toUpperCase() + s.slice(1);
  return s.length > MAX_ITEM_CHARS ? `${s.slice(0, MAX_ITEM_CHARS - 1).trimEnd()}…` : s;
}

export function parseNote(html: string): string[] {
  const listItems = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => toText(m[1]));
  // Notes written by hand may be paragraphs rather than a list.
  const lines = listItems.length
    ? listItems
    : html.split(/<\/p>|<br\s*\/?>|\n/i).map(toText);
  return lines
    .filter((l) => l && !/^(full changelog|what'?s changed|new contributors)\b/i.test(l))
    .map(cleanItem)
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

export function whatsNew(raw: RawReleaseNotes): WhatsNew[] {
  if (!raw) return [];
  const notes = typeof raw === 'string' ? [{ version: null, note: raw }] : raw;
  return notes
    .slice(0, MAX_VERSIONS)
    .map((n) => ({ version: n.version, items: n.note ? parseNote(n.note) : [] }))
    .filter((n) => n.items.length > 0);
}
