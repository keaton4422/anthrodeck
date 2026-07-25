import { GameMode, GameInput, TelemetryFrame, GameIntent, IntentCarrier } from '../types';
import { VAPOR, drawSunsetSky, neon, drawScanlines } from '../vapor';

// ENGINE RUNNER — you drive a blue JDM-style hero coupe (long hood, low roof, big rear wing;
// evoked, not badged — no marks or model names).
//
// The loop: RED hunters are stale context, and they are actively trying to PUSH YOU OFF. They line
// up on your lane and ram. Contact destroys them — you're the heavier car — which prunes a stale
// item AND kicks in a boost, so taking them head-on is the reward.
//
// Their threat isn't the hit, it's where the hit puts you. Every ram shoves you sideways, and
// they're aiming to shove you into the barrier or into GREY civilian traffic. Those are the only
// two things that actually damage you. Four dents ends the run.


// ─── Regions ──────────────────────────────────────────────────────────────────
// The road tours the world: every REGION_LENGTH metres the scenery, palette and lane markings
// change to a different country's highway. Purely cosmetic, but it's what makes a long turn
// somewhere to go rather than a treadmill.
interface Region {
  name: string;
  sky: string;
  verge: string;
  asphalt: string;
  divider: string;   // lane dashes — Europe/Japan white, US yellow
  edge: string;
  rail: string;
  prop: (ctx: CanvasRenderingContext2D, x: number, y: number, side: number, seed: number) => void;
}

export const REGION_LENGTH = 4000;

