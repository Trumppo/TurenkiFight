import {
  MAX_INPUT_FRAME_BYTES,
  MAX_PLAYERS_PER_FRAME,
  parseInputFrame,
  type InputFrame,
} from '../protocol/inputFrame';

/**
 * Transport-neutral M2 session envelope v1.
 *
 * This module only decodes and validates bytes plus canonical JSON. It does not
 * open sockets, choose a transport or resolve identity: a transport adapter
 * supplies trusted connection/room context to SessionEnvelopeGateway. A
 * `playerId` inside a payload is an assertion that the gateway verifies against
 * the trusted roster; it never becomes authority by itself.
 */
export const SESSION_ENVELOPE_VERSION = 1 as const;

/** Client-authored envelopes understood by the transport-neutral boundary. */
export const CLIENT_SESSION_ENVELOPE_KINDS = [
  'join-request', 'leave-request', 'input', 'ping', 'rematch', 'ready-request',
] as const;
export type ClientSessionEnvelopeKind = (typeof CLIENT_SESSION_ENVELOPE_KINDS)[number];

/**
 * Server-authored kinds documented by the approved contract. v1 does not freeze
 * their wire schema and this module does not encode them yet.
 */
export const SERVER_SESSION_ENVELOPE_KINDS = [
  'join-result', 'roster', 'match-start', 'snapshot', 'events', 'error', 'pong',
] as const;
export type ServerSessionEnvelopeKind = (typeof SERVER_SESSION_ENVELOPE_KINDS)[number];

/**
 * Pre-parse UTF-8 cap. The canonical InputFrame codec already caps a payload at
 * MAX_INPUT_FRAME_BYTES; this adds a fixed 1024-byte allowance for envelope
 * metadata (kind, sequence, targetTick, an optional 64-byte room ID and an
 * optional 12-byte room code). The schema-maximal envelope is measured in
 * sessionEnvelope.test.ts.
 */
export const MAX_SESSION_ENVELOPE_BYTES = MAX_INPUT_FRAME_BYTES + 1024;

const SESSION_IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Operator-issued room code: 4-12 ASCII letters or digits, canonical uppercase.
 * This is an admission code for a single-room server, not authentication: it
 * only prevents an accidental or casual join to the wrong room.
 */
export const ROOM_CODE_PATTERN = /^[A-Za-z0-9]{4,12}$/;
export const isRoomCode = (value: unknown): value is string =>
  typeof value === 'string' && ROOM_CODE_PATTERN.test(value);
/** Canonical form used on the wire, in the ready line and in the join form. */
export const normalizeRoomCode = (value: string): string => value.trim().toUpperCase();
const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export type SessionEnvelopeErrorCode =
  | 'oversized'
  | 'invalid-encoding'
  | 'invalid-json'
  | 'invalid-envelope'
  | 'unsupported-version'
  | 'unknown-kind'
  | 'unknown-field'
  | 'invalid-sequence'
  | 'invalid-tick'
  | 'tick-mismatch'
  | 'malformed-input'
  | 'non-canonical-envelope';

export class SessionEnvelopeError extends Error {
  constructor(readonly code: SessionEnvelopeErrorCode, message: string) {
    super(message);
    this.name = 'SessionEnvelopeError';
  }
}

export type JoinRequestEnvelope = {
  version: typeof SESSION_ENVELOPE_VERSION;
  kind: 'join-request';
  sequence: number;
  /**
   * Operator room code. A server that was started with a code requires it on
   * every join; omitting it is denied before a player slot is allocated.
   */
  roomCode?: string;
  roomId?: string;
  playerIds: string[];
};

export type LeaveRequestEnvelope = {
  version: typeof SESSION_ENVELOPE_VERSION;
  kind: 'leave-request';
  sequence: number;
  roomId?: string;
};

export type InputEnvelope = {
  version: typeof SESSION_ENVELOPE_VERSION;
  kind: 'input';
  sequence: number;
  roomId?: string;
  targetTick: number;
  frame: InputFrame;
};

export type PingEnvelope = {
  version: typeof SESSION_ENVELOPE_VERSION;
  kind: 'ping';
  sequence: number;
  roomId?: string;
};

/**
 * Asks the authoritative session for another match with the same roster. The
 * session decides acceptance; this envelope carries no roster, mode or result
 * claims that a client could use to change them.
 */
export type RematchEnvelope = {
  version: typeof SESSION_ENVELOPE_VERSION;
  kind: 'rematch';
  sequence: number;
  roomId?: string;
};

/** Signals that the client (for its claimed slots) is ready for the host to start the match. */
export type ReadyRequestEnvelope = {
  version: typeof SESSION_ENVELOPE_VERSION;
  kind: 'ready-request';
  sequence: number;
  roomId?: string;
  /** Optional explicit slots; if omitted the gateway uses the connection's current roster. */
  playerIds?: string[];
};

export type ClientSessionEnvelope =
  | JoinRequestEnvelope
  | LeaveRequestEnvelope
  | InputEnvelope
  | PingEnvelope
  | RematchEnvelope
  | ReadyRequestEnvelope;

