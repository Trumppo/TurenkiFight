import WebSocket from 'ws';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { encodeClientEnvelope } from '../src/game/session/sessionEnvelope';
import { decodeWsServerMessage } from '../src/game/networking/wsMessages';
import { TICK_RATE } from '../src/game/simulation/step';
import {
  CLIENT_MESSAGE_POLICY,
  CLIENT_MESSAGE_WINDOW_MS,
  CLOSE_REASON_MESSAGE_TOO_LARGE,
  CLOSE_REASON_RATE_LIMITED,
  CLOSE_REASON_VALIDATION_FAILURES,
  ClientMessageGuard,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_CLIENT_MESSAGES_PER_WINDOW,
  MAX_CLIENT_FRAME_BYTES,
  MAX_CLIENT_VALIDATION_FAILURES,
  WS_CLOSE_MESSAGE_TOO_LARGE,
  WS_CLOSE_POLICY_VIOLATION,
  WS_CLOSE_RATE_LIMITED,
  isRoomCodeDenial,
  isValidationFailureCode,
  type ClientMessagePolicy,
} from '../server/ws/clientMessageLimits';
import {
  formatMatchReadyLine,
  serveMatchUsage,
  startMatchServer,
  type MatchServerHandle,
} from '../server/ws/matchServer';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';

/**
 * M14 rate limits: per-connection size/rate budgets, immediate closure of
 * rejected peers and the ready-line documentation. Every socket test uses the
 * real operator-facing `startMatchServer`; no network performance is measured.
 */

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitFor<T>(
  label: string,
  check: () => T | undefined | false,
  timeoutMs = 5000,
): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function bindingFailure(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  if (code && ['EACCES', 'EPERM', 'EADDRINUSE', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return code;
  }
  return null;
}

function openRaw(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out opening a raw WebSocket'));
    }, 5000);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function closeCode(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out waiting for a close frame'));
    }, 8000);
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    socket.once('error', () => undefined);
  });
}

function joinEnvelope(roomCode: string, playerId: string): string {
  return encodeClientEnvelope({
    version: 1,
    kind: 'join-request',
    sequence: 1,
    roomCode,
    playerIds: [playerId],
  });
}

const openServers: MatchServerHandle[] = [];
const openClients: NodeSession[] = [];
const openSockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) {
    try {
      socket.terminate();
    } catch {
      // Already closed.
    }
  }
  for (const client of openClients.splice(0)) {
    try {
      client.close();
    } catch {
      // Already closed.
    }
  }
  for (const server of openServers.splice(0)) {
    await server.close();
  }
});

async function start(ctx: TestContext, overrides: {
  playerIds?: readonly string[];
  roomCode?: string;
  connectionMargin?: number;
} = {}): Promise<MatchServerHandle> {
  let server: MatchServerHandle;
  try {
    server = await startMatchServer({
      host: '127.0.0.1',
      port: 0,
      playerIds: overrides.playerIds ?? ['P1', 'P2'],
      roomCode: overrides.roomCode ?? 'LIMIT',
      connectionMargin: overrides.connectionMargin ?? 1,
      startMode: 'manual',
      log: () => undefined,
    });
    openServers.push(server);
  } catch (error) {
    const code = bindingFailure(error);
    ctx.skip(code === null
      ? `Local WebSocket server could not start: ${error instanceof Error ? error.message : String(error)}`
      : `Local WebSocket binding unavailable (${code})`);
    throw error;
  }
  return server;
}

