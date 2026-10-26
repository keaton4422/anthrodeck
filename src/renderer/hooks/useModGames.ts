import { useEffect, useState } from 'react';
import { buildModGames, type ModGameEntry } from '../game/mods';

// The mod games installed in <userData>/mods, read each time the cockpit opens, so a mod dropped
// into the folder shows up the next time it does. No mods (or no bridge) is just an empty list.
export function useModGames(): ModGameEntry[] {
  const [games, setGames] = useState<ModGameEntry[]>([]);
  useEffect(() => {
    let live = true;
    window.electronAPI.modsList?.()
      .then((scan) => { if (live) setGames(buildModGames(scan.mods)); })
      .catch(() => { /* the cockpit works the same without mods */ });
    return () => { live = false; };
  }, []);
  return games;
}