/**
 * Envelope metadata after strict field/version/kind/range checks. The gameplay
 * payload stays raw so the gateway can apply cheap trust and tick bounds before
 * spending work on the canonical InputFrame decoder.
 */
export type ClientEnvelopeHeader = {
  version: typeof SESSION_ENVELOPE_VERSION;
  kind: ClientSessionEnvelopeKind;
  sequence: number;
  roomId?: string;
  roomCode?: string;
  targetTick?: number;
  playerIds?: string[];
  frame?: unknown;
};

export const isSessionIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && SESSION_IDENTIFIER.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** UTF-8 bytes, checked before JSON.parse or TextDecoder work grows. */
export function sessionEnvelopeByteLength(input: string | Uint8Array): number {
  return typeof input === 'string' ? utf8.encode(input).byteLength : input.byteLength;
}

function decodeText(input: string | Uint8Array): string {
  if (typeof input === 'string') {
    if (utf8.encode(input).byteLength > MAX_SESSION_ENVELOPE_BYTES) throw new SessionEnvelopeError('oversized', 'Session envelope size limit exceeded');
    return input;
  }
  if (!(input instanceof Uint8Array)) throw new SessionEnvelopeError('invalid-envelope', 'Session envelope must be UTF-8 text or bytes');
  if (input.byteLength > MAX_SESSION_ENVELOPE_BYTES) throw new SessionEnvelopeError('oversized', 'Session envelope size limit exceeded');
  try {
    return strictUtf8.decode(input);
  } catch {
    throw new SessionEnvelopeError('invalid-encoding', 'Session envelope is not valid UTF-8');
  }
}

function readPlayerIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PLAYERS_PER_FRAME) {
    throw new SessionEnvelopeError('invalid-envelope', 'Join request requires a bounded player slot list');
  }
  const ids = new Set<string>();
  for (const playerId of value) {
    if (!isSessionIdentifier(playerId) || ids.has(playerId)) {
      throw new SessionEnvelopeError('invalid-envelope', 'Join request contains an invalid or duplicate player slot');
    }
    ids.add(playerId);
  }
  return [...value] as string[];
}

function readTargetTick(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new SessionEnvelopeError('invalid-tick', 'Invalid target tick');
  return value as number;
}

/** Strict envelope-object parser; performs no canonical-byte comparison. */
function parseEnvelopeValue(value: unknown): ClientEnvelopeHeader {
  if (!isRecord(value)) throw new SessionEnvelopeError('invalid-envelope', 'Session envelope must be an object');
  if (value.version !== SESSION_ENVELOPE_VERSION) throw new SessionEnvelopeError('unsupported-version', 'Unsupported session envelope version');
  if (typeof value.kind !== 'string') throw new SessionEnvelopeError('invalid-envelope', 'Session envelope kind is required');
  const kind = value.kind as ClientSessionEnvelopeKind;
  if (!CLIENT_SESSION_ENVELOPE_KINDS.includes(kind)) throw new SessionEnvelopeError('unknown-kind', 'Unknown client envelope kind');

  const allowed = new Set<string>(['version', 'kind', 'sequence', 'roomId']);
  if (kind === 'input') {
    allowed.add('targetTick');
    allowed.add('frame');
  } else if (kind === 'join-request') {
    allowed.add('playerIds');
    allowed.add('roomCode');
  } else if (kind === 'ready-request') {
    allowed.add('playerIds');
  }
  if (Object.keys(value).some(key => !allowed.has(key))) throw new SessionEnvelopeError('unknown-field', 'Unknown envelope field');

  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) {
    throw new SessionEnvelopeError('invalid-sequence', 'Invalid envelope sequence');
  }
  const sequence = value.sequence as number;
  let roomId: string | undefined;
  if (own(value, 'roomId')) {
    if (!isSessionIdentifier(value.roomId)) throw new SessionEnvelopeError('invalid-envelope', 'Invalid room identifier');
    roomId = value.roomId;
  }
  let roomCode: string | undefined;
  if (kind === 'join-request' && own(value, 'roomCode')) {
    if (!isRoomCode(value.roomCode)) throw new SessionEnvelopeError('invalid-envelope', 'Invalid room code');
    // Canonical wire form is uppercase; a lowercase claim is re-encoded and
    // therefore rejected by the canonical-byte check rather than accepted.
    roomCode = normalizeRoomCode(value.roomCode);
  }

  if (kind === 'input') {
    if (!own(value, 'targetTick')) throw new SessionEnvelopeError('invalid-tick', 'Input envelope requires targetTick');
    const targetTick = readTargetTick(value.targetTick);
    if (!isRecord(value.frame)) throw new SessionEnvelopeError('malformed-input', 'Input envelope requires a canonical InputFrame object');
    return { version: SESSION_ENVELOPE_VERSION, kind, sequence, ...(roomId === undefined ? {} : { roomId }), targetTick, frame: value.frame };
  }
  if (kind === 'join-request') {
    const playerIds = readPlayerIds(value.playerIds);
    return {
      version: SESSION_ENVELOPE_VERSION,
      kind,
      sequence,
      ...(roomCode === undefined ? {} : { roomCode }),
      ...(roomId === undefined ? {} : { roomId }),
      playerIds,
    };
  }
  if (kind === 'ready-request') {
    let playerIds: string[] | undefined;
    if (own(value, 'playerIds')) {
      playerIds = readPlayerIds(value.playerIds);
    }
    return {
      version: SESSION_ENVELOPE_VERSION,
      kind,
      sequence,
      ...(roomId === undefined ? {} : { roomId }),
      ...(playerIds ? { playerIds } : {}),
    };
  }
  return { version: SESSION_ENVELOPE_VERSION, kind, sequence, ...(roomId === undefined ? {} : { roomId }) };
}

