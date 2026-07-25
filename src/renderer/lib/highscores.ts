// Per-mode high scores, persisted through the existing electron-store bridge. A mode gets these for
// free just by implementing the optional `score()` / `isOver()` pair on GameMode.

const KEY = 'gameHighScores';

export type HighScores = Record<string, number>;

export async function loadHighScores(): Promise<HighScores> {
  try {
    const raw = await window.electronAPI.storeGet(KEY);
    return (raw && typeof raw === 'object' ? raw : {}) as HighScores;
  } catch {
    return {};
  }
}

// Pure: whether `score` beats what's recorded, and the table that results.
export function applyScore(scores: HighScores, modeId: string, score: number): {
  isRecord: boolean;
  next: HighScores;
} {
  const best = scores[modeId] ?? 0;
  if (!Number.isFinite(score) || score <= best) return { isRecord: false, next: scores };
  return { isRecord: true, next: { ...scores, [modeId]: Math.round(score) } };
}

export async function saveHighScores(scores: HighScores): Promise<void> {
  try {
    await window.electronAPI.storeSet(KEY, scores);
  } catch {
    /* non-fatal — a lost high score should never break the game */
  }
}
