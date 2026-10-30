import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import { assertWireSize, fingerprintUtf8, inputFrameFingerprint, MAX_INPUT_FRAME_BYTES, stateSnapshotFingerprint } from './fingerprint';

describe('M2 replay fingerprints and limits', () => {
  it('matches the standard FNV-1a UTF-8 test vector', () => {
    expect(fingerprintUtf8('hello')).toBe('4f9f2cab');
  });
  it('is independent of player input arrival order', () => {
    const a = { version: 1 as const, tick: 12, inputs: [
      { playerId: 'P2', moveX: 0 as const, moveY: 0 as const, jump: false },
      { playerId: 'P1', moveX: 1 as const, moveY: 0 as const, jump: true },
    ] };
    expect(inputFrameFingerprint(a)).toBe(inputFrameFingerprint({ ...a, inputs: [...a.inputs].reverse() }));
  });
  it('detects state changes and is reproducible after JSON restore', () => {
    const state = createState(['P1', 'P2'], 'fighting');
    const first = stateSnapshotFingerprint({ version: 1, state });
    const second = stateSnapshotFingerprint({ version: 1, state: step(state, []) });
    expect(first).not.toBe(second);
    expect(first).toBe(stateSnapshotFingerprint({ version: 1, state: JSON.parse(JSON.stringify(state)) }));
  });
  it('ignores object insertion order when fingerprinting the same state', () => {
    const state = createState(['P1', 'P2'], 'fighting');
    const reordered = Object.fromEntries(Object.entries(state).reverse()) as unknown as typeof state;
    const fighter = Object.fromEntries(Object.entries(state.fighters[0]).reverse()) as unknown as typeof state.fighters[number];
    reordered.fighters = [fighter, ...state.fighters.slice(1)];
    expect(stateSnapshotFingerprint({ version: 1, state })).toBe(
      stateSnapshotFingerprint({ version: 1, state: reordered }),
    );
  });
  it('canonicalizes nested event field order without reordering events', () => {
    const state = createState(['P1', 'P2'], 'fighting');
    const event = { tick: state.tick, type: 'HitLanded' as const, attacker: 'P1', target: 'P2', move: 'punch' as const };
    const events = [event, { ...event, attacker: 'P2', target: 'P1' }];
    const original = { ...state, events };
    const reordered = { ...original, events: events.map(e =>
      Object.fromEntries(Object.entries(e).reverse()) as typeof event,
    ) };
    expect(stateSnapshotFingerprint({ version: 1, state: original })).toBe(
      stateSnapshotFingerprint({ version: 1, state: reordered }),
    );
    expect(stateSnapshotFingerprint({ version: 1, state: { ...original, events: [...events].reverse() } })).not.toBe(
      stateSnapshotFingerprint({ version: 1, state: original }),
    );
  });
  it('enforces UTF-8 byte limits, not JavaScript character count', () => {
    assertWireSize('x'.repeat(MAX_INPUT_FRAME_BYTES), 'input');
    expect(() => assertWireSize('x'.repeat(MAX_INPUT_FRAME_BYTES + 1), 'input')).toThrow();
    expect(() => assertWireSize('ä'.repeat(MAX_INPUT_FRAME_BYTES / 2 + 1), 'input')).toThrow();
  });
});
