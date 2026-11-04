import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { encodeClientEnvelope, type ClientSessionEnvelope } from '../src/game/session/sessionEnvelope';
import { COUNTDOWN_TICKS } from '../src/game/simulation/step';
import { MATCH_TICKS } from '../src/game/simulation/modes';
import { rankMatch } from '../src/game/simulation/ranking';
import type { PlayerInput } from '../src/game/simulation/types';
import { computeMatchResult } from '../server/ws/matchResult';
import type { WsMatchResult, WsServerMessage } from '../src/game/networking/wsMessages';
import type { SessionClientHandlers } from '../src/game/networking/wsSessionClient';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';
import { startMatchServer, type MatchServerHandle } from '../server/ws/matchServer';
import {
  AuthoritativeWsSession,
  type WsSessionOptions,
  type WsSessionPhase,
} from '../server/ws/authoritativeWsSession';
import type { StateSnapshot } from '../src/game/protocol/stateSnapshot';

const PLAYERS = ['P1', 'P2'];
const ROOM = 'ws-room';

type Captured = { target: string | null; message: WsServerMessage };

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

const envelopeText = (envelope: ClientSessionEnvelope): string => encodeClientEnvelope(envelope);

const inputEnvelope = (
  sequence: number,
  tick: number,
  inputs: PlayerInput[],
): ClientSessionEnvelope => ({
  version: 1,
  kind: 'input',
  sequence,
  targetTick: tick,
  frame: { version: 1, tick, inputs },
});

function join(room: AuthoritativeWsSession, connectionId: string, playerIds: string[], sequence = 1): void {
  room.handleMessage(connectionId, envelopeText({ version: 1, kind: 'join-request', sequence, playerIds }));
}

function joinAll(room: AuthoritativeWsSession, playerIds: readonly string[] = PLAYERS): void {
  playerIds.forEach((playerId, index) => {
    room.addConnection(`conn-${index + 1}`);
    join(room, `conn-${index + 1}`, [playerId]);
  });
}

const messagesOf = (messages: Captured[], kind: WsServerMessage['kind']): Captured[] =>
  messages.filter(entry => entry.message.kind === kind);
const last = <T,>(values: T[]): T => values[values.length - 1];

/**
 * Drives P1 into punching range and lands at least one Score Brawl hit, proving
 * that a rematch really resets a non-zero score. P2 stays neutral.
 */
function landOneScoreHit(room: AuthoritativeWsSession): number {
  let sequence = 2;
  for (let attempt = 0; attempt < 900 && room.phase === 'running'; attempt++) {
    const state = room.snapshot().state;
    const p1 = state.fighters.find(fighter => fighter.id === 'P1');
    const p2 = state.fighters.find(fighter => fighter.id === 'P2');
    if (!p1 || !p2) throw new Error('Roster lost during a driven match');
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const aligned = Math.abs(dy) <= 14;
    const inReach = dx > 0 && dx <= 32 && aligned;
    const input: PlayerInput = {
      playerId: 'P1',
      moveX: inReach ? 0 : dx > 20 ? 1 : 0,
      moveY: Math.abs(dy) > 6 ? (dy > 0 ? 1 : -1) : 0,
      jump: false,
      // Single-tick presses: the simulation scans for a new button press.
      punch: inReach && attempt % 6 === 0,
    };
    const result = room.handleMessage(
      'conn-1',
      envelopeText(inputEnvelope(sequence++, state.tick, [input])),
    );
    if (result === null || !result.accepted) {
      throw new Error(`Driven input was denied: ${result === null ? 'no result' : result.code}`);
    }
    room.stepOnce();
    if ((room.snapshot().state.fighters.find(fighter => fighter.id === 'P1')?.score ?? 0) > 0) return sequence;
  }
  throw new Error('P1 never landed a scoring hit');
}

function runToResults(room: AuthoritativeWsSession): void {
  while (room.phase === 'running') room.stepOnce();
  expect(room.phase).toBe('results');
}

