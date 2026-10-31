import { describe, expect, it } from 'vitest';
import { COUNTDOWN_TICKS, MATCH_TICKS, MOVES, createState } from '../simulation/step';
import { encodeInputFrame, decodeInputFrame, MAX_INPUT_FRAME_BYTES } from './inputFrame';
import {
  MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_TICK, decodeStateSnapshot, encodeStateSnapshot, parseStateSnapshot,
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
    const ids = [0, 1, 2, 3].map(escapedId);
    const frame = { version: 1 as const, tick: MAX_SNAPSHOT_TICK, inputs: ids.map((playerId, index) => ({
      playerId, moveX: (index % 3 - 1) as -1 | 0 | 1, moveY: (index % 3 - 1) as -1 | 0 | 1,
      jump: true, punch: true, kick: true, jumpkick: true, attack: true,
    })) };
    const encoded = encodeInputFrame(frame);
    // Measured maximum: 2000 bytes, so the 4096-byte encoder check is defensive only.
    expect(byteLength(encoded)).toBe(2000);
    expect(byteLength(encoded)).toBeLessThan(MAX_INPUT_FRAME_BYTES);
  });

  it('keeps the event-batch byte cap reachable and measures the schema-maximal snapshot', () => {
    const ids = [0, 1, 2, 3].map(escapedId);
    const buttons = ['punch', 'kick', 'jumpkick', 'jump'];
    const fighter = (id: string, index: number) => ({
      id, x: -Number.MAX_VALUE, y: Number.MAX_VALUE, z: Number.MAX_VALUE, vz: -Number.MAX_VALUE,
      facing: -1 as const, health: 100, score: -Number.MAX_VALUE,
      koCount: Number.MAX_SAFE_INTEGER - 3, hitsReceived: Number.MAX_SAFE_INTEGER - 3,
      attackCooldown: MOVES.jumpkick.startup + MOVES.jumpkick.active + MOVES.jumpkick.recovery,
      attackFrames: MOVES.jumpkick.startup + MOVES.jumpkick.active + MOVES.jumpkick.recovery,
      attackMove: 'jumpkick' as const, hitTargets: ids.filter((_, i) => i !== index),
      hitstun: Number.MAX_SAFE_INTEGER, koTimer: Number.MAX_SAFE_INTEGER,
      protection: Number.MAX_SAFE_INTEGER, previousButtons: buttons,
    });
    const tick = MAX_SNAPSHOT_TICK;
    const event = (index: number) => ({
      tick, type: 'HitLanded' as const, attacker: ids[index % 4], target: ids[(index + 1) % 4], move: 'jumpkick' as const,
    });
    const state = {
      tick, phase: 'fighting' as const, countdownTicks: COUNTDOWN_TICKS, remainingTicks: MATCH_TICKS,
      fighters: ids.map((id, index) => fighter(id, index)),
      events: Array.from({ length: 64 }, (_, index) => event(index)),
    };
    expect(() => parseStateSnapshot({ version: 1, state })).not.toThrow();
    // Measured maximum: 62985 bytes. The tightened button-label and cooldown
    // bounds keep every schema-valid snapshot under the 65536-byte cap, so that
    // cap is defensive only (like MAX_INPUT_FRAME_BYTES); the encoder must still
    // accept the schema-maximal message.
    expect(byteLength(JSON.stringify({ version: 1, state }))).toBe(62985);
    expect(byteLength(JSON.stringify({ version: 1, state }))).toBeLessThan(MAX_SNAPSHOT_BYTES);
    expect(byteLength(encodeStateSnapshot({ version: 1, state }))).toBe(62985);

    const batch = { version: 1 as const, tick, events: Array.from({ length: MAX_EVENTS_PER_BATCH }, (_, index) => event(index)) };
    expect(() => parseEventBatch(batch)).not.toThrow();
    // Measured maximum: 18045 bytes for the 21-event cap, so the 8192-byte batch cap is binding too.
    expect(byteLength(JSON.stringify(batch))).toBe(18045);
    expect(() => encodeEventBatch(batch)).toThrow(/size limit/);
  });
});
