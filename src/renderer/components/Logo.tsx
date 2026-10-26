import React from 'react';

// The AnthroDeck mark: the handheld from assets/logo.svg without the app-icon background, cropped
// to the body. Keep the two in step; the icon files are rendered from logo.svg.
export function Logo({ height = 20, title = 'AnthroDeck' }: { height?: number; title?: string }) {
  return (
    <svg
      viewBox="48 284 928 456"
      height={height}
      width={(height * 928) / 456}
      role="img"
      aria-label={title}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect x="56" y="292" width="912" height="440" rx="200" fill="#3A3A42" stroke="#5C5C66" strokeWidth="8" />
      <circle cx="186" cy="430" r="66" fill="#17171A" />
      <circle cx="186" cy="430" r="44" fill="#55555E" />
      <circle cx="838" cy="430" r="66" fill="#17171A" />
      <circle cx="838" cy="430" r="44" fill="#55555E" />
      <rect x="134" y="544" width="104" height="104" rx="24" fill="#1D1D21" stroke="#55555E" strokeWidth="6" />
      <rect x="786" y="544" width="104" height="104" rx="24" fill="#1D1D21" stroke="#55555E" strokeWidth="6" />
      <rect x="294" y="344" width="436" height="336" rx="34" fill="#09090B" />
      <path
        d="M512 366 C525 470 554 499 658 512 C554 525 525 554 512 658 C499 554 470 525 366 512 C470 499 499 470 512 366 Z"
        fill="#D9825F"
      />
    </svg>
  );
}
