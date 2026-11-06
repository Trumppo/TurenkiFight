import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { TICK_RATE } from '../../src/game/simulation/step';
import { MODE_IDS } from '../../src/game/simulation/modes';
import { MAX_PLAYERS } from '../../src/game/protocol/players';
import type { ModeId } from '../../src/game/simulation/types';
import { SUPPORTED_SNAPSHOT_HZ, type SnapshotHz } from '../../src/game/networking/wsMessages';
import {
  isRoomCode,
  isSessionIdentifier,
  normalizeRoomCode,
} from '../../src/game/session/sessionEnvelope';
import type { AuthoritativeWsSession } from './authoritativeWsSession';
import {
  CLIENT_MESSAGE_POLICY,
  CLIENT_MESSAGE_WINDOW_MS,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_CLIENT_MESSAGES_PER_WINDOW,
  MAX_CLIENT_VALIDATION_FAILURES,
} from './clientMessageLimits';
import { startWsServer, type WsServerEnvelopeEvent, type WsServerEvent } from './wsServer';

/**
 * Real-match server mode for the architecture-A WebSocket prototype.
 *
 * This is a thin operator-facing wrapper around `startWsServer`, which in turn
 * wraps `AuthoritativeWsSession` and `SessionEnvelopeGateway`. It is not the
 * benchmark fixture driver: it writes no manifest, asserts no fingerprint and
 * never waits for a synthetic input schedule. Clients join, play and leave like
 * any other session; the server stays authoritative and deterministic.
 *
 * Honest scope:
 * - plain `ws://` by default; `tls` PEM material switches the listener to
 *   `https`/`wss`. There is still no authentication, origin check or rate
 *   limiting;
 * - an optional short room code is required on join when configured; it is
 *   admission, not authentication;
 * - the room has a hard socket cap (roster plus a documented margin) printed in
 *   the ready line; surplus sockets are closed before registration;
 * - every connection has the documented message-size, message-rate and
 *   consecutive-validation-failure budget; a breach closes that socket with a
 *   typed close code and frees its slot immediately. These are policy limits,
 *   not measured network performance;
 * - no client prediction, so input-to-render latency is RTT plus up to one
 *   snapshot interval;
 * - a match starts when every configured slot is claimed (auto) or when an
 *   operator explicitly requests it once the roster is full (manual). Explicit
 *   start never relaxes the session rule that requires a full roster;
 * - extra connections are closed before registration, so they cannot join,
 *   take a slot or delay a running match.
 */

export const DEFAULT_MATCH_HOST = '127.0.0.1';
export const DEFAULT_MATCH_PORT = 8787;
export const DEFAULT_MATCH_ROOM_ID = 'match';
/**
 * Extra sockets allowed above the player roster. The cap is documented and
 * printed in the ready line; it leaves room for an observer or a reconnect
 * hand-off without disturbing a running match.
 */
export const DEFAULT_MATCH_CONNECTION_MARGIN = 2;
/** Generated codes avoid characters that are easy to confuse when read aloud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
/** Roster bound derived from the single `MAX_PLAYERS` source of truth. */
export const MAX_MATCH_PLAYERS = MAX_PLAYERS;
/**
 * Operator default roster size. This is a default, not a cap: `--players` may
 * request any value in 1..MAX_MATCH_PLAYERS.
 */
export const DEFAULT_MATCH_PLAYERS = 4; // cap-scan-allow: operator default roster, not the supported cap
export const DEFAULT_MATCH_SNAPSHOT_HZ: SnapshotHz = 20;

export type MatchStartMode = 'auto' | 'manual';

/** PEM contents, already read from the operator's files. */
export type MatchTlsMaterial = {
  readonly cert: string;
  readonly key: string;
};

