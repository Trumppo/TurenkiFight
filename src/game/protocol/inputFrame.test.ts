import { describe, expect, it } from 'vitest';
import { createState, step } from '../simulation/step';
import { decodeInputFrame, encodeInputFrame, neutralPlayerInput, parseInputFrame } from './inputFrame';

const p = (playerId: string) => ({ playerId, moveX: 1 as const, moveY: 0 as const, jump: false, punch: true });

describe('M2 InputFrame v1', () => {
  it('round trips and canonicalizes unordered player inputs', () => {
    const a = { version: 1 as const, tick: 42, inputs: [p('P2'), p('P1')] };
    const b = { version: 1 as const, tick: 42, inputs: [p('P1'), p('P2')] };
    expect(encodeInputFrame(a)).toBe(encodeInputFrame(b));
    expect(decodeInputFrame(encodeInputFrame(a))).toEqual(parseInputFrame(b));
  });
  it('rejects malformed and future-version frames', () => {
    const base = { version: 1 as const, tick: 1, inputs: [p('P1')] };
    for (const invalid of [
      { ...base, version: 2 }, { ...base, tick: -1 }, { ...base, tick: 1.5 },
      { ...base, inputs: [p('P1'), p('P1')] },
      { ...base, inputs: [{ ...p('P1'), moveX: 2 }] },
      { ...base, inputs: [{ ...p('P1'), punch: 'true' }] },
      { ...base, inputs: [{ ...p('P1'), extra: 1 }] },
      { ...base, unexpected: true },
    ]) expect(() => parseInputFrame(invalid)).toThrow();
    expect(() => decodeInputFrame('{bad json')).toThrow();
  });
  it('preserves deterministic simulation across input ordering and disconnected players', () => {
    let a = createState(['P1', 'P2'], 'fighting');
    let b = createState(['P1', 'P2'], 'fighting');
    for (let tick = 0; tick < 180; tick++) {
      const inputs = tick < 60 ? [p('P2'), p('P1')] : [p('P1')];
      a = step(a, decodeInputFrame(encodeInputFrame({ version: 1, tick, inputs })).inputs);
      b = step(b, decodeInputFrame(encodeInputFrame({ version: 1, tick, inputs: [...inputs].reverse() })).inputs);
    }
    expect(a).toEqual(b);
    expect(neutralPlayerInput('P2')).toEqual({ playerId: 'P2', moveX: 0, moveY: 0, jump: false });
  });
});
