import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import { stateSnapshotFingerprint } from './fingerprint';
import { MAX_REPLAY_CHECKPOINTS, MAX_REPLAY_FRAMES, verifyReplay } from './replay';

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
  it('rejects unbounded replay frames and checkpoints', () => {
    const { state: _state, ...record } = make();
    expect(() => verifyReplay({ ...record, frames: Array(MAX_REPLAY_FRAMES + 1).fill(record.frames[0]) })).toThrow(/configured limits/);
    expect(() => verifyReplay({ ...record, checkpoints: Array(MAX_REPLAY_CHECKPOINTS + 1).fill(record.checkpoints[0]) })).toThrow(/configured limits/);
  });
  it('verifies every checkpoint and final state', () => {
    const { state, ...record } = make();
    const result = verifyReplay(record);
    expect(result.final.state).toEqual(state);
    expect(result.checked).toBe(record.checkpoints.length);
  });
  it('detects changed player input against a known-good checkpoint', () => {
    const { state: _state, ...record } = make();
    const frames = record.frames.map((frame, index) => index === 0
      ? { ...frame, inputs: [{ ...frame.inputs[0], moveX: 0 as const, punch: false }] }
      : frame);
    expect(() => verifyReplay({ ...record, frames })).toThrow(/Replay state mismatch/);
  });
  it('rejects malformed replay envelopes and null checkpoints', () => {
    const { state: _state, ...record } = make();
    expect(() => verifyReplay(null as unknown as typeof record)).toThrow(/malformed replay/);
    expect(() => verifyReplay({ ...record, frames: null } as unknown as typeof record)).toThrow(/malformed replay/);
    expect(() => verifyReplay({ ...record, checkpoints: [null] } as unknown as typeof record)).toThrow(/Invalid replay checkpoint/);
  });
  it('rejects repeated and malformed checkpoints', () => {
    const { state: _state, ...record } = make();
    expect(() => verifyReplay({ ...record, checkpoints: [record.checkpoints[0], record.checkpoints[0]] })).toThrow(/Invalid replay checkpoint/);
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: -1, fingerprint: '00000000' }] })).toThrow(/Invalid replay checkpoint/);
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: 0, fingerprint: 'not-a-hash' }] })).toThrow(/Invalid replay checkpoint/);
  });
  it('rejects corrupted checkpoints and skipped ticks', () => {
    const { state: _state, ...record } = make();
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: 30, fingerprint: '00000000' }] })).toThrow(/mismatch/);
    expect(() => verifyReplay({ ...record, frames: record.frames.slice(1) })).toThrow(/Non-contiguous/);
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: 999, fingerprint: '00000000' }] })).toThrow(/beyond replay/);
  });
});
