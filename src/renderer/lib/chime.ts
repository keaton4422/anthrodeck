// A two-note chime: "a session wants you". Heard while a Steam game is on screen (App.tsx).
let ctx: AudioContext | null = null;

export function chime(): void {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    for (const [freq, at, dur] of [[880, 0, 0.16], [1320, 0.16, 0.28]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur);
    }
  } catch { /* no audio: nothing to do */ }
}
