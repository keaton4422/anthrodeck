import { useEffect, useRef } from 'react';
import type { RcSession } from '../types';
import { Glyph } from './Glyph';
import { C } from '../lib/ui';
import { settlePad } from '../lib/shown';

// A Remote Control session's own claude.ai page (main/claudePage.ts): its whole transcript,
// prompts and approvals, with nothing installed on the computer it runs on. The main process
// draws the page over the space this component leaves for it, so this only says where.
//
// Pad: B back to Home, X puts the cursor in the page's message box (STEAM + X for the keyboard),
// the right stick and D-pad scroll; on an approval, left and right pick Deny or Allow and A presses
// it (the page reads those itself, main/claudePage.ts); the touchscreen works the page.

// `engine`: Claude Code's own sign-in on this page instead of a session (main/claudeLogin.ts).
export type PageFor = RcSession & { engine?: boolean };

interface Props {
  session: PageFor;
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
    if (session.engine) void window.electronAPI.claudeEngineSignIn(rect());
    else void window.electronAPI.claudeOpen(session.ref, session.name, rect());
    const ro = new ResizeObserver(() => window.electronAPI.claudePlace(rect()));
    ro.observe(el);
    return () => { ro.disconnect(); window.electronAPI.claudeHide(); settlePad(); };
  }, [session.ref, session.name, session.engine]);
  useEffect(() => { window.electronAPI.claudeShown(!covered); }, [covered]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 24px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ minWidth: 0, flex: 1, fontSize: 15, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.name}
          <span style={{ fontSize: 12, color: C.dim, marginLeft: 10 }}>
            {session.ref ? 'claude.ai · on another computer' : 'once, with your Claude account; back to Settings after'}
          </span>
        </div>
        <div style={{ fontSize: 13, color: C.dim, whiteSpace: 'nowrap' }}><Glyph b="A" /> Answer</div>
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