describe('M14 client message policy constants', () => {
  it('documents the exported policy and leaves headroom over honest 60 Hz traffic', () => {
    expect(CLIENT_MESSAGE_POLICY).toEqual({
      maxMessageBytes: MAX_CLIENT_MESSAGE_BYTES,
      maxMessagesPerWindow: MAX_CLIENT_MESSAGES_PER_WINDOW,
      windowMs: CLIENT_MESSAGE_WINDOW_MS,
      maxValidationFailures: MAX_CLIENT_VALIDATION_FAILURES,
    });
    expect(MAX_CLIENT_MESSAGE_BYTES).toBe(5120);
    expect(CLIENT_MESSAGE_WINDOW_MS).toBe(1000);
    expect(MAX_CLIENT_MESSAGES_PER_WINDOW).toBe(240);
    expect(MAX_CLIENT_VALIDATION_FAILURES).toBe(5);
    // One input frame per tick plus occasional pings; the policy is not a
    // tight ceiling on honest play. This is cadence, not a network measurement.
    expect(MAX_CLIENT_MESSAGES_PER_WINDOW).toBeGreaterThan(TICK_RATE * 3);
    expect(WS_CLOSE_MESSAGE_TOO_LARGE).toBe(1009);
    expect(WS_CLOSE_RATE_LIMITED).toBe(1013);
    expect(WS_CLOSE_POLICY_VIOLATION).toBe(1008);
    // The transport backstop sits above the policy so the policy close reason
    // is the one an over-policy peer observes.
    expect(MAX_CLIENT_FRAME_BYTES).toBeGreaterThan(MAX_CLIENT_MESSAGE_BYTES);
  });

  it('prints every enforced limit in the machine-readable ready line', () => {
    const line = formatMatchReadyLine({
      url: 'ws://127.0.0.1:8787',
      host: '127.0.0.1',
      port: 8787,
      roomId: 'match',
      roomCode: 'LIMIT',
      maxConnections: 3,
      maxMessageBytes: MAX_CLIENT_MESSAGE_BYTES,
      messageRateWindowMs: CLIENT_MESSAGE_WINDOW_MS,
      maxMessagesPerWindow: MAX_CLIENT_MESSAGES_PER_WINDOW,
      maxValidationFailures: MAX_CLIENT_VALIDATION_FAILURES,
      rejoinWindowMs: 30000,
      playerIds: ['P1', 'P2'],
      snapshotHz: 20,
      startMode: 'manual',
      mode: 'score-brawl',
      secure: false,
    });
    expect(line).not.toContain('\n');
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.maxMessageBytes).toBe(MAX_CLIENT_MESSAGE_BYTES);
    expect(parsed.messageRateWindowMs).toBe(CLIENT_MESSAGE_WINDOW_MS);
    expect(parsed.maxMessagesPerWindow).toBe(MAX_CLIENT_MESSAGES_PER_WINDOW);
    expect(parsed.maxValidationFailures).toBe(MAX_CLIENT_VALIDATION_FAILURES);
    expect(serveMatchUsage()).toContain('5120');
    expect(serveMatchUsage()).toContain('240');
  });

  it('a live server reports the same limits through its handle', async (ctx: TestContext) => {
    const server = await start(ctx);
    expect(server.ready.maxMessageBytes).toBe(MAX_CLIENT_MESSAGE_BYTES);
    expect(server.ready.messageRateWindowMs).toBe(CLIENT_MESSAGE_WINDOW_MS);
    expect(server.ready.maxMessagesPerWindow).toBe(MAX_CLIENT_MESSAGES_PER_WINDOW);
    expect(server.ready.maxValidationFailures).toBe(MAX_CLIENT_VALIDATION_FAILURES);
  });
});

