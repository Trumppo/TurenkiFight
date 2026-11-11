import type { AddressInfo } from 'node:net';
import { createServer as createHttpsServer } from 'node:https';
import { createSecureContext } from 'node:tls';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { TICK_RATE } from '../../src/game/simulation/step';
import type { ModeId } from '../../src/game/simulation/types';
import { encodeWsServerMessage, type SnapshotHz } from '../../src/game/networking/wsMessages';
import { MAX_SESSION_ENVELOPE_BYTES } from '../../src/game/session/sessionEnvelope';
import type { SessionEnvelopeResult } from '../../src/game/session/sessionEnvelopeGateway';
import {
  AuthoritativeWsSession,
  DEFAULT_REJOIN_WINDOW_MS,
  MAX_REJOIN_WINDOW_MS,
  type WsSessionPhase,
  type WsStepResult,
} from './authoritativeWsSession';
import {
  CLIENT_FRAME_SLACK_BYTES,
  ClientMessageGuard,
  isRoomCodeDenial,
  roomCodeCloseAction,
  type ClientMessagePolicy,
  type PolicyCloseAction,
} from './clientMessageLimits';

/**
 * Read-only observation of one client envelope after the session handled it.
 *
 * This exists so a benchmark coordinator can prove that every expected client
 * supplied fixture input for a tick before stepping it, and so its denial audit
 * is complete. It never validates, rewrites or short-circuits an envelope: the
 * authority is the existing `SessionEnvelopeGateway` decision plus the room's
 * lifecycle checks, and an observation callback that throws is contained.
 *
 * `source` records where a denial was decided:
 * - `gateway`: `SessionEnvelopeGateway` rejected the envelope (ownership,
 *   sequence, tick window, replay, malformed payload, ...);
 * - `room`: the authoritative session rejected it before the gateway saw it
 *   (`session-closed`, `match-started`, `match-complete`, `unknown-player`,
 *   `not-started`).
 */
export type WsServerEnvelopeEvent =
  | { connectionId: string; accepted: true; kind: 'join-request'; playerIds: readonly string[] }
  | { connectionId: string; accepted: true; kind: 'input'; targetTick: number }
  | { connectionId: string; accepted: true; kind: 'ping'; sequence: number }
  | { connectionId: string; accepted: true; kind: 'leave-request' }
  | { connectionId: string; accepted: true; kind: 'rematch' }
  | { connectionId: string; accepted: true; kind: 'ready-request'; playerIds?: readonly string[] }
  | { connectionId: string; accepted: true; kind: 'start-request' }
  | { connectionId: string; accepted: false; code: string; source: 'gateway' | 'room' };

/**
 * Read-only transport/lifecycle observation for an operator-facing server role.
 * It is reported after the decision was made, so a throwing callback (or slow
 * logging sink) can never accept, reject, reorder or delay a client envelope.
 *
 * `closeCode`/`reason` are present when the transport itself closed the socket
 * for a policy reason (rate limit, oversized message, admission failure).
 */
export type WsServerEvent =
  | { kind: 'connection-opened'; connectionId: string; connections: number }
  | {
    kind: 'connection-closed';
    connectionId: string;
    connections: number;
    closeCode?: number;
    reason?: string;
  }
  | { kind: 'connection-rejected'; reason: 'connection-limit' | 'server-closed' }
  | { kind: 'phase'; phase: WsSessionPhase };

/**
 * Thin Node WebSocket transport around `AuthoritativeWsSession`.
 *
 * The only trusted identity a socket gets is the ID allocated here; nothing in
 * a client payload can set or influence it. Supplying PEM certificate and key
 * material switches the listener to HTTPS/WSS. There is still no
 * authentication and no origin check; the room code is admission only and is
 * not an account or a secret with cryptographic guarantees.
 *
 * An optional {@link WsServerConfig.messagePolicy} enforces a per-connection
 * size/rate/validation budget. It is opt-in because the deterministic benchmark
 * harness deliberately submits synthetic bursts on loopback; the
 * operator-facing `startMatchServer` always supplies the documented policy.
 */
