import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessage, PendingWrite, TokenUsage } from '../types';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

interface UseClaudeOptions {
  apiKey: string;
  projectPath: string | null;
  autonomousWrites: boolean;
  onPendingWrite: (write: PendingWrite) => void;
}

export function useClaude({ apiKey, projectPath, autonomousWrites, onPendingWrite }: UseClaudeOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<TokenUsage | null>(null);

  const streamingIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const onPendingWriteRef = useRef(onPendingWrite);
  onPendingWriteRef.current = onPendingWrite;

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

    const unsubDone = window.electronAPI.onClaudeDone((usage) => {
      setIsStreaming(false);
      setLastUsage(usage);
      setMessages((prev) =>
        prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
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

      const history = [...messagesRef.current, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      window.electronAPI.claudeSend({ messages: history, apiKey, projectPath, autonomousWrites });
    },
    [apiKey, projectPath, autonomousWrites, isStreaming]
  );

  const clearMessages = useCallback(() => {
    if (isStreaming) {
      window.electronAPI.claudeAbort();
      setIsStreaming(false);
      streamingIdRef.current = null;
    }
    setMessages([]);
    setError(null);
  }, [isStreaming]);

  return { messages, sendMessage, isStreaming, error, lastUsage, clearMessages };
}
