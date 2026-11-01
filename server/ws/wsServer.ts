import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { TICK_RATE } from '../../src/game/simulation/step';
import { encodeWsServerMessage, type SnapshotHz } from '../../src/game/networking/wsMessages';
import { MAX_SESSION_ENVELOPE_BYTES } from '../../src/game/session/sessionEnvelope';
import {
  AuthoritativeWsSession,
  type WsSessionPhase,
  type WsStepResult,
} from './authoritativeWsSession';

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
  snapshotHz?: SnapshotHz;
  maxLead?: number;
  maxTicks?: number;
  /** Delay after the roster fills before the match enters `running`. */
  startDelayMs?: number;
  /** Delay after `match-start` before the first authoritative tick. */
  firstTickDelayMs?: number;
  /** `interval` drives 60 Hz with timers; `manual` lets tests call stepOnce. */
  tickMode?: 'interval' | 'manual';
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
  const tickMode = config.tickMode ?? 'interval';
  if (tickMode !== 'interval' && tickMode !== 'manual') throw new Error('Invalid tick mode');
  const tickIntervalMs = 1000 / TICK_RATE;

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
    if (tickMode !== 'interval' || closed) return;
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
    ...(config.snapshotHz === undefined ? {} : { snapshotHz: config.snapshotHz }),
    ...(config.maxLead === undefined ? {} : { maxLead: config.maxLead }),
    ...(config.maxTicks === undefined ? {} : { maxTicks: config.maxTicks }),
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

  wss.on('connection', socket => {    if (closed) {
      socket.close(1001, 'server closed');
      return;
    }
    const connectionId = `conn-${nextConnectionId++}`;
    sockets.set(connectionId, socket);
    try {
      room.addConnection(connectionId);
    } catch {
      sockets.delete(connectionId);
      socket.close(1008, 'registration denied');
      return;
    }
    socket.on('message', (data: RawData) => {
      // Trusted context is the socket's allocated ID, never a payload field.
      room.handleMessage(connectionId, rawBytes(data));
    });
    socket.on('close', () => {
      if (!sockets.delete(connectionId)) return;
      room.disconnect(connectionId);
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
      for (const socket of sockets.values()) {
        try {
          socket.close(1000, 'server stopping');
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
