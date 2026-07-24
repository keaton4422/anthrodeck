import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { ChatView } from './components/ChatView';
import { InputBar } from './components/InputBar';
import { SettingsPanel } from './components/SettingsPanel';
import ProjectDrawer from './components/ProjectDrawer';
import AskUserModal from './components/AskUserModal';
import ShareModal from './components/ShareModal';
import GameCanvas from './components/GameCanvas';
import TeachModal from './components/TeachModal';
import { useClaude } from './hooks/useClaude';
import { useVoice } from './hooks/useVoice';
import { useLocalVoice } from './hooks/useLocalVoice';
import { useGamepad } from './hooks/useGamepad';
import { useStore } from './hooks/useStore';
import { useProject } from './hooks/useProject';
import { useTelemetry } from './hooks/useTelemetry';
import { PendingWrite, PendingQuestion, TeachRequest } from './types';

interface TeachLogEntry { tool: string; why: string; timestamp: number; }

const SESSION_TOKEN_BUDGET = 200_000;

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [pendingTeach, setPendingTeach] = useState<TeachRequest | null>(null);
  const [teachRedirectSignal, setTeachRedirectSignal] = useState(0);
  const [teachLog, setTeachLog] = useState<TeachLogEntry[]>([]);
  const [voiceRejecting, setVoiceRejecting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [cockpitOpen, setCockpitOpen] = useState(false);
  const [autonomousWrites, setAutonomousWrites] = useState(false);
  const [apiKey, setApiKey] = useStore<string>('apiKey', '');
  const [previewPort, setPreviewPort] = useStore<number>('previewPort', 5757);
  const [previewHttps, setPreviewHttps] = useStore<boolean>('previewHttps', false);
  const [cockpitMode, setCockpitMode] = useStore<string>('cockpitMode', 'cockpit-tron');
  const [localVoice, setLocalVoice] = useStore<boolean>('localVoice', false);
  const [localReady, setLocalReady] = useState(false);
  const [teachMode, setTeachMode] = useStore<boolean>('teachMode', false);
  const [teachTimeout] = useStore<number>('teachTimeout', 5);

  const telemetry = useTelemetry();
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
    rewindTo,
    clearMessages,
  } = useClaude({
    apiKey,
    projectPath,
    autonomousWrites,
    model,
    extendedThinking,
    effort,
    teachMode,
    teachTimeout,
    onPendingWrite: setPendingWrite,
    onPendingQuestion: setPendingQuestion,
    onTeach: (req) => {
      setPendingTeach(req);
      setTeachRedirectSignal(0);
      setTeachLog((prev) => [...prev, { tool: req.tool, why: req.why, timestamp: Date.now() }]);
    },
  });

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const writeDiffRef = useRef<HTMLPreElement>(null);

  const handleVoiceResult = useCallback(
    (text: string) => { if (text.trim()) sendMessage(text.trim()); },
    [sendMessage]
  );

  const { isListening, transcript, isSupported, startListening, stopListening } =
    useVoice(handleVoiceResult);
  const localDict = useLocalVoice(handleVoiceResult);

  // Decide the active dictation backend: local whisper when enabled AND ready, else Web Speech.
  useEffect(() => {
    if (!localVoice) { setLocalReady(false); return; }
    window.electronAPI.voiceLocalStatus()
      .then((s) => setLocalReady(s.ready))
      .catch(() => setLocalReady(false));
  }, [localVoice]);
  const useLocal = localVoice && localReady;
  const startDictation = useLocal ? localDict.startListening : startListening;
  const stopDictation = useLocal ? localDict.stopListening : stopListening;
  const dictationListening = useLocal ? localDict.isListening : isListening;
  const transcribing = useLocal ? localDict.transcribing : false;

  const scrollChat = useCallback((delta: number) => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop += delta * 18;
  }, []);

  // Feed cumulative session tokens to the cockpit telemetry (drives trail length / progress).
  useEffect(() => {
    telemetry.setSessionTokens(
      sessionUsage.inputTokens + sessionUsage.outputTokens +
      sessionUsage.cacheReadTokens + sessionUsage.cacheCreationTokens,
    );
  }, [sessionUsage, telemetry]);

  // Clearing while streaming is an abort — that's a "crash" event for the cockpit.
  const handleClear = useCallback(() => {
    if (isStreaming) telemetry.emit({ type: 'crash' });
    clearMessages();
  }, [isStreaming, clearMessages, telemetry]);

  const handleWriteAccept = useCallback(() => {
    if (!pendingWrite) return;
    window.electronAPI.sendWriteDecision(pendingWrite.id, true);
    setPendingWrite(null);
    setVoiceRejecting(false);
    telemetry.emit({ type: 'boost' }); // approving a write is a boost
  }, [pendingWrite, telemetry]);

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

  const teachContinue = useCallback(() => {
    if (!pendingTeach) return;
    window.electronAPI.sendTeachDecision(pendingTeach.id, 'continue');
    setPendingTeach(null);
  }, [pendingTeach]);

  const teachRedirect = useCallback((instruction: string) => {
    if (!pendingTeach) return;
    window.electronAPI.sendTeachDecision(pendingTeach.id, 'redirect', instruction);
    setPendingTeach(null);
  }, [pendingTeach]);

  const modalActive = !!pendingWrite || !!pendingQuestion || !!pendingTeach;
  // When the cockpit game is open it owns the controller; App-level bindings stand down.
  const padBusy = modalActive || cockpitOpen;

  useGamepad({
    // L2 push-to-talk only drives chat when nothing else owns the pad.
    onL2Press: () => { if (!padBusy) startDictation(); },
    onL2Release: () => { if (!padBusy) stopDictation(); },
    onAPress: () => {
      if (cockpitOpen) return;
      if (pendingTeach) teachContinue();
      else if (pendingWrite) handleWriteAccept();
      else if (pendingQuestion) answerOption(0);
    },
    onXPress: () => {
      if (cockpitOpen) return;
      if (pendingWrite) handleWriteReject();
      else if (pendingQuestion) answerOption(2);
    },
    onBPress: () => {
      if (cockpitOpen) return;
      if (pendingTeach) { setTeachRedirectSignal((s) => s + 1); return; }
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
      if (cockpitOpen) return;
      if (pendingQuestion) answerOption(3);
      else setDrawerOpen((s) => !s);
    },
    onStartPress: () => { if (!cockpitOpen) setShowSettings((s) => !s); },
    onDpadUp: () => { if (!cockpitOpen && pendingWrite && writeDiffRef.current) writeDiffRef.current.scrollTop -= 48; },
    onDpadDown: () => { if (!cockpitOpen && pendingWrite && writeDiffRef.current) writeDiffRef.current.scrollTop += 48; },
    onScrollY: (d) => { if (!cockpitOpen) scrollChat(d); },
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
        isListening={dictationListening}
        isTranscribing={transcribing}
        isStreaming={isStreaming}
        hasApiKey={!!apiKey}
        projectPath={projectPath}
        usage={sessionUsage}
        budget={SESSION_TOKEN_BUDGET}
        onDrawer={() => setDrawerOpen((s) => !s)}
        onSettings={() => setShowSettings((s) => !s)}
        onCockpit={() => setCockpitOpen((s) => !s)}
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
        onShare={() => { setDrawerOpen(false); setShareOpen(true); }}
        teachLog={teachLog}
      />

      {showSettings ? (
        <SettingsPanel
          apiKey={apiKey}
          onSave={async (key) => { await setApiKey(key); setShowSettings(false); }}
          onClear={handleClear}
          onClose={() => setShowSettings(false)}
          model={model}
          onModelChange={setModel}
          extendedThinking={extendedThinking}
          onExtendedThinkingChange={setExtendedThinking}
          effort={effort}
          onEffortChange={setEffort}
          localVoice={localVoice}
          onLocalVoiceChange={setLocalVoice}
          teachMode={teachMode}
          onTeachModeChange={setTeachMode}
          previewPort={previewPort}
          onPreviewPortChange={setPreviewPort}
          previewHttps={previewHttps}
          onPreviewHttpsChange={setPreviewHttps}
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
            onRewind={rewindTo}
          />
          <InputBar
            onSend={sendMessage}
            isStreaming={isStreaming}
            isListening={dictationListening}
            transcript={useLocal ? '' : transcript}
            isVoiceSupported={isSupported || useLocal}
            onVoiceStart={startDictation}
            onVoiceStop={stopDictation}
          />
        </>
      )}

      {/* ask_user modal — Claude paused to ask the pilot a question */}
      {pendingQuestion && (
        <AskUserModal question={pendingQuestion} onSelect={answerQuestion} />
      )}

      {/* Teach mode — Claude is about to run a tool */}
      {pendingTeach && (
        <TeachModal
          req={pendingTeach}
          onContinue={teachContinue}
          onRedirect={teachRedirect}
          redirectSignal={teachRedirectSignal}
        />
      )}

      {/* Share preview over LAN */}
      {shareOpen && (
        <ShareModal
          onClose={() => setShareOpen(false)}
          port={previewPort}
          onPortChange={setPreviewPort}
          https={previewHttps}
          onHttpsChange={setPreviewHttps}
        />
      )}

      {/* Cockpit game layer — pauses when an approval modal is up */}
      {cockpitOpen && (
        <GameCanvas
          onClose={() => setCockpitOpen(false)}
          selectedId={cockpitMode}
          onSelect={setCockpitMode}
          telemetry={telemetry}
          paused={modalActive}
        />
      )}
    </div>
  );
}
