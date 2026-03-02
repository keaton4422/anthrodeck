import React, { KeyboardEvent, useRef, useState } from 'react';
import VoiceButton from './VoiceButton';

interface Props {
  onSend: (text: string) => void;
  isStreaming: boolean;
  isListening: boolean;
  transcript: string;
  isVoiceSupported: boolean;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
}

export function InputBar({
  onSend,
  isStreaming,
  isListening,
  transcript,
  isVoiceSupported,
  onVoiceStart,
  onVoiceStop,
}: Props) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  return (
    <div
      style={{
        background: '#141414',
        borderTop: '1px solid #2A2A2A',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 14,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* Text input area */}
      <div style={{ flex: 1, position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={isListening ? transcript : text}
          onChange={isListening ? undefined : handleTextChange}
          onKeyDown={handleKeyDown}
          readOnly={isListening}
          disabled={isStreaming && !isListening}
          placeholder={
            isStreaming
              ? 'Claude is thinking…'
              : isListening
              ? 'Listening…'
              : 'Type a message  (Enter to send, Shift+Enter for newline)'
          }
          rows={1}
          style={{
            width: '100%',
            background: '#1A1A1A',
            border: '1px solid',
            borderColor: isListening ? '#E05252' : '#3A3A3A',
            borderRadius: 10,
            padding: '12px 16px',
            paddingRight: 50,
            color: isListening ? '#ECECEC' : '#ECECEC',
            fontSize: 15,
            lineHeight: 1.5,
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
            transition: 'border-color 0.2s',
            overflowY: 'hidden',
            minHeight: 48,
            maxHeight: 120,
          }}
          onFocus={(e) => {
            if (!isListening) e.target.style.borderColor = '#CC785C';
          }}
          onBlur={(e) => {
            if (!isListening) e.target.style.borderColor = '#3A3A3A';
          }}
        />

        {/* Send button inside textarea */}
        {!isListening && (
          <button
            onClick={handleSend}
            disabled={!text.trim() || isStreaming}
            style={{
              position: 'absolute',
              right: 10,
              bottom: 10,
              width: 32,
              height: 32,
              borderRadius: 7,
              border: 'none',
              background:
                text.trim() && !isStreaming
                  ? '#CC785C'
                  : 'rgba(204,120,92,0.2)',
              color: text.trim() && !isStreaming ? '#fff' : 'rgba(204,120,92,0.4)',
              cursor: text.trim() && !isStreaming ? 'pointer' : 'not-allowed',
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            title="Send (Enter)"
          >
            ↑
          </button>
        )}
      </div>

      {/* Voice button */}
      <VoiceButton
        isListening={isListening}
        isSupported={isVoiceSupported}
        transcript={transcript}
        onStart={onVoiceStart}
        onStop={onVoiceStop}
      />
    </div>
  );
}
