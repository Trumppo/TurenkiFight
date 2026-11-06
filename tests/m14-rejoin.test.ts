import WebSocket from 'ws';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { encodeClientEnvelope, type ClientSessionEnvelope } from '../src/game/session/sessionEnvelope';
import { decodeWsServerMessage } from '../src/game/networking/wsMessages';
import type { PlayerInput } from '../src/game/simulation/types';
import {
  AuthoritativeWsSession,
  DEFAULT_REJOIN_WINDOW_MS,
  MAX_REJOIN_WINDOW_MS,
  type WsSessionOptions,
  type WsSessionPhase,
} from '../server/ws/authoritativeWsSession';
import {
  MAX_CLIENT_MESSAGE_BYTES,
  WS_CLOSE_MESSAGE_TOO_LARGE,
  WS_CLOSE_POLICY_VIOLATION,
} from '../server/ws/clientMessageLimits';
import {
  startMatchServer,
  type MatchServerHandle,
} from '../server/ws/matchServer';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';

/**
 * M14 rejoin: a mid-match drop keeps the player slot reserved for a bounded
 * window, and the same player id may reattach with a fresh sequence domain.
 *
 * Rejoin is not authentication and not host migration: any peer that knows the
 * room code and player id is the same identity, and the server keeps authority.
 * The unit tests use an injected clock; the socket tests use real loopback
 * sockets and the operator-facing server.
 */

const PLAYERS = ['P1', 'P2', 'P3', 'P4'];
const ROOM = 'ws-room';
const ROOM_CODE = 'REJOIN';

type Captured = { target: string | null; message: ReturnType<typeof decodeWsServerMessage> };

const controls = (playerId: string, moveX: -1 | 0 | 1 = 1): PlayerInput =>
  ({ playerId, moveX, moveY: 0, jump: false });

function envelopeText(envelope: ClientSessionEnvelope): string {
  return encodeClientEnvelope(envelope);
}

function captureRoom(options: WsSessionOptions = {}): {
  room: AuthoritativeWsSession;
  messages: Captured[];
  phases: WsSessionPhase[];
} {
  const messages: Captured[] = [];
  const phases: WsSessionPhase[] = [];
  const room = new AuthoritativeWsSession({
    roomId: ROOM,
    ...options,
    onOutgoing: (target, message) => messages.push({ target, message }),
    onPhaseChange: phase => phases.push(phase),
  });
  return { room, messages, phases };
}

function join(
  room: AuthoritativeWsSession,
  connectionId: string,
  playerIds: string[],
  sequence = 1,
  roomCode?: string,
): void {
  room.handleMessage(connectionId, envelopeText({
    version: 1,
    kind: 'join-request',
    sequence,
    ...(roomCode === undefined ? {} : { roomCode }),
    playerIds,
  }));
}

function input(
  room: AuthoritativeWsSession,
  connectionId: string,
  sequence: number,
  tick: number,
  inputs: PlayerInput[],
): void {
  room.handleMessage(connectionId, envelopeText({
    version: 1, kind: 'input', sequence, targetTick: tick, frame: { version: 1, tick, inputs },
  }));
}

function joinAll(room: AuthoritativeWsSession, roomCode?: string): void {
  PLAYERS.forEach((playerId, index) => {
    room.addConnection(`conn-${index + 1}`);
    join(room, `conn-${index + 1}`, [playerId], 1, roomCode);
  });
}

const messagesOf = (messages: Captured[], kind: string): Captured[] =>
  messages.filter(entry => entry.message.kind === kind);

