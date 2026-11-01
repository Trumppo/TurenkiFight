import { describe, expect, it } from 'vitest';
import { createState } from '../src/game/simulation/step';
import type { StateSnapshot } from '../src/game/protocol/stateSnapshot';
import {
  interpolateTimedSnapshots,
  type TimedSnapshot,
} from '../src/game/networking/snapshotInterpolation';
import { KEYBOARD_LAYOUTS, keyboardPlayerInput } from '../src/game/input/keyboardMapping';

function snapshotAt(tick: number, x: number, receivedAt: number): TimedSnapshot {
  const state = createState(['P1', 'P2'], 'fighting');
  state.tick = tick;
  state.fighters[0]!.x = x;
  state.fighters[0]!.health = 100 - tick;
  state.fighters[1]!.x = 314;
  const snapshot: StateSnapshot = { version: 1, state };
  return { snapshot, receivedAt };
}

function pressed(...codes: string[]): (code: string) => boolean {
  const set = new Set(codes);
  return code => set.has(code);
}

describe('snapshot interpolation', () => {
  it('returns the only snapshot unchanged before a second one arrives', () => {
    const current = snapshotAt(3, 80, 1000);
    const state = interpolateTimedSnapshots(null, current, 1200);
    expect(state.tick).toBe(3);
    expect(state.fighters[0]!.x).toBe(80);
    expect(state.fighters[0]!.health).toBe(97);
  });

  it('interpolates positions only and keeps authoritative fields from the newest snapshot', () => {
    const previous = snapshotAt(3, 70, 1000);
    const current = snapshotAt(6, 100, 1050);
    const state = interpolateTimedSnapshots(previous, current, 1075);
    expect(state.tick).toBe(6);
    expect(state.fighters[0]!.x).toBeCloseTo(85, 6);
    expect(state.fighters[0]!.health).toBe(94);
  });

  it('uses the announced snapshot interval so a stall recovers over one interval', () => {
    const previous = snapshotAt(3, 70, 1000);
    // Arrival gap is 2 s, but the server still emits at 20 Hz.
    const current = snapshotAt(6, 100, 3000);
    const state = interpolateTimedSnapshots(previous, current, 3025, 50);
    expect(state.fighters[0]!.x).toBeCloseTo(85, 6);
  });

  it('clamps before and after the snapshot pair instead of extrapolating', () => {
    const previous = snapshotAt(3, 70, 1000);
    const current = snapshotAt(6, 100, 1050);
    expect(interpolateTimedSnapshots(previous, current, 900).fighters[0]!.x).toBe(70);
    expect(interpolateTimedSnapshots(previous, current, 5000).fighters[0]!.x).toBe(100);
  });

  it('uses the newest position for a fighter absent from the previous snapshot', () => {
    const previous = snapshotAt(3, 70, 1000);
    previous.snapshot.state.fighters = previous.snapshot.state.fighters.slice(0, 1);
    const current = snapshotAt(6, 100, 1050);
    const state = interpolateTimedSnapshots(previous, current, 1025);
    expect(state.fighters.map(fighter => fighter.id)).toEqual(['P1', 'P2']);
    expect(state.fighters[1]!.x).toBe(314);
  });

  it('does not mutate either input snapshot', () => {
    const previous = snapshotAt(3, 70, 1000);
    const current = snapshotAt(6, 100, 1050);
    const before = JSON.stringify({ previous, current });
    interpolateTimedSnapshots(previous, current, 1025);
    expect(JSON.stringify({ previous, current })).toBe(before);
  });
});

describe('canonical keyboard mapping', () => {
  it('maps P1 exactly like the local game', () => {
    expect(keyboardPlayerInput('P1', pressed('KeyD', 'KeyS', 'Space', 'KeyF', 'KeyG', 'KeyH')))
      .toEqual({
        playerId: 'P1', moveX: 1, moveY: 1, jump: true,
        punch: true, kick: true, jumpkick: true,
      });
    expect(keyboardPlayerInput('P1', pressed('KeyA', 'KeyW')))
      .toEqual({
        playerId: 'P1', moveX: -1, moveY: -1, jump: false,
        punch: false, kick: false, jumpkick: false,
      });
  });

  it('maps P2 exactly like the local game', () => {
    expect(KEYBOARD_LAYOUTS.P2.moveX).toEqual(['ArrowLeft', 'ArrowRight']);
    expect(keyboardPlayerInput('P2', pressed('ArrowRight', 'ArrowDown', 'KeyK', 'KeyL', 'KeyJ', 'KeyU')))
      .toEqual({
        playerId: 'P2', moveX: 1, moveY: 1, jump: true,
        punch: true, kick: true, jumpkick: true,
      });
  });

  it('cancels opposite directions like the existing axis helper', () => {
    expect(keyboardPlayerInput('P1', pressed('KeyA', 'KeyD', 'KeyW', 'KeyS'))).toMatchObject({
      moveX: 0,
      moveY: 0,
    });
  });

  it('uses the documented P1 fallback for slots without their own layout', () => {
    expect(keyboardPlayerInput('P4', pressed('KeyD'))).toMatchObject({ playerId: 'P4', moveX: 1 });
  });
});
