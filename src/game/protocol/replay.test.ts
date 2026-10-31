import { describe, expect, it } from 'vitest';
import { MOVES, createState, step } from '../simulation/step';
import { stateSnapshotFingerprint } from './fingerprint';
import { MAX_SNAPSHOT_TICK } from './stateSnapshot';
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
  it('fails closed instead of returning an unencodable final state', () => {
    const terminal = { ...createState(['P1'], 'fighting'), tick: MAX_SNAPSHOT_TICK };
    expect(() => verifyReplay({
      version: 1,
      initial: { version: 1, state: terminal },
      frames: [{ version: 1, tick: MAX_SNAPSHOT_TICK, inputs: [] }],
      checkpoints: [],
    })).toThrow(/not encodable/);

    const base = createState(['P1', 'P2'], 'fighting');
    const punchFrames = MOVES.punch.active + MOVES.punch.recovery;
    const counter = {
      ...base,
      fighters: [
        { ...base.fighters[0], x: 100, y: 148, facing: 1 as const, attackMove: 'punch' as const, attackFrames: punchFrames, attackCooldown: punchFrames },
        { ...base.fighters[1], x: 120, y: 148, hitsReceived: Number.MAX_SAFE_INTEGER - 3 },
      ],
    };
    expect(() => verifyReplay({
      version: 1,
      initial: { version: 1, state: counter },
      frames: [{ version: 1, tick: 0, inputs: [] }],
      checkpoints: [],
    })).toThrow(/not encodable/);
  });
  it('rejects unknown replay envelope and checkpoint fields', () => {
    const { state: _state, ...record } = make();
    expect(() => verifyReplay({ ...record, unexpected: true } as unknown as typeof record)).toThrow(/malformed replay/);
    expect(() => verifyReplay({ ...record, checkpoints: [{ ...record.checkpoints[0], unexpected: true }] } as unknown as typeof record)).toThrow(/Invalid replay checkpoint/);
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: 0 }] } as unknown as typeof record)).toThrow(/Invalid replay checkpoint/);
  });
  it('rejects repeated and malformed checkpoints', () => {
    const { state: _state, ...record } = make();
    expect(() => verifyReplay({ ...record, checkpoints: [record.checkpoints[0], record.checkpoints[0]] })).toThrow(/Invalid replay checkpoint/);
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: -1, fingerprint: '00000000' }] })).toThrow(/Invalid replay checkpoint/);
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: 0, fingerprint: 'not-a-hash' }] })).toThrow(/Invalid replay checkpoint/);
  });
  it('rejects non-string checkpoint fingerprints before pattern coercion', () => {
    const { state: _state, ...record } = make();
    for (const malformed of [12345678, { toString: () => 'abcdef01' }, new String('abcdef01'), ['abcdef01'], null]) {
      expect(() => verifyReplay({
        ...record,
        checkpoints: [{ tick: 0, fingerprint: malformed }],
      } as unknown as typeof record)).toThrow(/Invalid replay checkpoint/);
    }
  });
  it('rejects corrupted checkpoints and skipped ticks', () => {
    const { state: _state, ...record } = make();
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: 30, fingerprint: '00000000' }] })).toThrow(/mismatch/);
    expect(() => verifyReplay({ ...record, frames: record.frames.slice(1) })).toThrow(/Non-contiguous/);
    expect(() => verifyReplay({ ...record, checkpoints: [{ tick: 999, fingerprint: '00000000' }] })).toThrow(/beyond replay/);
  });
});