export type WsServerConfig = {
  port: number;
  host?: string;
  roomId?: string;
  /**
   * Optional admission code. When set, every join must carry the matching
   * `roomCode` or the gateway denies it before a slot is allocated.
   */
  roomCode?: string;
  /** Simulation roster; the default is the historical P1..P4, up to MAX_PLAYERS. */
  playerIds?: readonly string[];
  /** Match rules chosen at session creation. Defaults to Score Brawl. */
  mode?: ModeId;
  /**
   * TLS material (PEM text). When supplied the server listens as HTTPS/WSS;
   * without it the historical plain `ws://` transport is unchanged.
   */
  tls?: { readonly cert: string; readonly key: string };
  snapshotHz?: SnapshotHz;
  maxLead?: number;
  maxTicks?: number;
  /** Opt-in repeatable session; see `AuthoritativeWsSession`. Default false. */
  allowRematch?: boolean;
  /**
   * How long a non-host player's slot stays reserved after a mid-match drop.
   * Defaults to `DEFAULT_REJOIN_WINDOW_MS`; `0` restores immediate revocation.
   */
  rejoinWindowMs?: number;
  /** Delay after the roster fills before the match enters `running`. */
  startDelayMs?: number;
  /** Delay after `match-start` before the first authoritative tick. */
  firstTickDelayMs?: number;
  /** `interval` drives 60 Hz with timers; `manual` lets tests call stepOnce. */
  tickMode?: 'interval' | 'manual';
  /**
   * `auto` (default) begins the match once the roster is full. `manual` leaves
   * the session in `starting` until the caller invokes `room.beginMatch()`, so
   * an operator can hold the start. Neither mode changes roster or authority
   * rules: `beginMatch()` still requires every configured slot to be claimed.
   */
  startMode?: 'auto' | 'manual';
  /**
   * Transport cap. Sockets beyond the cap are closed before they are registered,
   * so an unexpected connection cannot join, occupy a slot or delay a run.
   * Undefined keeps the transport unbounded as before.
   */
  maxConnections?: number;
  /**
   * Per-connection abuse policy. Undefined keeps the historical harness
   * behaviour (no message budget); `startMatchServer` always supplies the
   * exported policy constants. Exceeding a limit closes that socket with a
   * typed close code and frees its room slot immediately.
   */
  messagePolicy?: ClientMessagePolicy;
  /** Benchmark-only, read-only envelope observation; never affects semantics. */
  onClientEnvelope?: (event: WsServerEnvelopeEvent) => void;
  /** Read-only connection/phase observation for an operator-facing server. */
  onServerEvent?: (event: WsServerEvent) => void;
};

export type WsServerHandle = {
  readonly room: AuthoritativeWsSession;
  readonly port: number;
  readonly host: string;
  stepOnce(): WsStepResult;
  close(): Promise<void>;
};

const DEFAULT_START_DELAY_MS = 250;
const DEFAULT_FIRST_TICK_DELAY_MS = 150;
const CLOSE_FLUSH_MS = 100;
/** Bounded wait for the graceful close handshake during shutdown. */
const CLOSE_SETTLE_MS = 500;

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function rawBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}

function projectionMessage(message: string): boolean {
  return message === 'snapshot' || message === 'match-start' || message === 'match-end' || message === 'run-complete';
}

