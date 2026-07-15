import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessage, PendingWrite, PendingQuestion, TokenUsage } from '../types';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  thinkingTokens: 0,
};

// Strip the trailing <confidence>…</confidence> tag from displayed assistant text (the parsed
// level arrives separately on the done event).
const CONFIDENCE_RE = /\s*<confidence>\s*(?:high|medium|med|low)\s*<\/confidence>\s*$/i;

interface UseClaudeOptions {
  apiKey: string;
  projectPath: string | null;
  autonomousWrites: boolean;
  model: string;
  extendedThinking: boolean;
  effort: string;
  onPendingWrite: (write: PendingWrite) => void;
  onPendingQuestion: (question: PendingQuestion) => void;
}

export function useClaude({
  apiKey,
  projectPath,
  autonomousWrites,
  model,
  extendedThinking,
  effort,
  onPendingWrite,
  onPendingQuestion,
}: UseClaudeOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionUsage, setSessionUsage] = useState<TokenUsage>(ZERO_USAGE);
  // Message ids the pilot has pruned from the context sent on the next request.
  const [prunedIds, setPrunedIds] = useState<Set<string>>(() => new Set());

  const streamingIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const prunedIdsRef = useRef<Set<string>>(prunedIds);
  prunedIdsRef.current = prunedIds;
  const onPendingWriteRef = useRef(onPendingWrite);
  onPendingWriteRef.current = onPendingWrite;
  const onPendingQuestionRef = useRef(onPendingQuestion);
  onPendingQuestionRef.current = onPendingQuestion;

  useEffect(() => {
    const unsubDelta = window.electronAPI.onClaudeDelta((delta) => {
      if (!streamingIdRef.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamingIdRef.current ? { ...m, content: m.content + delta } : m
        )
      );
    });

    // Tool activity labels (e.g. `read: src/App.tsx`) get appended inline
    const unsubActivity = window.electronAPI.onClaudeToolActivity((label) => {
      if (!streamingIdRef.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamingIdRef.current ? { ...m, content: m.content + label } : m
        )
      );
    });

    const unsubDone = window.electronAPI.onClaudeDone((result) => {
      setIsStreaming(false);
      // Accumulate the turn's usage into the running session total (HUD source).
      setSessionUsage((prev) => ({
        inputTokens: prev.inputTokens + result.inputTokens,
        outputTokens: prev.outputTokens + result.outputTokens,
        cacheReadTokens: prev.cacheReadTokens + result.cacheReadTokens,
        cacheCreationTokens: prev.cacheCreationTokens + result.cacheCreationTokens,
        thinkingTokens: prev.thinkingTokens + result.thinkingTokens,
      }));
      const finishedId = streamingIdRef.current;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== finishedId) return m.isStreaming ? { ...m, isStreaming: false } : m;
          return {
            ...m,
            isStreaming: false,
            content: m.content.replace(CONFIDENCE_RE, ''),
            confidence: result.confidence ?? undefined,
          };
        })
      );
      streamingIdRef.current = null;
    });

    const unsubError = window.electronAPI.onClaudeError((err) => {
      setError(err);
      setIsStreaming(false);
      setMessages((prev) =>
        prev.filter((m) => !(m.isStreaming && m.content === ''))
      );
      streamingIdRef.current = null;
    });

    // Write preview: Claude wants to write a file
    const unsubPreview = window.electronAPI.onWritePreview((data) => {
      onPendingWriteRef.current(data);
    });

    // ask_user: Claude wants the pilot to pick between options
    const unsubAsk = window.electronAPI.onAskUser((data) => {
      onPendingQuestionRef.current(data);
    });

    // File written toast (autonomous mode)
    const unsubWritten = window.electronAPI.onFileWritten((filePath) => {
      if (!streamingIdRef.current) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamingIdRef.current
            ? { ...m, content: m.content + `\n\`✓ wrote: ${filePath}\`` }
            : m
        )
      );
    });

    return () => {
      unsubDelta();
      unsubActivity();
      unsubDone();
      unsubError();
      unsubPreview();
      unsubAsk();
      unsubWritten();
    };
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isStreaming) return;

      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      };

      const assistantId = uid();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setError(null);
      streamingIdRef.current = assistantId;

      // Build history, dropping any messages the pilot has pruned from context.
      const pruned = prunedIdsRef.current;
      const history = [...messagesRef.current, userMsg]
        .filter((m) => !pruned.has(m.id))
        .map((m) => ({ role: m.role, content: m.content }));

      window.electronAPI.claudeSend({
        messages: history,
        apiKey,
        projectPath,
        autonomousWrites,
        model,
        extendedThinking,
        effort,
      });
    },
    [apiKey, projectPath, autonomousWrites, model, extendedThinking, effort, isStreaming]
  );

  const clearMessages = useCallback(() => {
    if (isStreaming) {
      window.electronAPI.claudeAbort();
      setIsStreaming(false);
      streamingIdRef.current = null;
    }
    setMessages([]);
    setError(null);
    setSessionUsage(ZERO_USAGE);
    setPrunedIds(new Set());
  }, [isStreaming]);

  const togglePrune = useCallback((id: string) => {
    setPrunedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pruneMany = useCallback((ids: string[]) => {
    setPrunedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  return {
    messages,
    sendMessage,
    isStreaming,
    error,
    sessionUsage,
    prunedIds,
    togglePrune,
    pruneMany,
    clearMessages,
  };
}
