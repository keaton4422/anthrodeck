import { useCallback, useEffect, useState } from 'react';
import { Flashcard } from '../types';

export function useFlashcards(projectPath: string | null) {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setCards(await window.electronAPI.flashcardsGet());
  }, []);

  useEffect(() => { reload(); }, [projectPath, reload]);

  // Live-append cards the agent mints during a turn.
  useEffect(() => {
    const unsub = window.electronAPI.onFlashcard((c) => setCards((prev) => [...prev, c]));
    return unsub;
  }, []);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      const c = await window.electronAPI.flashcardGenerate();
      if (c) setCards((prev) => [...prev, c]);
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(async () => {
    await window.electronAPI.flashcardsClear();
    setCards([]);
  }, []);

  return { cards, busy, generate, clear, reload };
}