export const REGIONS: Region[] = [
  {
    name: 'WANGAN ・ TOKYO',
    sky: '#05020C', verge: '#070312', asphalt: '#0C0818',
    divider: 'rgba(255,106,213,0.42)', edge: 'rgba(139,247,255,0.7)', rail: 'rgba(255,46,151,0.55)',
    prop: (ctx, x, y, side, seed) => {           // neon towers + sodium lamps
      const hgt = 40 + (seed % 60);
      ctx.fillStyle = '#0E1220';
      ctx.fillRect(x - 13, y - hgt, 26, hgt);
      const hues = ['#FF4D6D', '#4DD0FF', '#FFD36A', '#B44DFF'];
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = hues[(seed + i) % hues.length];
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x - 9 + (i % 2) * 11, y - hgt + 7 + i * 9, 7, 3);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#3A4354'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + side * 9, y); ctx.lineTo(x + side * 9, y - 26); ctx.stroke();
      ctx.fillStyle = 'rgba(255,214,140,0.85)';
      ctx.fillRect(x + side * 9 - 5, y - 29, 10, 3);
    },
  },
  {
    name: 'AUTOBAHN ・ DEUTSCHLAND',
    sky: '#04060F', verge: '#050A12', asphalt: '#0A0E18',
    divider: 'rgba(139,247,255,0.38)', edge: 'rgba(230,240,255,0.7)', rail: 'rgba(138,79,255,0.55)',
    prop: (ctx, x, y, _side, seed) => {          // dense pine
      const hgt = 46 + (seed % 34);
      ctx.fillStyle = '#241B12';
      ctx.fillRect(x - 2, y - 10, 4, 10);
      ctx.fillStyle = seed % 2 ? '#16301E' : '#12271A';
      for (let i = 0; i < 3; i++) {
        const t = y - 8 - i * (hgt / 3.4);
        const wdt = 17 - i * 4;
        ctx.beginPath();
        ctx.moveTo(x, t - hgt / 2.6); ctx.lineTo(x - wdt, t); ctx.lineTo(x + wdt, t);
        ctx.closePath(); ctx.fill();
      }
    },
  },
  {
    name: 'DESERT RUN ・ ARIZONA',
    sky: '#0E0413', verge: '#110616', asphalt: '#100A18',
    divider: 'rgba(255,178,94,0.6)', edge: 'rgba(255,220,190,0.6)', rail: 'rgba(255,78,139,0.5)',
    prop: (ctx, x, y, _side, seed) => {          // saguaro + mesa
      if (seed % 3 === 0) {
        ctx.fillStyle = '#3A2418';
        ctx.beginPath();
        ctx.moveTo(x - 40, y); ctx.lineTo(x - 26, y - 34); ctx.lineTo(x + 24, y - 30);
        ctx.lineTo(x + 40, y); ctx.closePath(); ctx.fill();
        return;
      }
      ctx.fillStyle = '#1E3A22';
      ctx.fillRect(x - 3, y - 34, 6, 34);
      ctx.fillRect(x - 12, y - 24, 9, 4);
      ctx.fillRect(x - 12, y - 24, 4, 13);
      ctx.fillRect(x + 4, y - 29, 9, 4);
      ctx.fillRect(x + 9, y - 29, 4, 16);
    },
  },
  {
    name: 'PASSO ALPINO ・ ITALIA',
    sky: '#050514', verge: '#070A14', asphalt: '#0C0F1A',
    divider: 'rgba(230,240,255,0.34)', edge: 'rgba(200,230,255,0.65)', rail: 'rgba(139,247,255,0.6)',
    prop: (ctx, x, y, _side, seed) => {          // peaks with snow caps
      const hgt = 60 + (seed % 70);
      ctx.fillStyle = '#1B2430';
      ctx.beginPath();
      ctx.moveTo(x - 46, y); ctx.lineTo(x, y - hgt); ctx.lineTo(x + 46, y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(226,238,250,0.85)';
      ctx.beginPath();
      ctx.moveTo(x - 13, y - hgt + 13); ctx.lineTo(x, y - hgt); ctx.lineTo(x + 13, y - hgt + 13);
      ctx.closePath(); ctx.fill();
    },
  },
  {
    name: 'COAST ROAD ・ PACIFICA',
    sky: '#04041A', verge: '#04101C', asphalt: '#0A0E1A',
    divider: 'rgba(255,178,94,0.5)', edge: 'rgba(255,106,213,0.6)', rail: 'rgba(5,217,232,0.6)',
    prop: (ctx, x, y, _side, seed) => {          // palms over water
      ctx.fillStyle = '#0D2E42';
      ctx.fillRect(x - 50, y - 6, 100, 6);
      ctx.strokeStyle = '#3A2E1E'; ctx.lineWidth = 3;
      const hgt = 34 + (seed % 22);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 5, y - hgt / 2, x + 2, y - hgt); ctx.stroke();
      ctx.fillStyle = '#1C4A2A';
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.55;
        ctx.beginPath();
        ctx.ellipse(x + 2 + Math.cos(a) * 12, y - hgt + Math.sin(a) * 8, 12, 3.5, a, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
];

export function regionAt(distance: number): Region {
  return REGIONS[Math.floor(Math.abs(distance) / REGION_LENGTH) % REGIONS.length];
}

const LANES = 4;

type CarKind = 'hunter' | 'civilian';

interface Car {
  lane: number;
  x: number;        // px — hunters drift between lanes to line you up
  y: number;
  speed: number;    // closing speed relative to the road
  kind: CarKind;
  spin: number;     // >0 = knocked off, spinning away
  dents: number;    // visible damage
  vy: number;       // longitudinal velocity imparted by an impact
  mass: number;
  rotV: number;     // angular velocity from an off-centre hit
  vx: number;       // lateral velocity once knocked
  rot: number;
}

export interface RacerState extends IntentCarrier {
  w: number;
  h: number;
  lane: number;
  laneX: number;
  speed: number;
  cars: Car[];
  crashed: boolean;
  finished: boolean;
  boostT: number;
  distance: number;
  smashed: number;
  civWrecks: number;
  damage: number;   // dents on the hero car; MAX_DAMAGE ends the run
  heroVx: number;   // lateral velocity from impacts, fights the lane spring
  railHits: number;
  camX: number;     // camera's lateral position — trails the car rather than being glued to it
  camLead: number;  // -1..1, how far the car has pulled ahead of the camera under acceleration
  prevSpeed: number;
  score: number;
  spawnAcc: number;
  prevLeft: boolean;
  prevRight: boolean;
  tick: number;
  intents: GameIntent[];
}

const BASE_SPEED = 160;
const MAX_SPEED = 600;
const BOOST_TIME = 0.7;
const BOOST_MULT = 1.7;
const CAR_Y_FROM_BOTTOM = 84;
const CAR_W = 28;
const CAR_H = 50;
const SPAWN_DIST = 200;
const MAX_DAMAGE = 4;
const THROTTLE_GAIN = 190;   // what the pilot's own right trigger is worth
const ROLL_ON = 26;          // the car winds itself up over a clean run
const CAM_LAG = 3.4;         // how fast the camera catches the car laterally (lower = laggier)
const CAM_LEAD_PX = 46;      // how far ahead the car can pull before the camera reels it back
const HERO_MASS = 1650;      // the hero is the heavy one — that's why it wins exchanges
const RESTITUTION = 0.32;    // sheet metal crumples; very little bounce comes back

function clampDt(dt: number): number { return Math.max(0, Math.min(dt, 0.05)); }

// Perspective for a ~80-degree helicopter chase angle. This is a RECIPROCAL (1/z) falloff, not a
// linear ramp: a linear one made the road bend oddly and, worse, made traffic appear to change
// speed as it came down the screen. Under 1/z, distant things compress and everything accelerates
// toward the camera the way it actually does.
//
// Gameplay maths stays in flat road space — only rendering is projected — so collisions stay exact.
const CAM_COMPRESS = 0.85;
// Terrain. A fixed horizon made the road read as one endless downhill; a real highway crests and
// dips. Two layered sines (one long roll, one shorter undulation) move the horizon up and down as
// you travel, so you top a rise and drop into a valley. Pure and exported so it can be tested.
export function elevationAt(distance: number): number {
  const long = Math.sin(distance * 0.00042);
  const short = Math.sin(distance * 0.0016 + 1.3);
  return long * 0.62 + short * 0.38;   // -1..1
}

export function horizonAt(distance: number, h: number): number {
  // Low horizon = cresting a rise (less road ahead); high = dropping into a dip (more road).
  return h * (0.17 + elevationAt(distance) * 0.075);
}

export function perspAt(y: number, h: number): number {
  const u = Math.max(0, Math.min(1, (h - y) / h));   // 0 at the bumper, 1 at the far end
  return 1 / (1 + u * CAM_COMPRESS);
}
function projX(x: number, y: number, w: number, h: number): number {
  return w / 2 + (x - w / 2) * perspAt(y, h);
}

// A road-space band drawn as a polyline: with a curved projection the edges are no longer straight,
// so sampling keeps them flush with the lane dashes and scenery.
function fillBand(
  ctx: CanvasRenderingContext2D,
  x0: number, x1: number, yTop: number, yBot: number, w: number, h: number,
) {
  const STEPS = 16;
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const y = yTop + ((yBot - yTop) * i) / STEPS;
    const px = projX(x0, y, w, h);
    if (i === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
  }
  for (let i = STEPS; i >= 0; i--) {
    const y = yTop + ((yBot - yTop) * i) / STEPS;
    ctx.lineTo(projX(x1, y, w, h), y);
  }
  ctx.closePath();
  ctx.fill();
}
function roadLeft(w: number): number { return w * 0.15; }
function roadRight(w: number): number { return w * 0.85; }
export function laneCenter(w: number, lane: number): number {
  const l = roadLeft(w);
  return l + ((roadRight(w) - l) / LANES) * (lane + 0.5);
}

export function createMode(): GameMode<RacerState> {
  return {
    id: 'cockpit-runner',
    name: 'Engine Runner',
    kind: 'telemetry',
    blurb: 'RT throttle · red hunters ram you toward the barrier and the traffic · smash one for a BOOST + a pruned context item · only civilians and the armco damage you',

    init(w, h): RacerState {
      return {
        w, h, lane: 1, laneX: laneCenter(w, 1),
        speed: BASE_SPEED, cars: [],
        crashed: false, finished: false,
        boostT: 0, distance: 0, smashed: 0, civWrecks: 0, damage: 0, heroVx: 0, railHits: 0,
        camX: laneCenter(w, 1), camLead: 0, prevSpeed: BASE_SPEED, score: 0, spawnAcc: 0,
        prevLeft: false, prevRight: false, tick: 0, intents: [],
      };
    },

    step(state, input: GameInput, tel: TelemetryFrame, dtRaw): RacerState {
      if (state.crashed || state.finished) return state;
      const dt = clampDt(dtRaw);
      const s: RacerState = { ...state, tick: state.tick + 1, cars: state.cars.map((c) => ({ ...c })), intents: [] };
      const carY = s.h - CAR_Y_FROM_BOTTOM;

      const addCar = (kind: CarKind, lane: number, speed: number) => {
        s.cars.push({
          lane, x: laneCenter(s.w, lane), y: -70,
          speed, kind, spin: 0, vx: 0, rot: 0, dents: 0, vy: 0,
          mass: kind === 'hunter' ? 1400 : 1250, rotV: 0,
        });
      };

      for (const ev of tel.events) {
        if (ev.type === 'crash') return { ...s, crashed: true };
        if (ev.type === 'done') return { ...s, finished: true };
        if (ev.type === 'boost') s.boostT = BOOST_TIME;
        // Tool calls and errors send hunters after you.
        if (ev.type === 'tool' || ev.type === 'error') {
          addCar('hunter', (s.tick * 7 + s.cars.length * 3) % LANES, ev.type === 'error' ? 110 : 70);
        }
      }

      // Three things drive speed now: the engine's throughput (the telemetry link), the pilot's own
      // throttle, and a slow roll-on so a clean run keeps building without any input at all.
      const rollOn = Math.min(ROLL_ON * 4, (s.distance / 1000) * ROLL_ON);
      const target = BASE_SPEED
        + Math.min(tel.snapshot.tokensPerSec, 60) * 7
        + input.throttle * THROTTLE_GAIN
        + rollOn;
      s.speed += (target - s.speed) * Math.min(1, dt * 2.2);
      if (input.brake > 0.1) s.speed = Math.max(BASE_SPEED * 0.7, s.speed - input.brake * 320 * dt);
      if (s.boostT > 0) s.boostT = Math.max(0, s.boostT - dt);
      const eff = Math.min(MAX_SPEED, s.speed * (s.boostT > 0 ? BOOST_MULT : 1));

      // Discrete lane changes, edge-triggered.
      const wantLeft = input.left || input.steer < -0.5;
      const wantRight = input.right || input.steer > 0.5;
      if (wantLeft && !s.prevLeft) s.lane = Math.max(0, s.lane - 1);
      if (wantRight && !s.prevRight) s.lane = Math.min(LANES - 1, s.lane + 1);
      s.prevLeft = wantLeft; s.prevRight = wantRight;
      // Lane spring + impact velocity: after a hit you have to fight the car back into line.
      s.heroVx *= Math.max(0, 1 - 3.2 * dt);
      s.laneX += s.heroVx * dt;
      // The lane spring is the driver correcting back onto line — deliberately weak enough that a
      // solid ram can overpower it and carry you into the armco. At rate 9 it out-pulled every
      // shove and the whole push-you-off mechanic could never actually fire.
      s.laneX += (laneCenter(s.w, s.lane) - s.laneX) * Math.min(1, dt * 4.5);
      // Barrier strike — this is what the hunters are trying to cause.
      const minX = roadLeft(s.w) + 12;
      const maxX = roadRight(s.w) - 12;
      if ((s.laneX < minX && s.heroVx < -60) || (s.laneX > maxX && s.heroVx > 60)) {
        s.damage += 1;
        s.railHits += 1;
        s.score = Math.max(0, s.score - 120);
        s.heroVx *= -0.45;                       // scrape and bounce back off the armco
        s.speed = Math.max(BASE_SPEED * 0.6, s.speed * 0.82);
        if (s.damage >= MAX_DAMAGE) {
          s.laneX = Math.max(minX, Math.min(maxX, s.laneX));
          return { ...s, crashed: true };
        }
      }
      s.laneX = Math.max(minX, Math.min(maxX, s.laneX));

      // Ordinary traffic keeps the road busy.
      s.spawnAcc += eff * dt;
      if (s.spawnAcc >= SPAWN_DIST) {
        s.spawnAcc -= SPAWN_DIST;
        addCar('civilian', (s.tick * 5) % LANES, 55 + ((s.tick * 11) % 40));
      }

      const next: Car[] = [];
      for (const c of s.cars) {
        // Already knocked off — spin toward the shoulder and fall behind.
        if (c.spin > 0) {
          c.spin -= dt;
          c.vx *= (1 - 0.6 * dt);              // tyre scrub
          c.vy *= (1 - 0.6 * dt);
          c.x += c.vx * dt;
          c.rot += c.rotV * dt;
          c.rotV *= (1 - 0.5 * dt);
          c.y += (eff - c.speed * 0.3 - c.vy) * dt;
          if (c.spin > 0 && c.y < s.h + 140) next.push(c);
          continue;
        }

        // Hunters actively steer toward your lane; civilians hold theirs.
        if (c.kind === 'hunter') {
          const want = laneCenter(s.w, s.lane);
          c.x += Math.sign(want - c.x) * Math.min(Math.abs(want - c.x), 70 * dt);
        }
        c.y += (eff - c.speed) * dt;
        if (c.y > s.h + 90) continue;

        const overlap = Math.abs(c.x - s.laneX) < CAR_W * 0.92 && Math.abs(c.y - carY) < CAR_H * 0.92;
        if (overlap) {
          // Impulse resolution along the contact normal. Both cars carry momentum, so a glancing
          // blow deflects and a square hit transfers hard — and because the hero is the heaviest
          // thing on the road, it comes off best.
          let nx = c.x - s.laneX;
          let ny = c.y - carY;
          const len = Math.hypot(nx, ny) || 1;
          nx /= len; ny /= len;

          // Closing velocity: hero lateral vs car lateral, plus the speed difference along the road.
          const relX = c.vx - s.heroVx;
          const relY = c.vy - (c.speed - eff);
          const sep = relX * nx + relY * ny;
          if (sep < 0) {
            const j = (-(1 + RESTITUTION) * sep) / (1 / HERO_MASS + 1 / c.mass);
            c.vx += (j / c.mass) * nx;
            c.vy += (j / c.mass) * ny;
            s.heroVx -= (j / HERO_MASS) * nx;
            // Off-centre contact spins the struck car.
            c.rotV += ((c.x - s.laneX) / CAR_W) * (j / c.mass) * 0.06;
            // Energy lost to the crash scrubs speed off the hero.
            s.speed = Math.max(BASE_SPEED * 0.6, s.speed - Math.abs(j) / HERO_MASS * 0.5);
          }
          if (c.kind === 'hunter') {
            // SMASH: punt it toward the nearest shoulder. Real work — one stale item pruned.
            // The hunter crumples and goes off; the hero takes no damage. Real work: one prune —
            // and knocking it clear kicks in a boost, so meeting them head-on is the reward.
            c.spin = 1.6;
            c.dents = 3;
            c.vx += (c.x < s.w / 2 ? -1 : 1) * 120;   // plus the impulse already applied
            c.rotV += 6;
            // ...but it was ramming you, so it shoves you hard toward the outside on its way out.
            s.heroVx += Math.sign(s.laneX - c.x) * -1 * 340;
            s.boostT = Math.max(s.boostT, BOOST_TIME);
            s.smashed += 1;
            s.score += 250;
            s.intents.push({ type: 'prune-stale' });
            next.push(c);
            continue;
          }
          // Civilians are the only thing that can hurt you. Both cars wear the hit.
          c.spin = 1.6;
          c.dents = 3;
          c.vx += (c.x < s.w / 2 ? -1 : 1) * 90;
          c.rotV += 4;
          s.civWrecks += 1;
          s.damage += 1;
          s.score = Math.max(0, s.score - 150);
          next.push(c);
          if (s.damage >= MAX_DAMAGE) return { ...s, cars: next, crashed: true };
          continue;
        }
        next.push(c);
      }
      s.cars = next;
      s.distance += eff * dt;
      s.score += eff * dt * 0.05; // distance survived

      // Camera. It trails the car instead of being welded to it: laterally it eases toward the
      // car's lane, so a quick swerve visibly gets ahead of the shot before the camera settles.
      s.camX += (s.laneX - s.camX) * Math.min(1, dt * CAM_LAG);
      // Longitudinally, acceleration lets the car pull UP the frame and the camera reels it back in.
      const accel = (s.speed - s.prevSpeed) / Math.max(dt, 1e-4);
      s.prevSpeed = s.speed;
      const leadTarget = Math.max(-1, Math.min(1, accel / 260));
      s.camLead += (leadTarget - s.camLead) * Math.min(1, dt * 1.6);
      return s;
    },

    render(ctx, s, w, h) {
      // The camera pans a fraction of its offset — enough to feel like a chase shot, not so much
      // that the road swims. The car rides `camLead`, so hard acceleration pulls it up the frame.
      const pan = (s.camX - w / 2) * 0.3;
      const carY = h - CAR_Y_FROM_BOTTOM - s.camLead * CAM_LEAD_PX;
      const l = roadLeft(w) - pan;
      const r = roadRight(w) - pan;
      const speedFrac = Math.max(0, Math.min(1, (s.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)));

      const reg = regionAt(s.distance);
      // Cross-fade between regions so the world changes without a hard cut.
      const into = (Math.abs(s.distance) % REGION_LENGTH) / REGION_LENGTH;
      const fade = into > 0.94 ? (into - 0.94) / 0.06 : 0;

      ctx.fillStyle = reg.sky;
      ctx.fillRect(0, 0, w, h);
      // Sun on the horizon behind the scenery; the verge only fills below it.
      const horizon = horizonAt(s.distance, h);   // rises and falls with the terrain
      drawSunsetSky(ctx, w, h, horizon, { sun: false });
      ctx.fillStyle = reg.verge;
      ctx.fillRect(0, horizon, w, h - horizon);
      // Road as a trapezoid — narrower at the far end.
      ctx.fillStyle = reg.asphalt;
      fillBand(ctx, l, r, horizon, h, w, h);

      // Roadside scenery, scrolling with the road.
      const propGap = 190;
      const propOff = s.distance % propGap;
      for (let i = -1; i < Math.ceil(h / propGap) + 1; i++) {
        const y = i * propGap + propOff;
        if (y < horizon - 40 || y > h + 60) continue;
        const seed = Math.abs(Math.floor((s.distance - propOff) / propGap) + i) * 2654435761 % 997;
        const k = perspAt(y, h);
        ctx.save();
        ctx.translate(projX(l - 78, y, w, h), y); ctx.scale(k, k);
        reg.prop(ctx, 0, 0, -1, seed); ctx.restore();
        ctx.save();
        ctx.translate(projX(r + 78, y, w, h), y); ctx.scale(k, k);
        reg.prop(ctx, 0, 0, 1, seed + 37); ctx.restore();
      }


      // Asphalt texture bands — cheap, but they give the surface grain.
      ctx.fillStyle = 'rgba(255,255,255,0.012)';
      const band = 90;
      for (let y = horizon + (s.distance % band); y < h; y += band) {
        const yb = Math.min(h, y + band / 2);
        fillBand(ctx, l, r, y, yb, w, h);
      }

      // Guard rails, with posts that stream past faster as throughput rises.
      const postGap = 46;
      const off = s.distance % postGap;
      ctx.fillStyle = reg.rail;
      neon(ctx, VAPOR.magenta, 8, () => {
        fillBand(ctx, l - 32, l - 28, horizon, h, w, h);
        fillBand(ctx, r + 28, r + 32, horizon, h, w, h);
      });
      ctx.fillStyle = `rgba(204,120,92,${0.3 + speedFrac * 0.4})`;
      const streak = 10 + speedFrac * 40;
      for (let y = horizon + off - postGap; y < h; y += postGap) {
        if (y < horizon) continue;
        ctx.fillRect(l - 30, y, 3, streak);
        ctx.fillRect(r + 29, y, 3, streak);
      }

      // Edge lines + dashed lane dividers.
      ctx.fillStyle = reg.edge;
      neon(ctx, VAPOR.cyan, 6, () => {
        fillBand(ctx, l + 2, l + 5, horizon, h, w, h);
        fillBand(ctx, r - 5, r - 2, horizon, h, w, h);
      });
      ctx.fillStyle = reg.divider;
      const dash = 36;
      const dashOff = s.distance % (dash * 2);
      for (let i = 1; i < LANES; i++) {
        const x = l + ((r - l) / LANES) * i;
        for (let y = horizon + dashOff - dash * 2; y < h; y += dash * 2) {
          if (y < horizon) continue;
          const k = perspAt(y, h);
          ctx.fillRect(projX(x, y, w, h) - 1.5 * k, y, 3 * k, dash * k);
        }
      }

      for (const c of s.cars) {
        const k = perspAt(c.y, h);
        ctx.save();
        ctx.translate(projX(c.x - pan, c.y, w, h), c.y);
        ctx.scale(k, k);
        if (c.spin > 0) ctx.rotate(c.rot);
        if (c.kind === 'hunter') drawCar(ctx, '#D93A3A', '#6E1616', false, c.dents);
        else drawCar(ctx, '#7C8794', '#3A424C', false, c.dents);
        ctx.restore();
      }

      // Hero car.
      ctx.save();
      ctx.translate(projX(s.laneX - pan, carY, w, h), carY);
      ctx.scale(perspAt(carY, h), perspAt(carY, h));
      drawCar(ctx, s.boostT > 0 ? '#5FD0FF' : '#2E6DE0', '#123A78', true, s.damage);
      ctx.restore();
      if (s.boostT > 0) {
        ctx.fillStyle = 'rgba(255,211,106,0.8)';
        ctx.beginPath();
        const px = projX(s.laneX - pan, carY, w, h);
        ctx.moveTo(px - 8, carY + CAR_H / 2);
        ctx.lineTo(px + 8, carY + CAR_H / 2);
        ctx.lineTo(px, carY + CAR_H / 2 + 30);
        ctx.closePath(); ctx.fill();
      }

      drawScanlines(ctx, w, h, 0.05);

      // Region banner, and a heads-up as the next country approaches.
      ctx.textAlign = 'center';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(204,120,92,0.85)';
      ctx.fillText(reg.name, w / 2, 22);
      if (fade > 0) {
        const nxt = REGIONS[(REGIONS.indexOf(reg) + 1) % REGIONS.length];
        ctx.fillStyle = `rgba(236,236,236,${fade})`;
        ctx.fillText(`→ ${nxt.name}`, w / 2, 40);
      }
      ctx.textAlign = 'left';

      if (s.crashed || s.finished) {
        ctx.fillStyle = 'rgba(0,0,0,0.58)';
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.fillStyle = s.finished ? '#52A77C' : '#E05252';
        ctx.font = 'bold 38px system-ui, sans-serif';
        ctx.fillText(s.finished ? 'ARRIVED' : 'WRECKED', w / 2, h / 2 - 4);
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillStyle = '#9A9A9A';
        ctx.fillText(`${Math.round(s.score)} pts · ${s.smashed} hunters smashed · ${s.civWrecks} civilian${s.civWrecks === 1 ? '' : 's'} hit`, w / 2, h / 2 + 22);
      }
    },

    score: (s) => Math.round(s.score),
    isOver: (s) => s.crashed || s.finished,

    hud(s) {
      const bar = '●'.repeat(s.damage) + '○'.repeat(Math.max(0, MAX_DAMAGE - s.damage));
      if (s.crashed) return `WRECKED · ${Math.round(s.score)} pts`;
      if (s.finished) return `ARRIVED · ${Math.round(s.score)} pts`;
      const bst = s.boostT > 0 ? ' · BOOST' : '';
      return `${Math.round(s.score)} pts · ${s.smashed} smashed · dmg ${bar}${bst}`;
    },
  };
}

// Drawn at the origin, nose up. `hero` gives the blue car a squared-off 90s JDM coupe silhouette —
// flat hood, boxy shoulders, quad round tail lamps and a tall bolted-on rear wing — evoked rather
// than badged (no marks, no model names). `dents` progressively deforms and scorches any car.
function drawCar(
  ctx: CanvasRenderingContext2D,
  body: string, dark: string, hero: boolean, dents = 0,
) {
  const w = CAR_W, h = CAR_H;
  const d = Math.max(0, Math.min(3, dents));

  // Wheels
  ctx.fillStyle = '#0B0E12';
  ctx.fillRect(-w / 2 - 3, -h / 2 + 9, 3, 12);
  ctx.fillRect(w / 2, -h / 2 + 9, 3, 12);
  ctx.fillRect(-w / 2 - 3, h / 2 - 21, 3, 12);
  ctx.fillRect(w / 2, h / 2 - 21, 3, 12);

  if (hero) {
    // Tall rear wing on twin uprights.
    ctx.fillStyle = dark;
    ctx.fillRect(-w / 2 - 5, h / 2 - 10, w + 10, 4);
    ctx.fillRect(-w / 2 + 4, h / 2 - 14, 3, 8);
    ctx.fillRect(w / 2 - 7, h / 2 - 14, 3, 8);
  }

  // Body — the hero is deliberately square-shouldered rather than rounded.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, hero ? 3 : 5);
  ctx.fill();

  if (hero) {
    // Flat hood panel + wide lower intake.
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, 9);
    ctx.fillStyle = '#0B0E12';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 1, w - 8, 3);
    // Quad round tail lamps.
    ctx.fillStyle = '#FF5C4A';
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.arc(sx * 8, h / 2 - 4, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx * 3, h / 2 - 4, 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Glass
  ctx.fillStyle = 'rgba(8,12,18,0.82)';
  ctx.fillRect(-w / 2 + 4, -h / 2 + (hero ? 14 : 8), w - 8, hero ? 11 : 12);
  ctx.fillRect(-w / 2 + 5, h / 2 - (hero ? 24 : 20), w - 10, 8);

  if (hero) {
    ctx.fillStyle = 'rgba(240,248,255,0.85)';   // silver flank stripes
    ctx.fillRect(-w / 2 + 1, -h / 2 + 15, 2, h - 30);
    ctx.fillRect(w / 2 - 3, -h / 2 + 15, 2, h - 30);
  }

  // ── Damage ──────────────────────────────────────────────────────────────────
  if (d > 0) {
    // Crumple: bite chunks out of the shell so the silhouette itself deforms.
    ctx.fillStyle = 'rgba(10,12,16,0.85)';
    const bites: [number, number, number, number][] = [
      [-w / 2 - 1, -h / 2 + 6, 6, 7],
      [w / 2 - 5, h / 2 - 18, 6, 8],
      [-w / 2 + 2, h / 2 - 9, 8, 6],
    ];
    for (let i = 0; i < d; i++) {
      const [bx, by, bw, bh] = bites[i];
      ctx.fillRect(bx, by, bw, bh);
    }
    // Scorching over the paint.
    ctx.fillStyle = `rgba(30,26,24,${0.18 * d})`;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, hero ? 3 : 5);
    ctx.fill();
    // Cracked glass.
    if (d >= 2) {
      ctx.strokeStyle = 'rgba(220,230,240,0.55)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-6, -h / 2 + 16); ctx.lineTo(3, -h / 2 + 24);
      ctx.moveTo(2, -h / 2 + 15); ctx.lineTo(-4, -h / 2 + 25);
      ctx.stroke();
    }
    // Smoke once it is badly hurt.
    if (d >= 3) {
      ctx.fillStyle = 'rgba(150,150,155,0.28)';
      ctx.beginPath(); ctx.arc(0, -h / 2 - 4, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(5, -h / 2 - 12, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
}
