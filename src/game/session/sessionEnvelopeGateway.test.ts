import { describe, expect, it } from 'vitest';
import type { PlayerInput } from '../simulation/types';
import {
  MAX_SESSION_ENVELOPE_BYTES,
  encodeClientEnvelope,
  type ClientSessionEnvelope,
  type InputEnvelope,
  type JoinRequestEnvelope,
  type LeaveRequestEnvelope,
  type PingEnvelope,
} from './sessionEnvelope';
import {
  SessionEnvelopeGateway,
  type SessionEnvelopeDenialCode,
  type SessionEnvelopeResult,
  type TrustedSessionBinding,
} from './sessionEnvelopeGateway';

const ROOM = 'room-1';
const binding = (connectionId = 'conn-1', roomId = ROOM): TrustedSessionBinding => ({ connectionId, roomId });
const controls = (playerId: string, moveX: -1 | 0 | 1 = 1): PlayerInput =>
  ({ playerId, moveX, moveY: 0, jump: false });
const join = (sequence: number, playerIds: string[], roomId?: string): JoinRequestEnvelope =>
  ({ version: 1, kind: 'join-request', sequence, ...(roomId === undefined ? {} : { roomId }), playerIds });
const leave = (sequence: number, roomId?: string): LeaveRequestEnvelope =>
  ({ version: 1, kind: 'leave-request', sequence, ...(roomId === undefined ? {} : { roomId }) });
const ping = (sequence: number, roomId?: string): PingEnvelope =>
  ({ version: 1, kind: 'ping', sequence, ...(roomId === undefined ? {} : { roomId }) });
const input = (sequence: number, tick: number, inputs: PlayerInput[], roomId?: string): InputEnvelope =>
  ({
    version: 1, kind: 'input', sequence, ...(roomId === undefined ? {} : { roomId }),
    targetTick: tick, frame: { version: 1, tick, inputs },
  });
const send = (gateway: SessionEnvelopeGateway, envelope: ClientSessionEnvelope, target = binding()) =>
  gateway.handle(target, encodeClientEnvelope(envelope));

const expectAccepted = (result: SessionEnvelopeResult): void => {
  if (!result.accepted) throw new Error(`Expected acceptance, got ${result.code}: ${result.message}`);
};
const expectDenied = (result: SessionEnvelopeResult, code: SessionEnvelopeDenialCode): void => {
  expect(result.accepted).toBe(false);
  if (!result.accepted) expect(result.code).toBe(code);
};

