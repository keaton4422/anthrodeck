// Runs the mod runtime plus a mod's script in a bare VM context, standing in for the sandboxed
// iframe: no DOM, no electronAPI, a canvas that records nothing. Messages cross the boundary as
// JSON, the way postMessage's structured clone would copy them.
import vm from 'vm';
import { MOD_RUNTIME_JS } from '../modRuntime';

type Listener = (e: { source: unknown; data: unknown }) => void;

export function runModInVm(modSource: string, onPost?: (message: unknown) => void) {
  const listeners: Record<string, Listener[]> = {};
  const posted: Record<string, unknown>[] = [];
  const parent = {
    postMessage: (m: unknown) => {
      const copy = JSON.parse(JSON.stringify(m));
      posted.push(copy);
      onPost?.(copy);
    },
  };
  const noop = () => ({ addColorStop: () => undefined });
  const ctx2d = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx2d };
  const win: Record<string, unknown> = {
    parent,
    document: { getElementById: () => canvas },
    addEventListener: (type: string, fn: Listener) => { (listeners[type] ??= []).push(fn); },
  };
  win.window = win;
  const context = vm.createContext(win);
  vm.runInContext(MOD_RUNTIME_JS, context);
  vm.runInContext(modSource, context);
  for (const fn of listeners.DOMContentLoaded ?? []) fn({ source: null, data: null });

  return {
    posted,
    canvas,
    // A message from the cockpit (or, with `source`, from anywhere else).
    send(data: unknown, source: unknown = parent) {
      const copy = JSON.parse(JSON.stringify(data));
      for (const fn of listeners.message ?? []) fn({ source, data: copy });
    },
    // What a sandboxed page sees of the outside world.
    globals: win,
  };
}
