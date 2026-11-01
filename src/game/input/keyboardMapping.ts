import type { PlayerInput } from '../simulation/types';

/**
 * Canonical keyboard layouts, extracted from `StationScene` so the local game
 * and the online entry send exactly the same controls. Codes are DOM
 * `KeyboardEvent.code` values; `StationScene` maps its Phaser keys onto them.
 *
 * P3 and P4 have no original keyboard layout in the local prototype, so they
 * deliberately reuse P1's layout rather than inventing a new scheme. The online
 * page states which layout is in use.
 */
export type KeyboardLayout = {
  readonly moveX: readonly [string, string];
  readonly moveY: readonly [string, string];
  readonly jump: string;
  readonly punch: string;
  readonly kick: string;
  readonly jumpkick: string;
};

export const KEYBOARD_LAYOUTS: Readonly<Record<'P1' | 'P2', KeyboardLayout>> = {
  P1: {
    moveX: ['KeyA', 'KeyD'],
    moveY: ['KeyW', 'KeyS'],
    jump: 'Space',
    punch: 'KeyF',
    kick: 'KeyG',
    jumpkick: 'KeyH',
  },
  P2: {
    moveX: ['ArrowLeft', 'ArrowRight'],
    moveY: ['ArrowUp', 'ArrowDown'],
    jump: 'KeyK',
    punch: 'KeyL',
    kick: 'KeyJ',
    jumpkick: 'KeyU',
  },
};

export function keyboardLayoutFor(playerId: string): KeyboardLayout {
  return KEYBOARD_LAYOUTS[playerId === 'P2' ? 'P2' : 'P1'];
}

export function keyboardPlayerInput(
  playerId: string,
  isDown: (code: string) => boolean,
): PlayerInput {
  const layout = keyboardLayoutFor(playerId);
  return {
    playerId,
    moveX: axis(isDown(layout.moveX[0]), isDown(layout.moveX[1])),
    moveY: axis(isDown(layout.moveY[0]), isDown(layout.moveY[1])),
    jump: isDown(layout.jump),
    punch: isDown(layout.punch),
    kick: isDown(layout.kick),
    jumpkick: isDown(layout.jumpkick),
  };
}

/** Both directions cancel; the simulation expects -1, 0 or 1. */
export function axis(negative: boolean, positive: boolean): -1 | 0 | 1 {
  if (negative === positive) return 0;
  return negative ? -1 : 1;
}
