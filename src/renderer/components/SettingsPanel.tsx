import React, { useState } from 'react';
import { useUpdater } from '../hooks/useUpdater';

interface Props {
  apiKey: string;
  onSave: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function SettingsPanel({ apiKey, onSave, onClear, onClose }: Props) {
  const [draftKey, setDraftKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const { status, checkForUpdates, downloadUpdate, installUpdate } = useUpdater();

  const handleSave = () => {
    const trimmed = draftKey.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    if (window.confirm('Clear all chat history?')) {
      onClear();
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0F0F0F',
        padding: 40,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          background: '#1A1A1A',
          border: '1px solid #3A3A3A',
          borderRadius: 14,
          padding: 36,
          width: '100%',
          maxWidth: 560,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#ECECEC' }}>Settings</h2>
            <p style={{ fontSize: 13, color: '#6A6A6A', marginTop: 4 }}>Configure AntroDeck</p>
          </div>
          {apiKey && (
            <button onClick={onClose} style={closeBtn}>✕</button>
          )}
        </div>

        {/* ── API Key ─────────────────────────────────────────────────── */}
        <section>
          <label style={labelStyle}>Anthropic API Key</label>
          <p style={hintStyle}>
            Get your key at{' '}
            <span style={{ color: '#CC785C' }}>console.anthropic.com</span>
            . Stored locally on your device.
          </p>
          <div style={{ position: 'relative', marginTop: 10 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="sk-ant-..."
              style={{
                width: '100%',
                background: '#242424',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                padding: '12px 48px 12px 14px',
                color: '#ECECEC',
                fontSize: 15,
                outline: 'none',
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                letterSpacing: '0.04em',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#CC785C')}
              onBlur={(e) => (e.target.style.borderColor = '#3A3A3A')}
            />
            <button
              onClick={() => setShowKey((s) => !s)}
              style={{
                position: 'absolute', right: 12, top: '50%',
                transform: 'translateY(-50%)',
                background: 'none', border: 'none',
                color: '#6A6A6A', cursor: 'pointer', fontSize: 16,
              }}
              title={showKey ? 'Hide' : 'Show'}
            >
              {showKey ? '🙈' : '👁'}
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={!draftKey.trim()}
            style={{
              marginTop: 12, width: '100%', padding: '12px',
              borderRadius: 8, border: 'none',
              background: draftKey.trim() ? '#CC785C' : 'rgba(204,120,92,0.2)',
              color: draftKey.trim() ? '#fff' : 'rgba(204,120,92,0.4)',
              fontSize: 15, fontWeight: 600,
              cursor: draftKey.trim() ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
            }}
          >
            {saved ? '✓ Saved!' : 'Save API Key'}
          </button>
        </section>

        <Divider />

        {/* ── App Info ─────────────────────────────────────────────────── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Row label="Model" value="claude-opus-4-6" />
          <Row label="Voice" value="Hold L2 trigger or mic button — release to send" />
          <Row label="Controller" value="L2=speak · B/Start=settings · R-stick=scroll" />
          <Row label="Dev reload" value="npm start → React changes live-reload. Type 'rs' to restart main." />
        </section>

        <Divider />

        {/* ── Updates ──────────────────────────────────────────────────── */}
        <section>
          <label style={labelStyle}>Updates</label>
          <UpdateSection
            status={status}
            onCheck={checkForUpdates}
            onDownload={downloadUpdate}
            onInstall={installUpdate}
          />
        </section>

        {/* ── Danger zone ──────────────────────────────────────────────── */}
        {apiKey && (
          <>
            <Divider />
            <button
              onClick={handleClear}
              style={{
                padding: '10px', borderRadius: 8,
                border: '1px solid rgba(224,82,82,0.35)',
                background: 'rgba(224,82,82,0.08)',
                color: '#E05252', fontSize: 14, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.background = 'rgba(224,82,82,0.15)')}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.background = 'rgba(224,82,82,0.08)')}
            >
              Clear conversation history
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Update section ────────────────────────────────────────────────────────────
interface UpdateProps {
  status: ReturnType<typeof useUpdater>['status'];
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}

function UpdateSection({ status, onCheck, onDownload, onInstall }: UpdateProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Version row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, color: '#9A9A9A' }}>
          Version: <strong style={{ color: '#ECECEC' }}>{status.version || '…'}</strong>
        </span>
        {status.newVersion && (
          <span style={{ fontSize: 12, color: '#52A77C', fontWeight: 600 }}>
            v{status.newVersion} available
          </span>
        )}
      </div>

      {/* Download progress bar */}
      {status.state === 'downloading' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 6, background: '#2A2A2A', borderRadius: 3, overflow: 'hidden' }}>
            <div
              style={{
                width: `${status.downloadPercent ?? 0}%`,
                height: '100%',
                background: '#CC785C',
                borderRadius: 3,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: '#9A9A9A', minWidth: 35, textAlign: 'right' }}>
            {status.downloadPercent ?? 0}%
          </span>
        </div>
      )}

      {/* Status text */}
      {status.state === 'up-to-date' && (
        <p style={{ fontSize: 13, color: '#52A77C' }}>✓ You're on the latest version</p>
      )}
      {status.state === 'ready' && (
        <p style={{ fontSize: 13, color: '#52A77C' }}>
          ✓ v{status.newVersion} downloaded — ready to install
        </p>
      )}
      {status.state === 'error' && status.error && (
        <p style={{ fontSize: 12, color: '#E05252', whiteSpace: 'pre-line', lineHeight: 1.5 }}>
          {status.error}
        </p>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10 }}>
        {(status.state === 'idle' || status.state === 'error' || status.state === 'up-to-date') && (
          <button onClick={onCheck} style={secondaryBtn}>↻ Check for updates</button>
        )}
        {status.state === 'checking' && (
          <button disabled style={{ ...secondaryBtn, opacity: 0.5, cursor: 'wait' }}>⟳ Checking…</button>
        )}
        {status.state === 'available' && (
          <button onClick={onDownload} style={primaryBtn}>
            ↓ Download v{status.newVersion}
          </button>
        )}
        {status.state === 'ready' && (
          <button onClick={onInstall} style={primaryBtn}>
            ⚡ Restart & Install v{status.newVersion}
          </button>
        )}
      </div>

      {/* Dev tip */}
      <p style={{ fontSize: 11, color: '#4A4A4A', lineHeight: 1.6 }}>
        Production updates pull from GitHub Releases — set your repo in{' '}
        <code style={{ color: '#5A5A5A' }}>package.json → build.publish</code>.
        In dev (<code style={{ color: '#5A5A5A' }}>npm start</code>) changes hot-reload via Vite.
      </p>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function Divider() {
  return <div style={{ height: 1, background: '#2A2A2A' }} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <span style={{ fontSize: 12, color: '#6A6A6A', minWidth: 90, flexShrink: 0, paddingTop: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: '#ECECEC', lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600,
  color: '#CC785C', letterSpacing: '0.05em',
  display: 'block', marginBottom: 10,
};

const hintStyle: React.CSSProperties = {
  fontSize: 13, color: '#6A6A6A', lineHeight: 1.5,
};

const closeBtn: React.CSSProperties = {
  background: '#242424', border: '1px solid #3A3A3A',
  borderRadius: 6, width: 32, height: 32,
  color: '#9A9A9A', cursor: 'pointer', fontSize: 14,
};

const secondaryBtn: React.CSSProperties = {
  flex: 1, padding: '9px 14px', borderRadius: 7,
  border: '1px solid #3A3A3A', background: '#242424',
  color: '#ECECEC', fontSize: 13, cursor: 'pointer',
  transition: 'all 0.15s',
};

const primaryBtn: React.CSSProperties = {
  flex: 1, padding: '9px 14px', borderRadius: 7,
  border: 'none', background: '#CC785C',
  color: '#fff', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', transition: 'all 0.15s',
};
