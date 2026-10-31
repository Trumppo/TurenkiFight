import type { InputFrame } from './inputFrame';
import type { StateSnapshot } from './stateSnapshot';
import { decodeInputFrame, encodeInputFrame } from './inputFrame';
import { decodeStateSnapshot, encodeStateSnapshot, assertEncodableState } from './stateSnapshot';
import { stateSnapshotFingerprint } from './fingerprint';
import { step } from '../simulation/step';

export const REPLAY_VERSION = 1 as const;
export const MAX_REPLAY_FRAMES = 7200;
export const MAX_REPLAY_CHECKPOINTS = 7201;
export type ReplayRecord = {
  version: typeof REPLAY_VERSION;
  initial: StateSnapshot;
  frames: InputFrame[];
  checkpoints: { tick: number; fingerprint: string }[];
};
export type ReplayResult = { final: StateSnapshot; checked: number };

const fingerprint = /^[0-9a-f]{8}$/;

export function verifyReplay(record: ReplayRecord): ReplayResult {
  if (!record || typeof record !== 'object' || record.version !== REPLAY_VERSION ||
      !Array.isArray(record.frames) || !Array.isArray(record.checkpoints) ||
      Object.keys(record).some(key => !['version', 'initial', 'frames', 'checkpoints'].includes(key)) ||
      Object.keys(record).length !== 4) {
    throw new Error('Unsupported or malformed replay record');
  }
  if (record.frames.length > MAX_REPLAY_FRAMES || record.checkpoints.length > MAX_REPLAY_CHECKPOINTS) {
    throw new Error('Replay exceeds configured limits');
  }
  let state = decodeStateSnapshot(encodeStateSnapshot(record.initial)).state;
  const checkpoints = new Map<number, string>();
  for (const point of record.checkpoints) {
    if (!point || typeof point !== 'object' || Array.isArray(point) ||
        Object.keys(point).length !== 2 ||
        Object.keys(point).some(key => !['tick', 'fingerprint'].includes(key)) ||
        !Number.isSafeInteger(point.tick) || point.tick < state.tick ||
        typeof point.fingerprint !== 'string' || !fingerprint.test(point.fingerprint) ||
        checkpoints.has(point.tick)) throw new Error('Invalid replay checkpoint');
    checkpoints.set(point.tick, point.fingerprint);
  }
  const check = () => {
    const expected = checkpoints.get(state.tick);
    if (expected !== undefined && expected !== stateSnapshotFingerprint({ version: 1, state })) {
      throw new Error('Replay state mismatch at tick ' + state.tick);
    }
  };
  check();
  for (const input of record.frames) {
    const frame = decodeInputFrame(encodeInputFrame(input));
    if (frame.tick !== state.tick) throw new Error('Non-contiguous replay input tick');
    state = step(state, frame.inputs);
    // Fail closed on the first step result the snapshot codec would reject,
    // instead of continuing with an untransportable state.
    assertEncodableState(state);
    check();
  }
  if ([...checkpoints.keys()].some(tick => tick > state.tick)) throw new Error('Checkpoint beyond replay end');
  assertEncodableState(state);
  return { final: { version: 1, state }, checked: checkpoints.size };
}
