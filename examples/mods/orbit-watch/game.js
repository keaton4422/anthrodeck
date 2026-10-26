// Orbit Watch: an example AnthroDeck cockpit mod. See docs/MODS.md.
//
// It's the same GameMode contract as the built-in modes (src/renderer/game/types.ts), registered
// with anthrodeck.registerMode() instead of exported, because a mod runs as a plain script inside
// its own sandboxed frame. step() stays pure: no Date.now(), no Math.random(), only the seeded rng.
//
// The pilot holds a satellite on station around a planet. Claude's live output speed sets how fast
// it orbits; up/down on the stick or D-pad changes altitude. Outcome events (a finished task, a
// green test run) drop beacons worth points; tool calls throw debris that costs a shield.
anthrodeck.registerMode(function createMode() {
  var R_MIN = 0.18, R_MAX = 0.42;     // orbit radius, as a fraction of the shorter side
  var BEACON_LIFE = 12;               // seconds
  var SHIELDS = 3;

  var INK = '#141413', IVORY = '#F0EEE6', CLAY = '#D97757', SLATE = '#B0AEA5', RING = '#2A2925';

  function rng(seed) {
    var x = (seed >>> 0) || 1;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return { seed: x, value: x / 4294967296 };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function angleGap(a, b) {
    var d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  }

  function spawn(s, kind) {
    var a = rng(s.seed), r = rng(a.seed);
    var item = {
      kind: kind,                                  // 'beacon' | 'big' | 'debris'
      angle: a.value * Math.PI * 2,
      radius: R_MIN + r.value * (R_MAX - R_MIN),
      speed: kind === 'debris' ? -0.6 : 0,         // debris orbits the wrong way
      age: 0,
    };
    return Object.assign({}, s, { seed: r.seed, items: s.items.concat([item]) });
  }

  return {
    id: 'orbit-watch',
    name: 'Orbit Watch',
    kind: 'telemetry',
    blurb: 'Keep station while Claude works',

    init: function (w, h) {
      return {
        w: w, h: h, seed: 1234567, angle: 0, radius: (R_MIN + R_MAX) / 2,
        items: [], points: 0, shields: SHIELDS, hitCooldown: 0, tps: 0, over: false, intents: [],
      };
    },

    step: function (prev, input, tel, dt) {
      var s = Object.assign({}, prev, { intents: [] });
      if (s.over) return s;

      for (var i = 0; i < tel.events.length; i++) {
        var e = tel.events[i];
        if (e.type === 'sector') s = spawn(s, 'beacon');
        else if (e.type === 'milestone') s = spawn(s, e.good ? 'big' : 'debris');
        else if (e.type === 'tool' || e.type === 'error') s = spawn(s, 'debris');
      }

      var climb = input.moveY !== 0 ? input.moveY : (input.up ? -1 : input.down ? 1 : 0);
      s.radius = clamp(s.radius - climb * 0.25 * dt, R_MIN, R_MAX);
      s.tps = tel.snapshot.tokensPerSec;
      s.angle = (s.angle + (0.35 + Math.min(tel.snapshot.tokensPerSec, 120) / 40) * dt) % (Math.PI * 2);
      s.hitCooldown = Math.max(0, s.hitCooldown - dt);

      var kept = [];
      for (var j = 0; j < s.items.length; j++) {
        var it = Object.assign({}, s.items[j]);
        it.age += dt;
        it.angle += it.speed * dt;
        var close = angleGap(it.angle, s.angle) < 0.12 && Math.abs(it.radius - s.radius) < 0.03;
        if (close && it.kind !== 'debris') { s.points += it.kind === 'big' ? 250 : 100; continue; }
        if (close && it.kind === 'debris' && s.hitCooldown === 0) {
          s.shields -= 1; s.hitCooldown = 1.5;
          continue;
        }
        if (it.kind !== 'debris' && it.age > BEACON_LIFE) continue;
        if (it.kind === 'debris' && it.age > BEACON_LIFE * 2) continue;
        kept.push(it);
      }
      s.items = kept;
      if (s.shields <= 0) s.over = true;
      return s;
    },

    render: function (ctx, s, w, h) {
      var cx = w / 2, cy = h / 2, unit = Math.min(w, h);
      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = RING;
      ctx.lineWidth = 1;
      [R_MIN, (R_MIN + R_MAX) / 2, R_MAX].forEach(function (r) {
        ctx.beginPath(); ctx.arc(cx, cy, r * unit, 0, Math.PI * 2); ctx.stroke();
      });

      ctx.fillStyle = CLAY;
      ctx.beginPath(); ctx.arc(cx, cy, unit * 0.09, 0, Math.PI * 2); ctx.fill();

      s.items.forEach(function (it) {
        var x = cx + Math.cos(it.angle) * it.radius * unit;
        var y = cy + Math.sin(it.angle) * it.radius * unit;
        if (it.kind === 'debris') {
          ctx.fillStyle = SLATE;
          ctx.fillRect(x - 4, y - 4, 8, 8);
        } else {
          ctx.strokeStyle = CLAY;
          ctx.lineWidth = it.kind === 'big' ? 3 : 2;
          ctx.globalAlpha = 1 - Math.min(1, it.age / BEACON_LIFE) * 0.7;
          ctx.beginPath(); ctx.arc(x, y, it.kind === 'big' ? 12 : 8, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      });

      var sx = cx + Math.cos(s.angle) * s.radius * unit;
      var sy = cy + Math.sin(s.angle) * s.radius * unit;
      ctx.fillStyle = s.hitCooldown > 0 && Math.floor(s.hitCooldown * 10) % 2 === 0 ? SLATE : IVORY;
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();

      if (s.over) {
        ctx.fillStyle = IVORY;
        ctx.font = '20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Station lost. ↺ to relaunch', cx, cy + unit * 0.48);
        ctx.textAlign = 'left';
      }
    },

    hud: function (s) {
      var shields = '';
      for (var i = 0; i < SHIELDS; i++) shields += i < s.shields ? '●' : '○';
      return s.points + ' pts · ' + shields + ' · ' + Math.round(s.tps) + ' tok/s';
    },
    score: function (s) { return s.points; },
    isOver: function (s) { return s.over; },
  };
});
