import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import { decodeStateSnapshot, encodeStateSnapshot, parseStateSnapshot } from './stateSnapshot';

describe('M2 StateSnapshot v1', () => {
  it('round-trips a complete state with fighters and events', () => {
    const state = step(createState(['P1', 'P2'], 'countdown'), []);
    const encoded = encodeStateSnapshot({ version: 1, state });
    expect(decodeStateSnapshot(encoded)).toEqual({ version: 1, state });
  });
  it('rejects unsupported versions, duplicate players and invalid numbers', () => {
    const state = createState(['P1', 'P2'], 'fighting');
    for (const bad of [
      { version: 2, state },
      { version: 1, state: { ...state, tick: -1 } },
      { version: 1, state: { ...state, fighters: [state.fighters[0], state.fighters[0]] } },
      { version: 1, state: { ...state, fighters: [{ ...state.fighters[0], x: Infinity }] } },
      { version: 1, state: { ...state, events: [{ tick: 999, type: 'MatchEnded' }] } },
      { version: 1, state: { ...state, unexpected: true } },
    ]) expect(() => parseStateSnapshot(bad)).toThrow();
  });
  it('rejects oversized roster, event history and button state', () => {
    const state = createState(['P1', 'P2', 'P3', 'P4'], 'fighting');
    const fifth = { ...state.fighters[0], id: 'P5' };
    const event = { tick: state.tick, type: 'MatchStarted' as const };
    for (const bad of [
      { ...state, fighters: [...state.fighters, fifth] },
      { ...state, events: Array(65).fill(event) },
      { ...state, fighters: [{ ...state.fighters[0], previousButtons: Array.from({ length: 9 }, (_, i) => 'button' + i) }] },
    ]) expect(() => parseStateSnapshot({ version: 1, state: bad })).toThrow();
  });
  it('preserves simulation state and deterministic replay after restore', () => {
    const inputs = [{ playerId: 'P1', moveX: 1 as const, moveY: 0 as const, jump: false, punch: true }];
    let original = createState(['P1', 'P2'], 'fighting');
    for (let tick = 0; tick < 30; tick++) original = step(original, tick === 0 ? inputs : []);
    let restored = decodeStateSnapshot(encodeStateSnapshot({ version: 1, state: original })).state;
    for (let tick = 0; tick < 120; tick++) {
      original = step(original, tick % 40 === 0 ? inputs : []);
      restored = step(restored, tick % 40 === 0 ? inputs : []);
    }
    expect(restored).toEqual(original);
    expect(encodeStateSnapshot({ version: 1, state: restored })).toBe(encodeStateSnapshot({ version: 1, state: original }));
  });
});
