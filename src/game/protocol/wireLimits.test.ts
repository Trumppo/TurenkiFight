import { describe, expect, it } from 'vitest';
import { COUNTDOWN_TICKS, MATCH_TICKS, MOVES, createState } from '../simulation/step';
import { encodeInputFrame, decodeInputFrame, MAX_INPUT_FRAME_BYTES, MAX_PLAYERS_PER_FRAME } from './inputFrame';
import {
  MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_FIGHTERS, MAX_SNAPSHOT_TICK, decodeStateSnapshot, encodeStateSnapshot,
  parseStateSnapshot,
} from './stateSnapshot';
import { MAX_EVENTS_PER_BATCH, encodeEventBatch, parseEventBatch } from './eventBatch';

const byteLength = (s: string) => new TextEncoder().encode(s).byteLength;
/**
 * Six UTF-8 bytes per JSON character: JSON.stringify escapes lone surrogates as
 * `\udXXX`, which is the widest per-character encoding the schema admits.
 */
const escapedId = (n: number) => '\ud800'.repeat(63) + String.fromCharCode(0xd800 + n);

describe('M2 codec ingress and egress limits', () => {
  it('rejects oversized input JSON before parsing', () => {
    expect(() => decodeInputFrame(' '.repeat(MAX_INPUT_FRAME_BYTES + 1))).toThrow(/size limit/);
  });
  it('rejects oversized snapshot JSON before parsing', () => {
    expect(() => decodeStateSnapshot(' '.repeat(MAX_SNAPSHOT_BYTES + 1))).toThrow(/size limit/);
  });
  it('accepts valid messages under both limits', () => {
    const input = { version: 1 as const, tick: 1, inputs: [{ playerId: 'P1', moveX: 0 as const, moveY: 0 as const, jump: false }] };
    expect(decodeInputFrame(encodeInputFrame(input))).toEqual(input);
    const snapshot = { version: 1 as const, state: createState(['P1']) };
    expect(decodeStateSnapshot(encodeStateSnapshot(snapshot))).toEqual(snapshot);
  });

  it('keeps the input-frame byte cap unreachable for schema-maximal frames', () => {
    const ids = Array.from({ length: MAX_PLAYERS_PER_FRAME }, (_, index) => escapedId(index));
    const frame = { version: 1 as const, tick: MAX_SNAPSHOT_TICK, inputs: ids.map((playerId, index) => ({
      playerId, moveX: (index % 3 - 1) as -1 | 0 | 1, moveY: (index % 3 - 1) as -1 | 0 | 1,
      jump: true, punch: true, kick: true, jumpkick: true, attack: true,
    })) };
    const encoded = encodeInputFrame(frame);
    // Measured maximum: 3950 bytes, so the 4096-byte encoder check is defensive only.
    expect(byteLength(encoded)).toBe(3950);
    expect(byteLength(encoded)).toBeLessThan(MAX_INPUT_FRAME_BYTES);
  });

  it('keeps the event-batch byte cap reachable and measures the schema-maximal snapshot', () => {
    const ids = Array.from({ length: MAX_SNAPSHOT_FIGHTERS }, (_, index) => escapedId(index));
    const buttons = ['punch', 'kick', 'jumpkick', 'jump'];
    const fighter = (id: string, index: number) => ({
      id, x: -Number.MAX_VALUE, y: Number.MAX_VALUE, z: Number.MAX_VALUE, vz: -Number.MAX_VALUE,
      facing: -1 as const, health: 100, score: -Number.MAX_VALUE,
      koCount: Number.MAX_SAFE_INTEGER - (MAX_SNAPSHOT_FIGHTERS - 1),
      hitsReceived: Number.MAX_SAFE_INTEGER - (MAX_SNAPSHOT_FIGHTERS - 1),
      attackCooldown: MOVES.jumpkick.startup + MOVES.jumpkick.active + MOVES.jumpkick.recovery,
      attackFrames: MOVES.jumpkick.startup + MOVES.jumpkick.active + MOVES.jumpkick.recovery,
      attackMove: 'jumpkick' as const, hitTargets: ids.filter((_, i) => i !== index),
      hitstun: Number.MAX_SAFE_INTEGER, koTimer: Number.MAX_SAFE_INTEGER,
      protection: Number.MAX_SAFE_INTEGER, previousButtons: buttons,
    });
    const tick = MAX_SNAPSHOT_TICK;
    const event = (index: number) => ({
      tick, type: 'HitLanded' as const,
      attacker: ids[index % MAX_SNAPSHOT_FIGHTERS],
      target: ids[(index + 1) % MAX_SNAPSHOT_FIGHTERS],
      move: 'jumpkick' as const,
    });
    const state = {
      tick, phase: 'fighting' as const, countdownTicks: COUNTDOWN_TICKS, remainingTicks: MATCH_TICKS,
      fighters: ids.map((id, index) => fighter(id, index)),
      events: Array.from({ length: 64 }, (_, index) => event(index)),
    };
    expect(() => parseStateSnapshot({ version: 1, state })).not.toThrow();
    // Measured maximum: 83373 bytes at eight fighters. The snapshot byte cap is
    // doubled to 131072 so every schema-valid snapshot remains encodable; the
    // cap stays defensive rather than binding on real eight-player states.
    expect(byteLength(JSON.stringify({ version: 1, state }))).toBe(83373);
    expect(byteLength(JSON.stringify({ version: 1, state }))).toBeLessThan(MAX_SNAPSHOT_BYTES);
    expect(byteLength(encodeStateSnapshot({ version: 1, state }))).toBe(83373);

    const batch = { version: 1 as const, tick, events: Array.from({ length: MAX_EVENTS_PER_BATCH }, (_, index) => event(index)) };
    expect(() => parseEventBatch(batch)).not.toThrow();
    // Measured maximum: 62609 bytes for the 73-event cap, so the 8192-byte batch
    // cap is binding too.
    expect(byteLength(JSON.stringify(batch))).toBe(62609);
    expect(() => encodeEventBatch(batch)).toThrow(/size limit/);
  });
});
