import type { GameMode, GameInput, GameIntent, IntentCarrier, TelemetryFrame } from './types';
import { modGameId, type ModManifest } from '../../main/modManifest';

// The cockpit's side of a mod game.
//
// A mod's GameMode runs inside a sandboxed iframe (components/ModFrame.tsx, main/modRuntime.ts).
// Here it's wrapped in a proxy GameMode so the ordinary game loop, picker and high scores work
// unchanged: the proxy's step() posts the frame to the iframe and folds the iframe's latest answer
// into its own state; its render() only paints the backdrop the iframe draws over.
//
// Everything a mod says comes through ModChannel.receive() and is treated as untrusted: the HUD
// line is clipped, the score clamped, and intents gated below.

// Which intents a mod may raise. A Record over the whole union on purpose: adding an intent to
// GameIntent won't compile until someone decides here whether a third-party mod gets it.
const MOD_INTENTS: Record<GameIntent['type'], boolean> = {
  'prune-stale': true,
  'focus-question': true,
};

// A mod can raise each intent at most this often, however often it asks.
export const INTENT_COOLDOWN_S = 5;
const MAX_HUD = 80;
const MAX_SCORE = 1e9;

export interface ModStatus {
  run: number;
  hud: string;
  score: number;
  over: boolean;
  intents: GameIntent[];
}

interface FramePoster {
  postMessage(message: unknown, targetOrigin: string): void;
}

function isIntentType(t: unknown): t is GameIntent['type'] {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(MOD_INTENTS, t) && MOD_INTENTS[t as GameIntent['type']];
}

// Untrusted message → a status, or null if it isn't one.
export function parseStatus(data: unknown): ModStatus | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'status' || typeof d.run !== 'number') return null;
  const score = typeof d.score === 'number' && Number.isFinite(d.score) ? Math.min(MAX_SCORE, Math.max(0, d.score)) : 0;
  const intents: GameIntent[] = [];
  if (Array.isArray(d.intents)) {
    for (const i of d.intents.slice(0, 8)) {
      const type = (i as { type?: unknown } | null)?.type;
      if (isIntentType(type)) intents.push({ type } as GameIntent);
    }
  }
  return {
    run: d.run,
    hud: typeof d.hud === 'string' ? d.hud.slice(0, MAX_HUD) : '',
    score,
    over: d.over === true,
    intents,
  };
}

// Pure: which of `wanted` may fire now, and the updated last-fired clock.
export function gateIntents(
  wanted: GameIntent[],
  last: Partial<Record<GameIntent['type'], number>>,
  clock: number,
): { intents: GameIntent[]; last: Partial<Record<GameIntent['type'], number>> } {
  const intents: GameIntent[] = [];
  const next = { ...last };
  for (const i of wanted) {
    if (!isIntentType(i.type)) continue;
    const at = next[i.type];
    if (at !== undefined && clock - at < INTENT_COOLDOWN_S) continue;
    next[i.type] = clock;
    intents.push(i);
  }
  return { intents, last: next };
}

// The pipe between the proxy mode and one mod iframe.
export class ModChannel {
  private target: FramePoster | null = null;
  private latest: ModStatus | null = null;
  private pending: GameIntent[] = [];
  ready = false;
  error: string | null = null;

  // A new frame (or none): whatever the old one said no longer applies.
  attach(target: FramePoster | null): void {
    this.target = target;
    this.latest = null;
    this.pending = [];
    this.ready = false;
    this.error = null;
  }

  send(message: unknown): void {
    try { this.target?.postMessage(message, '*'); } catch { /* frame gone mid-teardown */ }
  }

  receive(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const type = (data as { type?: unknown }).type;
    if (type === 'ready') { this.ready = true; return; }
    if (type === 'error') {
      const msg = (data as { message?: unknown }).message;
      this.error = typeof msg === 'string' && msg ? msg.slice(0, MAX_HUD) : 'unknown error';
      return;
    }
    const status = parseStatus(data);
    if (!status) return;
    this.ready = true;
    this.latest = status;
    this.pending.push(...status.intents);
    if (this.pending.length > 16) this.pending.splice(0, this.pending.length - 16);
  }

  // The latest status for `run` (an older run's answers are dropped), plus intents since last take.
  take(run: number): { status: ModStatus | null; intents: GameIntent[] } {
    const status = this.latest?.run === run ? this.latest : null;
    const intents = status ? this.pending : [];
    this.pending = [];
    return { status, intents };
  }
}

export interface ModProxyState extends IntentCarrier {
  run: number;
  w: number;
  h: number;
  clock: number;
  hud: string;
  score: number;
  over: boolean;
  ready: boolean;
  failed: string | null;
  intents: GameIntent[];
  lastIntent: Partial<Record<GameIntent['type'], number>>;
}

// Run ids are global, not per channel, so a race parked with the cockpit closed still matches the
// fresh iframe that resumes it (the iframe adopts whatever run the frame message names).
let runSeq = 0;

export function createModProxyMode(manifest: ModManifest, channel: ModChannel): GameMode<ModProxyState> {
  const game = manifest.game!;
  return {
    id: modGameId(manifest.id),
    name: manifest.name,
    kind: game.kind,
    blurb: `Mod${manifest.author ? ` by ${manifest.author}` : ''} · ${game.blurb}`,

    init: (w, h) => ({
      run: ++runSeq, w, h, clock: 0, hud: '', score: 0, over: false, ready: false, failed: null,
      intents: [], lastIntent: {},
    }),

    step: (s: ModProxyState, input: GameInput, tel: TelemetryFrame, dt: number) => {
      channel.send({ type: 'frame', run: s.run, w: s.w, h: s.h, input, tel, dt });
      const { status, intents } = channel.take(s.run);
      const clock = s.clock + dt;
      const gated = gateIntents(intents, s.lastIntent, clock);
      return {
        ...s,
        clock,
        hud: status ? status.hud : s.hud,
        score: status ? status.score : s.score,
        over: status ? status.over : s.over,
        ready: channel.ready,
        failed: channel.error,
        intents: gated.intents,
        lastIntent: gated.last,
      };
    },

    // The iframe paints over this. It only shows while the mod is loading, or if it never does.
    render: (ctx, s, w, h) => {
      ctx.fillStyle = '#141413';
      ctx.fillRect(0, 0, w, h);
      if (s.ready && !s.failed) return;
      ctx.fillStyle = s.failed ? '#D97757' : '#B0AEA5';
      ctx.font = '16px monospace';
      ctx.fillText(s.failed ? `This mod stopped: ${s.failed}` : `Loading ${manifest.name}…`, 24, 40);
    },

    hud: (s) => (s.failed ? 'Mod stopped' : s.hud),
    score: (s) => s.score,
    isOver: (s) => s.over,
  };
}

export interface ModGameEntry {
  manifest: ModManifest;
  mode: GameMode;
  channel: ModChannel;
}

export function buildModGames(mods: ModManifest[]): ModGameEntry[] {
  const out: ModGameEntry[] = [];
  for (const manifest of mods) {
    if (!manifest.game || out.some((g) => g.manifest.id === manifest.id)) continue;
    const channel = new ModChannel();
    out.push({ manifest, channel, mode: createModProxyMode(manifest, channel) as GameMode });
  }
  return out;
}
