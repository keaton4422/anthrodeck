import React, { useEffect, useRef, useState } from 'react';
import { TeachRequest } from '../types';
import VoiceButton from './VoiceButton';
import { useVoice } from '../hooks/useVoice';

interface Props {
  req: TeachRequest;
  onContinue: () => void;
  onRedirect: (instruction: string) => void;
  redirectSignal: number; // bump from a gamepad B press to arm voice redirect
}

function summarizeInput(input: Record<string, unknown>): string {
  const s = JSON.stringify(input);
  return s.length > 180 ? `${s.slice(0, 179)}…` : s;
}

export default function TeachModal({ req, onContinue, onRedirect, redirectSignal }: Props) {
  const [showRedirect, setShowRedirect] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [remaining, setRemaining] = useState(req.timeout);
  const startedRef = useRef(false);

  const { isListening, transcript, isSupported, startListening, stopListening } =
    useVoice((text) => setFeedback((prev) => (prev ? `${prev} ${text}` : text)));

  // Auto-continue countdown — paused once the pilot starts a redirect.
  useEffect(() => {
    if (showRedirect || req.timeout <= 0) return;
    if (remaining <= 0) { onContinue(); return; }
    const id = window.setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => window.clearTimeout(id);
  }, [remaining, showRedirect, req.timeout, onContinue]);

  // Gamepad B arms the voice redirect.
  useEffect(() => {
    if (redirectSignal > 0 && !startedRef.current) {
      startedRef.current = true;
      setShowRedirect(true);
      startListening();
    }
  }, [redirectSignal, startListening]);

  const submitRedirect = () => {
    stopListening();
    onRedirect(feedback.trim() || '(reconsider your approach)');
  };

  return (
    <div className="overlay-in" style={{
      position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div className="panel-in" style={{
        background: '#1A1A1A', border: '1px solid #CC785C', borderRadius: 14, padding: 22,
        width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14,
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15 }}>🎓</span>
          <span style={{ color: '#CC785C', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em' }}>
            ABOUT TO RUN
          </span>
          <code style={{ marginLeft: 'auto', color: '#8FE9FF', fontSize: 13 }}>{req.tool}</code>
        </div>

        {req.why && (
          <p style={{ color: '#ECECEC', fontSize: 15, lineHeight: 1.5, margin: 0 }}>{req.why}</p>
        )}

        <pre style={{
          margin: 0, padding: '8px 10px', background: '#111', borderRadius: 8,
          fontSize: 12, color: '#9AA7B4', fontFamily: 'monospace', whiteSpace: 'pre-wrap',
          wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto',
        }}>{summarizeInput(req.input)}</pre>

        {!showRedirect ? (
          <>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onContinue} style={continueBtn}>
                <b style={{ color: '#0B0D10' }}>A</b>&nbsp; Continue
              </button>
              <button onClick={() => setShowRedirect(true)} style={redirectBtn}>
                <b style={{ color: '#E05252' }}>B</b>&nbsp; Redirect
              </button>
            </div>
            {req.timeout > 0 && (
              <div style={{ fontSize: 12, color: '#6A6A6A', textAlign: 'center' }}>
                Auto-continues in {remaining}s
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: '#888', fontSize: 12 }}>Tell Claude what to do instead:</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <textarea
                value={isListening ? transcript || feedback : feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Type or hold mic…"
                rows={2}
                style={{
                  flex: 1, background: '#111', border: '1px solid #3A3A3A', borderRadius: 8,
                  color: '#fff', fontSize: 14, padding: '8px 10px', resize: 'none', fontFamily: 'inherit',
                }}
              />
              {isSupported && (
                <VoiceButton
                  isListening={isListening}
                  isSupported={isSupported}
                  transcript={transcript}
                  onStart={startListening}
                  onStop={stopListening}
                  compact
                />
              )}
            </div>
            <button onClick={submitRedirect} style={redirectBtn}>Send redirect</button>
          </div>
        )}
      </div>
    </div>
  );
}

const continueBtn: React.CSSProperties = {
  flex: 1, padding: '11px 0', background: '#52A77C', color: '#fff', border: 'none',
  borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer',
};
const redirectBtn: React.CSSProperties = {
  flex: 1, padding: '11px 0', background: '#2A2A2A', color: '#E07050',
  border: '1px solid #E07050', borderRadius: 8, fontSize: 15, cursor: 'pointer',
};
