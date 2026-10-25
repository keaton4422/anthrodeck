// Update checks for builds that can't replace themselves.
//
// Windows ships as a plain zip: there's no installer and no update manifest, so electron-updater
// can only fail with "No update metadata". Those builds still deserve to hear that a new version
// is out and what changed, so they ask the GitHub API for the latest release and the pilot
// downloads it from the release page.
//
// Pure — no Electron, no network — so it unit-tests. index.ts does the fetch.

import { whatsNew, type UpdateAvailable } from './releaseNotes';

export const LATEST_RELEASE_API = 'https://api.github.com/repos/keaton4422/anthrodeck/releases/latest';
const RELEASE_PAGE_PREFIX = 'https://github.com/keaton4422/anthrodeck/releases/';

// True when `latest` is a higher x.y.z than `current`. Pre-release suffixes are ignored: the
// latest-release endpoint never returns drafts or pre-releases.
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

// Reads the API response (requested with Accept: application/vnd.github.html+json, so the notes
// come as `body_html`). Returns null when there's nothing newer, or when the response doesn't look
// like one of our releases: the link it carries is opened in the pilot's browser, so it must point
// at this repo's releases and nowhere else.
export function parseLatestRelease(json: unknown, currentVersion: string): UpdateAvailable | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as { tag_name?: unknown; html_url?: unknown; body_html?: unknown };
  if (typeof r.tag_name !== 'string' || typeof r.html_url !== 'string') return null;
  if (!r.html_url.startsWith(RELEASE_PAGE_PREFIX)) return null;
  const version = r.tag_name.replace(/^v/, '');
  if (!isNewer(version, currentVersion)) return null;
  return {
    version,
    notes: whatsNew(typeof r.body_html === 'string' ? r.body_html : null),
    manualUrl: r.html_url,
  };
}
