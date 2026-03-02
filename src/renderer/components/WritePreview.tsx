import React, { useState, useRef } from 'react';
import { PendingWrite } from '../types';
import VoiceButton from './VoiceButton';
import { useVoice } from '../hooks/useVoice';

interface Props {
  write: PendingWrite;
  onAccept: () => void;
  onReject: (feedback?: string) => void;
}

export default function WritePreview({ write, onAccept, onReject }: Props) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleVoiceResult = (text: string) => {
    setFeedback((prev) => (prev ? `${prev} ${text}` : text));
  };

  const { isListening, transcript, isSupported, startListening, stopListening } =
    useVoice(handleVoiceResult);

  const submitReject = () => onReject(feedback.trim() || undefined);

  const lineCount = write.content.split('\n').length;

  return (
    <div style={{
      background: '#1A1A1A',
      border: '1px solid #CC785C',
      borderRadius: 12,
      margin: '8px 0',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        background: '#1F1A17',
        borderBottom: '1px solid #2A2A2A',
      }}>
        <span style={{ fontSize: 14 }}>📝</span>
        <span style={{ color: '#CC785C', fontFamily: 'monospace', fontSize: 13, flex: 1 }}>
          {write.path}
        </span>
        <span style={{ color: '#555', fontSize: 12 }}>{lineCount} lines</span>
      </div>

      {/* Content preview */}
      <pre style={{
        margin: 0,
        padding: '12px 14px',
        maxHeight: 280,
        overflowY: 'auto',
        fontSize: 12,
        lineHeight: 1.5,
        color: '#C8C8C8',
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        background: '#111',
      }}>
        {write.content}
      </pre>

      {/* Action buttons or feedback */}
      {!showFeedback ? (
        <div style={{ display: 'flex', gap: 10, padding: '10px 14px', borderTop: '1px solid #2A2A2A' }}>
          <button
            onClick={onAccept}
            style={{
              flex: 1,
              padding: '10px 0',
              background: '#CC785C',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: 0.5,
            }}
          >
            ✓ Apply
          </button>
          <button
            onClick={() => setShowFeedback(true)}
            style={{
              flex: 1,
              padding: '10px 0',
              background: '#2A2A2A',
              color: '#aaa',
              border: '1px solid #3A3A3A',
              borderRadius: 8,
              fontSize: 15,
              cursor: 'pointer',
            }}
          >
            ✕ Reject
          </button>
        </div>
      ) : (
        <div style={{ padding: '10px 14px', borderTop: '1px solid #2A2A2A' }}>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>
            What should Claude change? (optional)
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <textarea
              ref={textareaRef}
              value={isListening ? transcript || feedback : feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Type or hold mic to speak…"
              rows={2}
              style={{
                flex: 1,
                background: '#1A1A1A',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                color: '#fff',
                fontSize: 14,
                padding: '8px 10px',
                resize: 'none',
                fontFamily: 'inherit',
              }}
            />
            {isSupported && (
              <VoiceButton
                isListening={isListening}
                isSupported={isSupported}
                transcript={transcript}
                onStart={startListening}
                onStop={stopListening}
                compact
              />
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={submitReject}
              style={{
                flex: 1,
                padding: '9px 0',
                background: '#2A2A2A',
                color: '#E07050',
                border: '1px solid #E07050',
                borderRadius: 8,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Send Feedback
            </button>
            <button
              onClick={() => setShowFeedback(false)}
              style={{
                padding: '9px 16px',
                background: 'transparent',
                color: '#666',
                border: '1px solid #333',
                borderRadius: 8,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
