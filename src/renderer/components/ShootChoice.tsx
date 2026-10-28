import React, { useEffect, useRef } from 'react';
import { C } from '../lib/ui';

// Choices you make by shooting them. When a session has news (it finished, it's your turn), the
// game doesn't stop for a card: its options fly in over the playfield as targets, and the pilot
// picks one by putting the reticle on it and firing (RT or A, the games' own fire buttons), or by
// tapping it. The game keeps running underneath. Works over every game, mods included, because it
// reads the pad itself rather than going through a mode.
//
// The reticle follows the right stick (the aim stick in the games that aim) with a little aim
// assist toward the nearest target. Nothing here can approve or deny anything: approvals keep their
// card, where a stray shot can't answer them.

export interface ShotOption { id: string; label: string; tone: string }
export interface ShotChoice {
  key: string;            // a new key brings a fresh set of targets
  title: string;          // "CLAUDE IS DONE"
  subject: string;        // the session
  detail: string | null;  // the end of what Claude said
  options: ShotOption[];
  timeoutMs: number;      // then `expire` is picked by itself
  expire: string;
}

interface Target { opt: ShotOption; x: number; y: number; phase: number; hit: number }

const R = 46;                 // target radius, px
const RETICLE_SPEED = 900;    // px/s at full stick
const ASSIST = 0.22;          // pull toward the nearest target within reach
const FIRE_CD = 0.22;
const BEAM_T = 0.16;

export function ShootChoice({ choice, onPick }: { choice: ShotChoice; onPick: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let w = 0, h = 0;
    const size = () => {
      const r = canvas.getBoundingClientRect();
      w = canvas.width = Math.round(r.width);
      h = canvas.height = Math.round(r.height);
    };
    size();
    const n = choice.options.length;
    const targets: Target[] = choice.options.map((opt, i) => ({
      opt, x: w * ((i + 1) / (n + 1)), y: -80 - i * 40, phase: i * 1.7, hit: 0,
    }));
    // Low in the playfield, away from the targets: an answer takes aiming, never a stray shot.
    const ret = { x: w / 2, y: h * 0.78 };
    let cd = 0, beam = 0, beamTo = { x: 0, y: 0 }, picked: Target | null = null, pickedT = 0;
    let wasFiring = true;     // a trigger already held when the targets arrive doesn't fire
    const born = performance.now();
    let last = born, raf = 0;

    const fireAt = (x: number, y: number) => {
      beam = BEAM_T; beamTo = { x, y }; cd = FIRE_CD;
      const t = targets.find((tg) => Math.hypot(tg.x - x, tg.y - y) < R + 6);
      if (t && !picked) { picked = t; t.hit = 1; pickedT = 0; }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - born) / 1000;

      // Targets fly in, then bob in a row across the upper playfield.
      targets.forEach((tg, i) => {
        const homeX = w * ((i + 1) / (n + 1)) + Math.sin(t * 0.9 + tg.phase) * 26;
        const homeY = h * 0.36 + Math.cos(t * 1.3 + tg.phase) * 18;
        tg.x += (homeX - tg.x) * Math.min(1, dt * 4);
        tg.y += (homeY - tg.y) * Math.min(1, dt * 4);
      });

      // Pad: right stick moves the reticle, RT or A fires.
      const gp = navigator.getGamepads?.()[0];
      if (gp && !picked) {
        const ax = gp.axes[2] ?? 0, ay = gp.axes[3] ?? 0;
        if (Math.hypot(ax, ay) > 0.15) { ret.x += ax * RETICLE_SPEED * dt; ret.y += ay * RETICLE_SPEED * dt; }
        const near = targets.reduce<Target | null>((a, b) =>
          (!a || Math.hypot(b.x - ret.x, b.y - ret.y) < Math.hypot(a.x - ret.x, a.y - ret.y) ? b : a), null);
        if (near && Math.hypot(near.x - ret.x, near.y - ret.y) < R * 2.2) {
          ret.x += (near.x - ret.x) * ASSIST * dt * 10;
          ret.y += (near.y - ret.y) * ASSIST * dt * 10;
        }
        ret.x = Math.max(20, Math.min(w - 20, ret.x));
        ret.y = Math.max(20, Math.min(h - 20, ret.y));
        const firing = (gp.buttons[7]?.value ?? 0) > 0.5 || !!gp.buttons[0]?.pressed;
        if (firing && !wasFiring && cd <= 0) fireAt(ret.x, ret.y);
        wasFiring = firing;
      }
      cd = Math.max(0, cd - dt);
      beam = Math.max(0, beam - dt);

      // Picked: let the hit land, then report it.
      if (picked) {
        pickedT += dt;
        if (pickedT > 0.45) { onPickRef.current(picked.opt.id); return; }
      } else if (now - born > choice.timeoutMs) {
        onPickRef.current(choice.expire);
        return;
      }

      draw(ctx, w, h, t, targets, ret, beam, beamTo, picked);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Tap a target to shoot it (the Deck's touchscreen, a mouse).
    const onDown = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (targets.some((tg) => Math.hypot(tg.x - x, tg.y - y) < R + 6)) { ret.x = x; ret.y = y; fireAt(x, y); }
    };
    canvas.addEventListener('pointerdown', onDown);
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); canvas.removeEventListener('pointerdown', onDown); ro.disconnect(); };
  }, [choice]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* The news, across the top of the playfield. */}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', maxWidth: '78%',
        padding: '10px 16px', borderRadius: 10, background: 'rgba(14,15,17,0.86)', border: `1px solid ${C.green}`,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: C.green }}>
          {choice.title} · <span style={{ color: C.text, letterSpacing: 0, fontWeight: 600, fontSize: 13 }}>{choice.subject}</span>
        </div>
        {choice.detail && (
          <div style={{
            fontSize: 13, color: '#BDBDBD', marginTop: 4, lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{choice.detail}</div>
        )}
        <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>Aim with the right stick · shoot your answer</div>
      </div>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'auto' }} />
    </div>
  );
}

