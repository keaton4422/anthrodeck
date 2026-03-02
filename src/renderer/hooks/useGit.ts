import { useState, useCallback } from 'react';

export function useGit(projectPath: string | null) {
  const [statusText, setStatusText] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [lastResult, setLastResult] = useState('');

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    const { stdout, stderr } = await window.electronAPI.gitStatus();
    setStatusText(stdout || stderr || 'Nothing to commit');
  }, [projectPath]);

  const commit = useCallback(async () => {
    if (!projectPath || !commitMsg.trim()) return;
    setIsWorking(true);
    setLastResult('');
    try {
      const { stdout, stderr } = await window.electronAPI.gitAddAndCommit(commitMsg.trim());
      setLastResult(stdout || stderr);
      setCommitMsg('');
      await refresh();
    } finally {
      setIsWorking(false);
    }
  }, [projectPath, commitMsg, refresh]);

  const push = useCallback(async () => {
    if (!projectPath) return;
    setIsWorking(true);
    setLastResult('');
    try {
      const { stdout, stderr } = await window.electronAPI.gitPush();
      setLastResult(stdout || stderr);
    } finally {
      setIsWorking(false);
    }
  }, [projectPath]);

  return { statusText, commitMsg, setCommitMsg, isWorking, lastResult, refresh, commit, push };
}
