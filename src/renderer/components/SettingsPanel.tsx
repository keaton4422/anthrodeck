import React, { useEffect, useRef, useState } from 'react';
import { usePadFocus, type PadFocus } from '../hooks/usePadFocus';
import { useUpdater } from '../hooks/useUpdater';
import { useLive } from '../hooks/useLive';
import { LocalVoiceStatus } from '../types';
import { PairKeyPanel } from './PairKeyPanel';
import { EnginePanel } from './EnginePanel';

interface Props {
  // The controller drives Settings through this: App routes the D-pad and A here while it's open.
  padNav?: React.MutableRefObject<PadFocus | null>;
  apiKey: string;
  onSave: (key: string) => void;
  // A paired key is written to electron-store by MAIN; this asks the app to re-read it.
  onPaired: () => void;
  onClear: () => void;
  onClose: () => void;
  model: string;
  onModelChange: (m: string) => void;
  extendedThinking: boolean;
  onExtendedThinkingChange: (v: boolean) => void;
  effort: string;
  onEffortChange: (e: string) => void;
  onVoiceChanged: () => void;
  teachMode: boolean;
  onTeachModeChange: (v: boolean) => void;
  previewPort: number;
  onPreviewPortChange: (p: number) => void;
  previewHttps: boolean;
  onPreviewHttpsChange: (v: boolean) => void;
  haptics: boolean;
  onHapticsChange: (v: boolean) => void;
  intermission: boolean;
  onIntermissionChange: (v: boolean) => void;
  tidyUp: boolean;
  onTidyUpChange: (v: boolean) => void;
  sound: boolean;
  onSoundChange: (v: boolean) => void;
}

// Claude Code model aliases: they track the current generation, so this list never goes stale.
const MODEL_OPTS: { id: string; label: string; sub: string }[] = [
  { id: 'sonnet', label: 'Sonnet', sub: 'Balanced · default · lower cost' },
  { id: 'opus', label: 'Opus', sub: 'Most capable · hardest jobs' },
  { id: 'haiku', label: 'Haiku', sub: 'Fastest · cheapest' },
];

