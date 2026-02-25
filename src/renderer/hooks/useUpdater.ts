import { useCallback, useEffect, useState } from 'react';

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error';

export interface UpdaterStatus {
  state: UpdateState;
  version: string;           // current app version
  newVersion?: string;       // available version, if any
  downloadPercent?: number;
  error?: string;
}

export function useUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'idle', version: '' });

  // Get current version on mount
  useEffect(() => {
    window.electronAPI.updaterGetVersion().then((v) => {
      setStatus((s) => ({ ...s, version: v }));
    });
  }, []);

  // Subscribe to updater events from main process
  useEffect(() => {
    const unsubAvailable = window.electronAPI.onUpdaterAvailable((info) => {
      setStatus((s) => ({ ...s, state: 'available', newVersion: info.version }));
    });

    const unsubUpToDate = window.electronAPI.onUpdaterUpToDate(() => {
      setStatus((s) => ({ ...s, state: 'up-to-date' }));
      // Reset to idle after showing message
      setTimeout(() => setStatus((s) => ({ ...s, state: 'idle' })), 4000);
    });

    const unsubProgress = window.electronAPI.onUpdaterProgress((info) => {
      setStatus((s) => ({ ...s, state: 'downloading', downloadPercent: info.percent }));
    });

    const unsubReady = window.electronAPI.onUpdaterReady((info) => {
      setStatus((s) => ({ ...s, state: 'ready', newVersion: info.version }));
    });

    const unsubError = window.electronAPI.onUpdaterError((err) => {
      setStatus((s) => ({ ...s, state: 'error', error: err }));
    });

    return () => {
      unsubAvailable();
      unsubUpToDate();
      unsubProgress();
      unsubReady();
      unsubError();
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    setStatus((s) => ({ ...s, state: 'checking', error: undefined }));
    try {
      const result = await window.electronAPI.updaterCheck() as { dev?: boolean; error?: string } | null;
      if (result?.dev) {
        // Running in development mode — updater is disabled
        setStatus((s) => ({ ...s, state: 'idle', error: 'Auto-update is only available in packaged builds.\nUse "npm start" for hot reload during development.' }));
        setTimeout(() => setStatus((s) => ({ ...s, error: undefined, state: 'idle' })), 6000);
      }
      // Real results come via event listeners above
    } catch (e) {
      setStatus((s) => ({ ...s, state: 'error', error: (e as Error).message }));
    }
  }, []);

  const downloadUpdate = useCallback(async () => {
    setStatus((s) => ({ ...s, state: 'downloading', downloadPercent: 0 }));
    await window.electronAPI.updaterDownload();
  }, []);

  const installUpdate = useCallback(() => {
    window.electronAPI.updaterInstall();
  }, []);

  return { status, checkForUpdates, downloadUpdate, installUpdate };
}