/** Fully validates the payload and produces the canonical typed envelope. */
function completeEnvelope(header: ClientEnvelopeHeader): ClientSessionEnvelope {
  if (header.kind === 'input') {
    let frame: InputFrame;
    try {
      frame = parseInputFrame(header.frame);
    } catch {
      throw new SessionEnvelopeError('malformed-input', 'Malformed canonical InputFrame payload');
    }
    if (frame.tick !== header.targetTick) throw new SessionEnvelopeError('tick-mismatch', 'Envelope targetTick must match the InputFrame tick');
    if (frame.inputs.length === 0) throw new SessionEnvelopeError('malformed-input', 'Input envelope must carry at least one player slot');
    return {
      version: SESSION_ENVELOPE_VERSION,
      kind: 'input',
      sequence: header.sequence,
      ...(header.roomId === undefined ? {} : { roomId: header.roomId }),
      targetTick: header.targetTick as number,
      frame,
    };
  }
  if (header.kind === 'join-request') {
    return {
      version: SESSION_ENVELOPE_VERSION,
      kind: 'join-request',
      sequence: header.sequence,
      ...(header.roomCode === undefined ? {} : { roomCode: header.roomCode }),
      ...(header.roomId === undefined ? {} : { roomId: header.roomId }),
      // Canonical slot order makes join encoding deterministic regardless of claims order.
      playerIds: [...(header.playerIds as string[])].sort(),
    };
  }
  if (header.kind === 'ready-request') {
    return {
      version: SESSION_ENVELOPE_VERSION,
      kind: 'ready-request',
      sequence: header.sequence,
      ...(header.roomId === undefined ? {} : { roomId: header.roomId }),
      ...(header.playerIds ? { playerIds: [...header.playerIds].sort() } : {}),
    };
  }
  return {
    version: SESSION_ENVELOPE_VERSION,
    kind: header.kind,
    sequence: header.sequence,
    ...(header.roomId === undefined ? {} : { roomId: header.roomId }),
  };
}

function parseHeaderText(text: string): ClientEnvelopeHeader {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new SessionEnvelopeError('invalid-json', 'Session envelope is not valid JSON');
  }
  return parseEnvelopeValue(decoded);
}

/** Parses metadata after the byte cap; the gameplay frame remains undecoded. */
export function parseClientEnvelopeHeader(input: string | Uint8Array): ClientEnvelopeHeader {
  return parseHeaderText(decodeText(input));
}

/**
 * Fail-closed encode-side byte guard. The decoder already rejects oversized
 * bytes before parsing; encoders apply the same cap so a future schema
 * expansion (or a canonicalization rule that only adds bytes) cannot emit a
 * message its own decoder would refuse. The cap value is unchanged.
 */
export function assertSessionEnvelopeSize(text: string): string {
  if (sessionEnvelopeByteLength(text) > MAX_SESSION_ENVELOPE_BYTES) {
    throw new SessionEnvelopeError('oversized', 'Session envelope size limit exceeded');
  }
  return text;
}

/** Canonical JSON with fixed field order and canonically sorted slot/frame lists. */
export function encodeClientEnvelope(envelope: ClientSessionEnvelope): string {
  return assertSessionEnvelopeSize(JSON.stringify(completeEnvelope(parseEnvelopeValue(envelope as unknown))));
}

/**
 * Decodes one client envelope. The decoder rejects unknown versions, kinds,
 * fields, duplicate JSON keys (via the canonical-byte check) and oversized
 * input before unbounded work. `header` may be a previously parsed header for
 * the same text/bytes, letting the gateway apply trust checks first.
 */
export function decodeClientEnvelope(input: string | Uint8Array, header?: ClientEnvelopeHeader): ClientSessionEnvelope {
  const text = decodeText(input);
  const envelope = completeEnvelope(header ?? parseHeaderText(text));
  // Exact canonical bytes also reject duplicate keys and reordered/whitespace JSON.
  if (encodeClientEnvelope(envelope) !== text) throw new SessionEnvelopeError('non-canonical-envelope', 'Session envelope must use canonical JSON');
  return envelope;
}