function envelopeEvent(connectionId: string, result: SessionEnvelopeResult): WsServerEnvelopeEvent {
  if (!result.accepted) return { connectionId, accepted: false, code: result.code, source: 'gateway' };
  const envelope = result.envelope;
  switch (envelope.kind) {
    case 'join-request':
      return { connectionId, accepted: true, kind: 'join-request', playerIds: [...envelope.playerIds] };
    case 'input':
      return { connectionId, accepted: true, kind: 'input', targetTick: envelope.targetTick };
    case 'ping':
      return { connectionId, accepted: true, kind: 'ping', sequence: envelope.sequence };
    case 'leave-request':
      return { connectionId, accepted: true, kind: 'leave-request' };
    case 'rematch':
      return { connectionId, accepted: true, kind: 'rematch' };
    case 'ready-request':
      return {
        connectionId,
        accepted: true,
        kind: 'ready-request',
        ...(envelope.playerIds === undefined ? {} : { playerIds: [...envelope.playerIds] }),
      };
    case 'start-request':
      return { connectionId, accepted: true, kind: 'start-request' };
  }
}

export async function startWsServer(config: WsServerConfig): Promise<WsServerHandle> {
  if (!Number.isSafeInteger(config?.port) || config.port < 0 || config.port > 65535) {
    throw new Error('Invalid WebSocket port');
  }
  const tls = config.tls ?? null;
  if (tls !== null) {
    if (typeof tls.cert !== 'string' || tls.cert.trim().length === 0 ||
        typeof tls.key !== 'string' || tls.key.trim().length === 0) {
      throw new Error('TLS requires both a certificate and a private key in PEM form');
    }
    // Fail during construction, not on the first handshake: an invalid PEM must
    // stop the operator immediately with a clear message.
    try {
      createSecureContext({ cert: tls.cert, key: tls.key });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid TLS certificate or key: ${detail}`);
    }
  }
  const host = config.host ?? '127.0.0.1';
  const startDelayMs = config.startDelayMs ?? DEFAULT_START_DELAY_MS;
  const firstTickDelayMs = config.firstTickDelayMs ?? DEFAULT_FIRST_TICK_DELAY_MS;
  if (!nonnegativeInteger(startDelayMs) || !nonnegativeInteger(firstTickDelayMs)) {
    throw new Error('Invalid start delay');
  }
  const maxConnections = config.maxConnections ?? null;
  if (maxConnections !== null && (!nonnegativeInteger(maxConnections) || maxConnections < 1)) {
    throw new Error('Invalid connection limit');
  }
  const messagePolicy = config.messagePolicy ?? null;
  if (messagePolicy !== null) {
    // Constructing a guard validates every policy field without allocating one
    // per connection yet.
    new ClientMessageGuard(messagePolicy);
  }
  const rejoinWindowMs = config.rejoinWindowMs ?? DEFAULT_REJOIN_WINDOW_MS;
  if (!nonnegativeInteger(rejoinWindowMs) || rejoinWindowMs > MAX_REJOIN_WINDOW_MS) {
    throw new Error('Invalid rejoin window');
  }
  const onClientEnvelope = config.onClientEnvelope ?? null;
  if (onClientEnvelope !== null && typeof onClientEnvelope !== 'function') {
    throw new Error('Invalid envelope observer');
  }
  const onServerEvent = config.onServerEvent ?? null;
  if (onServerEvent !== null && typeof onServerEvent !== 'function') {
    throw new Error('Invalid server event observer');
  }
  const tickMode = config.tickMode ?? 'interval';
  if (tickMode !== 'interval' && tickMode !== 'manual') throw new Error('Invalid tick mode');
  const startMode = config.startMode ?? 'auto';
  if (startMode !== 'auto' && startMode !== 'manual') throw new Error('Invalid start mode');
  const tickIntervalMs = 1000 / TICK_RATE;

  // A benchmark observer must never influence authority: a throwing callback is
  // reported and dropped, exactly like a failed outgoing encode.
  const notifyEnvelope = (event: WsServerEnvelopeEvent): void => {
    try {
      onClientEnvelope?.(event);
    } catch (error) {
      process.stderr.write(`ws prototype: envelope observer failed: ${String(error)}\n`);
    }
  };
  const observeResult = (connectionId: string, result: SessionEnvelopeResult): void => {
    notifyEnvelope(envelopeEvent(connectionId, result));
  };
  const notifyServerEvent = (event: WsServerEvent): void => {
    try {
      onServerEvent?.(event);
    } catch (error) {
      process.stderr.write(`ws prototype: server event observer failed: ${String(error)}\n`);
    }
  };

  const sockets = new Map<string, WebSocket>();
  const guards = new Map<string, ClientMessageGuard>();
  let nextConnectionId = 1;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setTimeout> | null = null;
  let rejoinTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let nextTickAt = 0;

  const send = (connectionId: string, message: string): void => {
    const socket = sockets.get(connectionId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(message, error => {
      if (error) socket.terminate();
    });
  };

  const broadcast = (message: string, includeUnjoined: boolean): void => {
    for (const [connectionId, socket] of sockets) {
      if (!includeUnjoined && !room.isJoined(connectionId)) continue;
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(message, error => {
        if (error) socket.terminate();
      });
    }
  };

  /**
   * Revokes a peer immediately: the connection slot, its room slots and its
   * sequence domain are released before the close handshake finishes. Waiting
   * for the peer to acknowledge the close would let a rejected client keep
   * consuming the room's connection margin.
   */
  const closePeer = (connectionId: string, action: PolicyCloseAction): void => {
    const socket = sockets.get(connectionId);
    if (!socket) return;
    sockets.delete(connectionId);
    guards.delete(connectionId);
    // `disconnect` is what frees player slots and queued input; if this peer
    // was the host the existing host-lost lifecycle still applies. A policy
    // closure is not a recoverable drop, so it never leaves a rejoin slot.
    room.disconnect(connectionId, { reserve: false });
    notifyServerEvent({
      kind: 'connection-closed',
      connectionId,
      connections: sockets.size,
      closeCode: action.closeCode,
      reason: action.reason,
    });
    if (socket.readyState === WebSocket.OPEN) {
      // Any already-queued error frame is sent before this close frame.
      socket.close(action.closeCode, action.reason);
    } else {
      try {
        socket.terminate();
      } catch {
        // Already closed.
      }
    }
  };

  const clearTimers = (): void => {
    if (startTimer) clearTimeout(startTimer);
    if (tickTimer) clearTimeout(tickTimer);
    if (rejoinTimer) clearTimeout(rejoinTimer);
    startTimer = null;
    tickTimer = null;
    rejoinTimer = null;
  };

  /**
   * A reservation may outlive the tick loop (for example the match ends while a
   * slot is held). One bounded timer per pending reservation releases it even
   * when no message or tick arrives; the interval loop usually expires it first.
   */
  const scheduleRejoinExpiry = (): void => {
    if (closed || rejoinTimer !== null || room.reservationCount === 0) return;
    rejoinTimer = setTimeout(() => {
      rejoinTimer = null;
      if (closed) return;
      room.expireReservations();
      scheduleRejoinExpiry();
    }, Math.max(25, Math.min(1000, room.rejoinWindowMsValue)));
    // Never keep a process alive solely for an expiry check.
    (rejoinTimer as { unref?: () => void }).unref?.();
  };

  function tick(): void {
    if (closed || room.phase !== 'running' || room.isRunComplete) {
      tickTimer = null;
      return;
    }
    room.stepOnce();
    if (room.isRunComplete) {
      tickTimer = null;
      return;
    }
    nextTickAt += tickIntervalMs;
    const now = performance.now();
    // A long stall must not produce an unbounded catch-up burst.
    if (now - nextTickAt > tickIntervalMs * 10) nextTickAt = now + tickIntervalMs;
    tickTimer = setTimeout(tick, Math.max(0, nextTickAt - performance.now()));
  }

  function scheduleFirstTick(): void {
    if (tickMode !== 'interval' || closed) return;
    nextTickAt = performance.now() + firstTickDelayMs;
    tickTimer = setTimeout(tick, firstTickDelayMs);
  }

  function scheduleStart(): void {
    // Manual mode never starts on its own; the caller invokes `beginMatch()`.
    if (tickMode !== 'interval' || closed || startMode !== 'auto') return;
    if (room.phase !== 'starting') return;
    startTimer = setTimeout(() => {
      startTimer = null;
      room.beginMatch();
    }, startDelayMs);
  }

  function closeSockets(): void {
    clearTimers();
    for (const socket of sockets.values()) {
      // Flush already-sent messages before a graceful close.
      socket.close(1000, 'session closed');
    }
    sockets.clear();
    guards.clear();
  }

  const room = new AuthoritativeWsSession({
    ...(config.roomId === undefined ? {} : { roomId: config.roomId }),
    ...(config.roomCode === undefined ? {} : { roomCode: config.roomCode }),
    ...(config.playerIds === undefined ? {} : { playerIds: config.playerIds }),
    ...(config.mode === undefined ? {} : { mode: config.mode }),
    ...(config.snapshotHz === undefined ? {} : { snapshotHz: config.snapshotHz }),
    ...(config.maxLead === undefined ? {} : { maxLead: config.maxLead }),
    ...(config.maxTicks === undefined ? {} : { maxTicks: config.maxTicks }),
    ...(config.allowRematch === undefined ? {} : { allowRematch: config.allowRematch }),
    rejoinWindowMs,
    onOutgoing: (targetConnectionId, message) => {
      let encoded: string;
      try {
        encoded = encodeWsServerMessage(message);
      } catch (error) {
        // A codec failure must not take the process down; drop this message.
        process.stderr.write(`ws prototype: failed to encode ${message.kind}: ${String(error)}\n`);
        return;
      }
      if (targetConnectionId === null) {
        broadcast(encoded, !projectionMessage(message.kind));
      } else {
        send(targetConnectionId, encoded);
      }
    },
    onPhaseChange: (phase: WsSessionPhase) => {
      notifyServerEvent({ kind: 'phase', phase });
      if (phase === 'lobby') {
        if (startTimer) clearTimeout(startTimer);
        startTimer = null;
      }
      if (phase === 'starting') scheduleStart();
      if (phase === 'running') scheduleFirstTick();
      if (phase === 'closed') {
        clearTimers();
        // Let the session-closed message flush before the transport closes.
        setTimeout(closeSockets, CLOSE_FLUSH_MS);
      }
    },
    // Room-level denials are sent to the client by the session itself; this hook
    // reports the already-decided code and applies the transport admission
    // policy. A room-code rejection ends the socket at once so a rejected peer
    // cannot hold the connection margin.
    onRoomDenial: (connectionId, code) => {
      notifyEnvelope({ connectionId, accepted: false, code, source: 'room' });
      if (isRoomCodeDenial(code)) {
        closePeer(connectionId, roomCodeCloseAction(code));
        return;
      }
      const failure = guards.get(connectionId)?.noteDenial(code) ?? null;
      if (failure) closePeer(connectionId, failure);
    },
  });

  const maxPayload = messagePolicy === null
    ? MAX_SESSION_ENVELOPE_BYTES
    : messagePolicy.maxMessageBytes + CLIENT_FRAME_SLACK_BYTES;
  const httpsServer = tls === null ? null : createHttpsServer({ cert: tls.cert, key: tls.key });
  const wss = httpsServer === null
    ? new WebSocketServer({ host, port: config.port, maxPayload })
    : new WebSocketServer({ server: httpsServer, maxPayload });
  const httpServer = httpsServer;

  await new Promise<void>((resolve, reject) => {
    if (httpServer !== null) {
      const server = httpServer;
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      server.once('listening', onListening);
      server.once('error', onError);
      server.listen(config.port, host);
      return;
    }
    const onListening = () => {
      wss.off('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      wss.off('listening', onListening);
      reject(error);
    };
    wss.once('listening', onListening);
    wss.once('error', onError);
  });

  wss.on('error', error => {
    // Keep a late server-level error from escaping as an unhandled EventEmitter error.
    process.stderr.write(`ws prototype: server error: ${error.message}\n`);
  });

  wss.on('connection', socket => {
    if (closed) {
      notifyServerEvent({ kind: 'connection-rejected', reason: 'server-closed' });
      socket.close(1001, 'server closed');
      return;
    }
    if (maxConnections !== null && sockets.size >= maxConnections) {
      // Reject before registration so an unexpected peer cannot join, occupy a
      // slot or otherwise disturb the authoritative run.
      notifyServerEvent({ kind: 'connection-rejected', reason: 'connection-limit' });
      socket.close(1008, 'connection limit reached');
      return;
    }
    const connectionId = `conn-${nextConnectionId++}`;
    sockets.set(connectionId, socket);
    if (messagePolicy !== null) guards.set(connectionId, new ClientMessageGuard(messagePolicy));
    try {
      room.addConnection(connectionId);
    } catch {
      sockets.delete(connectionId);
      guards.delete(connectionId);
      notifyServerEvent({ kind: 'connection-rejected', reason: 'server-closed' });
      socket.close(1008, 'registration denied');
      return;
    }
    notifyServerEvent({ kind: 'connection-opened', connectionId, connections: sockets.size });
    socket.on('message', (data: RawData) => {
      const guard = guards.get(connectionId);
      const bytes = rawBytes(data);
      if (guard) {
        // Transport policy runs before any parsing: size first, then the rate
        // window. A breach revokes the connection slot immediately.
        const violation = guard.admit(bytes.byteLength, performance.now());
        if (violation) {
          closePeer(connectionId, violation);
          return;
        }
      }
      // Trusted context is the socket's allocated ID, never a payload field.
      const result = room.handleMessage(connectionId, bytes);
      if (result === null) return;
      if (onClientEnvelope) observeResult(connectionId, result);
      if (result.accepted) {
        guard?.noteAccepted();
        return;
      }
      const failure = guard?.noteDenial(result.code) ?? null;
      if (failure) closePeer(connectionId, failure);
    });
    socket.on('close', () => {
      if (!sockets.delete(connectionId)) return;
      guards.delete(connectionId);
      room.disconnect(connectionId);
      scheduleRejoinExpiry();
      notifyServerEvent({ kind: 'connection-closed', connectionId, connections: sockets.size });
    });
    socket.on('error', () => {
      try {
        socket.terminate();
      } catch {
        // Already closed.
      }
    });
  });

  const address = wss.address();
  const boundPort = typeof address === 'object' && address !== null ? (address as AddressInfo).port : config.port;

  return {
    room,
    port: boundPort,
    host,
    stepOnce: () => room.stepOnce(),
    close: async () => {
      if (closed) return;
      closed = true;
      clearTimers();
      // Wait for the graceful close handshake so every socket's `close` handler
      // runs `room.disconnect`. Clearing the map first would strand the room in
      // its last phase even though no connection remains.
      const pending = [...sockets.values()];
      if (pending.length > 0) {
        await new Promise<void>(resolve => {
          let remaining = pending.length;
          const finish = (): void => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(finish, CLOSE_SETTLE_MS);
          for (const socket of pending) {
            socket.once('close', () => {
              remaining -= 1;
              if (remaining === 0) finish();
            });
          }
          for (const socket of pending) {
            try {
              socket.close(1000, 'server stopping');
            } catch {
              remaining -= 1;
              if (remaining === 0) finish();
            }
          }
        });
      }
      // An unresponsive peer must not keep a stopped server alive.
      for (const socket of sockets.values()) {
        try {
          socket.terminate();
        } catch {
          // Already closed.
        }
      }
      sockets.clear();
      guards.clear();
      await new Promise<void>(resolve => {
        wss.close(() => resolve());
      });
      // A WebSocketServer attached to an external HTTPS server does not close
      // that server; release the port explicitly.
      if (httpServer !== null && httpServer.listening) {
        httpServer.closeAllConnections();
        await new Promise<void>(resolve => {
          httpServer.close(() => resolve());
        });
      }
    },
  };
}
