import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import { decodeInputFrame, encodeInputFrame } from './inputFrame';
import { decodeStateSnapshot, encodeStateSnapshot } from './stateSnapshot';
import { decodeEventBatch, encodeEventBatch } from './eventBatch';
import { stateSnapshotFingerprint } from './fingerprint';

describe('M2 integrated protocol replay', () => {
  it('reproduces four-player state and ordered events over 240 ticks', () => {
    const ids = ['P1', 'P2', 'P3', 'P4'];
    let direct = createState(ids, 'fighting');
    let viaWire = decodeStateSnapshot(encodeStateSnapshot({ version: 1, state: direct })).state;
    const observed: string[] = [];
    for (let tick = 0; tick < 240; tick++) {
      const inputs = ids.map((playerId, index) => ({
        playerId, moveX: ((tick + index) % 3 - 1) as -1 | 0 | 1,
        moveY: (index % 2 === 0 ? 0 : 1) as 0 | 1,
        jump: tick % 61 === index,
        punch: tick % 29 === index,
        kick: tick % 37 === index,
      }));
      const decoded = decodeInputFrame(encodeInputFrame({ version: 1, tick, inputs: [...inputs].reverse() }));
      direct = step(direct, inputs);
      viaWire = step(viaWire, decoded.inputs);
      const batch = { version: 1 as const, tick: direct.tick, events: direct.events };
      const transmitted = decodeEventBatch(encodeEventBatch(batch));
      expect(transmitted.events).toEqual(viaWire.events);
      observed.push(stateSnapshotFingerprint({ version: 1, state: direct }));
      expect(stateSnapshotFingerprint({ version: 1, state: viaWire })).toBe(observed[tick]);
      if (tick % 60 === 59) viaWire = decodeStateSnapshot(encodeStateSnapshot({ version: 1, state: viaWire })).state;
    }
    expect(viaWire).toEqual(direct);
    expect(new Set(observed).size).toBe(240);
  });
});
