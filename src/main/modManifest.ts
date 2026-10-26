// Cockpit mods — the manifest contract, shared by main (loader, protocol) and renderer (picker).
//
// Pure on purpose: no fs, no electron. Everything a mod declares passes through parseManifest()
// before anything else looks at it, so this file is the one place the shape is enforced.
// See docs/MODS.md.

// Mod files are served from this scheme, one host per mod: anthrodeck-mod://<id>/<path>.
export const MOD_SCHEME = 'anthrodeck-mod';

// Served by the loader itself, never from the mod's folder: the page that hosts a game mod and the
// runtime that drives it. A mod can't ship files under this prefix.
export const RUNTIME_PREFIX = '__cockpit__/';
export const HOST_PAGE = `${RUNTIME_PREFIX}host.html`;

// What a mod's own page may do. No network (connect-src falls back to 'none'), no inline script, no
// eval, no frames, no forms, no navigating anywhere. Scripts only from the mod's own folder.
export const MOD_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export interface ModGame {
  kind: 'telemetry' | 'freeplay';
  entry: string; // script inside the mod's folder that calls anthrodeck.registerMode()
  blurb: string;
}

export interface ModManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  game?: ModGame;
}

// What the loader hands the renderer: every mod that loaded, and why each other folder didn't.
export interface ModScan {
  mods: ModManifest[];
  problems: { folder: string; message: string }[];
}

export type ParsedManifest =
  | { ok: true; manifest: ModManifest; warnings: string[] }
  | { ok: false; error: string };

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
// Keys reserved for later kinds of mod (docs/MODS.md). Accepted so a manifest written for a newer
// AnthroDeck still loads its game; ignored with a warning until they're implemented.
const RESERVED = ['theme', 'sounds'];
const KNOWN = ['id', 'name', 'version', 'author', 'description', 'game', ...RESERVED];

export function isModId(s: string): boolean {
  return ID_RE.test(s);
}

// A path inside the mod's folder: relative, plain characters only, no '..', no dotfiles, nothing
// under the runtime prefix. Plain characters keep it safe to drop into a URL or an HTML attribute.
const SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
export function isSafeModPath(p: string): boolean {
  if (!p || p.length > 200 || p.startsWith(RUNTIME_PREFIX)) return false;
  return p.split('/').every((seg) => SEGMENT_RE.test(seg));
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null;
}

// `folder` is the directory the manifest was found in. The id must match it, so the URL host, the
// folder and the id are always the same string and can't be played off against each other.
export function parseManifest(raw: unknown, folder: string): ParsedManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'mod.json is not an object' };
  const r = raw as Record<string, unknown>;
  const warnings: string[] = [];

  const id = typeof r.id === 'string' ? r.id : '';
  if (!isModId(id)) return { ok: false, error: 'id must be 2-40 chars of a-z, 0-9 and -' };
  if (id !== folder) return { ok: false, error: `id "${id}" does not match its folder "${folder}"` };
  const name = str(r.name, 40);
  if (!name) return { ok: false, error: 'name is required (up to 40 chars)' };
  const version = str(r.version, 20);
  if (!version) return { ok: false, error: 'version is required' };

  const manifest: ModManifest = { id, name, version };
  const author = str(r.author, 60);
  if (author) manifest.author = author;
  const description = str(r.description, 280);
  if (description) manifest.description = description;

  if (r.game !== undefined) {
    const g = r.game as Record<string, unknown>;
    if (!g || typeof g !== 'object') return { ok: false, error: 'game must be an object' };
    if (g.kind !== 'telemetry' && g.kind !== 'freeplay') return { ok: false, error: 'game.kind must be "telemetry" or "freeplay"' };
    const entry = typeof g.entry === 'string' ? g.entry : '';
    if (!isSafeModPath(entry) || !entry.endsWith('.js')) return { ok: false, error: 'game.entry must be a .js file inside the mod folder' };
    const blurb = str(g.blurb, 140);
    if (!blurb) return { ok: false, error: 'game.blurb is required (up to 140 chars)' };
    manifest.game = { kind: g.kind, entry, blurb };
  }

  for (const key of RESERVED) {
    if (r[key] !== undefined) warnings.push(`"${key}" mods aren't supported yet; ignored`);
  }
  for (const key of Object.keys(r)) {
    if (!KNOWN.includes(key)) warnings.push(`unknown key "${key}" ignored`);
  }
  if (!manifest.game) warnings.push('provides nothing this version can load');
  return { ok: true, manifest, warnings };
}

// Mod games get their own id namespace, so a mod can never shadow (or take the high score of) a
// built-in mode.
export function modGameId(modId: string): string {
  return `mod:${modId}`;
}

export function modUrl(modId: string, file: string): string {
  return `${MOD_SCHEME}://${modId}/${file}`;
}
