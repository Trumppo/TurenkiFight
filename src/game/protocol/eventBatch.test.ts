import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import {
  MAX_EVENT_BATCH_BYTES, MAX_EVENTS_PER_BATCH, MAX_EVENT_FIGHTERS,
  decodeEventBatch, encodeEventBatch, parseEventBatch,
} from './eventBatch';
import { MAX_SNAPSHOT_FIGHTERS } from './stateSnapshot';
import { MAX_PLAYERS_PER_FRAME } from './inputFrame';

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
  it('rejects events that are missing required fields', () => {
    for (const event of [
      { tick: 9, type: 'HitLanded', target: 'P2', move: 'punch' },
      { tick: 9, type: 'HitLanded', attacker: 'P1', target: 'P2' },
      { tick: 9, type: 'Respawned' },
      { tick: 9, type: 'Respawned', target: 'P2', move: 'punch' },
      { tick: 9, type: 'MatchStarted', attacker: 'P1' },
    ]) expect(() => parseEventBatch({ version: 1, tick: 9, events: [event] })).toThrow();
  });
  it('validates participant IDs against the session roster when supplied', () => {
    const batch = { version: 1 as const, tick: 9, events: [
      { tick: 9, type: 'HitLanded' as const, attacker: 'P1', target: 'P2', move: 'punch' as const },
    ] };
    const roster = new Set(['P1', 'P2']);
    expect(parseEventBatch(batch, roster)).toEqual(batch);
    expect(() => parseEventBatch({ ...batch, events: [{ ...batch.events[0], target: 'P3' }] }, roster)).toThrow();
    expect(() => parseEventBatch({ ...batch, events: [{ ...batch.events[0], attacker: 'P3' }] }, roster)).toThrow();
  });
  it('caps the event count before mapping the batch', () => {
    const events = Array.from({ length: MAX_EVENTS_PER_BATCH }, () => ({ tick: 9, type: 'MatchEnded' as const }));
    expect(parseEventBatch({ version: 1, tick: 9, events }).events).toHaveLength(MAX_EVENTS_PER_BATCH);
    expect(() => parseEventBatch({
      version: 1, tick: 9, events: [...events, { tick: 9, type: 'MatchEnded' as const }],
    })).toThrow(/event count/);
  });
  it('derives the event bound from the four-fighter roster limits', () => {
    expect(MAX_EVENT_FIGHTERS).toBe(MAX_SNAPSHOT_FIGHTERS);
    expect(MAX_EVENT_FIGHTERS).toBe(MAX_PLAYERS_PER_FRAME);
    expect(MAX_EVENTS_PER_BATCH).toBe(21);
  });
});
