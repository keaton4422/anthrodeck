import { useEffect, useRef } from 'react';

interface GamepadActions {
  onL2Press?: () => void;
  onL2Release?: () => void;
  onAPress?: () => void;
  onBPress?: () => void;
  onXPress?: () => void;
  onYPress?: () => void;
  onStartPress?: () => void;
  onDpadUp?: () => void;
  onDpadDown?: () => void;
  onScrollY?: (delta: number) => void;
}

// Standard gamepad button indices
const BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
};
const L2_THRESHOLD = 0.5;
const STICK_DEADZONE = 0.15;
const RIGHT_STICK_Y = 3; // axis index

export function useGamepad(actions: GamepadActions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const prevRef = useRef<{ buttons: boolean[]; l2Active: boolean }>({
    buttons: [],
    l2Active: false,
  });

  useEffect(() => {
    let rafId: number;

    const poll = () => {
      const gp = navigator.getGamepads()[0];
      if (gp) {
        const { buttons: prevButtons, l2Active: prevL2 } = prevRef.current;
        const acts = actionsRef.current;

        // Face buttons (rising edge detection)
        const pressed = (idx: number) => gp.buttons[idx]?.pressed ?? false;
        if (pressed(BTN.A) && !prevButtons[BTN.A]) acts.onAPress?.();
        if (pressed(BTN.B) && !prevButtons[BTN.B]) acts.onBPress?.();
        if (pressed(BTN.X) && !prevButtons[BTN.X]) acts.onXPress?.();
        if (pressed(BTN.Y) && !prevButtons[BTN.Y]) acts.onYPress?.();
        if (pressed(BTN.START) && !prevButtons[BTN.START]) acts.onStartPress?.();

        // D-pad up/down (rising edge) — used to scroll the write-preview diff
        if (pressed(BTN.DPAD_UP) && !prevButtons[BTN.DPAD_UP]) acts.onDpadUp?.();
        if (pressed(BTN.DPAD_DOWN) && !prevButtons[BTN.DPAD_DOWN]) acts.onDpadDown?.();

        // L2 trigger (value-based)
        const l2Val = gp.buttons[BTN.LT]?.value ?? 0;
        const l2Active = l2Val > L2_THRESHOLD;
        if (l2Active && !prevL2) acts.onL2Press?.();
        if (!l2Active && prevL2) acts.onL2Release?.();

        // Right stick Y — scroll
        const ry = gp.axes[RIGHT_STICK_Y] ?? 0;
        if (Math.abs(ry) > STICK_DEADZONE) {
          acts.onScrollY?.(ry);
        }

        prevRef.current = {
          buttons: gp.buttons.map((b) => b.pressed),
          l2Active,
        };
      }

      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
