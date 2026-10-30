import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import { decodeEventBatch, encodeEventBatch, MAX_EVENT_BATCH_BYTES, parseEventBatch } from './eventBatch';

describe('M2 EventBatch v1', () => {
  it('round trips real simulation lifecycle events', () => {
    const state = createState(['P1', 'P2'], 'countdown');
    const start = step({ ...state, countdownTicks: 1 }, []);
    const batch = { version: 1 as const, tick: start.tick, events: start.events };
    expect(decodeEventBatch(encodeEventBatch(batch))).toEqual(batch);
  });
  it('accepts valid hit, knockout and respawn events', () => {
    const batch = { version: 1 as const, tick: 9, events: [
      { tick: 9, type: 'HitLanded' as const, attacker: 'P1', target: 'P2', move: 'kick' as const },
      { tick: 9, type: 'Knockout' as const, attacker: 'P1', target: 'P2' },
      { tick: 9, type: 'Respawned' as const, target: 'P2' },
    ] };
    expect(decodeEventBatch(encodeEventBatch(batch))).toEqual(batch);
  });
  it('rejects invalid versions, mismatched ticks, and illegal event fields', () => {
    const event = { tick: 9, type: 'Knockout', attacker: 'P1', target: 'P2' };
    for (const bad of [
      { version: 2, tick: 9, events: [event] },
      { version: 1, tick: 8, events: [event] },
      { version: 1, tick: 9, events: [{ ...event, move: 'kick' }] },
      { version: 1, tick: 9, events: [{ ...event, target: 'P1' }] },
      { version: 1, tick: 9, events: [{ tick: 9, type: 'MatchEnded', attacker: 'P1' }] },
    ]) expect(() => parseEventBatch(bad)).toThrow();
    expect(() => decodeEventBatch(' '.repeat(MAX_EVENT_BATCH_BYTES + 1))).toThrow(/size limit/);
  });
});
