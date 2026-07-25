import { useEffect, useRef } from 'react';

interface GamepadActions {
  onL2Press?: () => void;
  onL2Release?: () => void;
  // Face buttons receive whether the L1 chord modifier was held at press time.
  onAPress?: (modifier: boolean) => void;
  onBPress?: (modifier: boolean) => void;
  onXPress?: (modifier: boolean) => void;
  onYPress?: (modifier: boolean) => void;
  onStartPress?: () => void;
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

export function useGamepad(actions: GamepadActions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const prevRef = useRef<{ buttons: boolean[]; l2Active: boolean; radialOpen: boolean }>({
    buttons: [],
    l2Active: false,
    radialOpen: false,
  });

  useEffect(() => {
    let rafId: number;

    const poll = () => {
      const gp = navigator.getGamepads()[0];
      if (gp) {
        const { buttons: prevButtons, l2Active: prevL2, radialOpen: prevRadial } = prevRef.current;
        const acts = actionsRef.current;

        const pressed = (idx: number) => gp.buttons[idx]?.pressed ?? false;
        // L1 acts as a held modifier rather than its own action.
        const modifier = pressed(BTN.LB);

        // Face buttons (rising edge detection)
        if (pressed(BTN.A) && !prevButtons[BTN.A]) acts.onAPress?.(modifier);
        if (pressed(BTN.B) && !prevButtons[BTN.B]) acts.onBPress?.(modifier);
        if (pressed(BTN.X) && !prevButtons[BTN.X]) acts.onXPress?.(modifier);
        if (pressed(BTN.Y) && !prevButtons[BTN.Y]) acts.onYPress?.(modifier);
        if (pressed(BTN.START) && !prevButtons[BTN.START]) acts.onStartPress?.();

        // Stick clicks
        if (pressed(BTN.L3) && !prevButtons[BTN.L3]) acts.onL3Press?.();
        if (pressed(BTN.R3) && !prevButtons[BTN.R3]) acts.onR3Press?.();

        // D-pad (rising edge)
        if (pressed(BTN.DPAD_UP) && !prevButtons[BTN.DPAD_UP]) acts.onDpadUp?.();
        if (pressed(BTN.DPAD_DOWN) && !prevButtons[BTN.DPAD_DOWN]) acts.onDpadDown?.();
        if (pressed(BTN.DPAD_LEFT) && !prevButtons[BTN.DPAD_LEFT]) acts.onDpadLeft?.();
        if (pressed(BTN.DPAD_RIGHT) && !prevButtons[BTN.DPAD_RIGHT]) acts.onDpadRight?.();

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
          radialOpen: radialHeld,
        };
      }

      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
