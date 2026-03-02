import { useState, useEffect, useCallback } from 'react';

export function useProject() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
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

  const openFolder = useCallback(async () => {
    const p = await window.electronAPI.projectOpenDialog();
    if (!p) return;
    await window.electronAPI.projectSet(p);
    setProjectPath(p);
    await refreshFiles(p);
  }, [refreshFiles]);

  return { projectPath, files, loading, openFolder, refreshFiles };
}