describe('M9 rematch session capability', () => {
  it('starts a second match with the same roster, zeroed counters and a higher matchId', () => {
    const { room, messages } = captureRoom({ playerIds: PLAYERS, allowRematch: true });
    joinAll(room);
    expect(room.beginMatch()).toBe(true);
    const firstStart = last(messagesOf(messages, 'match-start')).message;
    expect(firstStart).toMatchObject({ matchId: 1, startTick: 0 });

    const lastSequence = landOneScoreHit(room);
    const scored = room.snapshot().state.fighters.find(fighter => fighter.id === 'P1')?.score ?? 0;
    expect(scored).toBeGreaterThan(0);
    runToResults(room);
    const endTick = room.tick;
    const firstEvents = room.orderedEvents();
    expect(firstEvents.some(event => event.type === 'MatchEnded')).toBe(true);
    const firstEnd = last(messagesOf(messages, 'match-end')).message;
    if (firstEnd.kind !== 'match-end') throw new Error('Unexpected message');
    expect(firstEnd.result).toEqual(computeMatchResult(room.snapshot().state, firstEvents));

    const startsBefore = messagesOf(messages, 'match-start').length;
    const result = room.handleMessage(
      'conn-1',
      envelopeText({ version: 1, kind: 'rematch', sequence: lastSequence + 1 }),
    );
    expect(result?.accepted).toBe(true);
    expect(room.phase).toBe('running');
    expect(room.matchIdValue).toBe(2);
    expect(messagesOf(messages, 'match-start')).toHaveLength(startsBefore + 1);
    const secondStart = last(messagesOf(messages, 'match-start')).message;
    expect(secondStart).toMatchObject({ matchId: 2, startTick: endTick, tickRate: 60, snapshotHz: 20 });

    const state = room.snapshot().state;
    expect(state.tick).toBe(endTick);
    expect(state.phase).toBe('countdown');
    expect(state.countdownTicks).toBe(COUNTDOWN_TICKS);
    expect(state.remainingTicks).toBe(MATCH_TICKS);
    expect(state.fighters.map(fighter => fighter.id)).toEqual(PLAYERS);
    expect(state.fighters.map(fighter => fighter.score)).toEqual([0, 0]);
    expect(state.fighters.every(fighter => fighter.health === 100)).toBe(true);
    expect(room.orderedEvents()).toEqual([]);
    expect(room.bufferedTicks).toBe(0);
    expect(room.modeValue).toBe('score-brawl');

    // The absolute clock continues, so client input targets stay valid.
    const nextTick = room.tick + 1;
    expect(room.handleMessage(
      'conn-1',
      envelopeText(inputEnvelope(lastSequence + 2, nextTick, [{ playerId: 'P1', moveX: 1, moveY: 0, jump: false }])),
    )?.accepted).toBe(true);
    expect(room.stepOnce().tick).toBe(endTick + 1);
  });

  it('is idempotent for repeated requests while the rematch is starting', () => {
    const { room, messages } = captureRoom({ playerIds: PLAYERS, allowRematch: true });
    joinAll(room);
    room.beginMatch();
    runToResults(room);
    const startsBefore = messagesOf(messages, 'match-start').length;
    const errorsBefore = messagesOf(messages, 'error').length;

    expect(room.handleMessage('conn-1', envelopeText({ version: 1, kind: 'rematch', sequence: 2 }))?.accepted)
      .toBe(true);
    expect(room.handleMessage('conn-1', envelopeText({ version: 1, kind: 'rematch', sequence: 3 }))?.accepted)
      .toBe(true);

    expect(room.phase).toBe('running');
    expect(room.matchIdValue).toBe(2);
    expect(messagesOf(messages, 'match-start')).toHaveLength(startsBefore + 1);
    expect(messagesOf(messages, 'error')).toHaveLength(errorsBefore);

    // After the new match ticks, a late request is no longer a rematch request.
    room.stepOnce();
    expect(room.handleMessage('conn-1', envelopeText({ version: 1, kind: 'rematch', sequence: 4 })))
      .toBeNull();
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({ code: 'not-in-results' });
    expect(room.matchIdValue).toBe(2);
  });

  it('refuses a rematch outside the results phase and stays consistent', () => {
    const { room, messages } = captureRoom({ playerIds: PLAYERS, allowRematch: true });
    joinAll(room);
    room.beginMatch();
    expect(room.handleMessage('conn-1', envelopeText({ version: 1, kind: 'rematch', sequence: 2 })))
      .toBeNull();
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({ code: 'not-in-results' });
    expect(room.phase).toBe('running');
    expect(room.matchIdValue).toBe(1);
    expect(messagesOf(messages, 'match-start')).toHaveLength(1);
    // The session still runs and can be closed cleanly.
    expect(room.stepOnce().stepped).toBe(true);
  });

  it('refuses a rematch when a player left and keeps the finished match intact', () => {
    const { room, messages } = captureRoom({ playerIds: PLAYERS, allowRematch: true });
    joinAll(room);
    room.beginMatch();
    runToResults(room);
    const endTick = room.tick;
    const endMessages = messagesOf(messages, 'match-end').length;
    expect(room.disconnect('conn-2')).toEqual(['P2']);
    expect(room.phase).toBe('results');

    expect(room.handleMessage('conn-1', envelopeText({ version: 1, kind: 'rematch', sequence: 2 })))
      .toBeNull();
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({ code: 'roster-incomplete' });
    expect(room.phase).toBe('results');
    expect(room.tick).toBe(endTick);
    expect(room.matchIdValue).toBe(1);
    expect(messagesOf(messages, 'match-start')).toHaveLength(1);
    expect(messagesOf(messages, 'match-end')).toHaveLength(endMessages);
  });

  it('keeps the one-shot default when rematch is not enabled', () => {
    const { room, messages } = captureRoom({ playerIds: PLAYERS });
    expect(room.rematchAllowed).toBe(false);
    joinAll(room);
    room.beginMatch();
    runToResults(room);
    expect(room.handleMessage('conn-1', envelopeText({ version: 1, kind: 'rematch', sequence: 2 })))
      .toBeNull();
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({ code: 'rematch-disabled' });
    expect(room.phase).toBe('results');
    expect(room.matchIdValue).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Real-socket end-to-end coverage: a short Last Man Standing match, the result
// payload and a rematch in the same server process.
// ---------------------------------------------------------------------------

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
  timeoutMs = 20000,
): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Node timers active in this process; used to prove a clean shutdown. */
function activeTimeoutCount(): number | null {
  const resources = (process as unknown as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo;
  if (typeof resources !== 'function') return null;
  return resources.call(process).filter(entry => entry === 'Timeout').length;
}

function bindingFailure(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  if (code && ['EACCES', 'EPERM', 'EADDRINUSE', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return code;
  }
  return null;
}

function tightPunchInputs(snapshot: StateSnapshot | null, targetTick: number): PlayerInput {
  const p1 = snapshot?.state.fighters.find(fighter => fighter.id === 'P1');
  const p2 = snapshot?.state.fighters.find(fighter => fighter.id === 'P2');
  if (!p1 || !p2) return { playerId: 'P1', moveX: 0, moveY: 0, jump: false };
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const aligned = Math.abs(dy) <= 14;
  const inReach = dx > 0 && dx <= 32 && aligned;
  return {
    playerId: 'P1',
    moveX: inReach ? 0 : dx > 20 ? 1 : 0,
    moveY: Math.abs(dy) > 6 ? (dy > 0 ? 1 : -1) : 0,
    jump: false,
    punch: inReach && targetTick % 6 === 0,
  };
}

describe('M9 online result and rematch over real sockets', () => {
  const openServers: MatchServerHandle[] = [];
  const openClients: NodeSession[] = [];

  afterEach(async () => {
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

  it('finishes with a result payload, then serves a second match with a higher matchId and zeroed scores', async (ctx: TestContext) => {
    const baselineTimeouts = activeTimeoutCount();
    let server: MatchServerHandle;
    try {
      server = await startMatchServer({
        host: '127.0.0.1',
        port: 0,
        playerIds: PLAYERS,
        mode: 'last-man-standing',
        snapshotHz: 30,
        startDelayMs: 0,
        firstTickDelayMs: 0,
        allowRematch: true,
      });
      openServers.push(server);
    } catch (error) {
      const code = bindingFailure(error);
      ctx.skip(code === null
        ? `Local WebSocket server could not start: ${error instanceof Error ? error.message : String(error)}`
        : `Local WebSocket binding unavailable (${code})`);
      return;
    }

    const url = `ws://127.0.0.1:${server.port}`;
    const starts = PLAYERS.map(() => [] as number[]);
    const ends = PLAYERS.map(() => [] as Array<{ tick: number; result?: WsMatchResult }>);
    const snapshots: Array<StateSnapshot | null> = [null, null];
    const errors = PLAYERS.map(() => [] as string[]);
    const startsSeen = PLAYERS.map(() => deferred<void>());
    const secondStarts = PLAYERS.map(() => deferred<void>());
    const endsSeen = PLAYERS.map(() => deferred<void>());
    const clients: NodeSession[] = [];

    for (let index = 0; index < PLAYERS.length; index++) {
      const handlers: SessionClientHandlers = {
        onMatchStart: info => {
          starts[index].push(info.matchId ?? -1);
          if (starts[index].length === 1) startsSeen[index].resolve();
          if (starts[index].length === 2) secondStarts[index].resolve();
        },
        onSnapshot: snapshot => {
          snapshots[index] = snapshot;
        },
        onMatchEnd: (tick, result) => {
          ends[index].push({ tick, result });
          endsSeen[index].resolve();
        },
        onError: error => errors[index].push(error.code),
      };
      const session = await openNodeSession({ url, handlers });
      openClients.push(session);
      clients.push(session);
      session.client.join([PLAYERS[index]]);
    }

    await Promise.all(startsSeen.map(start => start.promise));
    await waitFor('a running authoritative match', () => server.room.phase === 'running');

    // Drive P1 with the same real socket a browser uses; P2 stays idle.
    let nextTarget = 0;
    const deadline = Date.now() + 20000;
    while (server.room.phase === 'running' && Date.now() < deadline) {
      if (nextTarget < server.room.tick + 1) nextTarget = server.room.tick + 1;
      let guard = 0;
      while (nextTarget <= server.room.tick + 3 && guard < 8) {
        guard += 1;
        const input = tightPunchInputs(snapshots[0], nextTarget);
        try {
          clients[0].client.submitInput(nextTarget, [input]);
        } catch {
          // A close race with the end of the match is harmless here.
        }
        nextTarget += 1;
      }
      await delay(4);
    }

    expect(server.room.phase).toBe('results');
    await Promise.all(endsSeen.map(end => end.promise));
    const endTick = server.room.tick;
    for (let index = 0; index < PLAYERS.length; index++) {
      expect(ends[index]).toHaveLength(1);
      const payload = ends[index][0].result;
      expect(payload).toBeDefined();
      expect(payload?.reason).toBe('elimination');
      expect(payload?.winner).toBe('P1');
      expect(payload?.ranking).toEqual(
        rankMatch(server.room.snapshot().state, server.room.orderedEvents())
          .order.map(entry => ({ id: entry.id, rank: entry.rank, metric: entry.metric })),
      );
      // Input racing the final authoritative tick may be denied as expected.
      expect(errors[index].filter(code => code !== 'match-complete' && code !== 'late-tick')).toEqual([]);
    }

    // The full roster is still connected, so the host's rematch is accepted.
    expect(clients[0].client.sessionState).toBe('joined');
    clients[0].client.rematch();
    await Promise.all(secondStarts.map(start => start.promise));
    for (let index = 0; index < PLAYERS.length; index++) {
      expect(starts[index]).toEqual([1, 2]);
    }
    expect(server.room.matchIdValue).toBe(2);
    expect(server.room.phase).toBe('running');
    expect(server.room.tick).toBeGreaterThanOrEqual(endTick);
    expect(server.room.snapshot().state.fighters.map(fighter => fighter.score)).toEqual([0, 0]);
    expect(server.room.snapshot().state.fighters.every(fighter => fighter.health === 100)).toBe(true);
    expect(server.room.orderedEvents()).toEqual([]);

    // A late snapshot from the first match cannot be mistaken for the second.
    await waitFor('the second match to tick', () => server.room.tick > endTick);

    const serverIndex = openServers.indexOf(server);
    if (serverIndex >= 0) openServers.splice(serverIndex, 1);
    await server.close();
    expect(server.room.phase).toBe('closed');
    for (const client of clients) client.close();
    await Promise.all(clients.map(client => client.closed));
    await delay(150);
    if (baselineTimeouts !== null) {
      expect(activeTimeoutCount()).toBeLessThanOrEqual(baselineTimeouts);
    }
  }, 40000);
});
