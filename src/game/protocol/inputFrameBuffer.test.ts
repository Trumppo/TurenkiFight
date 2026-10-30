import { describe, expect, it } from 'vitest';
import { InputFrameBuffer } from './inputFrameBuffer';

const input = (playerId: string) => ({ playerId, moveX: 1 as const, moveY: 0 as const, jump: false });

describe('M2 input tick buffer', () => {
  it('fills missing players with neutral input and advances exactly one tick', () => {
    const buffer = new InputFrameBuffer(['P1', 'P2']);
    buffer.push({ version: 1, tick: 0, inputs: [input('P2')] });
    expect(buffer.peek()).toEqual({ version: 1, tick: 0, inputs: [
      { playerId: 'P1', moveX: 0, moveY: 0, jump: false }, input('P2'),
    ] });
    expect(buffer.peek()).toEqual(buffer.consume());
    expect(buffer.tick).toBe(1);
    expect(buffer.pending).toBe(0);
  });

  it('accepts out-of-order future ticks and rejects duplicate or stale ticks', () => {
    const buffer = new InputFrameBuffer(['P1'], 5, 3);
    buffer.push({ version: 1, tick: 7, inputs: [input('P1')] });
    expect(() => buffer.push({ version: 1, tick: 7, inputs: [] })).toThrow(/Duplicate/);
    expect(() => buffer.push({ version: 1, tick: 8, inputs: [] })).toThrow(/outside/);
    expect(buffer.consume().tick).toBe(5);
    expect(buffer.consume().tick).toBe(6);
    expect(buffer.consume().inputs).toEqual([input('P1')]);
    expect(() => buffer.push({ version: 1, tick: 5, inputs: [] })).toThrow(/outside/);
  });

  it('rejects unknown players and invalid configuration', () => {
    const buffer = new InputFrameBuffer(['P1']);
    expect(() => buffer.push({ version: 1, tick: 0, inputs: [input('P2')] })).toThrow(/unknown/);
    expect(() => new InputFrameBuffer(['P1', 'P1'])).toThrow(/configuration/);
    expect(() => new InputFrameBuffer(['P1'], 0, 0)).toThrow(/configuration/);
  });
});
