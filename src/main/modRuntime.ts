// The page and runtime a mod game runs inside.
//
// A mod's code never runs in the app's own window: that window holds window.electronAPI, which can
// run shell commands, write files and answer approvals. Instead each mod game gets a sandboxed,
// opaque-origin iframe (see components/ModFrame.tsx) loading HOST_PAGE, which pulls in this runtime
// and then the mod's own script.
//
// The runtime gives the mod the same GameMode contract the built-in modes use. The cockpit sends it
// one message per frame (input, telemetry, dt); it runs step() and render() on its own canvas and
// answers with the HUD line, score, game-over flag and any intents. That message is the mod's ONLY
// way out, and the cockpit filters it (game/mods.ts).
//
// Plain ES5-ish JS in a string rather than a bundled module: it is served as a file by the mod
// protocol, and has to stay byte-for-byte what is tested here regardless of how main is bundled.

export const MOD_RUNTIME_JS = `(function () {
  'use strict';
  var mode = null, state = null, run = null, w = 0, h = 0, crashed = false;
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');

  function post(msg) { window.parent.postMessage(msg, '*'); }

  function fail(err) {
    crashed = true;
    var message = String((err && err.message) || err).slice(0, 200);
    post({ type: 'error', message: message });
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#141413';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#D97757';
      ctx.font = '16px monospace';
      ctx.fillText('This mod stopped: ' + message, 24, 40);
    } catch (e) { /* nothing left to draw with */ }
  }

  window.anthrodeck = Object.freeze({
    registerMode: function (m) {
      if (mode) return;
      try { mode = typeof m === 'function' ? m() : m; } catch (err) { fail(err); }
    }
  });

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent || crashed || !mode) return;
    var d = e.data;
    if (!d || d.type !== 'frame') return;
    try {
      if (d.run !== run || d.w !== w || d.h !== h) {
        run = d.run; w = d.w; h = d.h;
        canvas.width = w; canvas.height = h;
        state = mode.init(w, h);
      }
      state = mode.step(state, d.input, d.tel, d.dt);
      var intents = [];
      if (state && state.intents && state.intents.length) {
        for (var i = 0; i < state.intents.length; i++) intents.push({ type: String(state.intents[i] && state.intents[i].type) });
        state = Object.assign({}, state, { intents: [] });
      }
      mode.render(ctx, state, w, h);
      post({
        type: 'status',
        run: run,
        hud: String(mode.hud(state)),
        score: mode.score ? Number(mode.score(state)) : 0,
        over: mode.isOver ? !!mode.isOver(state) : false,
        intents: intents
      });
    } catch (err) { fail(err); }
  });

  window.addEventListener('DOMContentLoaded', function () {
    if (crashed) return;
    if (mode) post({ type: 'ready' });
    else fail(new Error('the mod never called anthrodeck.registerMode()'));
  });
})();
`;

// Classic scripts, not modules: a module script from an opaque origin would need CORS headers, and
// the runtime has to be defined before the mod's script runs.
export function hostPage(entry: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}</style>
</head><body><canvas id="stage"></canvas>
<script src="/__cockpit__/runtime.js"></script>
<script src="/${entry}"></script>
</body></html>`;
}
