import { GameMode } from './types';

// Auto-discovering mode registry.
//
// Adding a game is ONE file: drop `src/renderer/game/modes/yourgame.ts` exporting
// `export function createMode(): GameMode<YourState>` (or a default export of the same shape) and
// it appears in the picker. No registry edit, no wiring — which is what makes a mode PR-able as a
// single self-contained file. See docs/GAMES.md.
//
// import.meta.glob is a Vite build-time feature: the glob is statically analysed and each match is
// bundled, so this stays fully tree-shaken and typed rather than being a runtime directory read.
type ModeFactory = () => GameMode;
interface ModeModule {
  createMode?: ModeFactory;
  default?: ModeFactory | GameMode;
}

const modules = import.meta.glob<ModeModule>('./modes/*.ts', { eager: true });

function toMode(mod: ModeModule): GameMode | null {
  if (typeof mod.createMode === 'function') return mod.createMode();
  if (typeof mod.default === 'function') return (mod.default as ModeFactory)();
  if (mod.default && typeof mod.default === 'object' && 'id' in mod.default) {
    return mod.default as GameMode;
  }
  return null;
}

function discover(): GameMode[] {
  const found: GameMode[] = [];
  for (const path of Object.keys(modules).sort()) {
    const mode = toMode(modules[path]);
    if (!mode) continue;
    if (found.some((m) => m.id === mode.id)) {
      console.warn(`[games] duplicate mode id "${mode.id}" from ${path} — ignoring`);
      continue;
    }
    found.push(mode);
  }
  // Telemetry (cockpit) modes first — they're the point; free-play fills the wait.
  return found.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'telemetry' ? -1 : 1));
}

export const GAME_MODES: GameMode[] = discover();

export function getMode(id: string): GameMode | undefined {
  return GAME_MODES.find((m) => m.id === id);
}