describe('M14 rejoin reservation policy', () => {
  it('documents the operator default 30 s window with a bounded configuration', () => {
    expect(DEFAULT_REJOIN_WINDOW_MS).toBe(30_000);
    expect(MAX_REJOIN_WINDOW_MS).toBeGreaterThan(DEFAULT_REJOIN_WINDOW_MS);
    // The low-level session leaves rejoin opt-in; the WS transport supplies the
    // operator-facing 30 s default (asserted over a real server below).
    expect(captureRoom().room.rejoinWindowMsValue).toBe(0);
    expect(() => captureRoom({ rejoinWindowMs: -1 })).toThrow(/rejoin window/);
    expect(() => captureRoom({ rejoinWindowMs: 1.5 })).toThrow(/rejoin window/);
    expect(() => captureRoom({ rejoinWindowMs: MAX_REJOIN_WINDOW_MS + 1 })).toThrow(/rejoin window/);
    // Zero is an explicit operator choice: immediate revocation as before.
    expect(captureRoom({ rejoinWindowMs: 0 }).room.rejoinWindowMsValue).toBe(0);
  });

  it('keeps a dropped non-host slot reserved and the match running with that fighter idle', () => {
    const { room, messages } = captureRoom({ rejoinWindowMs: 30_000, now: () => 0 });
    joinAll(room);
    room.beginMatch();
    for (let tick = 0; tick < 3; tick++) room.stepOnce();
    const idleX = room.snapshot().state.fighters[1].x;

    expect(room.disconnect('conn-2')).toEqual(['P2']);
    expect(room.phase).toBe('running');
    // The slot is still claimed: the roster and the match do not change.
    expect(room.playerCount).toBe(4);
    expect(room.reservationCount).toBe(1);
    expect(room.reservedPlayerIds).toEqual(['P2']);
    expect(room.connectionCount).toBe(3);
    expect(room.hostConnectionId).toBe('conn-1');
    expect(messagesOf(messages, 'roster').at(-1)?.message)
      .toMatchObject({ kind: 'roster', playerIds: ['P1', 'P2', 'P3', 'P4'] });

    // The dropped connection has no trusted context; its late frame is ignored.
    expect(room.handleMessage('conn-2', envelopeText({
      version: 1, kind: 'input', sequence: 99, targetTick: room.tick,
      frame: { version: 1, tick: room.tick, inputs: [controls('P2')] },
    }))).toBeNull();

    // The match keeps ticking with neutral input for the reserved player.
    expect(room.stepOnce().stepped).toBe(true);
    expect(room.snapshot().state.fighters[1].x).toBe(idleX);
  });

  it('reattaches the full reserved slot with a fresh sequence domain and resumes control', () => {
    const { room, messages } = captureRoom({ rejoinWindowMs: 30_000, now: () => 0 });
    joinAll(room);
    room.beginMatch();
    for (let tick = 0; tick < 3; tick++) room.stepOnce();

    // The old connection reaches a high sequence before dropping.
    expect(room.handleMessage('conn-2', envelopeText({
      version: 1, kind: 'input', sequence: 40, targetTick: room.tick,
      frame: { version: 1, tick: room.tick, inputs: [controls('P2')] },
    }))?.accepted).toBe(true);
    room.stepOnce();
    expect(room.disconnect('conn-2')).toEqual(['P2']);
    expect(room.reservationCount).toBe(1);

    room.addConnection('conn-5');
    const rejoin = room.handleMessage('conn-5', envelopeText({
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P2'],
    }));
    expect(rejoin?.accepted).toBe(true);
    expect(room.isJoined('conn-5')).toBe(true);
    expect(room.isJoined('conn-2')).toBe(false);
    expect(room.reservationCount).toBe(0);
    expect(room.playerCount).toBe(4);
    // One fighter and one roster entry only: the slot was transferred, not added.
    expect(room.snapshot().state.fighters).toHaveLength(4);
    expect(messagesOf(messages, 'roster').at(-1)?.message)
      .toMatchObject({ kind: 'roster', playerIds: ['P1', 'P2', 'P3', 'P4'] });

    // The rejoining connection receives a fresh stream immediately.
    const targetedKinds = messages.filter(entry => entry.target === 'conn-5').map(entry => entry.message.kind);
    expect(targetedKinds).toContain('welcome');
    expect(targetedKinds).toContain('join-result');
    expect(targetedKinds).toContain('match-start');
    expect(targetedKinds).toContain('snapshot');
    const freshSnapshot = messages
      .filter(entry => entry.target === 'conn-5' && entry.message.kind === 'snapshot')
      .at(-1);
    expect(freshSnapshot?.message.kind === 'snapshot' &&
      freshSnapshot.message.snapshot.state.tick).toBe(room.tick);

    // Sequence 2 is accepted on the new connection after the join used 1: the
    // old counter (40) is not resurrected, and control takes effect on the next
    // authoritative tick.
    const before = room.snapshot().state.fighters[1].x;
    expect(room.handleMessage('conn-5', envelopeText({
      version: 1, kind: 'input', sequence: 2, targetTick: room.tick,
      frame: { version: 1, tick: room.tick, inputs: [controls('P2', 1)] },
    }))?.accepted).toBe(true);
    expect(room.stepOnce().stepped).toBe(true);
    expect(room.snapshot().state.fighters[1].x).toBeGreaterThan(before);

    // A stale replay on the new sequence domain is still rejected.
    expect(room.handleMessage('conn-5', envelopeText({
      version: 1, kind: 'input', sequence: 2, targetTick: room.tick,
      frame: { version: 1, tick: room.tick, inputs: [controls('P2', 1)] },
    }))).toMatchObject({ accepted: false, code: 'replayed-sequence' });
  });

  it('does not let another connection take the reserved slot or drive it', () => {
    const { room, messages } = captureRoom({ rejoinWindowMs: 30_000, now: () => 0 });
    joinAll(room);
    room.beginMatch();
    for (let tick = 0; tick < 3; tick++) room.stepOnce();
    room.disconnect('conn-2');
    expect(room.reservationCount).toBe(1);

    // An already joined peer cannot submit input for the reserved slot.
    input(room, 'conn-3', 5, room.tick, [controls('P2')]);
    expect(messagesOf(messages, 'error').at(-1)?.message).toMatchObject({ code: 'unauthorized-player' });
    expect(room.isJoined('conn-3')).toBe(true);

    // A non-rejoin claim is refused by the ordinary frozen-roster path; it
    // cannot absorb the reserved slot as part of a larger claim.
    room.addConnection('conn-9');
    const result = room.handleMessage('conn-9', envelopeText({
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P1', 'P2'],
    }));
    expect(result).toBeNull();
    expect(messagesOf(messages, 'error').at(-1)?.message).toMatchObject({ code: 'match-started' });
    expect(room.reservationCount).toBe(1);
    expect(room.playerCount).toBe(4);
    expect(room.isJoined('conn-9')).toBe(false);
  });

  it('keeps multiple dropped players reserved independently', () => {
    const { room } = captureRoom({ rejoinWindowMs: 30_000, now: () => 0 });
    joinAll(room);
    room.beginMatch();
    room.stepOnce();

    room.disconnect('conn-2');
    room.disconnect('conn-3');
    expect(room.reservationCount).toBe(2);
    expect(room.reservedPlayerIds).toEqual(['P2', 'P3']);
    expect(room.playerCount).toBe(4);
    expect(room.phase).toBe('running');

    room.addConnection('conn-5');
    expect(room.handleMessage('conn-5', envelopeText({
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P2'],
    }))?.accepted).toBe(true);
    expect(room.reservationCount).toBe(1);
    expect(room.reservedPlayerIds).toEqual(['P3']);
    expect(room.playerCount).toBe(4);

    room.addConnection('conn-6');
    expect(room.handleMessage('conn-6', envelopeText({
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P3'],
    }))?.accepted).toBe(true);
    expect(room.reservationCount).toBe(0);
    expect(room.playerCount).toBe(4);
  });

  it('releases the slot after the window and then treats a join as the ordinary path', () => {
    let nowMs = 0;
    const { room, messages } = captureRoom({ rejoinWindowMs: 1_000, now: () => nowMs });
    joinAll(room);
    room.beginMatch();
    room.stepOnce();

    room.disconnect('conn-2');
    expect(room.playerCount).toBe(4);
    expect(room.reservedPlayerIds).toEqual(['P2']);

    nowMs = 1_000; // exactly at the deadline the reservation expires
    expect(room.expireReservations()).toEqual(['P2']);
    expect(room.reservationCount).toBe(0);
    expect(room.reservedPlayerIds).toEqual([]);
    expect(room.playerCount).toBe(3);
    expect(room.phase).toBe('running');
    expect(messagesOf(messages, 'roster').at(-1)?.message)
      .toMatchObject({ kind: 'roster', playerIds: ['P1', 'P3', 'P4'] });

    // No special rejoin path remains: a running match refuses roster changes.
    room.addConnection('conn-6');
    const late = room.handleMessage('conn-6', envelopeText({
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P2'],
    }));
    expect(late).toBeNull();
    expect(messagesOf(messages, 'error').at(-1)?.message).toMatchObject({ code: 'match-started' });
    expect(room.playerCount).toBe(3);
  });

  it('expires a reservation from the tick path without an explicit timer call', () => {
    let nowMs = 0;
    const { room } = captureRoom({ rejoinWindowMs: 500, now: () => nowMs });
    joinAll(room);
    room.beginMatch();
    room.stepOnce();
    room.disconnect('conn-2');
    expect(room.playerCount).toBe(4);

    nowMs = 501;
    room.stepOnce();
    expect(room.playerCount).toBe(3);
    expect(room.reservationCount).toBe(0);
    expect(room.phase).toBe('running');
  });

  it('requires the configured room code on rejoin and keeps the reservation on denial', () => {
    const { room, messages } = captureRoom({ roomCode: 'ROOM1', rejoinWindowMs: 30_000, now: () => 0 });
    joinAll(room, 'ROOM1');
    room.beginMatch();
    room.stepOnce();
    room.disconnect('conn-2');

    room.addConnection('conn-5');
    expect(room.handleMessage('conn-5', envelopeText({
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P2'],
    }))).toBeNull();
    expect(messagesOf(messages, 'error').at(-1)?.message).toMatchObject({ code: 'room-code-required' });

    expect(room.handleMessage('conn-5', envelopeText({
      version: 1, kind: 'join-request', sequence: 2, roomCode: 'ROOM2', playerIds: ['P2'],
    }))).toBeNull();
    expect(messagesOf(messages, 'error').at(-1)?.message).toMatchObject({ code: 'room-code-mismatch' });
    expect(room.reservationCount).toBe(1);

    expect(room.handleMessage('conn-5', envelopeText({
      version: 1, kind: 'join-request', sequence: 3, roomCode: 'ROOM1', playerIds: ['P2'],
    }))?.accepted).toBe(true);
    expect(room.isJoined('conn-5')).toBe(true);
    expect(room.reservationCount).toBe(0);
  });

  it('never reserves the host and still closes on host loss', () => {
    const { room, messages } = captureRoom({ rejoinWindowMs: 30_000, now: () => 0 });
    joinAll(room);
    room.beginMatch();
    room.stepOnce();

    expect(room.disconnect('conn-1')).toEqual(['P1']);
    expect(room.phase).toBe('closed');
    expect(room.reservationCount).toBe(0);
    expect(room.playerCount).toBe(0);
    expect(messagesOf(messages, 'session-closed').at(-1)?.message)
      .toMatchObject({ kind: 'session-closed', reason: 'host-lost' });
  });

  it('does not reserve a slot closed by transport policy', () => {
    const { room } = captureRoom({ rejoinWindowMs: 30_000, now: () => 0 });
    joinAll(room);
    room.beginMatch();
    room.stepOnce();

    expect(room.disconnect('conn-2', { reserve: false })).toEqual(['P2']);
    expect(room.playerCount).toBe(3);
    expect(room.reservationCount).toBe(0);
    expect(room.phase).toBe('running');
  });

  it('clears reservations when the session closes', () => {
    const { room } = captureRoom({ rejoinWindowMs: 30_000, now: () => 0 });
    joinAll(room);
    room.beginMatch();
    room.stepOnce();
    room.disconnect('conn-2');
    expect(room.reservationCount).toBe(1);

    room.close('match-complete');
    expect(room.phase).toBe('closed');
    expect(room.reservationCount).toBe(0);
    expect(room.playerCount).toBe(0);
    expect(() => room.addConnection('conn-9')).toThrow(/closed/);
  });
});

