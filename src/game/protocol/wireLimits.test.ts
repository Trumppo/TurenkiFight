import { describe, expect, it } from 'vitest';
import { decodeInputFrame, encodeInputFrame, MAX_INPUT_FRAME_BYTES } from './inputFrame';
import { decodeStateSnapshot, encodeStateSnapshot, MAX_SNAPSHOT_BYTES } from './stateSnapshot';
import { createState } from '../simulation/step';

describe('M2 codec ingress and egress limits', () => {
  it('rejects oversized input JSON before parsing', () => {
    expect(() => decodeInputFrame(' '.repeat(MAX_INPUT_FRAME_BYTES + 1))).toThrow(/size limit/);
  });
  it('rejects oversized snapshot JSON before parsing', () => {
    expect(() => decodeStateSnapshot(' '.repeat(MAX_SNAPSHOT_BYTES + 1))).toThrow(/size limit/);
  });
  it('accepts valid messages under both limits', () => {
    const input = { version: 1 as const, tick: 1, inputs: [{ playerId: 'P1', moveX: 0 as const, moveY: 0 as const, jump: false }] };
    expect(decodeInputFrame(encodeInputFrame(input))).toEqual(input);
    const snapshot = { version: 1 as const, state: createState(['P1']) };
    expect(decodeStateSnapshot(encodeStateSnapshot(snapshot))).toEqual(snapshot);
  });
});
