import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDragScroll } from '../hooks/useDragScroll';
import { usePadFocus, type PadFocus } from '../hooks/usePadFocus';
import { useUpdater } from '../hooks/useUpdater';
import { LocalVoiceStatus, type EngineStatus, type RcStatus } from '../types';
import { withGlyphs } from './Glyph';
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
  // Sign in to claude.ai, to open sessions from any computer on their own page (ClaudePage).
  onClaudeSignIn: () => void;
  onEngineSignIn: () => void;           // Claude Code's own sign-in, on the claude.ai page
  onVoiceChanged: () => void;
  teachMode: boolean;
  onTeachModeChange: (v: boolean) => void;
  haptics: boolean;
  onHapticsChange: (v: boolean) => void;
  intermission: boolean;
  onIntermissionChange: (v: boolean) => void;
  builtInGames: boolean;
  onBuiltInGamesChange: (v: boolean) => void;
  tidyUp: boolean;
  onTidyUpChange: (v: boolean) => void;
  sound: boolean;
  onSoundChange: (v: boolean) => void;
}

export function SettingsPanel({
  padNav,
  apiKey,
  onSave,
  onPaired,
  onClear,
  onClose,
  onClaudeSignIn,
  onEngineSignIn,
  onVoiceChanged,
  teachMode,
  onTeachModeChange,
  haptics,
  onHapticsChange,
  intermission,
  onIntermissionChange,
  builtInGames,
  onBuiltInGamesChange,
  tidyUp,
  onTidyUpChange,
  sound,
  onSoundChange,
}: Props) {
  const [draftKey, setDraftKey] = useState(apiKey);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  // Claude Code's own sign-in on this device. With it, the API key is optional and stays folded away.
  const [claude, setClaude] = useState<{ signedIn: boolean; email: string | null; org: string | null } | null>(null);
  const [engineFound, setEngineFound] = useState(true);
  const [keyOpen, setKeyOpen] = useState(false);
  useEffect(() => {
    void window.electronAPI.engineStatus().then((st) => { setClaude(st.claude); setEngineFound(st.found); }).catch(() => setClaude(null));
  }, []);
  // Signing out of Claude Code on this device, and claude.ai's page with it (main: claude:sign-out).
  const [signingOut, setSigningOut] = useState<null | 'armed' | 'busy'>(null);
  const signOut = async () => {
    if (signingOut !== 'armed') { setSigningOut('armed'); return; }
    setSigningOut('busy');
    await window.electronAPI.claudeSignOut();
    const st = await window.electronAPI.engineStatus();
    setClaude(st.claude);
    setWebSignedIn(await window.electronAPI.claudeSignedIn());
    setSigningOut(null);
  };
  // Installed from the panel at the top: the sign-in step comes up under it.
  const onEngine = useCallback((st: EngineStatus) => { setEngineFound(st.found); setClaude(st.claude); }, []);
  // Everything past the two things that matter (account, your computers) waits behind this.
  const [advanced, setAdvanced] = useState(false);
  const keyFolded = !apiKey && !keyOpen;

  // A computer set up over SSH in an older version: Remote Control does its job now, so Settings
  // only offers to forget it.
  const [remoteSaved, setRemoteSaved] = useState<string | null>(null);
  useEffect(() => { void window.electronAPI.remoteGet().then((t) => setRemoteSaved(t?.label ?? t?.host ?? null)); }, []);
  const forgetRemote = async () => { await window.electronAPI.remoteSet(null, null); setRemoteSaved(null); };

  // Remote Control on this Deck: how every computer's sessions reach it.
  const [rcState, setRcState] = useState<RcStatus | null>(null);
  const [rcBusy, setRcBusy] = useState(false);
  useEffect(() => {
    void window.electronAPI.rcGet().then(setRcState);
    return window.electronAPI.onRcState(setRcState);
  }, []);
  const [webSignedIn, setWebSignedIn] = useState<boolean | null>(null);
  useEffect(() => { void window.electronAPI.claudeSignedIn().then(setWebSignedIn); }, []);
  const rcToggle = async () => { setRcBusy(true); setRcState(await window.electronAPI.rcSet(!rcState?.enabled)); setRcBusy(false); };

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
  useDragScroll(rootRef);   // a finger drags it, also when Steam sends touch as a mouse
  useEffect(() => {
    if (!padNav) return;
    padNav.current = pad;
    return () => { padNav.current = null; };
  }, [padNav, pad]);

  // The API key: shown in Account when there's no sign-in (or a key is already set), else in Advanced.
  const apiKeyBox = (
    <div>
      <p style={hintStyle}>
        An Anthropic API key from <span style={{ color: '#CC785C' }}>console.anthropic.com</span>, kept on this device.
        Claude Code then bills it instead of your Claude account.
      </p>
      <div style={{ position: 'relative', marginTop: 10 }}>
        <input
          type={showKey ? 'text' : 'password'}
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          placeholder="sk-ant-..."
          style={{
            width: '100%', boxSizing: 'border-box', background: '#242424', border: '1px solid #3A3A3A', borderRadius: 8,
            padding: '12px 48px 12px 14px', color: '#ECECEC', fontSize: 16, outline: 'none',
            fontFamily: 'JetBrains Mono, Consolas, monospace', letterSpacing: '0.04em',
          }}
        />
        <button
          onClick={() => setShowKey((v) => !v)}
          style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#6A6A6A', cursor: 'pointer', fontSize: 16 }}
          title={showKey ? 'Hide' : 'Show'}
        >
          {showKey ? '🙈' : '👁'}
        </button>
      </div>
      <button
        onClick={handleSave}
        disabled={!draftKey.trim()}
        style={{
          marginTop: 12, width: '100%', padding: '12px', borderRadius: 8, border: 'none',
          background: draftKey.trim() ? '#CC785C' : 'rgba(204,120,92,0.2)',
          color: draftKey.trim() ? '#fff' : 'rgba(204,120,92,0.4)', fontSize: 16, fontWeight: 600,
          cursor: draftKey.trim() ? 'pointer' : 'not-allowed',
        }}
      >
        {saved ? '✓ Saved' : 'Save API key'}
      </button>
      <PairKeyPanel onPaired={onPaired} />
    </div>
  );

  const deckLine = !rcState ? null
    : !rcState.enabled ? { ok: false, text: 'Remote Control is off on this Deck.' }
      : rcState.deck.state === 'connected' ? { ok: true, text: '✓ This Deck is on Remote Control: your computers can reach it.' }
        : rcState.deck.state === 'needs-consent' ? { ok: false, text: 'Remote Control needs turning on once: run claude remote-control in Konsole and accept.' }
          : { ok: null, text: 'Connecting this Deck to Remote Control…' };
  const tone = (ok: boolean | null | undefined) => (ok ? '#9AC9A8' : ok === false ? '#D9A35B' : '#9A9A9A');

  return (
    <div
      ref={rootRef}
      style={{ flex: 1, display: 'flex', background: '#0F0F0F', padding: 32, overflowY: 'auto' }}
    >
      {/* Centred with auto margins, not align-items: a centred flex child taller than the panel
          overflows upward and its top can never be scrolled back into view. */}
      <div style={{
        margin: 'auto', background: '#1A1A1A', border: '1px solid #3A3A3A', borderRadius: 14, padding: 32,
        width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 26,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: '#ECECEC' }}>Settings</h2>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        {!engineFound && <EnginePanel onStatus={onEngine} />}

        {/* ── 1. Account ───────────────────────────────────────────────── */}
        <section>
          <label style={labelStyle}>Account</label>
          {claude?.signedIn ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <p style={{ ...leadStyle, flex: 1, color: '#9AC9A8' }}>
                ✓ Signed in{claude.email ? <> as <span style={{ color: '#ECECEC' }}>{claude.email}</span></> : null}
                {/* A personal account's org is just "<email>'s Organization": nothing new to show. */}
                {claude.org && !(claude.email && claude.org.includes(claude.email)) ? <> · {claude.org}</> : null}
              </p>
              {/* Twice to sign out: once arms it, so a stray A doesn't. */}
              <button onClick={() => void signOut()} disabled={signingOut === 'busy'} onBlur={() => { if (signingOut === 'armed') setSigningOut(null); }}
                style={{ ...linkBtn, ...(signingOut === 'armed' ? { color: '#E05252', borderColor: '#E05252' } : {}) }}>
                {signingOut === 'busy' ? 'Signing out…' : signingOut === 'armed' ? 'Press again to sign out' : 'Sign out'}
              </button>
            </div>
          ) : !engineFound ? (
            <p style={leadStyle}>Install Claude Code above, then sign in here.</p>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <p style={{ ...leadStyle, flex: 1 }}>Sign in with your Claude account. Its page opens right here.</p>
                <button onClick={onEngineSignIn} style={{ ...linkBtn, color: '#fff', background: '#CC785C', borderColor: '#CC785C' }}>Sign in</button>
              </div>
              {keyFolded && (
                <button onClick={() => setKeyOpen(true)} style={{ ...linkBtn, marginTop: 12 }}>Or use an API key ▸</button>
              )}
            </>
          )}
          {!keyFolded && <div style={{ marginTop: 16 }}>{apiKeyBox}</div>}
        </section>

        {/* ── 2. Your computers ───────────────────────────────────────── */}
        {/* Every Claude Code session on the account with Remote Control on shows on Home, from any
            computer, like the Claude app on a phone. The AnthroDeck plugin on a computer brings its
            prompts here and says when its sessions finish (plugins/anthrodeck). */}
        <section>
          <label style={labelStyle}>Your computers</label>
          <p style={{ ...hintStyle, marginBottom: 12 }}>
            Every Claude Code session with Remote Control on shows on Home, from any computer. Nothing to install there.
          </p>
          {/* Nothing here works before Claude Code is signed in on the Deck. */}
          {!claude?.signedIn ? (
            <p style={{ ...leadStyle, color: '#9A9A9A' }}>After you sign in.</p>
          ) : (<>
            {deckLine && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <p style={{ ...leadStyle, flex: 1, color: tone(deckLine.ok) }}>{deckLine.text}</p>
                {rcState && !rcState.enabled && (
                  <button onClick={() => { if (!rcBusy) void rcToggle(); }} style={{ ...linkBtn, color: '#CC785C', borderColor: '#CC785C' }}>Turn on</button>
                )}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <p style={{ ...leadStyle, flex: 1, color: tone(webSignedIn) }}>
                {webSignedIn ? '✓ Signed in to claude.ai: a session opens on its own page, whole.'
                  : webSignedIn === false ? 'Sign in to claude.ai once, to open a session on its own page: the whole conversation, its prompts and approvals.'
                    : 'Checking claude.ai…'}
              </p>
              {webSignedIn === false && (
                <button onClick={onClaudeSignIn} style={{ ...linkBtn, color: '#CC785C', borderColor: '#CC785C' }}>Sign in</button>
              )}
            </div>
            <p style={{ ...hintStyle, marginBottom: 10 }}>
              Optional: to answer a session&apos;s prompts on cards here and hear when it finishes, even mid-game,
              add the AnthroDeck plugin to Claude Code on that computer, once:
            </p>
            <code style={{
              display: 'block', background: '#242424', border: '1px solid #3A3A3A', borderRadius: 8, padding: '12px 14px',
              color: '#ECECEC', fontSize: 14, fontFamily: 'JetBrains Mono, Consolas, monospace', userSelect: 'all',
            }}>claude plugin install anthrodeck --marketplace keaton4422/anthrodeck</code>
            <p style={{ ...hintStyle, marginTop: 8 }}>
              In the Claude desktop app: + next to the prompt box → Plugins → Add marketplace <span style={{ color: '#ECECEC' }}>keaton4422/anthrodeck</span> → Add plugin.
            </p>
          </>)}
        </section>

        <Divider />

        <button onClick={() => setAdvanced((a) => !a)} style={{ ...linkBtn, fontSize: 16, padding: '12px 14px' }}>
          {advanced ? 'Advanced ▾' : 'Advanced ▸'}
        </button>

        {advanced && (
          <>
            {engineFound && <EnginePanel />}

            {remoteSaved && (
              <section>
                <label style={labelStyle}>Over SSH</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <p style={{ ...hintStyle, flex: 1 }}>{remoteSaved} is still set up over SSH. Remote Control brings its sessions here without it.</p>
                  <button onClick={() => void forgetRemote()} style={linkBtn}>Forget it</button>
                </div>
              </section>
            )}

            {keyFolded && (
              <section>
                <label style={labelStyle}>API key</label>
                <button onClick={() => setKeyOpen(true)} style={linkBtn}>Use an API key instead of your account ▸</button>
              </section>
            )}

            {/* ── Voice & play ── */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={labelStyle}>Voice &amp; play</label>
              <LocalVoiceRow onChanged={onVoiceChanged} />
              <ToggleRow
                label="Built-in games"
                hint="Trench Run, Engine Runner and the rest. Off, Games opens your Steam library instead (on a Deck with Steam games)."
                value={builtInGames}
                onChange={() => onBuiltInGamesChange(!builtInGames)}
              />
              <ToggleRow
                label="Play while Claude works"
                hint="Put the controls down while Claude works and a game comes up. Cards from any session pause it."
                value={intermission}
                onChange={() => onIntermissionChange(!intermission)}
              />
              <ToggleRow
                label="Playing tidies the context"
                hint="Clearing stale-context targets in a game compacts Claude's context when its turn ends."
                value={tidyUp}
                onChange={() => onTidyUpChange(!tidyUp)}
              />
              <ToggleRow
                label="Teach mode"
                hint="Explain each tool call before it runs; A continues, B redirects by voice."
                value={teachMode}
                onChange={() => onTeachModeChange(!teachMode)}
              />
              <ToggleRow label="Haptics" hint="Controller rumble on tool success, errors and finished messages." value={haptics} onChange={() => onHapticsChange(!haptics)} />
              <ToggleRow label="Sound cues" hint="A chime when Claude finishes, a low tone on errors." value={sound} onChange={() => onSoundChange(!sound)} />
            </section>

            <section>
              <label style={labelStyle}>Updates</label>
              <UpdateSection status={status} onCheck={checkForUpdates} onDownload={downloadUpdate} onInstall={installUpdate} />
            </section>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={labelStyle}>Controls</label>
              <Row label="Voice" value="Hold [L2] or the mic button and talk; let go and the words land in the message box" />
              <Row label="Controller" value="[A] send · [B] back · [Menu] settings · right stick scrolls · [X] type · in a game: [Y] sessions, hold [X] talk, [View] drop" />
            </section>

            {apiKey && (
              <button onClick={handleClear} style={{
                padding: '12px', borderRadius: 8, border: '1px solid rgba(224,82,82,0.35)',
                background: 'rgba(224,82,82,0.08)', color: '#E05252', fontSize: 15, cursor: 'pointer',
              }}>
                Clear conversation history
              </button>
            )}
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
function ToggleRow({ label, hint, value, onChange, big }: { label: string; hint: string; value: boolean; onChange: () => void; big?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: big ? 18 : 16, color: '#ECECEC', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 14, color: '#8A8A8A', marginTop: 3, lineHeight: 1.45 }}>{hint}</div>
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
  background: 'none', border: '1px solid #3A3A3A', borderRadius: 8, padding: '10px 14px',
  color: '#9A9A9A', fontSize: 15, cursor: 'pointer', textAlign: 'left', flexShrink: 0,
};

function Divider() {
  return <div style={{ height: 1, background: '#2A2A2A' }} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <span style={{ fontSize: 14, color: '#8A8A8A', minWidth: 96, flexShrink: 0, paddingTop: 2 }}>
        {label}
      </span>
      <span style={{ fontSize: 15, color: '#ECECEC', lineHeight: 1.5 }}>{withGlyphs(value)}</span>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, textTransform: 'uppercase',
  color: '#CC785C', letterSpacing: '0.12em',
  display: 'block', marginBottom: 12,
};

// The one line that says how something stands.
const leadStyle: React.CSSProperties = {
  fontSize: 18, color: '#ECECEC', lineHeight: 1.45,
};

const hintStyle: React.CSSProperties = {
  fontSize: 15, color: '#8A8A8A', lineHeight: 1.5,
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
