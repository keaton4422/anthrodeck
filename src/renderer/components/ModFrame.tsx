import React, { useEffect, useRef } from 'react';
import { HOST_PAGE, modUrl } from '../../main/modManifest';
import type { ModGameEntry } from '../game/mods';

// Where a mod game actually runs: an iframe over the cockpit canvas.
//
// `sandbox="allow-scripts"` without allow-same-origin gives the page an opaque origin: it can't
// reach this window (or window.electronAPI), storage, cookies, popups, forms or top navigation.
// The page's own CSP (main/modManifest.ts) gives it no network. It never takes focus or the pointer,
// so the pad and keyboard stay with the cockpit, which forwards input in each frame message.
export default function ModFrame({ game }: { game: ModGameEntry }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    game.channel.attach(frame.contentWindow);
    const onMessage = (e: MessageEvent) => {
      if (e.source === frame.contentWindow) game.channel.receive(e.data);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      game.channel.attach(null);
    };
  }, [game]);

  return (
    <iframe
      ref={ref}
      key={game.manifest.id}
      title={game.manifest.name}
      src={modUrl(game.manifest.id, HOST_PAGE)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      tabIndex={-1}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        border: 0, background: 'transparent', pointerEvents: 'none',
      }}
    />
  );
}