describe('M14 ClientMessageGuard boundaries', () => {
  const tiny: ClientMessagePolicy = {
    maxMessageBytes: 16,
    maxMessagesPerWindow: 3,
    windowMs: 100,
    maxValidationFailures: 2,
  };

  it('rejects an oversized message before the rate window', () => {
    const guard = new ClientMessageGuard(tiny);
    expect(guard.admit(16, 0)).toBeNull();
    const denied = guard.admit(17, 0);
    expect(denied?.closeCode).toBe(WS_CLOSE_MESSAGE_TOO_LARGE);
    expect(denied?.reason).toBe(CLOSE_REASON_MESSAGE_TOO_LARGE);
    // A malformed byte count fails closed as oversized, never as accepted.
    expect(guard.admit(Number.NaN, 0)?.closeCode).toBe(WS_CLOSE_MESSAGE_TOO_LARGE);
    expect(guard.admit(-1, 0)?.closeCode).toBe(WS_CLOSE_MESSAGE_TOO_LARGE);
  });

  it('allows the window budget, closes on the next message and recovers after the window', () => {
    const guard = new ClientMessageGuard(tiny);
    expect(guard.admit(1, 0)).toBeNull();
    expect(guard.admit(1, 0)).toBeNull();
    expect(guard.admit(1, 0)).toBeNull();
    const denied = guard.admit(1, 0);
    expect(denied?.closeCode).toBe(WS_CLOSE_RATE_LIMITED);
    expect(denied?.reason).toBe(CLOSE_REASON_RATE_LIMITED);
    // Exactly at the boundary the oldest arrivals leave the sliding window.
    expect(guard.admit(1, 100)).toBeNull();
  });

  it('counts only consecutive protocol/authorization failures', () => {
    const guard = new ClientMessageGuard(tiny);
    expect(isValidationFailureCode('invalid-json')).toBe(true);
    expect(isValidationFailureCode('unauthorized-player')).toBe(true);
    // A stalled honest client already recovers from these; they must not close.
    expect(isValidationFailureCode('late-tick')).toBe(false);
    expect(isValidationFailureCode('future-tick')).toBe(false);
    expect(isValidationFailureCode('tick-out-of-window')).toBe(false);
    expect(isValidationFailureCode('rematch-disabled')).toBe(false);

    expect(guard.noteDenial('late-tick')).toBeNull();
    expect(guard.noteDenial('invalid-json')).toBeNull();
    const denied = guard.noteDenial('unauthorized-player');
    expect(denied?.closeCode).toBe(WS_CLOSE_POLICY_VIOLATION);
    expect(denied?.reason).toBe(CLOSE_REASON_VALIDATION_FAILURES);

    guard.noteAccepted();
    expect(guard.consecutiveFailures).toBe(0);
    expect(guard.noteDenial('invalid-json')).toBeNull();
  });

  it('treats both room-code denials as immediate policy closes', () => {
    expect(isRoomCodeDenial('room-code-required')).toBe(true);
    expect(isRoomCodeDenial('room-code-mismatch')).toBe(true);
    expect(isRoomCodeDenial('not-joined')).toBe(false);
  });
});

