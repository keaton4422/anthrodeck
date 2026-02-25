import React from 'react';

interface Props {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;
  onStart: () => void;
  onStop: () => void;
}

export function VoiceButton({ isListening, isSupported, transcript, onStart, onStop }: Props) {
  if (!isSupported) {
    return (
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          border: '2px solid #2A2A2A',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'not-allowed',
          opacity: 0.4,
        }}
        title="Voice not supported in this environment"
      >
        <MicIcon muted />
        <span style={{ fontSize: 8, color: '#6A6A6A', marginTop: 2 }}>N/A</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {/* Live transcript above button */}
      {transcript && (
        <div
          style={{
            position: 'absolute',
            bottom: 110,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1A1A1A',
            border: '1px solid #3A3A3A',
            borderRadius: 8,
            padding: '8px 14px',
            color: '#ECECEC',
            fontSize: 14,
            maxWidth: 500,
            textAlign: 'center',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <span style={{ color: '#CC785C' }}>⟩ </span>
          {transcript}
        </div>
      )}

      {/* Main button */}
      <button
        onMouseDown={onStart}
        onMouseUp={onStop}
        onTouchStart={(e) => { e.preventDefault(); onStart(); }}
        onTouchEnd={(e) => { e.preventDefault(); onStop(); }}
        className={isListening ? 'voice-btn-listening' : 'voice-btn-idle'}
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          border: `2px solid ${isListening ? '#E05252' : '#CC785C'}`,
          background: isListening
            ? 'radial-gradient(circle, rgba(224,82,82,0.25) 0%, rgba(224,82,82,0.08) 100%)'
            : 'radial-gradient(circle, rgba(204,120,92,0.15) 0%, rgba(204,120,92,0.05) 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'background 0.2s, border-color 0.2s',
          flexShrink: 0,
          outline: 'none',
          padding: 0,
        }}
        title={isListening ? 'Release to send' : 'Hold to speak (or L2 trigger)'}
        aria-label="Voice input"
      >
        <MicIcon muted={false} active={isListening} />
      </button>

      <span
        style={{
          fontSize: 10,
          color: isListening ? '#E05252' : '#6A6A6A',
          letterSpacing: '0.08em',
          fontWeight: 600,
          transition: 'color 0.2s',
        }}
      >
        {isListening ? 'RELEASE' : 'HOLD'}
      </span>
    </div>
  );
}

function MicIcon({ muted, active }: { muted: boolean; active?: boolean }) {
  const color = muted ? '#3A3A3A' : active ? '#E05252' : '#CC785C';
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
