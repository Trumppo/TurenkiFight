import { describe, expect, it, vi } from 'vitest';
import type { PlayerInput } from '../simulation/types';
import {
  CLIENT_SESSION_ENVELOPE_KINDS,
  MAX_SESSION_ENVELOPE_BYTES,
  SERVER_SESSION_ENVELOPE_KINDS,
  SessionEnvelopeError,
  assertSessionEnvelopeSize,
  decodeClientEnvelope,
  encodeClientEnvelope,
  sessionEnvelopeByteLength,
  type InputEnvelope,
  type JoinRequestEnvelope,
  type PingEnvelope,
  type ReadyRequestEnvelope,
} from './sessionEnvelope';

const controls = (playerId: string, moveX: -1 | 0 | 1 = 0): PlayerInput =>
  ({ playerId, moveX, moveY: 0, jump: false });

const errorCode = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    return error instanceof SessionEnvelopeError ? error.code : 'not-an-envelope-error';
  }
  return 'accepted';
};

const inputJson = (targetTick: number, frameTick: number, inputs: unknown, extra = ''): string =>
  `{"version":1,"kind":"input","sequence":1,"targetTick":${targetTick},${extra}"frame":{"version":1,"tick":${frameTick},"inputs":${JSON.stringify(inputs)}}}`;

