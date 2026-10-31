import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import { restoreBufferedSimulation } from './restoreBufferedSimulation';
import { stepBuffered } from './stepBuffered';

describe('M2 buffered simulation restoration', () => {
  it('continues deterministically from a snapshot without aliasing original state', () => {
    let state = createState(['P1', 'P2'], 'fighting');
    const neutral = ['P1', 'P2'].map(playerId => ({ playerId, moveX: 0 as const, moveY: 0 as const, jump: false }));
    for (let tick = 0; tick < 30; tick++) state = step(state, neutral);
    const snapshot = { version: 1 as const, state };
    const restored = restoreBufferedSimulation(snapshot);
    expect(restored.buffer.tick).toBe(30);
    expect(restored.state).toEqual(state);
    expect(restored.state).not.toBe(state);
    restored.state.fighters[0].health = 90;
    expect(state.fighters[0].health).toBe(100);
    restored.state.fighters[0].health = 100;
    let direct = state;
    let buffered = restored.state;
    for (let tick = 30; tick < 90; tick++) {
      direct = step(direct, neutral);
      buffered = stepBuffered(buffered, restored.buffer);
      expect(buffered).toEqual(direct);
    }
  });

  it('rejects invalid snapshot before allocating a buffer', () => {
    expect(() => restoreBufferedSimulation({ version: 1, state: { tick: -1 } } as never)).toThrow(/Malformed/);
  });
});
