import React, { useEffect, useState } from 'react';
import { useUpdater } from '../hooks/useUpdater';
import { LocalVoiceStatus } from '../types';

interface Props {
  apiKey: string;
  onSave: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
  model: string;
  onModelChange: (m: string) => void;
  extendedThinking: boolean;
  onExtendedThinkingChange: (v: boolean) => void;
  effort: string;
  onEffortChange: (e: string) => void;
  localVoice: boolean;
  onLocalVoiceChange: (v: boolean) => void;
  teachMode: boolean;
  onTeachModeChange: (v: boolean) => void;
  previewPort: number;
  onPreviewPortChange: (p: number) => void;
  previewHttps: boolean;
  onPreviewHttpsChange: (v: boolean) => void;
}

const MODEL_OPTS: { id: string; label: string; sub: string }[] = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5', sub: 'Balanced · default · lower cost' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', sub: 'Most capable · hardest turns' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', sub: 'Fastest · cheapest' },
];

const EFFORT_OPTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function SettingsPanel({
  apiKey,
  onSave,
  onClear,
  onClose,
  model,
  onModelChange,
  extendedThinking,
  onExtendedThinkingChange,
  effort,
  onEffortChange,
  localVoice,
  onLocalVoiceChange,
  teachMode,
  onTeachModeChange,
  previewPort,
  onPreviewPortChange,
  previewHttps,
  onPreviewHttpsChange,
}: Props) {
  const [portDraft, setPortDraft] = useState(String(previewPort));
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

        {/* ── Model & Reasoning ────────────────────────────────────────── */}
        <section>
          <label style={labelStyle}>Model</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {MODEL_OPTS.map((m) => {
              const active = model === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => onModelChange(m.id)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    gap: 2, padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                    textAlign: 'left', transition: 'all 0.15s',
                    border: `1px solid ${active ? '#CC785C' : '#3A3A3A'}`,
                    background: active ? 'rgba(204,120,92,0.12)' : '#242424',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, color: active ? '#CC785C' : '#ECECEC' }}>
                    {m.label}
                    <span style={{ color: '#6A6A6A', fontWeight: 400, marginLeft: 8, fontSize: 11 }}>{m.id}</span>
                  </span>
                  <span style={{ fontSize: 12, color: '#8A8A8A' }}>{m.sub}</span>
                </button>
              );
            })}
          </div>

          {/* Extended thinking toggle */}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginTop: 16,
            }}
          >
            <div>
              <span style={{ fontSize: 14, color: '#ECECEC', fontWeight: 600 }}>Extended thinking</span>
              <p style={{ fontSize: 12, color: '#6A6A6A', marginTop: 2 }}>
                Adaptive reasoning before answering. Best on Opus for hard turns.
              </p>
            </div>
            <button
              onClick={() => onExtendedThinkingChange(!extendedThinking)}
              role="switch"
              aria-checked={extendedThinking}
              style={{
                width: 46, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
                background: extendedThinking ? '#CC785C' : '#3A3A3A',
                position: 'relative', transition: 'background 0.15s', flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute', top: 3, left: extendedThinking ? 23 : 3,
                  width: 20, height: 20, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.15s',
                }}
              />
            </button>
          </div>

          {/* Effort selector */}
          <div style={{ marginTop: 16 }}>
            <span style={{ fontSize: 14, color: '#ECECEC', fontWeight: 600 }}>Effort</span>
            <p style={{ fontSize: 12, color: '#6A6A6A', marginTop: 2, marginBottom: 8 }}>
              How much the model deliberates and how many tools it uses.
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              {EFFORT_OPTS.map((e) => {
                const active = effort === e;
                return (
                  <button
                    key={e}
                    onClick={() => onEffortChange(e)}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: 7, cursor: 'pointer',
                      fontSize: 12, fontWeight: active ? 600 : 400, textTransform: 'capitalize',
                      transition: 'all 0.15s',
                      border: `1px solid ${active ? '#CC785C' : '#3A3A3A'}`,
                      background: active ? 'rgba(204,120,92,0.12)' : '#242424',
                      color: active ? '#CC785C' : '#9A9A9A',
                    }}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <Divider />

        {/* ── App Info ─────────────────────────────────────────────────── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Row label="Voice" value="Hold L2 trigger or mic button — release to send" />
          <Row label="Controller" value="L2=speak · B/Start=settings · R-stick=scroll" />
          <Row label="Dev reload" value="npm start → React changes live-reload. Type 'rs' to restart main." />
        </section>

        <Divider />

        {/* ── Voice & Assist ───────────────────────────────────────────── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={labelStyle}>Voice &amp; Assist</label>
          <LocalVoiceRow enabled={localVoice} onChange={onLocalVoiceChange} />
          <ToggleRow
            label="Teach mode"
            hint="Explain each tool call before it runs; A continues, B redirects by voice. Auto-continues after a few seconds."
            value={teachMode}
            onChange={() => onTeachModeChange(!teachMode)}
          />
        </section>

        <Divider />

        {/* ── Sharing ──────────────────────────────────────────────────── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={labelStyle}>Sharing</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: '#ECECEC', fontWeight: 600 }}>Preview port</div>
              <div style={{ fontSize: 12, color: '#6A6A6A', marginTop: 2 }}>
                Port the LAN preview server listens on.
              </div>
            </div>
            <input
              value={portDraft}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '');
                setPortDraft(v);
                const n = parseInt(v, 10);
                if (Number.isInteger(n) && n >= 1024 && n <= 65535) onPreviewPortChange(n);
              }}
              placeholder="5757"
              style={{
                width: 90, background: '#242424', border: '1px solid #3A3A3A', borderRadius: 8,
                padding: '8px 10px', color: '#ECECEC', fontSize: 14, outline: 'none',
                fontFamily: 'monospace', textAlign: 'center',
              }}
            />
          </div>
          <ToggleRow
            label="Self-signed HTTPS"
            hint="Serve the preview over https so mobile web can request camera / mic / gyro. The phone will warn about the certificate."
            value={previewHttps}
            onChange={() => onPreviewHttpsChange(!previewHttps)}
          />
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

// ─── Local voice (whisper) row ─────────────────────────────────────────────────
function LocalVoiceRow({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const [status, setStatus] = useState<LocalVoiceStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () => window.electronAPI.voiceLocalStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => { refresh(); }, []);

  const download = async () => {
    setDownloading(true);
    setMsg(null);
    try {
      const r = await window.electronAPI.voiceDownloadModel();
      setMsg(r.message);
      await refresh();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ToggleRow
        label="Local voice (offline Whisper)"
        hint="Transcribe on-device instead of cloud Web Speech. Needs the Whisper model downloaded."
        value={enabled}
        onChange={() => onChange(!enabled)}
      />
      {enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 2 }}>
          <div style={{ fontSize: 12, color: status?.ready ? '#52A77C' : '#D9A441' }}>
            {status?.ready
              ? `Ready (${status.model}).`
              : status?.available
                ? (status.reason ?? 'Model not downloaded.')
                : (status?.reason ?? 'Whisper native module not installed — see README.')}
          </div>
          {status?.available && !status.ready && (
            <button onClick={download} disabled={downloading} style={secondaryBtn}>
              {downloading ? 'Downloading… (~140 MB)' : 'Download local voice'}
            </button>
          )}
          {msg && <div style={{ fontSize: 12, color: '#8A8A8A' }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Toggle row ────────────────────────────────────────────────────────────────
function ToggleRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: '#ECECEC', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12, color: '#6A6A6A', marginTop: 2 }}>{hint}</div>
      </div>
      <button
        onClick={onChange}
        role="switch"
        aria-checked={value}
        style={{
          width: 46, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
          background: value ? '#CC785C' : '#3A3A3A', position: 'relative', flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: value ? 23 : 3, width: 20, height: 20,
          borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
        }} />
      </button>
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
