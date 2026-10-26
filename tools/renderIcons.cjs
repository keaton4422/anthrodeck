// Renders assets/logo.svg into the PNG and ICO icons the builds use. Run with:
//   npx electron tools/renderIcons.cjs
// Electron is Chromium, so the SVG is drawn on a canvas at each exact size (alpha preserved) and
// no image tooling has to be installed. The ICO holds PNG entries, which Windows Vista+ reads.
// On macOS it also builds assets/icon.icns with iconutil.
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT, 'assets', 'logo.svg'), 'utf8');
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);       // 0 means 256
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4);                      // colour planes
    dir.writeUInt16LE(32, o + 6);                     // bits per pixel
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const out = path.join(ROOT, 'assets', 'icons');
  fs.mkdirSync(out, { recursive: true });
  const pngs = [];
  for (const size of PNG_SIZES) {
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = ${size};
        const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        res(c.toDataURL('image/png'));
      };
      img.onerror = () => rej(new Error('svg failed to load'));
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(SVG).toString('base64'))};
    })`);
    const data = Buffer.from(dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(out, `${size}x${size}.png`), data);
    pngs.push({ size, data });
  }
  fs.copyFileSync(path.join(out, '512x512.png'), path.join(ROOT, 'assets', 'icon.png'));
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), ico(pngs.filter((p) => ICO_SIZES.includes(p.size))));
  if (process.platform === 'darwin') {
    const set = path.join(require('os').tmpdir(), 'anthrodeck.iconset');
    fs.rmSync(set, { recursive: true, force: true });
    fs.mkdirSync(set);
    for (const s of [16, 32, 128, 256, 512]) {
      fs.copyFileSync(path.join(out, `${s}x${s}.png`), path.join(set, `icon_${s}x${s}.png`));
      fs.copyFileSync(path.join(out, `${s * 2}x${s * 2}.png`), path.join(set, `icon_${s}x${s}@2x.png`));
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(ROOT, 'assets', 'icon.icns')]);
  }
  console.log(`wrote ${pngs.length} PNGs, assets/icon.png, assets/icon.ico${process.platform === 'darwin' ? ' and assets/icon.icns' : ''}`);
  app.quit();
});
