import { describe, expect, it } from 'vitest';
import { MOVES, createState, step } from '../simulation/step';
import { InputFrameBuffer } from './inputFrameBuffer';
import { stepBuffered } from './stepBuffered';
import { MAX_SNAPSHOT_TICK, parseStateSnapshot } from './stateSnapshot';

const p1 = { playerId: 'P1', moveX: 1 as const, moveY: 0 as const, jump: false, punch: true };
const neutral = (playerId: string) => ({ playerId, moveX: 0 as const, moveY: 0 as const, jump: false });

/** P1 is in the active punch window next to P2; P2 sits at the counter cap. */
function activePunchAtCounterCap() {
  const base = createState(['P1', 'P2'], 'fighting');
  const punchFrames = MOVES.punch.active + MOVES.punch.recovery;
  return {
    ...base,
    fighters: [
      { ...base.fighters[0], x: 100, y: 148, facing: 1 as const, attackMove: 'punch' as const, attackFrames: punchFrames, attackCooldown: punchFrames },
      { ...base.fighters[1], x: 120, y: 148, hitsReceived: Number.MAX_SAFE_INTEGER - 3 },
    ],
  };
}

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

  it('does not consume a staged frame when simulation and buffer ticks differ', () => {
    const buffer = new InputFrameBuffer(['P1'], 1);
    buffer.push({ version: 1, tick: 1, inputs: [p1] });
    const state = createState(['P1'], 'fighting');
    expect(() => stepBuffered(state, buffer)).toThrow(/tick mismatch/);
    expect(buffer.tick).toBe(1);
    expect(buffer.pending).toBe(1);

    // The preserved frame is still the one consumed once the simulation catches up.
    const advanced = step(state, []);
    const expected = step(advanced, buffer.peek().inputs);
    expect(stepBuffered(advanced, buffer)).toEqual(expected);
    expect(buffer.tick).toBe(2);
    expect(buffer.pending).toBe(0);
  });

  it('rejects a simulation/buffer roster mismatch before consuming', () => {
    const buffer = new InputFrameBuffer(['P1', 'P2'], 0);
    buffer.push({ version: 1, tick: 0, inputs: [p1] });
    const partial = createState(['P1'], 'fighting');
    expect(() => stepBuffered(partial, buffer)).toThrow(/roster mismatch/);
    expect(buffer.tick).toBe(0);
    expect(buffer.pending).toBe(1);

    const extra = createState(['P1', 'P2', 'P3'], 'fighting');
    expect(() => stepBuffered(extra, buffer)).toThrow(/roster mismatch/);
    expect(buffer.tick).toBe(0);
    expect(buffer.pending).toBe(1);

    const matching = createState(['P1', 'P2'], 'fighting');
    const expected = step(matching, buffer.peek().inputs);
    expect(stepBuffered(matching, buffer)).toEqual(expected);
    expect(buffer.tick).toBe(1);
    expect(buffer.pending).toBe(0);
  });

  it('ignores buffer roster order because step resolves inputs by player ID', () => {
    const ordered = new InputFrameBuffer(['P1', 'P2'], 0);
    const reversed = new InputFrameBuffer(['P2', 'P1'], 0);
    for (const buffer of [ordered, reversed]) buffer.push({ version: 1, tick: 0, inputs: [p1] });
    expect(ordered.players).toEqual(['P1', 'P2']);
    expect(reversed.players).toEqual(['P2', 'P1']);

    const state = createState(['P1', 'P2'], 'fighting');
    const expected = step(state, [p1, neutral('P2')]);
    expect(stepBuffered(state, ordered)).toEqual(expected);
    expect(stepBuffered(state, reversed)).toEqual(expected);
  });

  it('fails closed without consuming when the stepped state cannot be re-encoded', () => {
    const terminal = { ...createState(['P1'], 'fighting'), tick: MAX_SNAPSHOT_TICK };
    const terminalBuffer = new InputFrameBuffer(['P1'], MAX_SNAPSHOT_TICK);
    terminalBuffer.push({ version: 1, tick: MAX_SNAPSHOT_TICK, inputs: [p1] });
    expect(() => stepBuffered(terminal, terminalBuffer)).toThrow(/not encodable/);
    expect(terminal.tick).toBe(MAX_SNAPSHOT_TICK);
    expect(terminalBuffer.tick).toBe(MAX_SNAPSHOT_TICK);
    expect(terminalBuffer.pending).toBe(1);

    // A valid simulation input increments hitsReceived past the counter cap.
    const counter = activePunchAtCounterCap();
    expect(() => parseStateSnapshot({ version: 1, state: counter })).not.toThrow();
    const counterBuffer = new InputFrameBuffer(['P1', 'P2'], 0);
    counterBuffer.push({ version: 1, tick: 0, inputs: [] });
    expect(() => stepBuffered(counter, counterBuffer)).toThrow(/not encodable/);
    expect(counter.fighters[1].hitsReceived).toBe(Number.MAX_SAFE_INTEGER - 3);
    expect(counterBuffer.tick).toBe(0);
    expect(counterBuffer.pending).toBe(1);

    // The same step does land the hit; only the resulting snapshot is rejected.
    const stepped = step(counter, counterBuffer.peek().inputs);
    expect(stepped.fighters[1].hitsReceived).toBe(Number.MAX_SAFE_INTEGER - 2);
    expect(() => parseStateSnapshot({ version: 1, state: stepped })).toThrow();
  });

  it('fails closed when a finite airborne state steps past the finite-number domain', () => {
    const base = createState(['P1', 'P2'], 'fighting');
    // Both values are finite and the snapshot codec accepts them: there is no
    // physical jump-height limit here, only the numeric domain the wire format
    // requires. The overflow is produced by step() itself.
    const airborne = {
      ...base,
      fighters: [{ ...base.fighters[0], z: Number.MAX_VALUE, vz: Number.MAX_VALUE }, base.fighters[1]],
    };
    expect(Number.isFinite(airborne.fighters[0].z)).toBe(true);
    expect(Number.isFinite(airborne.fighters[0].vz)).toBe(true);
    expect(() => parseStateSnapshot({ version: 1, state: airborne })).not.toThrow();

    const buffer = new InputFrameBuffer(['P1', 'P2'], 0);
    buffer.push({ version: 1, tick: 0, inputs: [p1] });
    const before = structuredClone(airborne);
    const staged = buffer.peek();

    expect(() => stepBuffered(airborne, buffer)).toThrow(/not encodable/);
    expect(airborne).toEqual(before);
    expect(buffer.tick).toBe(0);
    expect(buffer.pending).toBe(1);
    expect(buffer.peek()).toEqual(staged);

    // step() runs `f.z = Math.max(0, f.z + f.vz)` before the codec sees the
    // result, so MAX_VALUE + MAX_VALUE becomes Infinity and the step is rejected.
    // (vz stays at MAX_VALUE because subtracting 0.35 rounds back to it.)
    const stepped = step(airborne, staged.inputs);
    expect(stepped.fighters[0].z).toBe(Infinity);
    expect(stepped.fighters[0].vz).toBe(Number.MAX_VALUE);
    expect(() => parseStateSnapshot({ version: 1, state: stepped })).toThrow();
  });
});
