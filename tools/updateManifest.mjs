import { createHash } from 'crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

// electron-updater discovers releases by fetching `latest-linux.yml` from the GitHub release and
// reading the version out of it. electron-builder writes that file; electron-forge's makers do not
// — which is exactly why in-app updates have never worked here. Rather than migrate the whole
// build to electron-builder, we generate the one file forge is missing and attach it to the release.
//
// The AppImage is the only artifact electron-updater can actually self-update on Linux (it swaps
// the file in place), so that is what the manifest points at. The .deb and .zip are still published
// for manual installs, but they are deliberately NOT in the manifest — listing an artifact the
// updater can't apply would turn "update available" into a dead end.

// Exported for testing. `files` is [{ name, sha512, size }]; kept pure so the YAML shape is pinned
// by unit tests rather than discovered in production by a Deck that fails to update.
export function buildManifest(version, files, releaseDate) {
  if (!version) throw new Error('version is required');
  if (!files.length) throw new Error('no AppImage found to publish — refusing to write an empty manifest');
  const primary = files[0];
  const lines = [
    `version: ${version}`,
    'files:',
    ...files.flatMap((f) => [
      `  - url: ${f.name}`,
      `    sha512: ${f.sha512}`,
      `    size: ${f.size}`,
    ]),
    `path: ${primary.name}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ];
  return lines.join('\n');
}

// electron-updater compares base64 sha512, not hex. Getting this wrong fails only at the moment a
// user tries to install, with a checksum mismatch — so it is worth stating plainly.
export function sha512Base64(buf) {
  return createHash('sha512').update(buf).digest('base64');
}

export function findAppImages(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.AppImage')) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

// CLI: node tools/updateManifest.mjs <artifactDir> <version> <outFile>
if (process.argv[1] && process.argv[1].endsWith('updateManifest.mjs')) {
  const [dir, version, outFile] = process.argv.slice(2);
  const found = findAppImages(dir);
  const files = found.map((p) => {
    const buf = readFileSync(p);
    return { name: path.basename(p), sha512: sha512Base64(buf), size: statSync(p).size };
  });
  const yml = buildManifest(version, files, new Date().toISOString());
  writeFileSync(outFile, yml, 'utf-8');
  console.log(`wrote ${outFile} for ${files.map((f) => f.name).join(', ')}`);
}
