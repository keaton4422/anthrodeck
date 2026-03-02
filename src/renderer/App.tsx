import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { ChatView } from './components/ChatView';
import { InputBar } from './components/InputBar';
import { SettingsPanel } from './components/SettingsPanel';
import ProjectDrawer from './components/ProjectDrawer';
import WritePreview from './components/WritePreview';
import { useClaude } from './hooks/useClaude';
import { useVoice } from './hooks/useVoice';
import { useGamepad } from './hooks/useGamepad';
import { useStore } from './hooks/useStore';
import { useProject } from './hooks/useProject';
import { PendingWrite } from './types';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const [autonomousWrites, setAutonomousWrites] = useState(false);
  const [apiKey, setApiKey] = useStore<string>('apiKey', '');

  const { projectPath, files, openFolder, refreshFiles } = useProject();

  const { messages, sendMessage, isStreaming, error, clearMessages } = useClaude({
    apiKey,
    projectPath,
    autonomousWrites,
    onPendingWrite: setPendingWrite,
  });

  const chatScrollRef = useRef<HTMLDivElement>(null);

  const handleVoiceResult = useCallback(
    (text: string) => { if (text.trim()) sendMessage(text.trim()); },
    [sendMessage]
  );

  const { isListening, transcript, isSupported, startListening, stopListening } =
    useVoice(handleVoiceResult);

  const scrollChat = useCallback((delta: number) => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop += delta * 18;
  }, []);

  useGamepad({
    onL2Press: startListening,
    onL2Release: stopListening,
    onBPress: () => setShowSettings((s) => !s),
    onYPress: () => setDrawerOpen((s) => !s),
    onStartPress: () => setShowSettings((s) => !s),
    onScrollY: scrollChat,
  });

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

  const handleWriteAccept = useCallback(() => {
    if (!pendingWrite) return;
    window.electronAPI.sendWriteDecision(pendingWrite.id, true);
    setPendingWrite(null);
  }, [pendingWrite]);

  const handleWriteReject = useCallback((feedback?: string) => {
    if (!pendingWrite) return;
    window.electronAPI.sendWriteDecision(pendingWrite.id, false, feedback);
    setPendingWrite(null);
  }, [pendingWrite]);

  return (
    <div className="app-root">
      <StatusBar
        isListening={isListening}
        isStreaming={isStreaming}
        hasApiKey={!!apiKey}
        projectPath={projectPath}
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
      />

      {showSettings ? (
        <SettingsPanel
          apiKey={apiKey}
          onSave={async (key) => { await setApiKey(key); setShowSettings(false); }}
          onClear={clearMessages}
          onClose={() => setShowSettings(false)}
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
    </div>
  );
}
