import { useEffect, useState } from 'react';

export function useStore<T>(key: string, defaultValue: T): [T, (v: T) => Promise<void>] {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    window.electronAPI.storeGet(key).then((stored) => {
      if (stored !== undefined && stored !== null) {
        setValue(stored as T);
      }
    });
  }, [key]);

  const set = async (newValue: T) => {
    setValue(newValue);
    await window.electronAPI.storeSet(key, newValue);
  };

  return [value, set];
}