describe('M14 abuse limits over real sockets', () => {
  it('closes a flooding connection with 1013 while another client keeps playing', async (ctx: TestContext) => {
    const server = await start(ctx);
    const url = server.url!;

    // A legitimate client joins first and becomes the host.
    const legitJoined = deferred<void>();
    const legitPongs: number[] = [];
    const legitErrors: string[] = [];
    const legit = await openNodeSession({
      url,
      handlers: {
        onJoinResult: result => { if (result.accepted) legitJoined.resolve(); },
        onPong: sequence => legitPongs.push(sequence),
        onError: error => legitErrors.push(error.code),
      },
    });
    openClients.push(legit);
    legit.client.join(['P1'], 'LIMIT');
    await legitJoined.promise;

    // The flooder joins a free slot so its pings are accepted until the rate
    // limit, not a validation failure, ends the connection.
    const flood = await openRaw(url);
    openSockets.push(flood);
    const floodClosed = closeCode(flood);
    const floodJoined = deferred<void>();
    flood.on('message', data => {
      const message = decodeWsServerMessage(data.toString());
      if (message.kind === 'join-result' && message.accepted) floodJoined.resolve();
    });
    flood.send(joinEnvelope('LIMIT', 'P2'));
    await floodJoined.promise;

    // One join plus these pings crosses the documented per-window budget.
    for (let sequence = 2; sequence <= MAX_CLIENT_MESSAGES_PER_WINDOW + 20; sequence++) {
      flood.send(encodeClientEnvelope({ version: 1, kind: 'ping', sequence }));
    }

    const closed = await floodClosed;
    expect(closed.code).toBe(WS_CLOSE_RATE_LIMITED);
    expect(closed.reason).toContain('rate');
    expect(closed.reason).toContain(String(MAX_CLIENT_MESSAGES_PER_WINDOW));

    // The flooder slot is freed immediately and the honest client is untouched.
    await waitFor('the flooder connection to be revoked', () => server.room.connectionCount === 1);
    expect(server.room.playerCount).toBe(1);
    const pingSequence = legit.client.ping();
    expect(pingSequence).toBeGreaterThan(0);
    await waitFor('the honest client pong', () => legitPongs.length > 0);
    expect(legitErrors).toEqual([]);
  });

  it('rejects an oversized message before parsing and frees the connection slot', async (ctx: TestContext) => {
    const server = await start(ctx, { playerIds: ['P1'], connectionMargin: 0 });
    const socket = await openRaw(server.url!);
    openSockets.push(socket);
    const closed = closeCode(socket);
    socket.send('x'.repeat(MAX_CLIENT_MESSAGE_BYTES + 1));

    const result = await closed;
    expect(result.code).toBe(WS_CLOSE_MESSAGE_TOO_LARGE);
    expect(result.reason).toContain(String(MAX_CLIENT_MESSAGE_BYTES));
    // Nothing was parsed, so no room-level error was emitted and no slot exists.
    await waitFor('the oversized peer slot to be freed', () => server.room.connectionCount === 0);
    expect(server.room.playerCount).toBe(0);
  });

  it('closes a wrong room code at once and frees the only connection slot', async (ctx: TestContext) => {
    // Zero margin makes this a direct proof: if the rejected peer still held the
    // slot, the correct peer would be rejected by the room cap.
    const server = await start(ctx, {
      playerIds: ['P1'],
      roomCode: 'ROOM1',
      connectionMargin: 0,
    });
    expect(server.ready.maxConnections).toBe(1);
    const url = server.url!;

    const rejected = await openRaw(url);
    openSockets.push(rejected);
    const rejectedClosed = closeCode(rejected);
    rejected.send(joinEnvelope('WRONG', 'P1'));
    const rejectedResult = await rejectedClosed;
    expect(rejectedResult.code).toBe(WS_CLOSE_POLICY_VIOLATION);
    expect(rejectedResult.reason).toContain('room code');
    expect(rejectedResult.reason).toContain('room-code-mismatch');
    await waitFor('the rejected peer slot to be freed', () => server.room.connectionCount === 0);

    const accepted = await openRaw(url);
    openSockets.push(accepted);
    const acceptedJoin = deferred<void>();
    // No timer: a clean join leaves the socket open, so only a close competes.
    const acceptedClosed = new Promise<never>((_, reject) => {
      accepted.once('close', (code, reason) => {
        reject(new Error(`Correct join was closed with ${code}: ${reason.toString()}`));
      });
    });
    accepted.on('message', data => {
      const message = decodeWsServerMessage(data.toString());
      if (message.kind === 'join-result' && message.accepted) acceptedJoin.resolve();
    });
    accepted.send(joinEnvelope('ROOM1', 'P1'));
    await Promise.race([acceptedJoin.promise, acceptedClosed]);
    expect(server.room.playerCount).toBe(1);
  });

  it('closes a connection after repeated protocol failures with 1008', async (ctx: TestContext) => {
    const server = await start(ctx, { playerIds: ['P1'], connectionMargin: 0 });
    const socket = await openRaw(server.url!);
    openSockets.push(socket);
    const closed = closeCode(socket);
    for (let index = 0; index < MAX_CLIENT_VALIDATION_FAILURES; index++) {
      socket.send('not a session envelope');
    }

    const result = await closed;
    expect(result.code).toBe(WS_CLOSE_POLICY_VIOLATION);
    expect(result.reason).toBe(CLOSE_REASON_VALIDATION_FAILURES);
    await waitFor('the invalid peer slot to be freed', () => server.room.connectionCount === 0);
  });
});
