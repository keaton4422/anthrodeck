import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { ChatView } from './components/ChatView';
import { InputBar } from './components/InputBar';
import { SettingsPanel } from './components/SettingsPanel';
import { useClaude } from './hooks/useClaude';
import { useVoice } from './hooks/useVoice';
import { useGamepad } from './hooks/useGamepad';
import { useStore } from './hooks/useStore';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useStore<string>('apiKey', '');

  const { messages, sendMessage, isStreaming, error, clearMessages } = useClaude(apiKey);

  const chatScrollRef = useRef<HTMLDivElement>(null);

  const handleVoiceResult = useCallback(
    (transcript: string) => {
      if (transcript.trim()) sendMessage(transcript.trim());
    },
    [sendMessage]
  );

  const { isListening, transcript, isSupported, startListening, stopListening } =
    useVoice(handleVoiceResult);

  const scrollChat = useCallback((delta: number) => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop += delta * 18;
    }
  }, []);

  useGamepad({
    onL2Press: startListening,
    onL2Release: stopListening,
    onBPress: () => setShowSettings((s) => !s),
    onStartPress: () => setShowSettings((s) => !s),
    onScrollY: scrollChat,
  });

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
        onSettings={() => setShowSettings((s) => !s)}
      />

      {showSettings ? (
        <SettingsPanel
          apiKey={apiKey}
          onSave={async (key) => {
            await setApiKey(key);
            setShowSettings(false);
          }}
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