export type MatchReadyInfo = {
  /** `null` for a wildcard bind such as `0.0.0.0`, which has no usable URL. */
  readonly url: string | null;
  readonly host: string;
  readonly port: number;
  readonly roomId: string;
  /** Admission code when one is enforced; `null` for the legacy no-code mode. */
  readonly roomCode: string | null;
  /** Hard socket cap for this room (roster plus the configured margin). */
  readonly maxConnections: number;
  /** Largest accepted client message, in UTF-8 bytes. */
  readonly maxMessageBytes: number;
  /** Sliding message-rate window length in milliseconds. */
  readonly messageRateWindowMs: number;
  /** Messages allowed per sliding window on one connection. */
  readonly maxMessagesPerWindow: number;
  /** Consecutive invalid messages before that connection is closed. */
  readonly maxValidationFailures: number;
  readonly playerIds: readonly string[];
  readonly snapshotHz: SnapshotHz;
  readonly startMode: MatchStartMode;
  /** Match rules this server creates. Score Brawl is the default. */
  readonly mode: ModeId;
  /** True when the listener is HTTPS/WSS. */
  readonly secure: boolean;
};

export type MatchStartFailureReason = 'roster-incomplete' | 'already-started' | 'not-startable' | 'closed';

export type MatchStartResult = {
  readonly started: boolean;
  readonly reason?: MatchStartFailureReason;
};

export type MatchServerOptions = {
  host?: string;
  port?: number;
  /** Simulation roster; 1..MAX_MATCH_PLAYERS unique identifiers. Defaults to P1..P4. */
  playerIds?: readonly string[];
  /**
   * Optional admission code. When set, every join must carry it and a missing
   * or wrong code is denied before a slot is allocated. Undefined preserves the
   * historical code-less sessions so existing callers and tests stay valid;
   * `serve:match` always supplies a generated or fixed code.
   */
  roomCode?: string;
  /** Extra sockets above the roster. Defaults to DEFAULT_MATCH_CONNECTION_MARGIN. */
  connectionMargin?: number;
  /** PEM material; both values together switch the listener to HTTPS/WSS. */
  tls?: MatchTlsMaterial;
  /** Match rules chosen at creation; unknown ids are rejected, never defaulted. */
  mode?: ModeId;
  snapshotHz?: SnapshotHz;
  startMode?: MatchStartMode;
  /** Delay after the roster fills before the match enters `running` (auto mode). */
  startDelayMs?: number;
  /** Delay after `match-start` before the first authoritative tick. */
  firstTickDelayMs?: number;
  /**
   * Opt in to a results-phase rematch in this process. Default false keeps the
   * historical one-match lifecycle and every existing runbook unchanged.
   */
  allowRematch?: boolean;
  /** Human-readable lifecycle status. Never contains a client's remote address. */
  log?: (line: string) => void;
  /** Called once after the socket binds, with the advertised connection info. */
  onReady?: (info: MatchReadyInfo) => void;
};

export type MatchServerHandle = {
  readonly host: string;
  readonly port: number;
  readonly url: string | null;
  readonly ready: MatchReadyInfo;
  readonly room: AuthoritativeWsSession;
  /** Explicit start request. Only succeeds for a full roster in `starting`. */
  start(): MatchStartResult;
  /** Stops the tick timer, closes every socket and releases the listening port. */
  close(): Promise<void>;
};

export type ServeMatchCliOptions = {
  host: string;
  port: number;
  playerIds: readonly string[];
  snapshotHz: SnapshotHz;
  startMode: MatchStartMode;
  mode: ModeId;
  /** Fixed room code, already normalized; null means generate one. */
  roomCode: string | null;
  /** TLS certificate path; null when TLS is off. */
  cert: string | null;
  /** TLS private-key path; null when TLS is off. */
  key: string | null;
  /** Opt in to repeated matches in one process (default false). */
  rematch: boolean;
  help: boolean;
};

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

/** A wildcard bind cannot be dialled, so the ready line carries host/port only. */
export function matchConnectUrl(host: string, port: number, secure = false): string | null {
  if (isWildcardHost(host)) return null;
  const formatted = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${secure ? 'wss' : 'ws'}://${formatted}:${port}`;
}

function validateHost(raw: string): string {
  if (raw.includes('://')) throw new Error(`Host must be an address, not a URL: ${raw}`);
  if (!/^[A-Za-z0-9._:[\]-]{1,253}$/.test(raw)) throw new Error(`Invalid host: ${raw}`);
  return raw;
}