const EFFORT_OPTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function SettingsPanel({
  padNav,
  apiKey,
  onSave,
  onPaired,
  onClear,
  onClose,
  model,
  onModelChange,
  extendedThinking,
  onExtendedThinkingChange,
  effort,
  onEffortChange,
  onVoiceChanged,
  teachMode,
  onTeachModeChange,
  previewPort,
  onPreviewPortChange,
  previewHttps,
  onPreviewHttpsChange,
  haptics,
  onHapticsChange,
  intermission,
  onIntermissionChange,
  tidyUp,
  onTidyUpChange,
  sound,
  onSoundChange,
}: Props) {
  const [portDraft, setPortDraft] = useState(String(previewPort));
  const [draftKey, setDraftKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  // Claude Code's own sign-in on this device. With it, the API key is optional and stays folded away.
  const [claude, setClaude] = useState<{ signedIn: boolean; email: string | null; org: string | null } | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  useEffect(() => {
    void window.electronAPI.engineStatus().then((st) => setClaude(st.claude)).catch(() => setClaude(null));
  }, []);
  const keyFolded = !!claude?.signedIn && !apiKey && !keyOpen;

  // Remote computer: run Claude Code on another machine (your Mac) over SSH, from Home's switcher.
  const [remoteHost, setRemoteHost] = useState('');
  const [remoteSaved, setRemoteSaved] = useState<string | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<{ busy?: boolean; ok?: boolean; text: string } | null>(null);
  useEffect(() => {
    void window.electronAPI.remoteGet().then((t) => { setRemoteSaved(t?.host ?? null); setRemoteHost(t?.host ?? ''); });
  }, []);
  const saveRemote = async () => {
    const t = await window.electronAPI.remoteSet(remoteHost.trim() || null);
    setRemoteSaved(t?.host ?? null);
    if (!t) { setRemoteStatus(null); return; }
    setRemoteStatus({ busy: true, text: `Connecting to ${t.label}…` });
    const r = await window.electronAPI.remoteTest();
    setRemoteStatus(r.ok
      ? { ok: true, text: `✓ Connected to ${t.label} · Claude Code ${r.version?.replace(/\s*\(Claude Code\)/, '') ?? ''}. Press Y on Home to see its projects.` }
      : { ok: false, text: r.error ?? 'Could not connect.' });
  };

  // Live sessions there: the relay that brings their approvals and questions to the Deck.
  const live = useLive();
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  const setRelay = async (op: 'install' | 'remove') => {
    setRelayBusy(true); setRelayError(null);
    const r = await window.electronAPI.liveRelay(op);
    setRelayBusy(false);
    if (!r.ok) setRelayError(r.error ?? 'That didn\'t work.');
  };

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

  const rootRef = useRef<HTMLDivElement>(null);
  const pad = usePadFocus(rootRef);
  useEffect(() => {
    if (!padNav) return;
    padNav.current = pad;
    return () => { padNav.current = null; };
  }, [padNav, pad]);

  return (
    <div
      ref={rootRef}
      style={{
        flex: 1,
        display: 'flex',
        background: '#0F0F0F',
        padding: 40,
        overflowY: 'auto',
      }}
    >
      {/* Centred with auto margins, not align-items: a centred flex child taller than the panel
          overflows upward and its top can never be scrolled back into view. */}
      <div
        style={{
          margin: 'auto',
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
            <p style={{ fontSize: 13, color: '#6A6A6A', marginTop: 4 }}>Configure AnthroDeck</p>
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <EnginePanel />

        <Divider />

        {/* ── Claude account ─────────────────────────────────────────── */}
        <section>
          <label style={labelStyle}>Claude account</label>
          {claude?.signedIn ? (
            <p style={{ ...hintStyle, color: '#9AC9A8' }}>
              ✓ Claude Code is signed in on this device
              {claude.email ? <> as <span style={{ color: '#ECECEC' }}>{claude.email}</span></> : null}
              {/* A personal account's org is just "<email>'s Organization": nothing new to show. */}
              {claude.org && !(claude.email && claude.org.includes(claude.email)) ? <> · {claude.org}</> : null}. No API key needed.
            </p>
          ) : (
            <p style={hintStyle}>
              Claude Code isn&apos;t signed in on this device. Sign in once from Desktop Mode (run{' '}
              <code style={{ color: '#CC785C' }}>~/.local/bin/claude</code> in Konsole), or use an API key below.
            </p>
          )}
          {keyFolded && (
            <button onClick={() => setKeyOpen(true)} style={{ ...linkBtn, marginTop: 10 }}>
              Use an API key instead ▸
            </button>
          )}
        </section>

        {/* ── Remote computer ────────────────────────────────────────── */}
        <section>
          <label style={labelStyle}>Remote computer</label>
          <p style={hintStyle}>
            Drive Claude Code on another computer, like your Mac: its projects and sessions show on Home
            (press Y to switch), and Claude runs there, in its folders. Needs SSH: on a Mac, turn on Remote
            Login (System Settings → General → Sharing), and add this Deck&apos;s key to it.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              value={remoteHost}
              onChange={(e) => setRemoteHost(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveRemote(); }}
              placeholder="you@your-mac.local"
              style={{
                flex: 1, background: '#242424', border: '1px solid #3A3A3A', borderRadius: 8, padding: '10px 12px',
                color: '#ECECEC', fontSize: 14, outline: 'none', fontFamily: 'JetBrains Mono, Consolas, monospace',
              }}
            />
            <button onClick={() => void saveRemote()} disabled={!!remoteStatus?.busy} style={{ ...linkBtn, color: '#CC785C', borderColor: '#CC785C' }}>
              {remoteHost.trim() || !remoteSaved ? 'Save & test' : 'Remove'}
            </button>
          </div>
          {remoteStatus && (
            <p style={{ ...hintStyle, marginTop: 8, color: remoteStatus.busy ? '#9A9A9A' : remoteStatus.ok ? '#9AC9A8' : '#D9A35B' }}>
              {remoteStatus.text}
            </p>
          )}

          {live && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, border: '1px solid #2E2E2E', background: '#151515' }}>
              <div style={{ fontSize: 13, color: '#ECECEC', fontWeight: 600 }}>Approvals from {live.label}</div>
              {!live.connected ? (
                <p style={{ ...hintStyle, marginTop: 4, color: live.error ? '#D9A35B' : '#9A9A9A' }}>
                  {live.error ? `Not connected: ${live.error}` : `Connecting to ${live.label}…`}
                </p>
              ) : live.state?.relay ? (
                <>
                  <p style={{ ...hintStyle, marginTop: 4, color: '#9AC9A8' }}>
                    ✓ When a Claude Code session on {live.label} asks for permission or asks a question, it shows up
                    here too. Answer on whichever is closer: the first answer wins.
                  </p>
                  <button onClick={() => void setRelay('remove')} disabled={relayBusy} style={{ ...linkBtn, marginTop: 6 }}>
                    {relayBusy ? 'Removing…' : 'Remove from ' + live.label}
                  </button>
                </>
              ) : (
                <>
                  <p style={{ ...hintStyle, marginTop: 4 }}>
                    Sessions running on {live.label} (in the Claude app or a terminal) can send their permission
                    prompts and questions here, so you can approve from the Deck. This adds one hook to Claude
                    Code&apos;s settings on {live.label} (~/.claude/settings.json, backed up first). When the Deck
                    isn&apos;t connected the hook does nothing.
                  </p>
                  <button onClick={() => void setRelay('install')} disabled={relayBusy} style={{ ...linkBtn, marginTop: 6, color: '#CC785C', borderColor: '#CC785C' }}>
                    {relayBusy ? 'Installing…' : `Install on ${live.label}`}
                  </button>
                </>
              )}
              {relayError && <p style={{ ...hintStyle, marginTop: 6, color: '#D9A35B' }}>{relayError}</p>}
            </div>
          )}
        </section>

        <Divider />

        {/* ── API Key (optional when signed in) ─────────────────────────── */}
        {!keyFolded && (
        <section>
          <label style={labelStyle}>Anthropic API Key</label>
          <p style={hintStyle}>
            Get your key at{' '}
            <span style={{ color: '#CC785C' }}>console.anthropic.com</span>
            . Stored locally on your device and handed to Claude Code, which then bills that key
            instead of your Claude account.
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

          <PairKeyPanel onPaired={onPaired} />
        </section>
        )}

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
          <LocalVoiceRow onChanged={onVoiceChanged} />
          <ToggleRow
            label="Teach mode"
            hint="Explain each tool call before it runs; A continues, B redirects by voice. Auto-continues after a few seconds."
            value={teachMode}
            onChange={() => onTeachModeChange(!teachMode)}
          />
          <ToggleRow
            label="Play while Claude works"
            hint="Put the controls down while Claude works and a game comes up. Cards from any session pause it, and when a session finishes it offers to take you there."
            value={intermission}
            onChange={() => onIntermissionChange(!intermission)}
          />
          <ToggleRow
            label="Playing tidies the context"
            hint="Clearing stale-context targets in a game queues a compaction of Claude's context, run when its turn ends."
            value={tidyUp}
            onChange={() => onTidyUpChange(!tidyUp)}
          />
          <ToggleRow
            label="Haptics"
            hint="Controller rumble on tool success, errors, and completed messages."
            value={haptics}
            onChange={() => onHapticsChange(!haptics)}
          />
          <ToggleRow
            label="Sound cues"
            hint="Chime on complete, low tone on error, tick on voice start/stop."
            value={sound}
            onChange={() => onSoundChange(!sound)}
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
// Plain text only: the main process has already stripped the release notes' HTML.
function WhatsNewList({ notes }: { notes: NonNullable<ReturnType<typeof useUpdater>['status']['notes']> }) {
  return (
    <div style={{ background: '#161616', border: '1px solid #2A2A2A', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#CC785C', marginBottom: 6 }}>
        WHAT&apos;S NEW
      </div>
      {notes.map((n, i) => (
        <div key={n.version ?? i} style={{ marginTop: i ? 8 : 0 }}>
          {notes.length > 1 && n.version && (
            <div style={{ fontSize: 11, color: '#777', marginBottom: 2 }}>v{n.version}</div>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#CFCFCF', lineHeight: 1.5 }}>
            {n.items.map((item, j) => <li key={j}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

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

      {/* What's new, from the release notes */}
      {status.newVersion && !!status.notes?.length && (status.state === 'available' || status.state === 'downloading' || status.state === 'ready') && (
        <WhatsNewList notes={status.notes} />
      )}

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
            {status.manualUrl ? `↗ Get v${status.newVersion} from GitHub` : `↓ Download v${status.newVersion}`}
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
function LocalVoiceRow({ onChanged }: { onChanged: () => void }) {
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
      onChanged();
    } finally {
      setDownloading(false);
    }
  };

  // Voice runs on this device (whisper.cpp): built into the Linux install, a one-time model
  // download elsewhere. Hold L2 or the mic button to talk.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 14, color: '#ECECEC', fontWeight: 600 }}>Voice</div>
      <div style={{ fontSize: 12, color: status?.ready ? '#52A77C' : '#D9A441' }}>
        {status?.ready
          ? `Ready: hold L2 and talk. Runs on this device (${status.model}${status.bundled ? ', built in' : ''}).`
          : (status?.reason ?? 'Checking…')}
      </div>
      {status?.available && !status.ready && (
        <button onClick={download} disabled={downloading} style={secondaryBtn}>
          {downloading ? 'Downloading… (~60 MB)' : 'Download the speech model'}
        </button>
      )}
      {msg && <div style={{ fontSize: 12, color: '#8A8A8A' }}>{msg}</div>}
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
const linkBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #3A3A3A', borderRadius: 8, padding: '8px 12px',
  color: '#9A9A9A', fontSize: 13, cursor: 'pointer', textAlign: 'left',
};

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
