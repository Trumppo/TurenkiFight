import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import { InputFrameBuffer } from './inputFrameBuffer';
import { stepBuffered } from './stepBuffered';

describe('M2 buffered simulation integration', () => {
  it('replays out-of-order input frames as contiguous deterministic ticks', () => {
    const players = ['P1', 'P2'];
    const buffer = new InputFrameBuffer(players, 0, 120);
    const inputs = Array.from({ length: 90 }, (_, tick) => ({
      version: 1 as const,
      tick,
      inputs: [{ playerId: 'P1', moveX: (tick % 2 === 0 ? 1 : -1) as -1 | 1, moveY: 0 as const, jump: false, punch: tick % 20 === 0 }],
    }));
    for (const frame of [...inputs].reverse()) buffer.push(frame);
    let buffered = createState(players, 'fighting');
    let direct = createState(players, 'fighting');
    for (const frame of inputs) {
      buffered = stepBuffered(buffered, buffer);
      direct = step(direct, [
        frame.inputs[0],
        { playerId: 'P2', moveX: 0, moveY: 0, jump: false },
      ]);
      expect(buffered).toEqual(direct);
    }
    expect(buffer.tick).toBe(90);
    expect(buffer.pending).toBe(0);
  });

  it('does not consume a frame when simulation and buffer ticks differ', () => {
    const buffer = new InputFrameBuffer(['P1'], 1);
    const state = createState(['P1'], 'fighting');
    expect(() => stepBuffered(state, buffer)).toThrow(/tick mismatch/);
    expect(buffer.tick).toBe(1);
  });
});