describe('M2 session envelope gateway', () => {
  it('accepts an owned player input exactly once on its target tick', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    // The adapter may deliver validated UTF-8 bytes instead of a JS string.
    expectAccepted(gateway.handle(binding(), new TextEncoder().encode(encodeClientEnvelope(join(1, ['P1'])))));
    expectAccepted(send(gateway, input(2, 0, [controls('P1', 1)])));
    expect(gateway.consume()).toEqual({ version: 1, tick: 0, inputs: [controls('P1', 1)] });
    // The submitted action is never replayed on a later tick.
    expect(gateway.consume().inputs).toEqual([]);
  });

  it('denies spoofed players and host claims without mutating state', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(1, ['P1'])));
    expectDenied(send(gateway, input(2, 0, [controls('P2')])), 'unauthorized-player');
    expect(gateway.bufferedTicks).toBe(0);
    expect(gateway.sequenceOf('conn-1')).toBe(1);
    // The denied sequence is not burned: the same sequence is accepted for P1.
    expectAccepted(send(gateway, input(2, 0, [controls('P1')])));
    expect(gateway.consume().inputs).toEqual([controls('P1')]);

    // There is no client-controlled host flag or unknown field.
    expectDenied(
      gateway.handle(binding(), '{"version":1,"kind":"join-request","sequence":3,"playerIds":["P1"],"host":true}'),
      'unknown-field',
    );
  });

  it('denies cross-room bindings and payload room assertions', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(1, ['P1'])));
    expectDenied(send(gateway, ping(2), binding('conn-1', 'room-2')), 'room-mismatch');
    expectDenied(send(gateway, ping(2, 'room-2')), 'room-mismatch');
    expect(gateway.sequenceOf('conn-1')).toBe(1);

    const otherRoom = new SessionEnvelopeGateway({ roomId: 'room-2' });
    expectDenied(send(otherRoom, input(2, 0, [controls('P1')]), binding('conn-1', 'room-2')), 'not-joined');
  });

  it('rejects replayed sequences and duplicate player/tick without side effects', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(1, ['P1'])));
    // The sequence is monotonic across kinds, not only across input frames.
    expectDenied(send(gateway, ping(1)), 'replayed-sequence');
    expectAccepted(send(gateway, input(2, 0, [controls('P1', 1)])));

    expectDenied(send(gateway, input(2, 0, [controls('P1', -1)])), 'replayed-sequence');
    expectDenied(send(gateway, input(3, 0, [controls('P1', -1)])), 'duplicate-input');
    // Denied frames did not advance the sequence or replace the first input.
    expect(gateway.sequenceOf('conn-1')).toBe(2);
    expect(gateway.consume()).toEqual({ version: 1, tick: 0, inputs: [controls('P1', 1)] });

    // The denied duplicate sequence remains usable for the next tick.
    expectAccepted(send(gateway, input(3, 1, [controls('P1', -1)])));
    expect(gateway.consume()).toEqual({ version: 1, tick: 1, inputs: [controls('P1', -1)] });
  });

  it('rejects late and far-future ticks using the existing bounded window', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(1, ['P1'])));
    // Missing input consumes neutral: no player inputs on tick 0.
    expect(gateway.consume()).toEqual({ version: 1, tick: 0, inputs: [] });
    expectDenied(send(gateway, input(2, 0, [controls('P1')])), 'late-tick');
    expectDenied(send(gateway, input(2, 10, [controls('P1')])), 'future-tick');
    // Default look-ahead is 8 ticks: nextTick 1 + 8 = 9 is the boundary.
    expectAccepted(send(gateway, input(2, 9, [controls('P1')])));
    expect(gateway.bufferedTicks).toBe(1);
  });

  it('rejects bad version, kind, extra fields and malformed payloads', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectDenied(gateway.handle(binding(), '{"version":2,"kind":"ping","sequence":1}'), 'unsupported-version');
    expectDenied(gateway.handle(binding(), '{"version":1,"kind":"kick","sequence":1}'), 'unknown-kind');
    expectAccepted(send(gateway, join(1, ['P1'])));
    expectDenied(gateway.handle(binding(), inputJsonWithExtraFrameField()), 'malformed-input');
    expectDenied(
      gateway.handle(binding(), '{"version":1,"kind":"input","sequence":2,"targetTick":5,"frame":{"version":1,"tick":4,"inputs":[{"playerId":"P1","moveX":0,"moveY":0,"jump":false}]}}'),
      'tick-mismatch',
    );
    expectDenied(
      gateway.handle(binding(), '{"version":1,"kind":"input","sequence":2,"targetTick":0,"frame":{"version":1,"tick":0,"inputs":[]}}'),
      'malformed-input',
    );
  });

  it('rejects oversized payloads before parsing', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectDenied(gateway.handle(binding(), new Uint8Array(MAX_SESSION_ENVELOPE_BYTES + 1)), 'oversized');
    expectDenied(gateway.handle(binding(), ' '.repeat(MAX_SESSION_ENVELOPE_BYTES + 1)), 'oversized');
  });

  it('supports multiple slots per connection and rejects a mixed unauthorized frame atomically', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(1, ['P1', 'P2'])));
    expect(gateway.playerCount).toBe(2);
    expectAccepted(send(gateway, input(2, 0, [controls('P1'), controls('P2')])));
    expect(gateway.consume()).toEqual({
      version: 1, tick: 0, inputs: [controls('P1'), controls('P2')],
    });

    expectDenied(send(gateway, input(3, 1, [controls('P1'), controls('P2'), controls('P3')])), 'unauthorized-player');
    expect(gateway.bufferedTicks).toBe(0);
    expectAccepted(send(gateway, input(3, 1, [controls('P1'), controls('P2')])));
    expect(gateway.consume().inputs).toEqual([controls('P1'), controls('P2')]);
  });

  it('rejects a duplicate player/tick atomically without adding the other slot', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(1, ['P1', 'P2'])));
    expectAccepted(send(gateway, input(2, 0, [controls('P1', 1)])));
    // P2 is new for tick 0, but the frame cannot partially apply around duplicate P1.
    expectDenied(send(gateway, input(3, 0, [controls('P1', -1), controls('P2')])), 'duplicate-input');
    expect(gateway.sequenceOf('conn-1')).toBe(2);
    expect(gateway.consume()).toEqual({ version: 1, tick: 0, inputs: [controls('P1', 1)] });

    // The denied sequence remains usable, and P2 was never silently queued.
    expectAccepted(send(gateway, input(3, 2, [controls('P2')])));
    expect(gateway.consume().inputs).toEqual([]);
    expect(gateway.consume().inputs).toEqual([controls('P2')]);
  });

  it('revokes queue, ownership and sequence on disconnect and denies stale input', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(1, ['P1'])));
    expectAccepted(send(gateway, input(2, 0, [controls('P1')])));
    expect(gateway.disconnect('conn-1')).toEqual(['P1']);
    expectDenied(send(gateway, input(3, 0, [controls('P1')])), 'not-joined');
    expectDenied(send(gateway, ping(3)), 'not-joined');
    expect(gateway.consume().inputs).toEqual([]);
    expect(gateway.sequenceOf('conn-1')).toBeUndefined();
  });

  it('treats reconnect as a fresh join with a fresh sequence domain', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(10, ['P1'])));
    expectAccepted(send(gateway, input(11, 0, [controls('P1')])));
    gateway.disconnect('conn-1');

    // A reconnect cannot recover the old slots without a new join.
    expectDenied(send(gateway, input(12, 0, [controls('P1')])), 'not-joined');
    expectAccepted(send(gateway, join(1, ['P1'])));
    // Sequence 1 would be a replay if the old sequence domain survived.
    expectAccepted(send(gateway, input(2, 0, [controls('P1', -1)])));
    expect(gateway.consume()).toEqual({ version: 1, tick: 0, inputs: [controls('P1', -1)] });
  });

  it('rejects sequence exhaustion and requires a session reset', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(Number.MAX_SAFE_INTEGER - 2, ['P1'])));
    expectAccepted(send(gateway, input(Number.MAX_SAFE_INTEGER - 1, 0, [controls('P1')])));
    expectDenied(send(gateway, ping(Number.MAX_SAFE_INTEGER)), 'sequence-exhausted');
    expect(gateway.sequenceOf('conn-1')).toBe(Number.MAX_SAFE_INTEGER - 1);

    const fresh = new SessionEnvelopeGateway({ roomId: ROOM });
    expectDenied(send(fresh, join(Number.MAX_SAFE_INTEGER, ['P1'])), 'sequence-exhausted');
    expect(fresh.isJoined('conn-1')).toBe(false);
  });

  it('rejects tick exhaustion instead of wrapping', () => {
    const startTick = Number.MAX_SAFE_INTEGER - 1;
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM, startTick, maxLead: 0 });
    expectAccepted(send(gateway, join(1, ['P1'])));
    // The terminal safe tick can never be consumed, so it is rejected up front.
    expectDenied(send(gateway, input(2, Number.MAX_SAFE_INTEGER, [controls('P1')])), 'tick-exhausted');
    expectAccepted(send(gateway, input(2, startTick, [controls('P1')])));
    expect(gateway.consume().tick).toBe(startTick);
    expect(() => gateway.consume()).toThrow(/exhausted/);
  });

  it('rejects a partially owned multi-slot join without creating authority', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM, maxPlayers: 2 });
    expectAccepted(send(gateway, join(1, ['P1']), binding('conn-a')));
    expectDenied(send(gateway, join(1, ['P2', 'P1']), binding('conn-b')), 'player-owned');
    expect(gateway.isJoined('conn-b')).toBe(false);
    expectDenied(send(gateway, join(1, ['P2', 'P3']), binding('conn-b')), 'session-full');
    expect(gateway.isJoined('conn-b')).toBe(false);
    expect(gateway.playerCount).toBe(1);
  });

  it('rejects a duplicate join and keeps existing ownership', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(1, ['P1'])));
    expectDenied(send(gateway, join(2, ['P2'])), 'already-joined');
    expect(gateway.playerCount).toBe(1);
    expect(gateway.isJoined('conn-1')).toBe(true);
  });

  it('revokes queued input and slot ownership on leave-request', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(1, ['P1'])));
    expectAccepted(send(gateway, ping(2)));
    expectAccepted(send(gateway, input(3, 0, [controls('P1')])));
    expectAccepted(send(gateway, leave(4)));
    expect(gateway.isJoined('conn-1')).toBe(false);
    expect(gateway.consume().inputs).toEqual([]);
    expectDenied(send(gateway, input(5, 0, [controls('P1')])), 'not-joined');

    // The freed slot requires a fresh join by another connection.
    expectAccepted(send(gateway, join(1, ['P1']), binding('conn-2')));
    expect(gateway.isJoined('conn-2')).toBe(true);
  });

  it('does not let one connection submit another connection’s slot', () => {
    const gateway = new SessionEnvelopeGateway({ roomId: ROOM });
    expectAccepted(send(gateway, join(1, ['P1']), binding('conn-a')));
    expectAccepted(send(gateway, join(1, ['P2']), binding('conn-b')));
    expectDenied(
      send(gateway, input(2, 0, [controls('P1'), controls('P2')]), binding('conn-b')),
      'unauthorized-player',
    );
    expect(gateway.bufferedTicks).toBe(0);
    // The denied sequence is not burned.
    expectAccepted(send(gateway, input(2, 0, [controls('P2')]), binding('conn-b')));
    expect(gateway.consume().inputs).toEqual([controls('P2')]);
  });
});

function inputJsonWithExtraFrameField(): string {
  return '{"version":1,"kind":"input","sequence":2,"targetTick":0,"frame":{"version":1,"tick":0,' +
    '"inputs":[{"playerId":"P1","moveX":0,"moveY":0,"jump":false,"teleport":true}]}}';
}
