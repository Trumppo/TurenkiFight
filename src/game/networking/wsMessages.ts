import { END_REASONS } from '../protocol/gameEvent';
import { MAX_PLAYERS_PER_FRAME } from '../protocol/inputFrame';
import { MAX_SNAPSHOT_BYTES, parseStateSnapshot, type StateSnapshot } from '../protocol/stateSnapshot';
import { isSessionIdentifier } from '../session/sessionEnvelope';
import type { EndReason, PlayerId } from '../simulation/types';

/**
 * Prototype-only server message schema for the architecture-A WebSocket slice.
 *
 * This is NOT a frozen wire contract and does not select a transport. It exists
 * so the loopback prototype and its synthetic clients can exchange explicit
 * server-authored messages with strict decoding. Client-authored messages keep
 * using the approved transport-neutral session envelope v1 unchanged.
 *
 * This module is browser-safe: it only uses JSON, TextEncoder and the existing
 * protocol codecs. Node `ws` imports live in `server/ws/` instead.
 */
export const WS_SERVER_PROTOCOL_VERSION = 1 as const;

/** Snapshot emission rates the server accepts (all divide the 60 Hz tick rate). */
export const SUPPORTED_SNAPSHOT_HZ = [10, 20, 30] as const;
export type SnapshotHz = (typeof SUPPORTED_SNAPSHOT_HZ)[number];

export const WS_SERVER_MESSAGE_KINDS = [
  'welcome',
  'join-result',
  'roster',
  'match-start',
  'snapshot',
  'error',
  'pong',
  'match-end',
  'run-complete',
  'session-closed',
] as const;
export type WsServerMessageKind = (typeof WS_SERVER_MESSAGE_KINDS)[number];

export type SessionClosedReason = 'host-lost' | 'match-complete';

/** One ranked fighter in the server-authored `match-end` result. */
export type WsRankedEntry = {
  id: PlayerId;
  /** 1-based competition rank: ties share a rank and the next rank is skipped. */
  rank: number;
  /** The mode's primary sortable value; Last Man Standing uses -1 for unplaced. */
  metric: number;
};

/**
 * Server-authored outcome of a finished match. The server is the only ranker:
 * it computes this from its accumulated event stream exactly like local play.
 * The payload is canonically omitted when a session does not have one, so old
 * messages and pinned snapshot bytes stay unchanged.
 */
export type WsMatchResult = {
  reason: EndReason;
  winner: PlayerId | null;
  ranking: WsRankedEntry[];
};

export type WsServerMessage =
  | { version: typeof WS_SERVER_PROTOCOL_VERSION; kind: 'welcome'; connectionId: string; roomId: string }
  | { version: typeof WS_SERVER_PROTOCOL_VERSION; kind: 'join-result'; accepted: boolean; playerIds: string[]; code?: string }
  | { version: typeof WS_SERVER_PROTOCOL_VERSION; kind: 'roster'; playerIds: string[] }
  | {
      version: typeof WS_SERVER_PROTOCOL_VERSION;
      kind: 'match-start';
      startTick: number;
      tickRate: number;
      snapshotHz: SnapshotHz;
      /** Monotonic across rematches; absent from the legacy message shape. */
      matchId?: number;
    }
  | { version: typeof WS_SERVER_PROTOCOL_VERSION; kind: 'snapshot'; snapshot: StateSnapshot }
  | { version: typeof WS_SERVER_PROTOCOL_VERSION; kind: 'error'; code: string; message: string; targetTick?: number }
  | { version: typeof WS_SERVER_PROTOCOL_VERSION; kind: 'pong'; sequence: number }
  | { version: typeof WS_SERVER_PROTOCOL_VERSION; kind: 'match-end'; tick: number; result?: WsMatchResult }
  | { version: typeof WS_SERVER_PROTOCOL_VERSION; kind: 'run-complete'; tick: number; reason: 'bounded' }
  | { version: typeof WS_SERVER_PROTOCOL_VERSION; kind: 'session-closed'; reason: SessionClosedReason };

export type WsServerDecodeOptions = {
  /**
   * When supplied, a `match-end.result.ranking` must cover exactly this roster.
   * The match-end payload itself has no roster field, so a client that knows the
   * authoritative roster opts into the stronger check.
   */
  roster?: readonly string[];
};

/**
 * A snapshot is capped at MAX_SNAPSHOT_BYTES; the fixed allowance covers the
 * small server envelope around it. The decoder rejects oversized bytes before
 * parsing so a malformed peer cannot force unbounded JSON work.
 */
export const MAX_WS_SERVER_MESSAGE_BYTES = MAX_SNAPSHOT_BYTES + 1024;

