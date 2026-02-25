import React from 'react';

interface Props {
  isListening: boolean;
  isStreaming: boolean;
  hasApiKey: boolean;
  onSettings: () => void;
}

export function StatusBar({ isListening, isStreaming, hasApiKey, onSettings }: Props) {
  return (
    <div
      style={{
        height: 52,
        background: '#141414',
        borderBottom: '1px solid #2A2A2A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {/* Left: Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>◆</span>
        <span
          style={{
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: '#ECECEC',
          }}
        >
          ANTHRO<span style={{ color: '#CC785C' }}>DECK</span>
        </span>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            background: 'rgba(204,120,92,0.15)',
            color: '#CC785C',
            border: '1px solid rgba(204,120,92,0.3)',
            letterSpacing: '0.05em',
            fontWeight: 500,
          }}
        >
          claude-opus-4-6
        </span>
      </div>

      {/* Right: Status indicators + settings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {isListening && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#E05252',
                display: 'inline-block',
                animation: 'blink 0.8s step-end infinite',
              }}
            />
            <span style={{ fontSize: 12, color: '#E05252', fontWeight: 600, letterSpacing: '0.08em' }}>
              LISTENING
            </span>
          </div>
        )}
        {isStreaming && !isListening && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="streaming-dot-1" style={{ width: 5, height: 5, borderRadius: '50%', background: '#CC785C', display: 'inline-block' }} />
            <span className="streaming-dot-2" style={{ width: 5, height: 5, borderRadius: '50%', background: '#CC785C', display: 'inline-block' }} />
            <span className="streaming-dot-3" style={{ width: 5, height: 5, borderRadius: '50%', background: '#CC785C', display: 'inline-block' }} />
            <span style={{ fontSize: 12, color: '#9A9A9A', marginLeft: 4, letterSpacing: '0.06em' }}>
              THINKING
            </span>
          </div>
        )}
        {!hasApiKey && !isListening && !isStreaming && (
          <span style={{ fontSize: 12, color: '#E05252' }}>⚠ No API key</span>
        )}
        <button
          onClick={onSettings}
          style={{
            background: 'none',
            border: '1px solid #3A3A3A',
            borderRadius: 6,
            padding: '4px 10px',
            color: '#9A9A9A',
            cursor: 'pointer',
            fontSize: 16,
            transition: 'all 0.15s',
            lineHeight: 1,
          }}
          title="Settings (B button / Start)"
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.color = '#CC785C';
            (e.target as HTMLButtonElement).style.borderColor = '#CC785C';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.color = '#9A9A9A';
            (e.target as HTMLButtonElement).style.borderColor = '#3A3A3A';
          }}
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