/* ------------------------------------------------------------------ */
/* Real loopback sockets                                               */
/* ------------------------------------------------------------------ */

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

async function startServer(
  ctx: TestContext,
  overrides: { rejoinWindowMs?: number } = {},
): Promise<MatchServerHandle> {
  let server: MatchServerHandle;
  try {
    server = await startMatchServer({
      host: '127.0.0.1',
      port: 0,
      playerIds: ['P1', 'P2'],
      roomCode: ROOM_CODE,
      connectionMargin: 1,
      startMode: 'manual',
      startDelayMs: 0,
      firstTickDelayMs: 0,
      rejoinWindowMs: overrides.rejoinWindowMs,
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

async function joinPlayer(
  url: string,
  playerId: string,
  handlers: Parameters<typeof openNodeSession>[0]['handlers'] = {},
): Promise<NodeSession> {
  const joined = deferred<void>();
  const session = await openNodeSession({
    url,
    handlers: {
      ...handlers,
      onJoinResult: result => {
        handlers?.onJoinResult?.(result);
        if (result.accepted) joined.resolve();
      },
    },
  });
  openClients.push(session);
  session.client.join([playerId], ROOM_CODE);
  await waitFor(`${playerId} join`, () => session.client.sessionState === 'joined');
  await waitFor(`${playerId} welcome`, () => session.client.connectionId !== null);
  return session;
}

describe('M14 rejoin over real sockets', () => {
  it('reports the operator-facing 30 s default in the ready line', async (ctx: TestContext) => {
    const server = await startServer(ctx);
    expect(server.ready.rejoinWindowMs).toBe(DEFAULT_REJOIN_WINDOW_MS);
    expect(server.room.rejoinWindowMsValue).toBe(DEFAULT_REJOIN_WINDOW_MS);
  });

  it('reserves P1 on drop, survives an attempted takeover, then rejoins and resumes input', async (ctx: TestContext) => {
    const server = await startServer(ctx, { rejoinWindowMs: 5000 });
    expect(server.ready.rejoinWindowMs).toBe(5000);
    const url = server.url!;

    const p2Errors: string[] = [];
    // P2 joins first, so P2 is the host; a host drop still closes the session.
    // This test exercises a non-host rejoin, which is the supported case.
    const p2 = await joinPlayer(url, 'P2', { onError: error => p2Errors.push(error.code) });
    const p1 = await joinPlayer(url, 'P1');
    expect(server.room.playerCount).toBe(2);
    expect(server.start()).toEqual({ started: true });
    await waitFor('match running', () => server.room.phase === 'running' && server.room.tick >= 2);

    // P1 control works before the drop.
    const p1Before = server.room.snapshot().state.fighters[0].x;
    let target = server.room.tick + 3;
    p1.client.submitInput(target, [controls('P1', 1)]);
    await waitFor('P1 pre-drop movement', () => server.room.tick > target);
    expect(server.room.snapshot().state.fighters[0].x).toBeGreaterThan(p1Before);

    const p1ConnectionId = p1.client.connectionId!;
    p1.close();
    await waitFor('P1 reservation', () => server.room.reservationCount === 1);
    expect(server.room.playerCount).toBe(2);
    expect(server.room.reservedPlayerIds).toEqual(['P1']);
    expect(server.room.phase).toBe('running');
    expect(server.room.isJoined(p1ConnectionId)).toBe(false);

    // P2 keeps playing while P1 is idle.
    const p2Before = server.room.snapshot().state.fighters[1].x;
    target = server.room.tick + 3;
    p2.client.submitInput(target, [controls('P2', -1)]);
    await waitFor('P2 movement during the window', () => server.room.tick > target);
    expect(server.room.snapshot().state.fighters[1].x).toBeLessThan(p2Before);

    // The old connection is no longer trusted even if its bytes appear late.
    expect(server.room.handleMessage(p1ConnectionId, encodeClientEnvelope({
      version: 1, kind: 'input', sequence: 999, targetTick: server.room.tick + 1,
      frame: { version: 1, tick: server.room.tick + 1, inputs: [controls('P1')] },
    }))).toBeNull();

    // A second client cannot take the reserved slot as part of another claim.
    const thief = await openRaw(url);
    openSockets.push(thief);
    let thiefClosedCode: number | null = null;
    thief.once('close', code => { thiefClosedCode = code; });
    const thiefErrors: string[] = [];
    thief.on('message', data => {
      const message = decodeWsServerMessage(data.toString());
      if (message.kind === 'error') thiefErrors.push(message.code);
    });
    thief.send(encodeClientEnvelope({
      version: 1, kind: 'join-request', sequence: 1, roomCode: ROOM_CODE, playerIds: ['P1', 'P2'],
    }));
    await waitFor('takeover denial', () => thiefErrors.length > 0);
    expect(thiefErrors).toEqual(['match-started']);
    expect(thiefClosedCode).toBeNull();
    expect(server.room.reservationCount).toBe(1);
    expect(server.room.playerCount).toBe(2);
    expect(server.room.isJoined(p1ConnectionId)).toBe(false);

    // An active peer still cannot drive P1's reserved slot.
    target = server.room.tick + 4;
    p2.sendRaw(encodeClientEnvelope({
      version: 1, kind: 'input', sequence: 900, targetTick: target,
      frame: { version: 1, tick: target, inputs: [controls('P1', 1)] },
    }));
    await waitFor('unauthorized input denial', () => p2Errors.includes('unauthorized-player'));

    // A wrong room code is a typed denial and leaves the reservation intact.
    const wrongCode = await openRaw(url);
    openSockets.push(wrongCode);
    const wrongClosed = closeCode(wrongCode);
    wrongCode.send(joinEnvelope('WRONG', 'P1'));
    const wrongResult = await wrongClosed;
    expect(wrongResult.code).toBe(WS_CLOSE_POLICY_VIOLATION);
    expect(wrongResult.reason).toContain('room-code-mismatch');
    await waitFor('reservation survives wrong code', () => server.room.reservationCount === 1);

    // Correct room code and player id reattach the reserved slot.
    const rejoinedEvents: string[] = [];
    const rejoinedSnapshots: number[] = [];
    const rejoined = await joinPlayer(url, 'P1', {
      onMatchStart: () => rejoinedEvents.push('match-start'),
      onSnapshot: snapshot => rejoinedSnapshots.push(snapshot.state.tick),
      onRoster: roster => rejoinedEvents.push(`roster:${roster.join(',')}`),
    });
    expect(server.room.reservationCount).toBe(0);
    expect(server.room.playerCount).toBe(2);
    expect(server.room.isJoined(p1ConnectionId)).toBe(false);
    expect(server.room.isJoined(rejoined.client.connectionId!)).toBe(true);
    await waitFor('fresh snapshot stream', () => rejoinedSnapshots.length > 0);
    expect(rejoinedEvents).toContain('match-start');
    expect(rejoinedEvents).toContain('roster:P1,P2');
    expect(server.room.snapshot().state.fighters).toHaveLength(2);

    // Control resumes on the next authoritative tick with a fresh sequence.
    const idleX = server.room.snapshot().state.fighters[0].x;
    target = server.room.tick + 3;
    expect(rejoined.client.submitInput(target, [controls('P1', 1)])).toBeGreaterThan(1);
    await waitFor('P1 resumed movement', () => server.room.tick > target);
    expect(server.room.snapshot().state.fighters[0].x).toBeGreaterThan(idleX);
    expect(p2Errors).toEqual(['unauthorized-player']);

    // The rejoined connection has its own message budget. Drop it again, rejoin
    // over a raw socket and prove the oversized frame is closed with 1009 and
    // frees the slot instead of reserving it.
    rejoined.close();
    await waitFor('second reservation', () => server.room.reservationCount === 1);
    const limited = await openRaw(url);
    openSockets.push(limited);
    const limitedClosed = closeCode(limited);
    limited.send(joinEnvelope(ROOM_CODE, 'P1'));
    await waitFor('second rejoin accepted', () => server.room.reservationCount === 0);
    limited.send('x'.repeat(MAX_CLIENT_MESSAGE_BYTES + 1));
    const limitedResult = await limitedClosed;
    expect(limitedResult.code).toBe(WS_CLOSE_MESSAGE_TOO_LARGE);
    await waitFor('rejoined slot released by policy', () => server.room.playerCount === 1);
    expect(server.room.reservationCount).toBe(0);
    expect(server.room.phase).toBe('running');
  }, 30_000);

  it('releases the slot after the window and then uses the ordinary join path', async (ctx: TestContext) => {
    const server = await startServer(ctx, { rejoinWindowMs: 200 });
    const url = server.url!;

    // P2 joins first and is the host; P1 is the non-host under test.
    const p2 = await joinPlayer(url, 'P2');
    const p1 = await joinPlayer(url, 'P1');
    expect(server.start()).toEqual({ started: true });
    await waitFor('match running', () => server.room.phase === 'running' && server.room.tick >= 2);

    p1.close();
    await waitFor('P1 reservation', () => server.room.reservationCount === 1);
    expect(server.room.playerCount).toBe(2);

    // The interval tick / expiry timer releases the slot without stopping play.
    await waitFor('reservation expiry', () => server.room.reservationCount === 0 && server.room.playerCount === 1);
    expect(server.room.phase).toBe('running');
    expect(server.room.reservedPlayerIds).toEqual([]);

    const p2Before = server.room.snapshot().state.fighters[1].x;
    const target = server.room.tick + 3;
    p2.client.submitInput(target, [controls('P2', -1)]);
    await waitFor('P2 still playing after expiry', () => server.room.tick > target);
    expect(server.room.snapshot().state.fighters[1].x).toBeLessThan(p2Before);

    // After expiry the same id is no longer special: the ordinary running-match
    // admission denies it with `match-started` and allocates nothing.
    const lateErrors: string[] = [];
    const late = await openNodeSession({
      url,
      handlers: {
        onError: error => lateErrors.push(error.code),
      },
    });
    openClients.push(late);
    late.client.join(['P1'], ROOM_CODE);
    await waitFor('ordinary join denial', () => lateErrors.includes('match-started'));
    expect(server.room.playerCount).toBe(1);
    expect(server.room.reservationCount).toBe(0);
    expect(server.room.phase).toBe('running');
  }, 30_000);
});
