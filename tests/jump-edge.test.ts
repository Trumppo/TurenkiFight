import { expect, test } from 'vitest';
import { createState, step } from '../src/game/simulation/step';

test('jump only triggers on a fresh press after landing', () => {
  let state = createState(['P1', 'P2'], 'fighting');
  const held = [{ playerId: 'P1', moveX: 0 as const, moveY: 0 as const, jump: true }];
  let takeoffs = 0;
  let prior = 0;
  for (let i = 0; i < 180; i++) {
    state = step(state, held);
    const z = state.fighters[0].z;
    if (prior === 0 && z > 0) takeoffs++;
    prior = z;
  }
  expect(takeoffs).toBe(1);
  state = step(state, [{ ...held[0], jump: false }]);
  state = step(state, held);
  expect(state.fighters[0].z).toBeGreaterThan(0);
});
