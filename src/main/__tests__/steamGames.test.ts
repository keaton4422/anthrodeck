import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSteamGames, parseManifest, steamArt } from '../steamGames';

const manifest = (appid: string, name: string, flags = 4, lastPlayed = 0) => `"AppState"
{
\t"appid"\t\t"${appid}"
\t"name"\t\t"${name}"
\t"StateFlags"\t\t"${flags}"
\t"LastPlayed"\t\t"${lastPlayed}"
\t"UserConfig"
\t{
\t\t"name"\t\t"ignored"
\t}
}`;

describe('the Deck\'s Steam games', () => {
  it('reads a game from its manifest, and leaves out Steam\'s tools and unfinished installs', () => {
    expect(parseManifest(manifest('413150', 'Stardew Valley', 4, 1700000000))).toEqual({ appid: '413150', name: 'Stardew Valley', lastPlayed: 1700000000 });
    expect(parseManifest(manifest('105450', 'Age of Empires® III (2007)', 1538))).not.toBeNull();   // installed, update pending
    expect(parseManifest(manifest('1493710', 'Proton Experimental'))).toBeNull();
    expect(parseManifest(manifest('1628350', 'Steam Linux Runtime 3.0 (sniper)'))).toBeNull();
    expect(parseManifest(manifest('228980', 'Steamworks Common Redistributables'))).toBeNull();
    expect(parseManifest(manifest('1', 'Still downloading', 1024))).toBeNull();
  });

  it('lists every library, the SD card too, most recently played first, with covers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-steam-'));
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'adk-sd-'));
    fs.mkdirSync(path.join(root, 'steamapps'), { recursive: true });
    fs.mkdirSync(path.join(sd, 'steamapps'), { recursive: true });
    fs.writeFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${root}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${sd}"\n\t}\n}`);
    fs.writeFileSync(path.join(root, 'steamapps', 'appmanifest_413150.acf'), manifest('413150', 'Stardew Valley', 4, 100));
    fs.writeFileSync(path.join(sd, 'steamapps', 'appmanifest_1313140.acf'), manifest('1313140', 'Cult of the Lamb', 4, 200));
    fs.writeFileSync(path.join(sd, 'steamapps', 'appmanifest_1493710.acf'), manifest('1493710', 'Proton Experimental'));
    expect(listSteamGames(root).map((g) => g.name)).toEqual(['Cult of the Lamb', 'Stardew Valley']);

    const art = path.join(root, 'appcache', 'librarycache', '413150', 'abc123');
    fs.mkdirSync(art, { recursive: true });
    fs.writeFileSync(path.join(art, 'library_600x900.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    expect(steamArt('413150', root)).toBe('data:image/jpeg;base64,/9j/');
    expect(steamArt('999', root)).toBeNull();
    expect(steamArt('../etc', root)).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sd, { recursive: true, force: true });
  });
});
