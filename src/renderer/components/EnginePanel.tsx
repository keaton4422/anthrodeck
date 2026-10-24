import React, { useCallback, useEffect, useState } from 'react';
import { EngineStatus } from '../types';

const SOURCE_LABEL: Record<NonNullable<EngineStatus['source']>, string> = {
  override: 'custom path',
  installer: 'official installer',
  path: 'system PATH',
  bundled: 'dev build (SDK package)',
};

// Settings → Engine: is Claude Code installed, which one, and a one-press install when it isn't.
// The engine updates itself; AnthroDeck only needs to find it.
export function EnginePanel({ onStatus }: { onStatus?: (s: EngineStatus) => void }) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [output, setOutput] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await window.electronAPI.engineStatus();
    setStatus(s);
    onStatus?.(s);
  }, [onStatus]);

  useEffect(() => { void refresh(); }, [refresh]);

  const install = async () => {
    setInstalling(true);
    setOutput(null);
    try {
      const r = await window.electronAPI.engineInstall();
      setOutput(r.output);
    } finally {
      setInstalling(false);
      void refresh();
    }
  };

  const ok = !!status?.found;

  return (
    <section>
      <label style={label}>Engine · Claude Code</label>
      <p style={hint}>
        AnthroDeck is the cockpit; Claude Code is the engine. Your CLAUDE.md, skills, plugins and
        permission rules all apply.
      </p>
      <div style={{
        marginTop: 10, padding: '12px 14px', borderRadius: 10, background: '#242424',
        border: `1px solid ${ok ? '#2F5A43' : '#5A2F2F'}`, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {status === null ? (
          <span style={{ color: '#8A8A8A', fontSize: 13 }}>Checking…</span>
        ) : ok ? (
          <>
            <span style={{ color: '#52A77C', fontSize: 14, fontWeight: 600 }}>
              ● Ready {status.version ? `· ${status.version}` : ''}
            </span>
            <span style={mono}>{status.path} ({status.source ? SOURCE_LABEL[status.source] : ''})</span>
            {!status.hasApiKey && (
              <span style={{ color: '#D9A441', fontSize: 12 }}>
                No API key paired: Claude Code will use its own sign-in. Pair a key below if it isn&apos;t signed in.
              </span>
            )}
          </>
        ) : (
          <>
            <span style={{ color: '#E05252', fontSize: 14, fontWeight: 600 }}>● Not installed</span>
            <span style={{ color: '#8A8A8A', fontSize: 12 }}>Runs the official installer:</span>
            <span style={mono}>{status.installCommand}</span>
            <button onClick={install} disabled={installing} style={{
              marginTop: 4, padding: '10px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: installing ? '#3A3A3A' : '#CC785C', color: '#fff', fontWeight: 600, fontSize: 14,
            }}>
              {installing ? 'Installing…' : 'Install Claude Code'}
            </button>
          </>
        )}
        {output && <pre style={{ ...mono, whiteSpace: 'pre-wrap', margin: 0, maxHeight: 140, overflowY: 'auto' }}>{output}</pre>}
      </div>
    </section>
  );
}

// Matches SettingsPanel's section label / hint styles.
const label: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#CC785C', letterSpacing: '0.05em', display: 'block', marginBottom: 10,
};
const hint: React.CSSProperties = { fontSize: 13, color: '#6A6A6A', lineHeight: 1.5 };
const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12, color: '#B0B0B0', wordBreak: 'break-all' };
