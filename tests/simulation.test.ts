import { describe, expect, it } from 'vitest';
import { createState, step } from '../src/game/simulation/step';

describe('deterministic fighter simulation', () => {
  it('advances by one fixed tick without mutating previous state', () => {
    const original = createState();
    const next = step(original, [{ playerId: 'P1', moveX: 1, moveY: 0, jump: false, attack: false }]);
    expect(next.tick).toBe(1);
    expect(next.fighters[0].x).toBeGreaterThan(original.fighters[0].x);
    expect(original.tick).toBe(0);
  });

  it('returns the same result from the same state and inputs', () => {
    const state = createState();
    const input = [{ playerId: 'P1', moveX: 1 as const, moveY: 0 as const, jump: false, attack: false }];
    expect(step(state, input)).toEqual(step(state, input));
  });

  it('keeps players within arena bounds', () => {
    let state = createState();
    const input = [{ playerId: 'P1', moveX: -1 as const, moveY: -1 as const, jump: false, attack: false }];
    for (let i = 0; i < 500; i++) state = step(state, input);
    expect(state.fighters[0].x).toBe(16);
    expect(state.fighters[0].y).toBe(124);
  });
});
