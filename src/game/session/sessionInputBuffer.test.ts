import { describe, expect, it } from 'vitest';
import { SessionInputBuffer } from './sessionInputBuffer';

const input = (playerId: string, moveX: -1 | 0 | 1 = 1) =>
  ({ playerId, moveX, moveY: 0 as const, jump: false });

describe('M2 bounded input buffer', () => {
  it('emits canonical ticks and neutralizes missing players', () => {
    const b = new SessionInputBuffer();
    b.submit('c2', 1, 0, input('P2'));
    b.submit('c1', 1, 0, input('P1'));
    expect(b.consume()).toEqual({ version: 1, tick: 0, inputs: [input('P1'), input('P2')] });
    expect(b.consume()).toEqual({ version: 1, tick: 1, inputs: [] });
  });

  it('rejects stale, far-future, duplicate and replayed submissions', () => {
    const b = new SessionInputBuffer(10, 2);
    expect(() => b.submit('a', 1, 9, input('P1'))).toThrow(/Stale/);
    expect(() => b.submit('a', 1, 13, input('P1'))).toThrow(/Stale/);
    b.submit('a', 1, 10, input('P1'));
    expect(() => b.submit('a', 1, 11, input('P1'))).toThrow(/Replayed/);
    expect(() => b.submit('a', 2, 10, input('P1'))).toThrow(/Duplicate/);
    b.submit('a', 2, 11, input('P1'));
    expect(b.consume().inputs).toHaveLength(1);
    expect(() => b.submit('a', 3, 10, input('P1'))).toThrow(/Stale/);
  });

  it('bounds player capacity and tick storage', () => {
    const b = new SessionInputBuffer(0, 2, 2);
    b.submit('a', 1, 0, input('P1'));
    b.submit('b', 1, 0, input('P2'));
    expect(() => b.submit('c', 1, 0, input('P3'))).toThrow(/roster full/);
    b.submit('a', 2, 2, input('P1'));
    expect(b.bufferedTicks).toBe(2);
    expect(() => b.submit('a', 3, 3, input('P1'))).toThrow(/future/);
  });

  it('revokes disconnected players and resets connection sequence explicitly', () => {
    const b = new SessionInputBuffer();
    b.submit('a', 10, 0, input('P1'));
    b.submit('b', 2, 0, input('P2'));
    b.revokePlayer('P1');
    b.revokeConnection('a');
    b.submit('a', 1, 1, input('P1'));
    expect(b.consume().inputs).toEqual([input('P2')]);
    expect(b.consume().inputs).toEqual([input('P1')]);
  });

  it('rejects malformed controls without poisoning a sequence', () => {
    const b = new SessionInputBuffer();
    expect(() => b.submit('a', 1, 0, { ...input('P1'), moveX: 2 as 1 })).toThrow(/Malformed/);
    expect(() => b.submit('a', 1, 0, { ...input('P1'), punch: 'yes' as unknown as boolean })).toThrow(/Malformed/);
    b.submit('a', 1, 0, input('P1'));
    expect(b.consume().inputs).toEqual([input('P1')]);
  });
});
