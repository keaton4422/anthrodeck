import { useEffect, useRef } from 'react';
import type { RcSession } from '../types';
import { Glyph } from './Glyph';
import { C } from '../lib/ui';

// A Remote Control session's own claude.ai page (main/claudePage.ts): its whole transcript,
// prompts and approvals, with nothing installed on the computer it runs on. The main process
// draws the page over the space this component leaves for it, so this only says where.
//
// Pad: B back to Home, X puts the cursor in the page's message box (STEAM + X for the keyboard),
// the right stick and D-pad scroll; the touchscreen works the page. App routes the buttons.

interface Props {
  session: RcSession;
  covered: boolean;      // a card, menu or game over it: the page steps aside (it would draw on top)
  onBack: () => void;
}

export function ClaudePage({ session, covered, onBack }: Props) {
  const spot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = spot.current;
    if (!el) return;
    const rect = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    void window.electronAPI.claudeOpen(session.ref, session.name, rect());
    const ro = new ResizeObserver(() => window.electronAPI.claudePlace(rect()));
    ro.observe(el);
    return () => { ro.disconnect(); window.electronAPI.claudeHide(); };
  }, [session.ref, session.name]);
  useEffect(() => { window.electronAPI.claudeShown(!covered); }, [covered]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 24px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ minWidth: 0, flex: 1, fontSize: 15, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.name}
          <span style={{ fontSize: 12, color: C.dim, marginLeft: 10 }}>claude.ai · on another computer</span>
        </div>
        <div style={{ fontSize: 13, color: C.dim, whiteSpace: 'nowrap' }}><Glyph b="X" /> Type</div>
        <button onClick={onBack} style={{
          padding: '6px 12px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          border: `1px solid ${C.line}`, background: 'transparent', color: C.dim,
        }}><Glyph b="B" /> Back</button>
      </div>
      <div ref={spot} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
