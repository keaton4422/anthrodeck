import { useCallback, useState } from 'react';
import { PreviewStatus } from '../types';

interface StartOpts {
  port?: number;
  https?: boolean;
  devPort?: number | null;
}

export function usePreview() {
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await window.electronAPI.previewStatus());
  }, []);

  const start = useCallback(async (opts: StartOpts) => {
    setBusy(true);
    try {
      setStatus(await window.electronAPI.previewStart(opts));
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await window.electronAPI.previewStop());
    } finally {
      setBusy(false);
    }
  }, []);

  const detectDev = useCallback(() => window.electronAPI.previewDetectDev(), []);

  return { status, busy, refresh, start, stop, detectDev };
}
