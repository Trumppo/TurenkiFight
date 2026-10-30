import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import { stateSnapshotFingerprint } from './fingerprint';
import { verifyReplay } from './replay';

describe('M2 replay verification', () => {
  const make = () => {
    let state = createState(['P1', 'P2'], 'fighting');
    const initial = { version: 1 as const, state };
    const frames = [];
    const checkpoints = [{ tick: state.tick, fingerprint: stateSnapshotFingerprint(initial) }];
    for (let i = 0; i < 120; i++) {
      const frame = { version: 1 as const, tick: state.tick, inputs: [
        { playerId: 'P1', moveX: (i % 2 === 0 ? 1 : -1) as -1 | 1, moveY: 0 as const, jump: false, punch: i % 30 === 0 },
      ] };
      frames.push(frame);
      state = step(state, frame.inputs);
      if (i % 30 === 29) checkpoints.push({ tick: state.tick, fingerprint: stateSnapshotFingerprint({ version: 1, state }) });
    }
    return { version: 1 as const, initial, frames, checkpoints, state };
  };
  it('verifies every checkpoint and final state', () => {
    const { state, ...record } = make();
    const result = verifyReplay(record);
    expect(result.final.state).toEqual(state);
    expect(result.checked).toBe(record.checkpoints.length);
  });
  it('rejects corrupted checkpoints and skipped ticks', () => {
    const { state: _state, ...record } = make();
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: 30, fingerprint: '00000000' }] })).toThrow(/mismatch/);
    expect(() => verifyReplay({ ...record, frames: record.frames.slice(1) })).toThrow(/Non-contiguous/);
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: 999, fingerprint: '00000000' }] })).toThrow(/beyond replay/);
  });
});
