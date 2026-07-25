import { describe, it, expect } from 'vitest';
// @ts-expect-error - plain .mjs build tool, no type declarations by design
import { buildManifest, sha512Base64 } from '../../../tools/updateManifest.mjs';

// This YAML is parsed by electron-updater on a Steam Deck we cannot see. If the shape drifts, the
// only symptom is a Deck that silently stops finding updates -- so the format is pinned here.

const FILES = [{ name: 'AnthroDeck-0.7.1-x64.AppImage', sha512: 'abc123==', size: 98765432 }];

describe('buildManifest', () => {
  it('emits the keys electron-updater reads', () => {
    const yml = buildManifest('0.7.1', FILES, '2026-07-25T12:00:00.000Z');
    expect(yml).toContain('version: 0.7.1');
    expect(yml).toContain('  - url: AnthroDeck-0.7.1-x64.AppImage');
    expect(yml).toContain('    sha512: abc123==');
    expect(yml).toContain('    size: 98765432');
    // `path` and the top-level `sha512` are what the download step actually resolves.
    expect(yml).toContain('path: AnthroDeck-0.7.1-x64.AppImage');
    expect(yml).toMatch(/^sha512: abc123==$/m);
    expect(yml).toContain("releaseDate: '2026-07-25T12:00:00.000Z'");
  });

  it('ends with a trailing newline', () => {
    expect(buildManifest('0.7.1', FILES, 'x')).toMatch(/\n$/);
  });

  it('points `path` at the first artifact', () => {
    const yml = buildManifest('0.7.1', [
      { name: 'first.AppImage', sha512: 'a', size: 1 },
      { name: 'second.AppImage', sha512: 'b', size: 2 },
    ], 'x');
    expect(yml).toContain('path: first.AppImage');
    expect(yml).toMatch(/^sha512: a$/m);
    expect(yml).toContain('  - url: second.AppImage');
  });

  it('refuses to write an empty manifest', () => {
    // A manifest with no files would publish as "update available" and then dead-end on download.
    // Failing the release build is strictly better than shipping that.
    expect(() => buildManifest('0.7.1', [], 'x')).toThrow(/no AppImage/);
  });

  it('requires a version', () => {
    expect(() => buildManifest('', FILES, 'x')).toThrow(/version is required/);
  });
});

describe('sha512Base64', () => {
  it('is base64, not hex -- electron-updater rejects hex with a checksum mismatch', () => {
    const d = sha512Base64(Buffer.from('anthrodeck'));
    expect(d).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(d).not.toMatch(/^[0-9a-f]{128}$/);
    expect(Buffer.from(d, 'base64')).toHaveLength(64);
  });

  it('is stable for the same input', () => {
    expect(sha512Base64(Buffer.from('x'))).toBe(sha512Base64(Buffer.from('x')));
  });
});

// ─── Updater error guidance ───────────────────────────────────────────────────
import { updaterErrorMessage } from '../agentLoop.helpers';

describe('updaterErrorMessage', () => {
  it('explains the .deb / unzipped case, which is the one that will actually bite', () => {
    const m = updaterErrorMessage('Error: APPIMAGE env is not defined');
    expect(m).toMatch(/AppImage build/);
    expect(m).toMatch(/Steam shortcut/);
  });

  it('handles a missing manifest', () => {
    expect(updaterErrorMessage('HttpError: 404 Not Found latest-linux.yml'))
      .toMatch(/No update metadata/);
  });

  it('handles no network', () => {
    expect(updaterErrorMessage('getaddrinfo ENOTFOUND github.com')).toMatch(/network connection/);
  });

  it('handles a corrupt download', () => {
    expect(updaterErrorMessage('sha512 checksum mismatch')).toMatch(/checksum/);
  });

  it('passes through anything it does not recognise rather than inventing advice', () => {
    expect(updaterErrorMessage('something entirely new')).toBe('something entirely new');
  });
});
