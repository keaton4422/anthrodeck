import React from 'react';

// The AnthroDeck mark for the dark UI: the drawing in assets/logo.svg inverted (an ivory Deck
// with a clay screen, since an ink silhouette vanishes on near-black), cropped to the body.
// Keep the geometry in step with logo.svg and the boot splash in index.html.
export function Logo({ height = 20, title = 'AnthroDeck' }: { height?: number; title?: string }) {
  return (
    <svg
      viewBox="56 322 916 432"
      height={height}
      width={(height * 916) / 432}
      role="img"
      aria-label={title}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path
        d="M180 330 L844 330 C905 330 944 368 952 430 C962 520 966 610 940 680 C920 732 860 748 812 730 C770 714 742 680 700 668 L324 668 C282 680 254 714 212 730 C164 748 104 732 84 680 C58 610 62 520 72 430 C80 368 119 330 180 330 Z"
        fill="#F0EEE6"
      />
      <rect x="300" y="372" width="424" height="258" rx="16" fill="#D97757" />
      <circle cx="186" cy="438" r="48" fill="#141413" />
      <circle cx="186" cy="438" r="24" fill="#F0EEE6" />
      <circle cx="838" cy="438" r="48" fill="#141413" />
      <circle cx="838" cy="438" r="24" fill="#F0EEE6" />
      <rect x="146" y="540" width="84" height="84" rx="14" fill="none" stroke="#141413" strokeWidth="14" />
      <rect x="794" y="540" width="84" height="84" rx="14" fill="none" stroke="#141413" strokeWidth="14" />
    </svg>
  );
}
