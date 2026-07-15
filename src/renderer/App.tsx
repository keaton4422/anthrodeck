import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { ChatView } from './components/ChatView';
import { InputBar } from './components/InputBar';
import { SettingsPanel } from './components/SettingsPanel';
import ProjectDrawer from './components/ProjectDrawer';
import AskUserModal from './components/AskUserModal';
import { useClaude } from './hooks/useClaude';
import { useVoice } from './hooks/useVoice';
import { useGamepad } from './hooks/useGamepad';
import { useStore } from './hooks/useStore';
import { useProject } from './hooks/useProject';
import { PendingWrite, PendingQuestion } from './types';

const SESSION_TOKEN_BUDGET = 200_000;

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [voiceRejecting, setVoiceRejecting] = useState(false);
  const [autonomousWrites, setAutonomousWrites] = useState(false);
  const [apiKey, setApiKey] = useStore<string>('apiKey', '');
  const [model, setModel] = useStore<string>('model', 'claude-sonnet-5');
  const [extendedThinking, setExtendedThinking] = useStore<boolean>('extendedThinking', false);
  const [effort, setEffort] = useStore<string>('effort', 'high');

  const { projectPath, files, openFolder, refreshFiles } = useProject();

  const {
    messages,
    sendMessage,
    isStreaming,
    error,
    sessionUsage,
    prunedIds,
    togglePrune,
    pruneMany,
    clearMessages,
  } = useClaude({
    apiKey,
    projectPath,
    autonomousWrites,
    model,
    extendedThinking,
    effort,
    onPendingWrite: setPendingWrite,
    onPendingQuestion: setPendingQuestion,
  });

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const writeDiffRef = useRef<HTMLPreElement>(null);

  const handleVoiceResult = useCallback(
    (text: string) => { if (text.trim()) sendMessage(text.trim()); },
    [sendMessage]
  );

  const { isListening, transcript, isSupported, startListening, stopListening } =
    useVoice(handleVoiceResult);

  const scrollChat = useCallback((delta: number) => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop += delta * 18;
  }, []);

  const handleWriteAccept = useCallback(() => {
    if (!pendingWrite) return;
    window.electronAPI.sendWriteDecision(pendingWrite.id, true);
    setPendingWrite(null);
    setVoiceRejecting(false);
  }, [pendingWrite]);

  const handleWriteReject = useCallback((feedback?: string) => {
    if (!pendingWrite) return;
    window.electronAPI.sendWriteDecision(pendingWrite.id, false, feedback);
    setPendingWrite(null);
    setVoiceRejecting(false);
  }, [pendingWrite]);

  // Dedicated voice channel for spoken write-rejection feedback (B button). Separate from the
  // main send-voice so a rejection never gets sent as a chat message.
  const rejectVoice = useVoice((text) => {
    setVoiceRejecting(false);
    handleWriteReject(text.trim() || undefined);
  });

  const answerQuestion = useCallback((value: string) => {
    if (!pendingQuestion) return;
    window.electronAPI.sendAskUserDecision(pendingQuestion.id, value);
    setPendingQuestion(null);
  }, [pendingQuestion]);

  const modalActive = !!pendingWrite || !!pendingQuestion;

  useGamepad({
    // L2 push-to-talk only drives chat when no approval modal is up.
    onL2Press: () => { if (!modalActive) startListening(); },
    onL2Release: () => { if (!modalActive) stopListening(); },
    onAPress: () => {
      if (pendingWrite) handleWriteAccept();
      else if (pendingQuestion) answerOption(0);
    },
    onXPress: () => {
      if (pendingWrite) handleWriteReject();
      else if (pendingQuestion) answerOption(2);
    },
    onBPress: () => {
      if (pendingWrite) {
        // Toggle spoken-rejection push-to-talk.
        if (voiceRejecting) {
          rejectVoice.stopListening();
        } else {
          setVoiceRejecting(true);
          rejectVoice.startListening();
        }
      } else if (pendingQuestion) {
        answerOption(1);
      } else {
        setShowSettings((s) => !s);
      }
    },
    onYPress: () => {
      if (pendingQuestion) answerOption(3);
      else setDrawerOpen((s) => !s);
    },
    onStartPress: () => setShowSettings((s) => !s),
    onDpadUp: () => { if (pendingWrite && writeDiffRef.current) writeDiffRef.current.scrollTop -= 48; },
    onDpadDown: () => { if (pendingWrite && writeDiffRef.current) writeDiffRef.current.scrollTop += 48; },
    onScrollY: scrollChat,
  });

  function answerOption(index: number) {
    const opt = pendingQuestion?.options[index];
    if (opt) answerQuestion(opt.value);
  }

  // Inject file path into input when user taps a file in the drawer
  const handleFileClick = useCallback((file: string) => {
    sendMessage(`Read the file ${file} and tell me about it`);
    setDrawerOpen(false);
  }, [sendMessage]);

  // Auto-open settings when no API key
  useEffect(() => {
    if (!apiKey) setShowSettings(true);
  }, [apiKey]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div className="app-root">
      <StatusBar
        isListening={isListening}
        isStreaming={isStreaming}
        hasApiKey={!!apiKey}
        projectPath={projectPath}
        usage={sessionUsage}
        budget={SESSION_TOKEN_BUDGET}
        onDrawer={() => setDrawerOpen((s) => !s)}
        onSettings={() => setShowSettings((s) => !s)}
      />

      {/* Project drawer (slides in from left, over content) */}
      <ProjectDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        projectPath={projectPath}
        files={files}
        onOpenFolder={openFolder}
        onRefreshFiles={refreshFiles}
        autonomousWrites={autonomousWrites}
        onToggleAutonomous={() => setAutonomousWrites((s) => !s)}
        onFileClick={handleFileClick}
        messages={messages}
        prunedIds={prunedIds}
        onTogglePrune={togglePrune}
        onPruneMany={pruneMany}
      />

      {showSettings ? (
        <SettingsPanel
          apiKey={apiKey}
          onSave={async (key) => { await setApiKey(key); setShowSettings(false); }}
          onClear={clearMessages}
          onClose={() => setShowSettings(false)}
          model={model}
          onModelChange={setModel}
          extendedThinking={extendedThinking}
          onExtendedThinkingChange={setExtendedThinking}
          effort={effort}
          onEffortChange={setEffort}
        />
      ) : (
        <>
          <ChatView
            messages={messages}
            error={error}
            scrollRef={chatScrollRef}
            isStreaming={isStreaming}
            pendingWrite={pendingWrite}
            onWriteAccept={handleWriteAccept}
            onWriteReject={handleWriteReject}
            writeDiffRef={writeDiffRef}
            voiceRejecting={voiceRejecting}
          />
          <InputBar
            onSend={sendMessage}
            isStreaming={isStreaming}
            isListening={isListening}
            transcript={transcript}
            isVoiceSupported={isSupported}
            onVoiceStart={startListening}
            onVoiceStop={stopListening}
          />
        </>
      )}

      {/* ask_user modal — Claude paused to ask the pilot a question */}
      {pendingQuestion && (
        <AskUserModal question={pendingQuestion} onSelect={answerQuestion} />
      )}
    </div>
  );
}
