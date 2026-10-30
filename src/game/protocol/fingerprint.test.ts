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
  it('enforces UTF-8 byte limits, not JavaScript character count', () => {
    assertWireSize('x'.repeat(MAX_INPUT_FRAME_BYTES), 'input');
    expect(() => assertWireSize('x'.repeat(MAX_INPUT_FRAME_BYTES + 1), 'input')).toThrow();
    expect(() => assertWireSize('ä'.repeat(MAX_INPUT_FRAME_BYTES / 2 + 1), 'input')).toThrow();
  });
});