const ERROR_CODE = /^[a-z][a-z0-9-]{0,63}$/;
const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const own = (value: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const boundedText = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const slotIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= MAX_PLAYERS_PER_FRAME &&
  new Set(value).size === value.length && value.every(isSessionIdentifier);
const isSnapshotHz = (value: unknown): value is SnapshotHz =>
  SUPPORTED_SNAPSHOT_HZ.includes(value as SnapshotHz);

function messageByteLength(input: string | Uint8Array): number {
  return typeof input === 'string' ? utf8.encode(input).byteLength : input.byteLength;
}

function decodeText(input: string | Uint8Array): string {
  if (typeof input === 'string') {
    if (messageByteLength(input) > MAX_WS_SERVER_MESSAGE_BYTES) throw new Error('Server message exceeds size limit');
    return input;
  }
  if (!(input instanceof Uint8Array)) throw new Error('Server message must be UTF-8 text or bytes');
  if (input.byteLength > MAX_WS_SERVER_MESSAGE_BYTES) throw new Error('Server message exceeds size limit');
  try {
    return strictUtf8.decode(input);
  } catch {
    throw new Error('Server message is not valid UTF-8');
  }
}

function parseJoinResult(value: Record<string, unknown>): WsServerMessage {
  if (!keys(value, own(value, 'code')
    ? ['version', 'kind', 'accepted', 'playerIds', 'code']
    : ['version', 'kind', 'accepted', 'playerIds']) ||
      typeof value.accepted !== 'boolean' || !slotIds(value.playerIds) ||
      (own(value, 'code') && (!boundedText(value.code, 64) || !ERROR_CODE.test(value.code)))) {
    throw new Error('Malformed server message');
  }
  return {
    version: WS_SERVER_PROTOCOL_VERSION,
    kind: 'join-result',
    accepted: value.accepted,
    playerIds: [...value.playerIds],
    ...(own(value, 'code') ? { code: value.code as string } : {}),
  };
}

/**
 * Strict decoder for the optional `match-end` result. Structural invariants
 * hold without a roster; when the caller knows the authoritative roster, the
 * ranking must cover it exactly. Anything that `rankMatch` cannot produce
 * (unknown keys, duplicate ids, non-competition ranks, a winner outside rank 1)
 * is rejected instead of being trusted.
 */
function parseMatchResult(value: unknown, roster?: ReadonlySet<string>): WsMatchResult {
  if (!isRecord(value) || !keys(value, ['reason', 'winner', 'ranking']) ||
      !END_REASONS.includes(value.reason as EndReason) ||
      !(value.winner === null || isSessionIdentifier(value.winner)) ||
      !Array.isArray(value.ranking) || value.ranking.length < 1 || value.ranking.length > MAX_PLAYERS_PER_FRAME) {
    throw new Error('Malformed server message');
  }
  const seen = new Set<string>();
  const ranking: WsRankedEntry[] = value.ranking.map((entry: unknown) => {
    if (!isRecord(entry) || !keys(entry, ['id', 'rank', 'metric']) ||
        !isSessionIdentifier(entry.id) || seen.has(entry.id) ||
        !Number.isSafeInteger(entry.rank) || (entry.rank as number) < 1 ||
        // Score metrics are signed: a knockout target penalty makes a fighter's
        // score negative in Score Brawl and in wave mode's enemy slots. The
        // historical -1 floor described only Last Man Standing's unplaced
        // marker and wrongly rejected a real wave result.
        !Number.isSafeInteger(entry.metric)) {
      throw new Error('Malformed server message');
    }
    seen.add(entry.id);
    return { id: entry.id, rank: entry.rank as number, metric: entry.metric as number };
  });
  // Competition ranks are non-decreasing and either tie with the previous place
  // or skip to the next unshared place (1, 1, 3 - never 1, 1, 2).
  for (let index = 0; index < ranking.length; index++) {
    const rank = ranking[index].rank;
    if (index === 0) {
      if (rank !== 1) throw new Error('Malformed server message');
    } else if (rank !== ranking[index - 1].rank && rank !== index + 1) {
      throw new Error('Malformed server message');
    }
  }
  const top = ranking.filter(entry => entry.rank === 1);
  if (value.winner !== null &&
      (top.length !== 1 || top[0].id !== value.winner)) {
    throw new Error('Malformed server message');
  }
  if (roster !== undefined) {
    if (ranking.length !== roster.size) throw new Error('Malformed server message');
    for (const playerId of roster) {
      if (!seen.has(playerId)) throw new Error('Malformed server message');
    }
    if (value.winner !== null && !roster.has(value.winner)) throw new Error('Malformed server message');
  }
  return { reason: value.reason as EndReason, winner: value.winner as PlayerId | null, ranking };
}

function parseServerMessage(value: unknown, roster?: ReadonlySet<string>): WsServerMessage {
  if (!isRecord(value) || value.version !== WS_SERVER_PROTOCOL_VERSION || typeof value.kind !== 'string') {
    throw new Error('Unsupported server message');
  }
  switch (value.kind) {
    case 'welcome':
      if (!keys(value, ['version', 'kind', 'connectionId', 'roomId']) ||
          !isSessionIdentifier(value.connectionId) || !isSessionIdentifier(value.roomId)) {
        throw new Error('Malformed server message');
      }
      return {
        version: WS_SERVER_PROTOCOL_VERSION,
        kind: 'welcome',
        connectionId: value.connectionId,
        roomId: value.roomId,
      };
    case 'join-result':
      return parseJoinResult(value);
    case 'roster':
      if (!keys(value, ['version', 'kind', 'playerIds']) || !slotIds(value.playerIds)) {
        throw new Error('Malformed server message');
      }
      return { version: WS_SERVER_PROTOCOL_VERSION, kind: 'roster', playerIds: [...value.playerIds] };
    case 'match-start':
      if (!keys(value, own(value, 'matchId')
        ? ['version', 'kind', 'startTick', 'tickRate', 'snapshotHz', 'matchId']
        : ['version', 'kind', 'startTick', 'tickRate', 'snapshotHz']) ||
          !nonnegative(value.startTick) || !nonnegative(value.tickRate) || !isSnapshotHz(value.snapshotHz) ||
          (own(value, 'matchId') && !nonnegative(value.matchId))) {
        throw new Error('Malformed server message');
      }
      return {
        version: WS_SERVER_PROTOCOL_VERSION,
        kind: 'match-start',
        startTick: value.startTick,
        tickRate: value.tickRate,
        snapshotHz: value.snapshotHz,
        ...(own(value, 'matchId') ? { matchId: value.matchId as number } : {}),
      };
    case 'snapshot': {
      if (!keys(value, ['version', 'kind', 'snapshot'])) throw new Error('Malformed server message');
      return { version: WS_SERVER_PROTOCOL_VERSION, kind: 'snapshot', snapshot: parseStateSnapshot(value.snapshot) };
    }
    case 'error':
      if (!keys(value, own(value, 'targetTick')
        ? ['version', 'kind', 'code', 'message', 'targetTick']
        : ['version', 'kind', 'code', 'message']) ||
          !boundedText(value.code, 64) || !ERROR_CODE.test(value.code) ||
          !boundedText(value.message) || (own(value, 'targetTick') && !nonnegative(value.targetTick))) {
        throw new Error('Malformed server message');
      }
      return {
        version: WS_SERVER_PROTOCOL_VERSION,
        kind: 'error',
        code: value.code,
        message: value.message,
        ...(own(value, 'targetTick') ? { targetTick: value.targetTick as number } : {}),
      };
    case 'pong':
      if (!keys(value, ['version', 'kind', 'sequence']) || !nonnegative(value.sequence)) {
        throw new Error('Malformed server message');
      }
      return { version: WS_SERVER_PROTOCOL_VERSION, kind: 'pong', sequence: value.sequence };
    case 'match-end': {
      if (!keys(value, own(value, 'result')
        ? ['version', 'kind', 'tick', 'result']
        : ['version', 'kind', 'tick']) || !nonnegative(value.tick)) {
        throw new Error('Malformed server message');
      }
      return {
        version: WS_SERVER_PROTOCOL_VERSION,
        kind: 'match-end',
        tick: value.tick,
        ...(own(value, 'result') ? { result: parseMatchResult(value.result, roster) } : {}),
      };
    }
    case 'run-complete':
      if (!keys(value, ['version', 'kind', 'tick', 'reason']) ||
          !nonnegative(value.tick) || value.reason !== 'bounded') {
        throw new Error('Malformed server message');
      }
      return { version: WS_SERVER_PROTOCOL_VERSION, kind: 'run-complete', tick: value.tick, reason: 'bounded' };
    case 'session-closed':
      if (!keys(value, ['version', 'kind', 'reason']) ||
          (value.reason !== 'host-lost' && value.reason !== 'match-complete')) {
        throw new Error('Malformed server message');
      }
      return { version: WS_SERVER_PROTOCOL_VERSION, kind: 'session-closed', reason: value.reason };
    default:
      throw new Error('Unknown server message kind');
  }
}

/** Strict decoder for server-authored bytes. Rejects unknown versions, kinds, fields and sizes. */
export function decodeWsServerMessage(
  input: string | Uint8Array,
  options: WsServerDecodeOptions = {},
): WsServerMessage {
  const text = decodeText(input);
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Server message is not valid JSON');
  }
  return parseServerMessage(decoded, options.roster === undefined ? undefined : new Set(options.roster));
}

/** Validates then serializes one server message; never emits an unreadable payload. */
export function encodeWsServerMessage(message: WsServerMessage): string {
  const json = JSON.stringify(parseServerMessage(message));
  if (messageByteLength(json) > MAX_WS_SERVER_MESSAGE_BYTES) throw new Error('Server message exceeds size limit');
  return json;
}
