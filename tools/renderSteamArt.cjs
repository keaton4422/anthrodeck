// Renders assets/steam/*.svg (Steam library art for the non-Steam shortcut) to PNGs at their own
// sizes, using Electron's Chromium like tools/renderIcons.cjs. Run with:
//   npx electron tools/renderSteamArt.cjs
// Install on a Deck: copy assets/steam/png/<name>.png into
//   ~/.local/share/Steam/userdata/<user>/config/grid/ as <appid>p.png (portrait), <appid>.png (wide),
//   <appid>_hero.png and <appid>_logo.png, where <appid> is the shortcut's id. See "Library art" in README.md.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'steam');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  fs.mkdirSync(path.join(DIR, 'png'), { recursive: true });
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.svg'))) {
    const svg = fs.readFileSync(path.join(DIR, f), 'utf8');
    const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    const url = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
        c.getContext('2d').drawImage(img, 0, 0, ${w}, ${h}); res(c.toDataURL('image/png')); };
      img.onerror = () => rej(new Error('${f} failed to load'));
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    })`);
    fs.writeFileSync(path.join(DIR, 'png', f.replace(/\.svg$/, '.png')), Buffer.from(url.split(',')[1], 'base64'));
    console.log(`rendered ${f} (${w}x${h})`);
  }
  app.quit();
});
