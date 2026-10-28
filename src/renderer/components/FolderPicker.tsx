import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { FolderListing, Machine } from '../types';
import { usePadFocus, type PadFocus } from '../hooks/usePadFocus';
import { C } from '../lib/ui';

// Pick (or create) a project folder inside the app. The system dialog can't open in the Deck's
// Game Mode (see main/folders.ts), and this one is driven like the rest of the cockpit: D-pad to
// move, A to go into a folder or press a button, B to cancel.

interface Props {
  title?: string;
  machine?: Machine;   // browse this device, or the remote computer (Settings → Remote computer)
  padNav: React.MutableRefObject<PadFocus | null>;
  onPick: (path: string) => void;
  onCancel: () => void;
}

export default function FolderPicker({ title = 'Open a project folder', machine = 'local', padNav, onPick, onCancel }: Props) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pad = usePadFocus(rootRef, `${listing?.path ?? ''}:${creating}`);

  useEffect(() => {
    padNav.current = pad;
    return () => { padNav.current = null; };
  }, [padNav, pad]);

  const go = useCallback(async (dir: string | null) => {
    setProblem(null);
    setCreating(false);
    setListing(await window.electronAPI.foldersList(dir, machine));
  }, [machine]);
  useEffect(() => { void go(null); }, [go]);

  // Escape cancels, for a keyboard; B does it on the pad (App routes it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const create = async () => {
    if (!listing) return;
    const r = await window.electronAPI.foldersCreate(listing.path, newName, machine);
    if (r.error || !r.path) { setProblem(r.error ?? 'Could not create the folder.'); return; }
    setNewName('');
    await go(r.path);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 88, background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div ref={rootRef} style={{
        width: '100%', maxWidth: 760, maxHeight: '100%', display: 'flex', flexDirection: 'column', gap: 12,
        background: '#1A1A1A', border: '1px solid #3A3A3A', borderRadius: 14, padding: 22,
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', color: C.text }}>{title.toUpperCase()}</div>
          <div title={listing?.path} style={{
            fontFamily: 'monospace', fontSize: 13, color: C.clay, marginTop: 6,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left',
          }}>
            {listing?.path ?? '…'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => listing && onPick(listing.path)} disabled={!listing} style={btn(true)}>✓ Open this folder</button>
          <button onClick={() => { setCreating((c) => !c); setProblem(null); }} style={btn(false)}>
            {creating ? 'Cancel new folder' : '＋ New folder here'}
          </button>
          <button onClick={onCancel} style={btn(false)}>Cancel</button>
        </div>

        {creating && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
              placeholder="new-project (STEAM + X for the keyboard)"
              style={{
                flex: 1, background: '#242424', border: '1px solid #3A3A3A', borderRadius: 8, padding: '10px 12px',
                color: C.text, fontSize: 14, outline: 'none',
              }}
            />
            <button onClick={() => void create()} style={btn(true)}>Create</button>
          </div>
        )}
        {(problem || listing?.error) && (
          <div style={{ fontSize: 12, color: '#D9A35B' }}>{problem ?? `Can't read this folder: ${listing?.error}`}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', minHeight: 0 }}>
          {listing?.parent && (
            <button onClick={() => void go(listing.parent)} style={row}>
              <span style={{ color: C.dim }}>↑ Up to {listing.parent.split(/[\\/]/).filter(Boolean).pop() ?? '/'}</span>
            </button>
          )}
          {listing?.folders.map((f) => (
            <button key={f.path} onClick={() => void go(f.path)} style={row}>
              <span style={{ color: C.text }}>📁 {f.name}</span>
              {f.git && <span style={tag}>git project</span>}
            </button>
          ))}
          {listing && !listing.folders.length && !listing.error && (
            <div style={{ fontSize: 13, color: C.faint, padding: '8px 4px' }}>No folders here. Open this one, or make a new one.</div>
          )}
        </div>
      </div>
    </div>
  );
}

const btn = (primary: boolean): React.CSSProperties => ({
  padding: '10px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
  border: `1px solid ${primary ? C.clay : '#3A3A3A'}`,
  background: primary ? 'rgba(217,119,87,0.14)' : '#202020', color: primary ? C.clay : '#BBBBBB',
});

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'left',
  padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.panel,
  cursor: 'pointer', fontSize: 14, flexShrink: 0,
};

const tag: React.CSSProperties = {
  fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.clay,
  border: `1px solid ${C.clay}`, borderRadius: 3, padding: '0 5px',
};