function parsePort(raw: string): number {
  if (!/^\d{1,5}$/.test(raw)) throw new Error(`Invalid port: ${raw}`);
  const value = Number(raw);
  if (value > 65535) throw new Error(`Invalid port: ${raw}`);
  return value;
}

function parsePlayers(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid player count: ${raw}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_MATCH_PLAYERS) {
    throw new Error(`Player count must be 1..${MAX_MATCH_PLAYERS}: ${raw}`);
  }
  return value;
}

function parseSnapshotHz(raw: string): SnapshotHz {
  const value = Number(raw);
  if (!SUPPORTED_SNAPSHOT_HZ.includes(value as SnapshotHz)) {
    throw new Error(`Unsupported snapshot rate: ${raw} (expected ${SUPPORTED_SNAPSHOT_HZ.join(', ')} Hz)`);
  }
  return value as SnapshotHz;
}

function parseStartMode(raw: string): MatchStartMode {
  if (raw !== 'auto' && raw !== 'manual') {
    throw new Error(`Invalid start mode: ${raw} (expected auto or manual)`);
  }
  return raw;
}

/** Unknown modes fail here instead of silently falling back to Score Brawl. */
function parseMode(raw: string): ModeId {
  if (!(MODE_IDS as readonly string[]).includes(raw)) {
    throw new Error(`Invalid mode: ${raw} (expected ${MODE_IDS.join(', ')})`);
  }
  return raw as ModeId;
}

