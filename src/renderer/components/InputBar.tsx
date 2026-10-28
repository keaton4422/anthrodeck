import React, { forwardRef, KeyboardEvent, useImperativeHandle, useRef, useState } from 'react';
import VoiceButton from './VoiceButton';

// What App drives from the pad and dictation. Dictation is written into the box, not sent, so the
// pilot can read and fix it first; A sends it (or puts the cursor in an empty box).
export interface ComposerHandle {
  insert(text: string): void;
  send(): void;
  hasText(): boolean;
}

interface Props {
  onSend: (text: string) => void;
  isStreaming: boolean;
  isListening: boolean;
  transcript: string;
  isVoiceSupported: boolean;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
}

export const InputBar = forwardRef<ComposerHandle, Props>(function InputBar({
  onSend,
  isStreaming,
  isListening,
  transcript,
  isVoiceSupported,
  onVoiceStart,
  onVoiceStop,
}, ref) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  const fit = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  // Never focuses the box: on the Deck that would raise SteamOS's keyboard over the words.
  useImperativeHandle(ref, () => ({
    insert(words: string) {
      const w = words.trim();
      if (!w) return;
      setText((t) => (t.trim() ? `${t.replace(/\s+$/, '')} ${w}` : w));
      requestAnimationFrame(fit);
    },
    send: () => handleSend(),
    hasText: () => !!textRef.current.trim(),
  }));

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

  // The message dock: the same centred column as the conversation, the field, send and mic on one
  // line, and the pad's ways to write underneath (no keyboard on a console).
  return (
    <div
      style={{
        background: '#141414',
        borderTop: '1px solid #2A2A2A',
        padding: '12px 24px 10px',
        flexShrink: 0,
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: '100%', maxWidth: 920 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
            <textarea
              ref={textareaRef}
              className="message-box"
              value={isListening ? transcript : text}
              onChange={isListening ? undefined : handleTextChange}
              onKeyDown={handleKeyDown}
              readOnly={isListening}
              disabled={isStreaming && !isListening}
              placeholder={isStreaming ? 'Claude is working…' : isListening ? 'Listening…' : 'Message Claude'}
              rows={1}
              style={{
                width: '100%',
                background: '#1A1A1A',
                border: '1px solid',
                borderColor: isListening ? '#E05252' : '#3A3A3A',
                borderRadius: 12,
                padding: '14px 60px 14px 18px',
                color: '#ECECEC',
                fontSize: 16,
                lineHeight: 1.5,
                outline: 'none',
                resize: 'none',
                fontFamily: 'inherit',
                transition: 'border-color 0.2s',
                overflowY: 'hidden',
                minHeight: 52,
                maxHeight: 132,
              }}
              onFocus={(e) => {
                if (!isListening) e.target.style.borderColor = '#CC785C';
              }}
              onBlur={(e) => {
                if (!isListening) e.target.style.borderColor = '#3A3A3A';
              }}
            />

            {!isListening && (
              <button
                onClick={handleSend}
                disabled={!text.trim() || isStreaming}
                style={{
                  position: 'absolute',
                  right: 8,
                  bottom: 8,
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  border: 'none',
                  background: text.trim() && !isStreaming ? '#CC785C' : 'rgba(204,120,92,0.2)',
                  color: text.trim() && !isStreaming ? '#fff' : 'rgba(204,120,92,0.4)',
                  cursor: text.trim() && !isStreaming ? 'pointer' : 'not-allowed',
                  fontSize: 17,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
                title="Send"
              >
                ↑
              </button>
            )}
          </div>

          <VoiceButton
            isListening={isListening}
            isSupported={isVoiceSupported}
            transcript={transcript}
            onStart={onVoiceStart}
            onStop={onVoiceStop}
            inline
          />
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 8, fontSize: 12, color: '#6A6A6A' }}>
          {text.trim() && !isListening && <span><Key>A</Key> Send</span>}
          {isVoiceSupported && <span><Key>L2</Key> {isListening ? 'Let go to write it in' : 'Hold to talk'}</span>}
          <span><Key>STEAM</Key>+<Key>X</Key> Keyboard</span>
        </div>
      </div>
    </div>
  );
});

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 5, background: '#262626', color: '#BDBDBD',
      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', margin: '0 2px',
    }}>{children}</span>
  );
}
