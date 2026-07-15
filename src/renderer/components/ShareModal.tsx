import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { usePreview } from '../hooks/usePreview';

interface Props {
  onClose: () => void;
  port: number;
  onPortChange: (p: number) => void;
  https: boolean;
  onHttpsChange: (v: boolean) => void;
}

export default function ShareModal({ onClose, port, onPortChange, https, onHttpsChange }: Props) {
  const { status, busy, refresh, start, stop, detectDev } = usePreview();
  const [qr, setQr] = useState<string | null>(null);
  const [devPort, setDevPort] = useState<number | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [portDraft, setPortDraft] = useState(String(port));

  useEffect(() => { refresh(); }, [refresh]);

  const url = status?.running ? status.url : null;

  // Render the QR whenever the served URL changes.
  useEffect(() => {
    if (!url) { setQr(null); return; }
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#0F0F0F', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const found = await detectDev();
      setDevPort(found);
    } finally {
      setDetecting(false);
    }
  };

  const handleStart = () => {
    const p = parseInt(portDraft, 10);
    const safePort = Number.isInteger(p) && p >= 1024 && p <= 65535 ? p : 5757;
    onPortChange(safePort);
    start({ port: safePort, https, devPort });
  };

  const copyUrl = () => {
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const running = !!status?.running;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1A1A1A', border: '1px solid #3A3A3A', borderRadius: 14,
          padding: 24, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column',
          gap: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#ECECEC', fontSize: 18, fontWeight: 700 }}>Share preview</span>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        {running && url ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              {qr && (
                <img
                  src={qr}
                  alt="QR code"
                  style={{ width: 220, height: 220, borderRadius: 10, background: '#fff', padding: 6 }}
                />
              )}
              <div
                onClick={copyUrl}
                title="Copy URL"
                style={{
                  fontFamily: 'monospace', fontSize: 14, color: '#CC785C', cursor: 'pointer',
                  background: '#242424', border: '1px solid #3A3A3A', borderRadius: 8,
                  padding: '8px 12px', wordBreak: 'break-all', textAlign: 'center', width: '100%',
                }}
              >
                {url} {copied ? '✓ copied' : '⧉'}
              </div>
              <div style={{ fontSize: 12, color: '#8A8A8A', textAlign: 'center' }}>
                {status?.mode === 'proxy'
                  ? `Proxying dev server on port ${status.devPort} — live reload works on your phone.`
                  : status?.servedDir
                    ? 'Serving your latest build output.'
                    : 'No build output yet — run a build and it appears automatically.'}
                {status?.https && ' (self-signed HTTPS — accept the certificate warning on the phone.)'}
              </div>
            </div>
            <button onClick={stop} disabled={busy} style={dangerBtn}>
              {busy ? 'Stopping…' : 'Stop sharing'}
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: '#8A8A8A', lineHeight: 1.5, margin: 0 }}>
              Serve your project&apos;s build output (or a running dev server) over your LAN so a
              phone or another device can open it. Scan the QR that appears after you start.
            </p>

            {/* Port */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={fieldLabel}>Port</span>
              <input
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="5757"
                style={input}
              />
            </label>

            {/* HTTPS toggle */}
            <ToggleRow
              label="Self-signed HTTPS"
              hint="Needed for camera / mic / gyro on mobile web. Phone will warn about the cert."
              value={https}
              onChange={() => onHttpsChange(!https)}
            />

            {/* Dev server detect */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={handleDetect} disabled={detecting} style={secondaryBtn}>
                {detecting ? 'Scanning…' : 'Detect running dev server'}
              </button>
              {devPort != null && (
                <span style={{ fontSize: 12, color: '#52A77C' }}>
                  Found dev server on port {devPort} — it will be proxied (live reload).
                </span>
              )}
              {devPort == null && !detecting && (
                <span style={{ fontSize: 12, color: '#6A6A6A' }}>
                  Optional. Without one, your latest build output is served.
                </span>
              )}
            </div>

            {status?.error && (
              <span style={{ fontSize: 12, color: '#E05252' }}>{status.error}</span>
            )}

            <button onClick={handleStart} disabled={busy} style={primaryBtn}>
              {busy ? 'Starting…' : 'Start sharing'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
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

const closeBtn: React.CSSProperties = {
  background: '#242424', border: '1px solid #3A3A3A', borderRadius: 6,
  width: 30, height: 30, color: '#9A9A9A', cursor: 'pointer', fontSize: 13,
};
const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#CC785C', letterSpacing: '0.04em' };
const input: React.CSSProperties = {
  background: '#242424', border: '1px solid #3A3A3A', borderRadius: 8,
  padding: '10px 12px', color: '#ECECEC', fontSize: 15, outline: 'none', fontFamily: 'monospace',
};
const primaryBtn: React.CSSProperties = {
  padding: '12px', borderRadius: 8, border: 'none', background: '#CC785C',
  color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  padding: '10px', borderRadius: 8, border: '1px solid #3A3A3A', background: '#242424',
  color: '#ECECEC', fontSize: 13, cursor: 'pointer',
};
const dangerBtn: React.CSSProperties = {
  padding: '12px', borderRadius: 8, border: '1px solid rgba(224,82,82,0.4)',
  background: 'rgba(224,82,82,0.1)', color: '#E05252', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
