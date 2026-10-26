import { useState, useEffect, useCallback } from 'react';

export function useProject() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  // The computer the project is on: null for this one, else the remote host (Settings → Remote).
  const [projectHost, setProjectHost] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Load saved project on mount
  useEffect(() => {
    window.electronAPI.projectGet().then((p) => {
      if (p) {
        setProjectPath(p);
        refreshFiles(p);
      }
    });
    void window.electronAPI.projectHost().then(setProjectHost);
  }, []);

  const refreshFiles = useCallback(async (overridePath?: string) => {
    const root = overridePath ?? projectPath;
    if (!root) return;
    setLoading(true);
    try {
      const list = await window.electronAPI.fsList();
      setFiles(list);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Returns the folder picked, or null if the dialog was cancelled.
  const openFolder = useCallback(async (): Promise<string | null> => {
    const p = await window.electronAPI.projectOpenDialog();
    if (!p) return null;
    await window.electronAPI.projectSet(p);
    setProjectPath(p);
    await refreshFiles(p);
    return p;
  }, [refreshFiles]);

  // Switch to a folder chosen elsewhere (a project on the pit wall, or a reopened session's folder).
  const adoptProject = useCallback(async (p: string, host: string | null = null) => {
    await window.electronAPI.projectSet(p, host);
    setProjectPath(p);
    setProjectHost(host);
    await refreshFiles(p);
  }, [refreshFiles]);

  return { projectPath, projectHost, files, loading, openFolder, refreshFiles, adoptProject };
}
