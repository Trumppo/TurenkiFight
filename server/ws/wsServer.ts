import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { TICK_RATE } from '../../src/game/simulation/step';
import type { ModeId } from '../../src/game/simulation/types';
import { encodeWsServerMessage, type SnapshotHz } from '../../src/game/networking/wsMessages';
import { MAX_SESSION_ENVELOPE_BYTES } from '../../src/game/session/sessionEnvelope';
import type { SessionEnvelopeResult } from '../../src/game/session/sessionEnvelopeGateway';
import {
  AuthoritativeWsSession,
  type WsSessionPhase,
  type WsStepResult,
} from './authoritativeWsSession';

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
  | { connectionId: string; accepted: false; code: string; source: 'gateway' | 'room' };

/**
 * Read-only transport/lifecycle observation for an operator-facing server role.
 * It is reported after the decision was made, so a throwing callback (or slow
 * logging sink) can never accept, reject, reorder or delay a client envelope.
 */
export type WsServerEvent =
  | { kind: 'connection-opened'; connectionId: string; connections: number }
  | { kind: 'connection-closed'; connectionId: string; connections: number }
  | { kind: 'connection-rejected'; reason: 'connection-limit' | 'server-closed' }
  | { kind: 'phase'; phase: WsSessionPhase };

/**
 * Thin Node WebSocket transport around `AuthoritativeWsSession`.
 *
 * The only trusted identity a socket gets is the ID allocated here; nothing in
 * a client payload can set or influence it. This prototype has no TLS,
 * authentication, origin checks, rate limiting or production hardening.
 */
export type WsServerConfig = {
  port: number;
  host?: string;
  roomId?: string;
  playerIds?: readonly string[];
  /** Match rules chosen at session creation. Defaults to Score Brawl. */
  mode?: ModeId;
  snapshotHz?: SnapshotHz;
  maxLead?: number;
  maxTicks?: number;
  /** Opt-in repeatable session; see `AuthoritativeWsSession`. Default false. */
  allowRematch?: boolean;
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
  }
}

export async function startWsServer(config: WsServerConfig): Promise<WsServerHandle> {
  if (!Number.isSafeInteger(config?.port) || config.port < 0 || config.port > 65535) {
    throw new Error('Invalid WebSocket port');
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
  let nextConnectionId = 1;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setTimeout> | null = null;
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

  const clearTimers = (): void => {
    if (startTimer) clearTimeout(startTimer);
    if (tickTimer) clearTimeout(tickTimer);
    startTimer = null;
    tickTimer = null;
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
  }

  const room = new AuthoritativeWsSession({
    ...(config.roomId === undefined ? {} : { roomId: config.roomId }),
    ...(config.playerIds === undefined ? {} : { playerIds: config.playerIds }),
    ...(config.mode === undefined ? {} : { mode: config.mode }),
    ...(config.snapshotHz === undefined ? {} : { snapshotHz: config.snapshotHz }),
    ...(config.maxLead === undefined ? {} : { maxLead: config.maxLead }),
    ...(config.maxTicks === undefined ? {} : { maxTicks: config.maxTicks }),
    ...(config.allowRematch === undefined ? {} : { allowRematch: config.allowRematch }),
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
    // only reports the already-decided code to the benchmark observer.
    onRoomDenial: (connectionId, code) => {
      notifyEnvelope({ connectionId, accepted: false, code, source: 'room' });
    },
  });

  const wss = new WebSocketServer({ host, port: config.port, maxPayload: MAX_SESSION_ENVELOPE_BYTES });

  await new Promise<void>((resolve, reject) => {
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
    try {
      room.addConnection(connectionId);
    } catch {
      sockets.delete(connectionId);
      notifyServerEvent({ kind: 'connection-rejected', reason: 'server-closed' });
      socket.close(1008, 'registration denied');
      return;
    }
    notifyServerEvent({ kind: 'connection-opened', connectionId, connections: sockets.size });
    socket.on('message', (data: RawData) => {
      // Trusted context is the socket's allocated ID, never a payload field.
      const result = room.handleMessage(connectionId, rawBytes(data));
      if (result !== null && onClientEnvelope) observeResult(connectionId, result);
    });
    socket.on('close', () => {
      if (!sockets.delete(connectionId)) return;
      room.disconnect(connectionId);
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
      await new Promise<void>(resolve => {
        wss.close(() => resolve());
      });
    },
  };
}
