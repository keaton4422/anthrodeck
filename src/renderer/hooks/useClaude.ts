import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatMessage,
  DriveMode,
  EngineSettingsPayload,
  PendingQuestion,
  PendingWrite,
  Sector,
  TeachRequest,
  TokenUsage,
} from '../types';

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

export interface ContextGauge {
  percentage: number;
  totalTokens: number;
  maxTokens: number;
}

interface UseClaudeOptions {
  settings: EngineSettingsPayload;
  onPendingWrite: (write: PendingWrite) => void;
  onPendingQuestion: (question: PendingQuestion) => void;
  onTeach: (req: TeachRequest) => void;
  // The engine withdrew a card (interrupt / rewind) — close whatever modal shows it.
  onPromptCancel: (id: string) => void;
}

// Conversation state for the cockpit. Claude Code holds the real session (history, context,
// compaction); this hook only mirrors it for display and forwards the pilot's turns.
export function useClaude({ settings, onPendingWrite, onPendingQuestion, onTeach, onPromptCancel }: UseClaudeOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionUsage, setSessionUsage] = useState<TokenUsage>(ZERO_USAGE);
  const [costUsd, setCostUsd] = useState(0);
  const [context, setContext] = useState<ContextGauge | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [mode, setModeState] = useState<DriveMode>('default');
  const [engineModel, setEngineModel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const streamingIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const cbs = useRef({ onPendingWrite, onPendingQuestion, onTeach, onPromptCancel });
  cbs.current = { onPendingWrite, onPendingQuestion, onTeach, onPromptCancel };

  const appendToStreaming = (text: string) => {
    if (!streamingIdRef.current) return;
    const id = streamingIdRef.current;
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + text } : m)));
  };

  useEffect(() => {
    void window.electronAPI.claudeGetMode().then(setModeState).catch(() => {});

    const unsubs = [
      window.electronAPI.onClaudeDelta(appendToStreaming),
      // Tool activity labels (e.g. `read: src/App.tsx`) get appended inline.
      window.electronAPI.onClaudeToolActivity(appendToStreaming),
      window.electronAPI.onFileWritten((filePath) => appendToStreaming(`\n\`✓ wrote: ${filePath}\`\n`)),

      window.electronAPI.onClaudeDone((result) => {
        setIsStreaming(false);
        // Claude Code reports running session totals — replace, don't sum.
        setSessionUsage({
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cacheReadTokens: result.cacheReadTokens,
          cacheCreationTokens: result.cacheCreationTokens,
          thinkingTokens: result.thinkingTokens,
        });
        setCostUsd(result.costUsd);
        const finishedId = streamingIdRef.current;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== finishedId) return m.isStreaming ? { ...m, isStreaming: false } : m;
            return {
              ...m,
              isStreaming: false,
              content: m.content.replace(CONFIDENCE_RE, ''),
              confidence: result.confidence ?? undefined,
              anchor: result.anchor,
            };
          }),
        );
        streamingIdRef.current = null;
      }),

      window.electronAPI.onClaudeError((err) => {
        setError(err === 'Aborted' ? null : err);
        setIsStreaming(false);
        setMessages((prev) =>
          prev
            .filter((m) => !(m.isStreaming && m.content === ''))
            .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
        );
        streamingIdRef.current = null;
      }),

      window.electronAPI.onEngineEvent((ev) => {
        switch (ev.type) {
          case 'session': setEngineModel(ev.model); break;
          case 'sectors': setSectors(ev.sectors); break;
          case 'mode': setModeState(ev.mode); break;
          case 'context': setContext({ percentage: ev.percentage, totalTokens: ev.totalTokens, maxTokens: ev.maxTokens }); break;
          case 'compacted':
            setNotice(`Context compacted from ${Math.round(ev.preTokens / 1000)}K tokens.`);
            break;
          case 'retry':
            setNotice(`Engine hiccup, retrying (${ev.attempt}/${ev.maxRetries})…`);
            break;
          default: break;
        }
      }),

      window.electronAPI.onWritePreview((data) => cbs.current.onPendingWrite(data)),
      window.electronAPI.onAskUser((data) => cbs.current.onPendingQuestion(data)),
      window.electronAPI.onTeach((data) => cbs.current.onTeach(data)),
      window.electronAPI.onPromptCancel((id) => cbs.current.onPromptCancel(id)),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isStreaming) return;

      const userMsg: ChatMessage = { id: uid(), role: 'user', content: text.trim(), timestamp: Date.now() };
      const assistantId = uid();
      const assistantMsg: ChatMessage = {
        id: assistantId, role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setError(null);
      setNotice(null);
      streamingIdRef.current = assistantId;

      window.electronAPI.claudeSend({ text: text.trim(), settings });
    },
    [settings, isStreaming],
  );

  const abort = useCallback(() => {
    if (isStreaming) window.electronAPI.claudeAbort();
  }, [isStreaming]);

  // Fresh session: Claude Code forgets the conversation, and so does the cockpit.
  const clearMessages = useCallback(() => {
    window.electronAPI.claudeReset();
    setIsStreaming(false);
    streamingIdRef.current = null;
    setMessages([]);
    setError(null);
    setNotice(null);
    setSessionUsage(ZERO_USAGE);
    setCostUsd(0);
    setContext(null);
    setSectors([]);
  }, []);

  // Reopen a session from the pit wall: the engine resumes it on the next send, and its conversation
  // comes back on screen so the pilot knows where they left off.
  const resumeSession = useCallback(async (id: string, cwd: string): Promise<string | null> => {
    const r = await window.electronAPI.sessionsResume(id, cwd, settings as unknown as Record<string, unknown>);
    if (r.error || !r.history) return r.error ?? 'Could not reopen that session.';
    setIsStreaming(false);
    streamingIdRef.current = null;
    setMessages(r.history.map((m) => ({ ...m })));
    setError(null);
    setNotice(null);
    setSessionUsage(ZERO_USAGE);
    setCostUsd(0);
    setContext(null);
    setSectors([]);
    return null;
  }, [settings]);

  // Rewind: drop everything after the given message and resume Claude Code from the last completed
  // turn at or before it, on a fork — so the next send really continues from that point.
  const rewindTo = useCallback((id: string) => {
    const msgs = messagesRef.current;
    const idx = msgs.findIndex((m) => m.id === id);
    if (idx === -1) return;
    // Cut back to the last completed turn so the screen shows exactly what the engine still knows.
    let cut = -1;
    for (let i = idx; i >= 0; i--) {
      if (msgs[i].role === 'assistant' && msgs[i].anchor) { cut = i; break; }
    }
    const anchor = cut >= 0 ? msgs[cut].anchor ?? null : null;
    window.electronAPI.claudeRewind(anchor);
    setIsStreaming(false);
    streamingIdRef.current = null;
    setMessages(msgs.slice(0, cut + 1));
    if (!anchor) { setSectors([]); setContext(null); }
    setError(null);
  }, []);

  const setMode = useCallback(async (m: DriveMode) => {
    setModeState(await window.electronAPI.claudeSetMode(m));
  }, []);

  // Claude Code's /compact is the real context pruner now: it summarises the session in place.
  const pitStop = useCallback(() => sendMessage('/compact'), [sendMessage]);

  return {
    messages,
    sendMessage,
    isStreaming,
    error,
    notice,
    sessionUsage,
    costUsd,
    context,
    sectors,
    mode,
    setMode,
    engineModel,
    rewindTo,
    resumeSession,
    abort,
    pitStop,
    clearMessages,
  };
}
