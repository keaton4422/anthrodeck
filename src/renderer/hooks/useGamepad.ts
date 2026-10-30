import { useEffect, useRef } from 'react';
import { holdFires, type HoldState } from '../lib/padRepeat';
import { isShown } from '../lib/shown';

interface GamepadActions {
  onL2Press?: () => void;
  onL2Release?: () => void;
  // Face buttons receive whether the L1 chord modifier was held at press time.
  onAPress?: (modifier: boolean) => void;
  onBPress?: (modifier: boolean) => void;
  onXPress?: (modifier: boolean) => void;
  onXRelease?: () => void;   // X held is push-to-talk in the game's comms rail
  onYPress?: (modifier: boolean) => void;
  onStartPress?: () => void;
  // Wheel controls: R1 is the drive-mode paddle; R2 (with L1 held, so it is never an accident)
  // is the brake that interrupts Claude.
  onR1Press?: () => void;
  onR2Press?: (modifier: boolean) => void;
  onDpadUp?: () => void;
  onDpadDown?: () => void;
  onDpadLeft?: () => void;
  onDpadRight?: () => void;
  onL3Press?: () => void;
  onR3Press?: () => void;
  // Radial menu: hold to open, aim with the right stick, release to commit.
  onRadialOpen?: () => void;
  onRadialAim?: (x: number, y: number) => void;
  onRadialClose?: () => void;
  onScrollY?: (delta: number) => void;
  // Any button or stick, each frame it's touched: tells App the pilot has the controls.
  onActivity?: () => void;
}

// Standard gamepad button indices.
const BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9,
  L3: 10, R3: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
};
const L2_THRESHOLD = 0.5;
const STICK_DEADZONE = 0.15;
const RIGHT_STICK_X = 2; // axis index
const RIGHT_STICK_Y = 3; // axis index
const LEFT_STICK_X = 0;
const LEFT_STICK_Y = 1;
// The left stick moves focus like the D-pad (Steam's Deck templates send the left stick, and often
// the trackpads, as stick movement). Pushed past PUSH it counts as held; it lets go below RELEASE,
// so a stick resting near the edge doesn't flicker.
const STICK_PUSH = 0.6;
const STICK_RELEASE = 0.35;

// Which D-pad directions the left stick is holding, with hysteresis against the previous frame.
export function stickDirections(x: number, y: number, prev: Record<number, boolean>): Record<number, boolean> {
  const held = (dir: number, v: number) => (prev[dir] ? v > STICK_RELEASE : v > STICK_PUSH);
  // Only the dominant axis counts, so a diagonal push moves one way instead of two.
  const horizontal = Math.abs(x) >= Math.abs(y);
  return {
    [BTN.DPAD_UP]: !horizontal && held(BTN.DPAD_UP, -y),
    [BTN.DPAD_DOWN]: !horizontal && held(BTN.DPAD_DOWN, y),
    [BTN.DPAD_LEFT]: horizontal && held(BTN.DPAD_LEFT, -x),
    [BTN.DPAD_RIGHT]: horizontal && held(BTN.DPAD_RIGHT, x),
  };
}

