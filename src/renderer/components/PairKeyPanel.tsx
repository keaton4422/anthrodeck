import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { PairingSession } from '../types';

// Typing `sk-ant-...` on the Deck's on-screen keyboard is a genuinely bad time — 100+ characters
// of random case-sensitive base64 on a trackpad-driven keyboard. So: the Deck opens a short-lived
// page on the LAN, you scan it with a phone that already has the key on its clipboard, paste, and
// it lands in electron-store on the Deck. Nothing is typed on the Deck except a 6-digit code, and
// the key never passes through the renderer.

interface Props {
  onPaired: () => void;
}

function useCountdown(expiresAt: number | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!expiresAt) { setLeft(0); return; }
    const tick = () => setLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return left;
}

export function PairKeyPanel({ onPaired }: Props) {
  const [session, setSession] = useState<PairingSession | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const paired = useRef(onPaired);
  paired.current = onPaired;

  const left = useCountdown(session?.active ? session.expiresAt : null);

  const stop = useCallback(async () => {
    setSession(await window.electronAPI.pairStop());
    setQr(null);
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    setDone(false);
    try { setSession(await window.electronAPI.pairStart()); }
    finally { setBusy(false); }
  }, []);

  // Main tells us the moment a key arrives — the key itself stays in main.
  useEffect(() => window.electronAPI.onPairReceived(() => {
    setDone(true);
    setSession(null);
    setQr(null);
    paired.current();
  }), []);

  useEffect(() => {
    if (!session?.url) { setQr(null); return; }
    QRCode.toDataURL(session.url, { width: 190, margin: 1, color: { dark: '#0F0F0F', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [session?.url]);

  // The window closes itself after 5 min in main; mirror that here so the UI doesn't lie.
  useEffect(() => {
    if (session?.active && left === 0 && session.expiresAt) setSession(null);
  }, [left, session]);

  // Tear the server down if Settings closes while pairing is open.
  useEffect(() => () => { void window.electronAPI.pairStop(); }, []);

  if (done) {
    return (
      <p style={{ ...note, color: '#52A77C', marginTop: 10 }}>
        Key received and saved. You are ready to go.
      </p>
    );
  }

  if (!session?.active) {
    return (
      <>
        <button onClick={start} disabled={busy} style={ghostBtn}>
          {busy ? 'Starting...' : 'Send key from my phone or PC'}
        </button>
        {session?.error && <p style={{ ...note, color: '#E05252' }}>{session.error}</p>}
        <p style={note}>Avoids typing the key on the Deck keyboard. Works on your local network.</p>
      </>
    );
  }

  return (
    <div style={{
      marginTop: 12, padding: 16, borderRadius: 10,
      background: '#1A1A1A', border: '1px solid #3A3A3A',
      display: 'flex', gap: 16, alignItems: 'center',
    }}>
      {qr && (
        <img
          src={qr}
          alt="Pairing QR code"
          style={{ width: 130, height: 130, borderRadius: 6, background: '#fff', flexShrink: 0 }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <p style={{ ...note, marginTop: 0 }}>Scan on your phone, or open</p>
        <p style={{
          fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 13,
          color: '#ECECEC', margin: '2px 0 12px', wordBreak: 'break-all',
        }}>
          {session.url}
        </p>

        <p style={{ ...note, marginTop: 0 }}>Then enter this code:</p>
        <p style={{
          fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 30,
          letterSpacing: '0.18em', color: '#CC785C', fontWeight: 700, margin: '2px 0 0',
        }}>
          {session.code}
        </p>

        <p style={{ ...note, marginBottom: 0 }}>
          Closes in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · local network only
        </p>
        <button onClick={stop} style={{ ...ghostBtn, marginTop: 10, padding: '8px 14px', width: 'auto' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const note: React.CSSProperties = {
  fontSize: 12, color: '#6A6A6A', lineHeight: 1.5, margin: '8px 0 0',
};

const ghostBtn: React.CSSProperties = {
  marginTop: 10, width: '100%', padding: 11, borderRadius: 8,
  border: '1px solid #3A3A3A', background: '#242424', color: '#ECECEC',
  fontSize: 14, fontWeight: 500, cursor: 'pointer',
};
