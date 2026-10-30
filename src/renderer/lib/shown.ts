// Whether AnthroDeck is the app on screen. False while a Steam game played beside it is up
// (main/beside.ts): the pad belongs to that game then, so AnthroDeck ignores it and its own games
// pause until it's back.
let shown = true;
export const isShown = (): boolean => shown;
export const setShown = (v: boolean): void => { shown = v; };