describe('M2 session envelope codec', () => {
  it('round-trips a canonical input envelope byte-for-byte', () => {
    const envelope: InputEnvelope = {
      version: 1,
      kind: 'input',
      sequence: 7,
      targetTick: 3,
      frame: { version: 1, tick: 3, inputs: [controls('P2', 0), controls('P1', 1)] },
    };
    const text = encodeClientEnvelope(envelope);
    expect(text).toBe(
      '{"version":1,"kind":"input","sequence":7,"targetTick":3,"frame":{"version":1,"tick":3,' +
      '"inputs":[{"playerId":"P1","moveX":1,"moveY":0,"jump":false},' +
      '{"playerId":"P2","moveX":0,"moveY":0,"jump":false}]}}',
    );
    expect(decodeClientEnvelope(text)).toEqual({
      ...envelope,
      frame: { version: 1, tick: 3, inputs: [controls('P1', 1), controls('P2', 0)] },
    });
  });

  it('canonicalizes join slot claims and rejects non-canonical bytes', () => {
    const join: JoinRequestEnvelope = { version: 1, kind: 'join-request', sequence: 1, playerIds: ['P2', 'P1'] };
    const text = encodeClientEnvelope(join);
    expect(text).toBe('{"version":1,"kind":"join-request","sequence":1,"playerIds":["P1","P2"]}');
    expect(decodeClientEnvelope(text)).toEqual({ ...join, playerIds: ['P1', 'P2'] });
    expect(encodeClientEnvelope({ ...join, roomId: 'room-1' })).toBe(
      '{"version":1,"kind":"join-request","sequence":1,"roomId":"room-1","playerIds":["P1","P2"]}',
    );
    const eight = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
    const joinEight: JoinRequestEnvelope = { version: 1, kind: 'join-request', sequence: 2, playerIds: [...eight].reverse() };
    expect(decodeClientEnvelope(encodeClientEnvelope(joinEight))).toEqual({ ...joinEight, playerIds: eight });

    expect(errorCode(() => decodeClientEnvelope(
      '{"version":1,"kind":"join-request","sequence":1,"playerIds":["P2","P1"]}',
    ))).toBe('non-canonical-envelope');
    expect(errorCode(() => decodeClientEnvelope(
      '{ "version": 1, "kind": "join-request", "sequence": 1, "playerIds": ["P1","P2"] }',
    ))).toBe('non-canonical-envelope');
  });

  it('validates and canonicalizes initial host room settings on join', () => {
    const create: JoinRequestEnvelope = {
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P1'],
      roomConfig: { mode: 'deathmatch', arena: 'kkauppa', playerCount: 8, durationMinutes: 3 },
    };
    expect(decodeClientEnvelope(encodeClientEnvelope(create))).toEqual(create);
    expect(errorCode(() => encodeClientEnvelope({
      ...create, roomConfig: { ...create.roomConfig!, durationMinutes: 5 as 1 | 2 | 3 },
    }))).toBe('invalid-envelope');
    expect(errorCode(() => encodeClientEnvelope({
      ...create, roomConfig: { ...create.roomConfig!, playerCount: 1 },
    }))).toBe('invalid-envelope');
    expect(errorCode(() => encodeClientEnvelope({
      ...create, roomConfig: { ...create.roomConfig!, arena: 'unknown' as 'station' },
    }))).toBe('invalid-envelope');
  });

  it('round-trips a canonical ready request and sorts optional slots', () => {
    const ready: ReadyRequestEnvelope = {
      version: 1, kind: 'ready-request', sequence: 4, roomId: 'room-1', playerIds: ['P2', 'P1'],
    };
    const text = encodeClientEnvelope(ready);
    expect(text).toBe('{"version":1,"kind":"ready-request","sequence":4,"roomId":"room-1","playerIds":["P1","P2"]}');
    expect(decodeClientEnvelope(text)).toEqual({ ...ready, playerIds: ['P1', 'P2'] });
    const allSlots: ReadyRequestEnvelope = { version: 1, kind: 'ready-request', sequence: 5 };
    expect(decodeClientEnvelope(encodeClientEnvelope(allSlots))).toEqual(allSlots);
    expect(errorCode(() => decodeClientEnvelope(
      '{"version":1,"kind":"ready-request","sequence":4,"playerIds":["P2","P1"]}',
    ))).toBe('non-canonical-envelope');
  });

  it('rejects unknown version, kind and envelope fields', () => {
    expect(errorCode(() => decodeClientEnvelope('{"version":2,"kind":"ping","sequence":1}')))
      .toBe('unsupported-version');
    expect(errorCode(() => decodeClientEnvelope('{"version":1,"kind":"kick","sequence":1}')))
      .toBe('unknown-kind');
    expect(errorCode(() => decodeClientEnvelope('{"version":1,"kind":"ping","sequence":1,"host":true}')))
      .toBe('unknown-field');
    expect(errorCode(() => decodeClientEnvelope(
      '{"version":1,"kind":"input","sequence":1,"targetTick":0,"playerId":"P1","frame":{"version":1,"tick":0,"inputs":[]}}',
    ))).toBe('unknown-field');
    expect(errorCode(() => decodeClientEnvelope(
      '{"version":1,"kind":"join-request","sequence":1,"playerIds":["P1"],"playerId":"P1"}',
    ))).toBe('unknown-field');
  });

  it('rejects malformed or mismatched canonical InputFrame payloads', () => {
    expect(errorCode(() => decodeClientEnvelope(inputJson(0, 0, [{ ...controls('P1'), teleport: true }]))))
      .toBe('malformed-input');
    expect(errorCode(() => decodeClientEnvelope(inputJson(2, 1, [controls('P1')]))))
      .toBe('tick-mismatch');
    expect(errorCode(() => decodeClientEnvelope(inputJson(0, 0, [])))).toBe('malformed-input');
    expect(errorCode(() => decodeClientEnvelope(inputJson(0, 0, [controls('P1'), controls('P1')]))))
      .toBe('malformed-input');
  });

  it('rejects invalid sequence and tick ranges', () => {
    for (const sequence of ['-1', '1.5', '"1"']) {
      expect(errorCode(() => decodeClientEnvelope(
        `{"version":1,"kind":"ping","sequence":${sequence}}`,
      ))).toBe('invalid-sequence');
    }
    expect(errorCode(() => decodeClientEnvelope('{"version":1,"kind":"ping"}')))
      .toBe('invalid-sequence');
    expect(errorCode(() => decodeClientEnvelope(
      '{"version":1,"kind":"input","sequence":1,"targetTick":-1,"frame":{"version":1,"tick":0,"inputs":[]}}',
    ))).toBe('invalid-tick');
    expect(errorCode(() => decodeClientEnvelope(
      '{"version":1,"kind":"input","sequence":1,"frame":{"version":1,"tick":0,"inputs":[]}}',
    ))).toBe('invalid-tick');
  });

  it('rejects invalid join claims atomically in the decoder', () => {
    for (const playerIds of [[], ['P1', 'P1'], ['P1', 'bad id'], Array.from({ length: 9 }, (_, index) => `P${index + 1}`)]) {
      expect(errorCode(() => decodeClientEnvelope(
        JSON.stringify({ version: 1, kind: 'join-request', sequence: 1, playerIds }),
      ))).toBe('invalid-envelope');
    }
  });

  it('rejects duplicate JSON keys through the canonical byte check', () => {
    expect(errorCode(() => decodeClientEnvelope(
      '{"version":1,"kind":"ping","sequence":1,"sequence":1}',
    ))).toBe('non-canonical-envelope');
  });

  it('rejects oversized input before parsing, counting UTF-8 bytes', () => {
    // Neither payload is valid JSON, so reaching the parser would report another code.
    expect(errorCode(() => decodeClientEnvelope(' '.repeat(MAX_SESSION_ENVELOPE_BYTES + 1))))
      .toBe('oversized');
    expect(errorCode(() => decodeClientEnvelope(new Uint8Array(MAX_SESSION_ENVELOPE_BYTES + 1))))
      .toBe('oversized');
    const multibyte = 'ä'.repeat(MAX_SESSION_ENVELOPE_BYTES);
    expect(sessionEnvelopeByteLength(multibyte)).toBe(MAX_SESSION_ENVELOPE_BYTES * 2);
    expect(errorCode(() => decodeClientEnvelope(multibyte))).toBe('oversized');
  });

  it('rejects invalid UTF-8 bytes inside the size cap', () => {
    expect(errorCode(() => decodeClientEnvelope(new Uint8Array([0x7b, 0xff, 0x7d]))))
      .toBe('invalid-encoding');
  });

  it('fails closed when an encoded envelope exceeds the documented byte cap', () => {
    const atCap = 'x'.repeat(MAX_SESSION_ENVELOPE_BYTES);
    expect(assertSessionEnvelopeSize(atCap)).toBe(atCap);
    expect(errorCode(() => assertSessionEnvelopeSize(atCap + 'x'))).toBe('oversized');
    // Counted bytes, not UTF-16 code units: the cap is even, so one more
    // two-byte character crosses it.
    const multibyteAtCap = 'ä'.repeat(MAX_SESSION_ENVELOPE_BYTES / 2);
    expect(assertSessionEnvelopeSize(multibyteAtCap)).toBe(multibyteAtCap);
    expect(errorCode(() => assertSessionEnvelopeSize(multibyteAtCap + 'ä'))).toBe('oversized');

    // The guard must live in the encode path, not only in the helper.
    const envelope: PingEnvelope = { version: 1, kind: 'ping', sequence: 1 };
    const spy = vi.spyOn(JSON, 'stringify').mockReturnValueOnce('y'.repeat(MAX_SESSION_ENVELOPE_BYTES + 1));
    try {
      expect(errorCode(() => encodeClientEnvelope(envelope))).toBe('oversized');
    } finally {
      spy.mockRestore();
    }
    expect(encodeClientEnvelope(envelope)).toBe('{"version":1,"kind":"ping","sequence":1}');
  });

  it('keeps the derived byte cap above the schema-maximal envelope', () => {
    // JSON.stringify escapes lone surrogates as six ASCII bytes per character.
    const escapedId = (n: number) => '\ud800'.repeat(63) + String.fromCharCode(0xd800 + n);
    const ids = [0, 1, 2, 3].map(escapedId);
    const envelope: InputEnvelope = {
      version: 1,
      kind: 'input',
      sequence: Number.MAX_SAFE_INTEGER,
      targetTick: Number.MAX_SAFE_INTEGER,
      roomId: 'r'.repeat(64),
      frame: {
        version: 1,
        tick: Number.MAX_SAFE_INTEGER,
        inputs: ids.map((playerId, index) => ({
          playerId, moveX: (index % 3 - 1) as -1 | 0 | 1, moveY: (index % 3 - 1) as -1 | 0 | 1,
          jump: true, punch: true, kick: true, jumpkick: true, attack: true,
        })),
      },
    };
    const text = encodeClientEnvelope(envelope);
    expect(sessionEnvelopeByteLength(text)).toBeGreaterThan(2000);
    expect(sessionEnvelopeByteLength(text)).toBeLessThan(MAX_SESSION_ENVELOPE_BYTES);
    expect(decodeClientEnvelope(text)).toEqual(envelope);
  });

  it('documents the approved client and server kind names', () => {
    expect([...CLIENT_SESSION_ENVELOPE_KINDS]).toEqual(['join-request', 'leave-request', 'input', 'ping', 'rematch', 'ready-request', 'start-request']);
    expect([...SERVER_SESSION_ENVELOPE_KINDS]).toEqual([
      'join-result', 'roster', 'lobby-state', 'match-start', 'snapshot', 'events', 'error', 'pong',
    ]);
  });

  it('round-trips a host start request as a minimal canonical envelope', () => {
    const request = { version: 1 as const, kind: 'start-request' as const, sequence: 3 };
    const encoded = encodeClientEnvelope(request);
    expect(encoded).toBe('{"version":1,"kind":"start-request","sequence":3}');
    expect(decodeClientEnvelope(encoded)).toEqual(request);
  });
});
