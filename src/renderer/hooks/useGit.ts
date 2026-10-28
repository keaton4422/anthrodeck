import { useState, useCallback } from 'react';
import type { Commit } from '../types';

export function useGit(projectPath: string | null) {
  const [statusText, setStatusText] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [lastResult, setLastResult] = useState('');
  // The project's recent commits (on whichever computer it's on).
  const [history, setHistory] = useState<{ commits: Commit[]; error: string | null } | null>(null);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    const [status, log] = await Promise.all([window.electronAPI.gitStatus(), window.electronAPI.gitLog()]);
    setStatusText(status.stdout || status.stderr || 'Nothing to commit');
    setHistory(log);
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
      await refresh();
    } finally {
      setIsWorking(false);
    }
  }, [projectPath, refresh]);

  return { statusText, commitMsg, setCommitMsg, isWorking, lastResult, history, refresh, commit, push };
}