export function useGamepad(actions: GamepadActions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const prevRef = useRef<{ buttons: boolean[]; l2Active: boolean; r2Active: boolean; radialOpen: boolean }>({
    buttons: [],
    l2Active: false,
    r2Active: false,
    radialOpen: false,
  });

  // D-pad hold state per direction, for hold-to-repeat.
  const holdRef = useRef<Record<number, HoldState | null>>({});
  const stickRef = useRef<Record<number, boolean>>({});

  useEffect(() => {
    let rafId: number;

    const poll = () => {
      const gp = navigator.getGamepads()[0];
      // Hidden behind a Steam game: that game has the pad. Keep the buttons' state so nothing held
      // while playing fires when AnthroDeck comes back.
      if (gp && !isShown()) prevRef.current = { ...prevRef.current, buttons: gp.buttons.map((b) => b.pressed) };
      else if (gp) {
        const { buttons: prevButtons, l2Active: prevL2, r2Active: prevR2, radialOpen: prevRadial } = prevRef.current;
        const acts = actionsRef.current;

        const pressed = (idx: number) => gp.buttons[idx]?.pressed ?? false;
        if (gp.buttons.some((b) => b.pressed) || gp.axes.some((a) => Math.abs(a) > STICK_DEADZONE * 2)) acts.onActivity?.();
        // L1 acts as a held modifier rather than its own action.
        const modifier = pressed(BTN.LB);

        // Face buttons (rising edge detection)
        if (pressed(BTN.A) && !prevButtons[BTN.A]) acts.onAPress?.(modifier);
        if (pressed(BTN.B) && !prevButtons[BTN.B]) acts.onBPress?.(modifier);
        if (pressed(BTN.X) && !prevButtons[BTN.X]) acts.onXPress?.(modifier);
        if (!pressed(BTN.X) && prevButtons[BTN.X]) acts.onXRelease?.();
        if (pressed(BTN.Y) && !prevButtons[BTN.Y]) acts.onYPress?.(modifier);
        if (pressed(BTN.START) && !prevButtons[BTN.START]) acts.onStartPress?.();
        if (pressed(BTN.RB) && !prevButtons[BTN.RB]) acts.onR1Press?.();

        // Stick clicks
        if (pressed(BTN.L3) && !prevButtons[BTN.L3]) acts.onL3Press?.();
        if (pressed(BTN.R3) && !prevButtons[BTN.R3]) acts.onR3Press?.();

        // D-pad (or the left stick): one step on press, then hold-to-repeat (lib/padRepeat), so long
        // lists and the Settings page don't take one press per row.
        const now = performance.now();
        const stick = stickDirections(gp.axes[LEFT_STICK_X] ?? 0, gp.axes[LEFT_STICK_Y] ?? 0, stickRef.current);
        stickRef.current = stick;
        const dpad: [number, (() => void) | undefined][] = [
          [BTN.DPAD_UP, acts.onDpadUp], [BTN.DPAD_DOWN, acts.onDpadDown],
          [BTN.DPAD_LEFT, acts.onDpadLeft], [BTN.DPAD_RIGHT, acts.onDpadRight],
        ];
        for (const [btn, fn] of dpad) {
          const r = holdFires(pressed(btn) || stick[btn], now, holdRef.current[btn] ?? null);
          holdRef.current[btn] = r.st;
          if (r.fire) fn?.();
        }

        // Radial menu — hold Select (Steam Input can map trackpad center-click here).
        const radialHeld = pressed(BTN.SELECT);
        if (radialHeld && !prevRadial) acts.onRadialOpen?.();
        if (radialHeld) acts.onRadialAim?.(gp.axes[RIGHT_STICK_X] ?? 0, gp.axes[RIGHT_STICK_Y] ?? 0);
        if (!radialHeld && prevRadial) acts.onRadialClose?.();

        // L2 trigger (value-based)
        const l2Val = gp.buttons[BTN.LT]?.value ?? 0;
        const l2Active = l2Val > L2_THRESHOLD;
        if (l2Active && !prevL2) acts.onL2Press?.();
        if (!l2Active && prevL2) acts.onL2Release?.();

        // R2 trigger — rising edge past the same threshold.
        const r2Active = (gp.buttons[BTN.RT]?.value ?? 0) > L2_THRESHOLD;
        if (r2Active && !prevR2) acts.onR2Press?.(modifier);

        // Right stick Y — scroll (suppressed while the radial is aiming)
        if (!radialHeld) {
          const ry = gp.axes[RIGHT_STICK_Y] ?? 0;
          if (Math.abs(ry) > STICK_DEADZONE) {
            acts.onScrollY?.(ry);
          }
        }

        prevRef.current = {
          buttons: gp.buttons.map((b) => b.pressed),
          l2Active,
          r2Active,
          radialOpen: radialHeld,
        };
      }

      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