function draw(
  ctx: CanvasRenderingContext2D, w: number, h: number, t: number, targets: Target[],
  ret: { x: number; y: number }, beam: number, beamTo: { x: number; y: number }, picked: Target | null,
) {
  ctx.clearRect(0, 0, w, h);
  for (const tg of targets) {
    const dead = tg === picked;
    ctx.save();
    ctx.translate(tg.x, tg.y);
    // A drone: an outer ring, spokes and a lit core in the option's colour.
    const spin = t * 1.6 + tg.phase;
    ctx.globalAlpha = picked && !dead ? 0.25 : 1;
    ctx.strokeStyle = tg.opt.tone;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      const a = spin + (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (R - 12), Math.sin(a) * (R - 12));
      ctx.lineTo(Math.cos(a) * (R + 8), Math.sin(a) * (R + 8));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(14,15,17,0.82)';
    ctx.beginPath(); ctx.arc(0, 0, R - 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = tg.opt.tone;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    wrap(ctx, tg.opt.label, R * 1.6).forEach((line, i, all) => ctx.fillText(line, 0, (i - (all.length - 1) / 2) * 17));
    if (dead) {
      // The hit: a burst of rays.
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
        ctx.lineTo(Math.cos(a) * R * 1.9, Math.sin(a) * R * 1.9);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // The beam, from the bottom centre (the guns) to where it hit.
  if (beam > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = beam / BEAM_T;
    ctx.strokeStyle = '#8FE9FF';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(w / 2, h); ctx.lineTo(beamTo.x, beamTo.y); ctx.stroke();
    ctx.restore();
  }
  // The reticle.
  if (!picked) {
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ret.x, ret.y, 14, 0, Math.PI * 2); ctx.stroke();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath(); ctx.moveTo(ret.x + dx * 8, ret.y + dy * 8); ctx.lineTo(ret.x + dx * 22, ret.y + dy * 22); ctx.stroke();
    }
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > max && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}
