import React from 'react';

interface Props {
  isListening: boolean;
  isStreaming: boolean;
  hasApiKey: boolean;
  projectPath: string | null;
  onDrawer: () => void;
  onSettings: () => void;
}

export function StatusBar({ isListening, isStreaming, hasApiKey, projectPath, onDrawer, onSettings }: Props) {
  const folderName = projectPath ? projectPath.split(/[\\/]/).pop() : null;

  return (
    <div
      style={{
        height: 52,
        background: '#141414',
        borderBottom: '1px solid #2A2A2A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        flexShrink: 0,
        userSelect: 'none',
        gap: 10,
      }}
    >
      {/* Left: Drawer toggle + Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onDrawer}
          title="Project & Git (Y button)"
          style={{
            background: 'none',
            border: '1px solid #2A2A2A',
            borderRadius: 6,
            padding: '4px 8px',
            color: projectPath ? '#CC785C' : '#555',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget).style.borderColor = '#CC785C'; }}
          onMouseLeave={(e) => { (e.currentTarget).style.borderColor = '#2A2A2A'; }}
        >
          ☰
        </button>

        <span style={{ fontSize: 20, lineHeight: 1 }}>◆</span>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', color: '#ECECEC' }}>
          ANTHRO<span style={{ color: '#CC785C' }}>DECK</span>
        </span>
      </div>

      {/* Center: project name */}
      {folderName && (
        <div style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
          <span style={{
            fontSize: 12,
            color: '#666',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 300,
          }}>
            📁 {folderName}
          </span>
        </div>
      )}

      {/* Right: Status indicators + settings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isListening && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#E05252',
              display: 'inline-block', animation: 'blink 0.8s step-end infinite',
            }} />
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
            <span style={{ fontSize: 12, color: '#9A9A9A', marginLeft: 4, letterSpacing: '0.06em' }}>THINKING</span>
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
            (e.currentTarget).style.color = '#CC785C';
            (e.currentTarget).style.borderColor = '#CC785C';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget).style.color = '#9A9A9A';
            (e.currentTarget).style.borderColor = '#3A3A3A';
          }}
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