export function matchPlayerIds(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

/**
 * Deterministic-friendly room code generator. The injected `nextInt` exists so
 * tests can pin the alphabet; it has nothing to do with simulation randomness.
 */
export function generateRoomCode(
  nextInt: (maxExclusive: number) => number = max => randomInt(max),
): string {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index++) {
    code += ROOM_CODE_ALPHABET[nextInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Canonical operator room code, or a clear argument error. */
export function parseRoomCode(raw: string): string {
  const code = normalizeRoomCode(raw);
  if (!isRoomCode(code)) {
    throw new Error(`Invalid room code: ${raw} (4-12 letters or digits)`);
  }
  return code;
}

/**
 * Reads and validates operator PEM files. Missing or malformed material fails
 * before any socket is bound, with the offending path in the message.
 */
export function loadTlsFiles(certPath: string, keyPath: string): MatchTlsMaterial {
  const read = (label: string, path: string): string => {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot read TLS ${label} ${path}: ${detail}`);
    }
    if (text.trim().length === 0) throw new Error(`TLS ${label} ${path} is empty`);
    return text;
  };
  const cert = read('certificate', certPath);
  const key = read('private key', keyPath);
  try {
    createSecureContext({ cert, key });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid TLS certificate or key: ${detail}`);
  }
  return { cert, key };
}

/**
 * Parses `--name=value` (and `--name value`) flags for `npm run serve:match`.
 * Pure and synchronous so the CLI stays a thin loop and argument errors are
 * testable.
 */
export function parseServeMatchArgs(argv: readonly string[]): ServeMatchCliOptions {
  let host = DEFAULT_MATCH_HOST;
  let port = DEFAULT_MATCH_PORT;
  let playerCount = DEFAULT_MATCH_PLAYERS;
  let snapshotHz = DEFAULT_MATCH_SNAPSHOT_HZ;
  let startMode: MatchStartMode = 'auto';
  let mode: ModeId = 'score-brawl';
  let roomCode: string | null = null;
  let cert: string | null = null;
  let key: string | null = null;
  let rematch = false;
  let help = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--rematch') {
      rematch = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const separator = arg.indexOf('=');
    // Both `--name=value` (the runbook form) and `--name value` are accepted.
    const name = separator < 0 ? arg.slice(2) : arg.slice(2, separator);
    let value: string;
    if (separator >= 0) {
      value = arg.slice(separator + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Argument must be --name=value or --name value: ${arg}`);
      }
      value = next;
      index += 1;
    }
    switch (name) {
      case 'host':
        host = validateHost(value);
        break;
      case 'port':
        port = parsePort(value);
        break;
      case 'players':
        playerCount = parsePlayers(value);
        break;
      case 'snapshot-hz':
        snapshotHz = parseSnapshotHz(value);
        break;
      case 'start':
        startMode = parseStartMode(value);
        break;
      case 'mode':
        mode = parseMode(value);
        break;
      case 'room':
        roomCode = parseRoomCode(value);
        break;
      case 'cert':
        if (value.length === 0) throw new Error('--cert requires a PEM file path');
        cert = value;
        break;
      case 'key':
        if (value.length === 0) throw new Error('--key requires a PEM file path');
        key = value;
        break;
      default:
        throw new Error(`Unknown option: --${name}`);
    }
  }

  if (!help && (cert === null) !== (key === null)) {
    throw new Error('--cert and --key must be provided together for https/wss');
  }

  return {
    host,
    port,
    playerIds: help ? [] : matchPlayerIds(playerCount),
    snapshotHz,
    startMode,
    mode,
    roomCode,
    cert,
    key,
    rematch,
    help,
  };
}

export function serveMatchUsage(): string {
  return [
    'Usage: npm run serve:match -- [options]',
    '',
    'Options:',
    '  --host=<address>     Bind address (default 127.0.0.1; 0.0.0.0 for a LAN)',
    '  --port=<number>      Bind port 0..65535 (default 8787; 0 = ephemeral)',
    `  --players=<1-${MAX_MATCH_PLAYERS}>      Claimable slots P1..PN (default ${DEFAULT_MATCH_PLAYERS})`,
    '  --snapshot-hz=<hz>   Snapshot rate 10, 20 or 30 (default 20)',
    '  --start=<mode>       auto starts when the roster is full; manual waits for a',
    '                       "start" line on stdin (default auto)',
    '  --mode=<mode>        score-brawl, last-man-standing or deathmatch',
    '                       (default score-brawl; unknown modes are rejected)',
    '  --room=<code>        Fixed 4-12 character room code (default: generated)',
    '  --cert=<pem>         TLS certificate chain (PEM) for https/wss',
    '  --key=<pem>          TLS private key (PEM); must be paired with --cert',
    '  --rematch            Allow a results-phase rematch with the full roster in',
    '                       this process (default off: one match per process)',
    '  --help               Show this text',
    '',
    'Per-connection policy (fixed, not measured):',
    `  at most ${MAX_CLIENT_MESSAGE_BYTES} bytes per message, ` +
      `${MAX_CLIENT_MESSAGES_PER_WINDOW} messages per ${CLIENT_MESSAGE_WINDOW_MS} ms,`,
    `  and ${MAX_CLIENT_VALIDATION_FAILURES} consecutive invalid messages. Exceeding`,
    '  any limit closes that connection and frees its room slot immediately.',
    '',
    'Flags also accept a separate value: --cert cert.pem --key key.pem',
    '',
    'stdin controls:',
    '  start                Request an explicit start (the roster must be full)',
    '  quit | stop          Stop the server cleanly (same as SIGINT/SIGTERM)',
    '',
    'Prints one JSON ready line on stdout, then human-readable status on stderr.',
    'Without --cert/--key the server speaks plain ws://: LAN or VPN only, never',
    'the open internet. With both it serves https/wss using the operator key.',
  ].join('\n');
}

/** One machine-readable line; no account credentials, key material, peer addresses or metrics. */
export function formatMatchReadyLine(info: MatchReadyInfo): string {
  return JSON.stringify({
    kind: 'match-server-ready',
    url: info.url,
    host: info.host,
    port: info.port,
    roomId: info.roomId,
    roomCode: info.roomCode,
    maxConnections: info.maxConnections,
    maxMessageBytes: info.maxMessageBytes,
    messageRateWindowMs: info.messageRateWindowMs,
    maxMessagesPerWindow: info.maxMessagesPerWindow,
    maxValidationFailures: info.maxValidationFailures,
    players: [...info.playerIds],
    snapshotHz: info.snapshotHz,
    tickRate: TICK_RATE,
    startMode: info.startMode,
    mode: info.mode,
    secure: info.secure,
  });
}

function phaseMessage(phase: string, startMode: MatchStartMode): string {
  switch (phase) {
    case 'lobby':
      return 'waiting for players';
    case 'starting':
      return startMode === 'manual'
        ? 'roster complete; type "start" and press Enter to begin'
        : 'roster complete; starting the match';
    case 'running':
      return 'match running; authoritative 60 Hz ticks with no prediction';
    case 'results':
      return 'match finished; session stays open until the host leaves or the server stops';
    case 'closed':
      return 'session closed; authority revoked';
    default:
      return `phase ${phase}`;
  }
}

function validateRoster(playerIds: readonly string[]): readonly string[] {
  if (!Array.isArray(playerIds) || playerIds.length < 1 || playerIds.length > MAX_MATCH_PLAYERS) {
    throw new Error(`Match roster requires 1..${MAX_MATCH_PLAYERS} slots`);
  }
  if (!playerIds.every(isSessionIdentifier) || new Set(playerIds).size !== playerIds.length) {
    throw new Error('Match roster requires unique valid player identifiers');
  }
  return [...playerIds];
}

/** Bounded wait so `close()` reports a settled room instead of a racing one. */
const CLOSE_SETTLE_MS = 1000;

async function settleDisconnect(room: AuthoritativeWsSession): Promise<void> {
  const deadline = Date.now() + CLOSE_SETTLE_MS;
  while (room.connectionCount > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/**
 * Binds the match socket and returns an operator handle. The match itself is
 * driven by the existing 60 Hz interval tick loop inside `startWsServer`.
 */
export async function startMatchServer(options: MatchServerOptions = {}): Promise<MatchServerHandle> {
  const host = validateHost(options.host ?? DEFAULT_MATCH_HOST);
  const port = options.port ?? DEFAULT_MATCH_PORT;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${String(port)}`);
  const playerIds = validateRoster(options.playerIds ?? matchPlayerIds(DEFAULT_MATCH_PLAYERS));
  const snapshotHz = options.snapshotHz ?? DEFAULT_MATCH_SNAPSHOT_HZ;
  if (!SUPPORTED_SNAPSHOT_HZ.includes(snapshotHz)) {
    throw new Error(`Unsupported snapshot rate: ${String(snapshotHz)}`);
  }
  const startMode = options.startMode ?? 'auto';
  if (startMode !== 'auto' && startMode !== 'manual') throw new Error(`Invalid start mode: ${String(startMode)}`);
  const mode = options.mode ?? 'score-brawl';
  if (!(MODE_IDS as readonly string[]).includes(mode)) {
    throw new Error(`Invalid match mode: ${String(mode)} (expected ${MODE_IDS.join(', ')})`);
  }
  const roomCode = options.roomCode === undefined ? null : parseRoomCode(options.roomCode);
  const connectionMargin = options.connectionMargin ?? DEFAULT_MATCH_CONNECTION_MARGIN;
  if (!Number.isSafeInteger(connectionMargin) || connectionMargin < 0 || connectionMargin > 16) {
    throw new Error(`Invalid connection margin: ${String(connectionMargin)} (expected 0..16)`);
  }
  const maxConnections = playerIds.length + connectionMargin;
  const tls = options.tls ?? null;
  if (tls !== null && (typeof tls.cert !== 'string' || typeof tls.key !== 'string')) {
    throw new Error('TLS requires both a certificate and a private key in PEM form');
  }
  const log = options.log ?? (() => undefined);
  if (typeof log !== 'function') throw new Error('Invalid status sink');
  const onReady = options.onReady ?? null;
  if (onReady !== null && typeof onReady !== 'function') throw new Error('Invalid ready sink');

  let room: AuthoritativeWsSession | null = null;
  let closed = false;
  // A denial flood from one broken client must not flood the operator console.
  const loggedDenials = new Set<string>();

  const noteEnvelope = (event: WsServerEnvelopeEvent): void => {
    if (!event.accepted) {
      const key = `${event.connectionId}:${event.code}`;
      if (loggedDenials.has(key)) return;
      loggedDenials.add(key);
      log(`denied ${event.code} for ${event.connectionId} (${event.source})`);
      return;
    }
    if (event.kind === 'join-request') {
      log(`connection ${event.connectionId} joined ${event.playerIds.join(', ')}; ` +
        `${room?.playerCount ?? 0}/${playerIds.length} slots claimed`);
      return;
    }
    if (event.kind === 'leave-request') {
      log(`connection ${event.connectionId} left; ${room?.playerCount ?? 0}/${playerIds.length} slots claimed`);
    }
    // Accepted inputs and pings are deliberately not logged: they are routine.
  };

  const noteServerEvent = (event: WsServerEvent): void => {
    switch (event.kind) {
      case 'connection-opened':
        log(`connection ${event.connectionId} opened (${event.connections}/${maxConnections} sockets)`);
        return;
      case 'connection-closed':
        log(`connection ${event.connectionId} closed` +
          `${event.closeCode === undefined ? '' : ` by policy (${event.closeCode}: ${event.reason ?? ''})`}` +
          ` (${event.connections}/${maxConnections} sockets, ` +
          `${room?.playerCount ?? 0}/${playerIds.length} slots claimed)`);
        return;
      case 'connection-rejected':
        log(event.reason === 'connection-limit'
          ? `connection rejected before registration: ${maxConnections}/${maxConnections} sockets in use`
          : 'connection rejected before registration: server is closing');
        return;
      case 'phase':
        log(phaseMessage(event.phase, startMode));
        return;
    }
  };

  const server = await startWsServer({
    host,
    port,
    roomId: DEFAULT_MATCH_ROOM_ID,
    ...(roomCode === null ? {} : { roomCode }),
    ...(tls === null ? {} : { tls }),
    playerIds,
    mode,
    snapshotHz,
    startMode,
    allowRematch: options.allowRematch === true,
    startDelayMs: options.startDelayMs,
    firstTickDelayMs: options.firstTickDelayMs,
    // Roster plus the documented margin: surplus sockets are closed before
    // registration, so they cannot join, take a slot or delay the match.
    maxConnections,
    // The operator-facing server always enforces the abuse policy; the
    // synthetic benchmark harness calls `startWsServer` without it.
    messagePolicy: CLIENT_MESSAGE_POLICY,
    onClientEnvelope: noteEnvelope,
    onServerEvent: noteServerEvent,
  });
  room = server.room;

  const ready: MatchReadyInfo = {
    url: matchConnectUrl(host, server.port, tls !== null),
    host: server.host,
    port: server.port,
    roomId: DEFAULT_MATCH_ROOM_ID,
    roomCode,
    maxConnections,
    maxMessageBytes: CLIENT_MESSAGE_POLICY.maxMessageBytes,
    messageRateWindowMs: CLIENT_MESSAGE_POLICY.windowMs,
    maxMessagesPerWindow: CLIENT_MESSAGE_POLICY.maxMessagesPerWindow,
    maxValidationFailures: CLIENT_MESSAGE_POLICY.maxValidationFailures,
    playerIds,
    snapshotHz,
    startMode,
    mode,
    secure: tls !== null,
  };
  onReady?.(ready);

  return {
    host: ready.host,
    port: ready.port,
    url: ready.url,
    ready,
    room: server.room,
    start: () => {
      if (closed || server.room.phase === 'closed') return { started: false, reason: 'closed' };
      if (server.room.phase === 'running' || server.room.phase === 'results') {
        return { started: false, reason: 'already-started' };
      }
      if (server.room.playerCount !== playerIds.length) return { started: false, reason: 'roster-incomplete' };
      return server.room.beginMatch() ? { started: true } : { started: false, reason: 'not-startable' };
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await server.close();
      await settleDisconnect(server.room);
      loggedDenials.clear();
    },
  };
}
