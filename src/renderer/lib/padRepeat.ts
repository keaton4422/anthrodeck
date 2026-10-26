// Hold-to-repeat for the D-pad, like a held arrow key: one step on press, then after a pause a
// steady stream, so a long Settings page or folder list doesn't take one press per row.
//
// Pure (time is passed in) so it unit-tests.

export interface HoldState { since: number; last: number }

export const REPEAT_DELAY_MS = 380;
export const REPEAT_EVERY_MS = 90;

export function holdFires(
  pressed: boolean,
  now: number,
  st: HoldState | null,
): { fire: boolean; st: HoldState | null } {
  if (!pressed) return { fire: false, st: null };
  if (!st) return { fire: true, st: { since: now, last: now } };
  if (now - st.since >= REPEAT_DELAY_MS && now - st.last >= REPEAT_EVERY_MS) {
    return { fire: true, st: { since: st.since, last: now } };
  }
  return { fire: false, st };
}
