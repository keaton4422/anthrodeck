import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applySeason,
  levelFor,
  levelProgress,
  loadSeason,
  NEW_SEASON,
  tierFor,
  type SeasonEvent,
  type SeasonState,
  type SeasonUpdate,
} from '../lib/season';
import type { Sector } from '../types';

const KEY = 'season';

export interface SeasonView {
  state: SeasonState;
  level: number;
  tier: string;
  progress: number;
}

// The pilot's career, fed straight from the engine: finished turns, completed sectors and real
// milestones. The cockpit can also record pilot-side outcomes (approved edits, answered questions).
// `onUpdate` fires for every event that earned something, so the app can toast and rumble.
export function useSeason(onUpdate: (u: SeasonUpdate) => void) {
  const [state, setState] = useState<SeasonState>(NEW_SEASON);
  const stateRef = useRef(state);
  stateRef.current = state;
  const loaded = useRef(false);
  const sectorsRef = useRef<Sector[]>([]);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const record = useCallback((ev: SeasonEvent) => {
    const u = applySeason(stateRef.current, ev);
    stateRef.current = u.state;
    setState(u.state);
    if (loaded.current) void window.electronAPI.storeSet(KEY, u.state);
    if (u.gained > 0 || u.unlocked.length > 0) onUpdateRef.current(u);
  }, []);

  useEffect(() => {
    void window.electronAPI.storeGet(KEY).then((raw) => {
      const s = loadSeason(raw);
      stateRef.current = s;
      setState(s);
      loaded.current = true;
    });

    const unsubDone = window.electronAPI.onClaudeDone((r) => {
      record({ type: 'lap', confidence: r.confidence, isError: r.isError });
    });
    const unsubEngine = window.electronAPI.onEngineEvent((ev) => {
      if (ev.type === 'sectors') sectorsRef.current = ev.sectors;
      else if (ev.type === 'sector-done') {
        const list = sectorsRef.current;
        record({ type: 'sector', total: list.length, completed: list.filter((s) => s.status === 'completed').length });
      } else if (ev.type === 'milestone') {
        record({ type: 'milestone', kind: ev.kind });
      }
    });
    return () => { unsubDone(); unsubEngine(); };
  }, [record]);

  const level = levelFor(state.xp);
  const view: SeasonView = { state, level, tier: tierFor(level), progress: levelProgress(state.xp) };
  return { season: view, record };
}
