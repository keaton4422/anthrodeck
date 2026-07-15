import { GameMode } from './types';
import { makeTronMode } from './modes/tron';
import { makeRacerMode } from './modes/racer';
import { makeShooterMode } from './modes/shooter';

// The pluggable mode registry. Adding a mode is one entry here — the canvas, picker, and loop are
// all mode-agnostic. Tron ships in two flavors (telemetry cockpit + free-play) from one sim.
export const GAME_MODES: GameMode[] = [
  makeTronMode({
    id: 'cockpit-tron',
    name: 'Tron Cockpit',
    kind: 'telemetry',
    telemetryDriven: true,
    blurb: 'Trail grows with progress · errors drop walls · boost = approve · crash = abort',
  }) as GameMode,
  makeRacerMode() as GameMode,
  makeShooterMode() as GameMode,
  makeTronMode({
    id: 'freeplay-tron',
    name: 'Tron (free-play)',
    kind: 'freeplay',
    telemetryDriven: false,
    blurb: 'Classic lightcycle on your own throttle — pass the time while the engine runs',
  }) as GameMode,
];

export function getMode(id: string): GameMode | undefined {
  return GAME_MODES.find((m) => m.id === id);
}
