// Whether AnthroDeck is the app on screen. False while a Steam game played beside it is up
// (main/beside.ts): the pad belongs to that game then, so AnthroDeck ignores it and its own games
// pause until it's back.
let shown = true;
export const isShown = (): boolean => shown;
export const setShown = (v: boolean): void => { shown = v; };

// Back from a page that had the pad (a session's claude.ai page): the button that closed it may
// still be held, and must not count as a press here as well. The next read only takes the state.
let settle = false;
export const settlePad = (): void => { settle = true; };
export const takeSettle = (): boolean => { const s = settle; settle = false; return s; };
