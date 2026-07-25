// Shared vaporwave palette + primitives.
//
// The restraint that keeps this from becoming parody: neon is used for LIGHT — things that emit
// (grids, horizons, trails, hostiles) — while hulls, road surfaces and rock stay desaturated. Two
// hues carry it (magenta and cyan) with violet between them, so the games read as one world rather
// than four different takes on the same joke. The app's clay accent still owns the UI chrome;
// in-game neon never leaks into the surrounding interface.

export const VAPOR = {
  magenta: '#FF2E97',
  pink: '#FF6AD5',
  cyan: '#05D9E8',
  iceBlue: '#8BF7FF',
  violet: '#8A4FFF',
  // Backgrounds are deliberately near-black with only a hint of colour. Vaporwave reads through
  // CONTRAST — neon on darkness. A first pass used bright indigo fills and the whole thing came
  // back 75-97% violet: a purple wash with no cyan left to see.
  indigo: '#150C2E',
  night: '#0A0518',
  deep: '#05020C',
  sun: '#FFB25E',
  sunHot: '#FF4E8B',
} as const;

// Deep indigo→violet sky with the low sun that does most of the work. `sunY` is a fraction of the
// height; slits across the sun's lower half are the signature — cheap, and instantly reads.
export function drawSunsetSky(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  horizonY: number,
  opts: { sun?: boolean; sunX?: number } = {},
) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, VAPOR.deep);
  sky.addColorStop(0.62, VAPOR.night);
  sky.addColorStop(1, '#241040');   // colour only concentrates at the horizon
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizonY);

  if (opts.sun !== false) {
    const cx = opts.sunX ?? w / 2;
    const r = Math.min(w, h) * 0.13;   // a highlight, not a wall
    const cy = horizonY - r * 0.18;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, horizonY);
    ctx.clip();

    const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    g.addColorStop(0, VAPOR.sun);
    g.addColorStop(0.5, VAPOR.sunHot);
    g.addColorStop(1, VAPOR.magenta);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Slit bands across the lower half — spacing widens toward the bottom.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9; i++) {
      const t = i / 9;
      const y = cy + t * r;
      const gap = 2 + t * 6;
      ctx.fillRect(cx - r, y, r * 2, gap);
    }
    ctx.globalCompositeOperation = 'source-over';

    // Glow bloom around it.
    const bloom = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 2.1);
    bloom.addColorStop(0, 'rgba(255,78,139,0.16)');
    bloom.addColorStop(1, 'rgba(255,78,139,0)');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Horizon line with a soft bleed under it.
  const bleed = ctx.createLinearGradient(0, horizonY - 18, 0, horizonY + 26);
  bleed.addColorStop(0, 'rgba(255,46,151,0)');
  bleed.addColorStop(0.5, 'rgba(255,46,151,0.22)');
  bleed.addColorStop(1, 'rgba(255,46,151,0)');
  ctx.fillStyle = bleed;
  ctx.fillRect(0, horizonY - 18, w, 44);
  ctx.strokeStyle = VAPOR.pink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(w, horizonY);
  ctx.stroke();
}

// Run a draw call with a neon bloom. Kept as a wrapper so shadowBlur is always reset — leaving it
// set is the classic canvas footgun that tanks framerate.
export function neon(
  ctx: CanvasRenderingContext2D,
  color: string,
  blur: number,
  draw: () => void,
) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

// CRT scanlines. Deliberately subtle — at high alpha this eats contrast on a 1280x800 handheld.
export function drawScanlines(ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 0.06) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}
