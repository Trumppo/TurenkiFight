import type { PlayerInput } from '../simulation/types';
import { axis } from './keyboardMapping';

/**
 * Standard-mapping gamepad buttons (browser Gamepad API indices). Physical
 * labels vary by controller, so the guide names both the index and the common
 * Xbox-style label.
 *
 * The four face buttons 0-3 already carry jump and the three attacks, and 8/9
 * are join/start. `grab` therefore uses the left shoulder (button 4 / LB): it
 * is unused, reachable without moving the thumb off the attack buttons, and a
 * conventional pickup/throw placement in beat-em-ups.
 */
export const GAMEPAD_BUTTONS = {
  jump: 0,
  kick: 1,
  punch: 2,
  jumpkick: 3,
  grab: 4,
  join: 8,
  start: 9,
} as const;

/**
 * Minimal structural shape of a browser `Gamepad` so the mapping can be tested
 * headlessly without a controller or a DOM. `Gamepad` itself is assignable.
 */
export type GamepadLike = {
  readonly axes: ArrayLike<number>;
  readonly buttons: ReadonlyArray<{ readonly pressed?: boolean } | undefined>;
};

const down = (pad: GamepadLike, button: number): boolean => !!pad.buttons[button]?.pressed;

/** Normalize one physical pad into the shared logical input contract. */
export function gamepadPlayerInput(playerId: string, pad: GamepadLike): PlayerInput {
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  return {
    playerId,
    moveX: axis(x < -0.3, x > 0.3),
    moveY: axis(y < -0.3, y > 0.3),
    jump: down(pad, GAMEPAD_BUTTONS.jump),
    punch: down(pad, GAMEPAD_BUTTONS.punch),
    kick: down(pad, GAMEPAD_BUTTONS.kick),
    jumpkick: down(pad, GAMEPAD_BUTTONS.jumpkick),
    grab: down(pad, GAMEPAD_BUTTONS.grab),
  };
}
