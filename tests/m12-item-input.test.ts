import { describe, expect, it } from 'vitest';
import { KEYBOARD_LAYOUTS, keyboardPlayerInput } from '../src/game/input/keyboardMapping';
import { GAMEPAD_BUTTONS, gamepadPlayerInput, type GamepadLike } from '../src/game/input/gamepadMapping';

function pressed(...codes: string[]): (code: string) => boolean {
  const set = new Set(codes);
  return code => set.has(code);
}

function pad(buttons: number[] = [], axes: [number, number] = [0, 0]): GamepadLike {
  const pressedButtons = new Set(buttons);
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressedButtons.has(index) })),
  };
}

describe('M12 grab keyboard mapping', () => {
  it('maps P1 T to grab and changes nothing else', () => {
    expect(keyboardPlayerInput('P1', pressed('KeyT'))).toEqual({
      playerId: 'P1',
      moveX: 0, moveY: 0,
      jump: false, punch: false, kick: false, jumpkick: false,
      grab: true,
    });
  });

  it('maps P2 I to grab and changes nothing else', () => {
    expect(keyboardPlayerInput('P2', pressed('KeyI'))).toEqual({
      playerId: 'P2',
      moveX: 0, moveY: 0,
      jump: false, punch: false, kick: false, jumpkick: false,
      grab: true,
    });
  });

  it('keeps the existing P1 and P2 bindings unchanged', () => {
    expect(KEYBOARD_LAYOUTS.P1).toEqual({
      moveX: ['KeyA', 'KeyD'],
      moveY: ['KeyW', 'KeyS'],
      jump: 'Space',
      punch: 'KeyF',
      kick: 'KeyG',
      jumpkick: 'KeyH',
      grab: 'KeyT',
    });
    expect(KEYBOARD_LAYOUTS.P2).toEqual({
      moveX: ['ArrowLeft', 'ArrowRight'],
      moveY: ['ArrowUp', 'ArrowDown'],
      jump: 'KeyK',
      punch: 'KeyL',
      kick: 'KeyJ',
      jumpkick: 'KeyU',
      grab: 'KeyI',
    });
  });

  it('does not let P1 and P2 share a grab key', () => {
    // A shared key would give both players the same edge on the same tick.
    expect(keyboardPlayerInput('P1', pressed('KeyI')).grab).toBe(false);
    expect(keyboardPlayerInput('P2', pressed('KeyT')).grab).toBe(false);
  });

  it('applies the P1 layout to keyboard slots without their own layout', () => {
    const input = keyboardPlayerInput('P3', pressed('KeyT'));
    expect(input).toMatchObject({ playerId: 'P3', grab: true });
  });
});

describe('M12 grab gamepad mapping', () => {
  it('maps the left shoulder (button 4) to grab and changes nothing else', () => {
    expect(GAMEPAD_BUTTONS.grab).toBe(4);
    expect(gamepadPlayerInput('P2', pad([GAMEPAD_BUTTONS.grab]))).toEqual({
      playerId: 'P2',
      moveX: 0, moveY: 0,
      jump: false, punch: false, kick: false, jumpkick: false,
      grab: true,
    });
  });

  it('keeps the existing gamepad face-button bindings unchanged', () => {
    expect(gamepadPlayerInput('P2', pad([0]))).toMatchObject({ jump: true, punch: false, kick: false, jumpkick: false, grab: false });
    expect(gamepadPlayerInput('P2', pad([1]))).toMatchObject({ jump: false, punch: false, kick: true, jumpkick: false, grab: false });
    expect(gamepadPlayerInput('P2', pad([2]))).toMatchObject({ jump: false, punch: true, kick: false, jumpkick: false, grab: false });
    expect(gamepadPlayerInput('P2', pad([3]))).toMatchObject({ jump: false, punch: false, kick: false, jumpkick: true, grab: false });
  });

  it('does not confuse grab with join or start', () => {
    expect(gamepadPlayerInput('P2', pad([GAMEPAD_BUTTONS.join])).grab).toBe(false);
    expect(gamepadPlayerInput('P2', pad([GAMEPAD_BUTTONS.start])).grab).toBe(false);
  });

  it('maps the left stick with the same thresholds as the existing scene code', () => {
    expect(gamepadPlayerInput('P1', pad([], [-0.31, 0.31]))).toMatchObject({ moveX: -1, moveY: 1 });
    expect(gamepadPlayerInput('P1', pad([], [-0.3, 0.3]))).toMatchObject({ moveX: 0, moveY: 0 });
  });
});
