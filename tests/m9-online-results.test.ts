import { describe, expect, it } from 'vitest';
import { encodeClientEnvelope, decodeClientEnvelope, type ClientSessionEnvelope } from '../src/game/session/sessionEnvelope';
import { createState } from '../src/game/simulation/step';
import { MODE_IDS } from '../src/game/simulation/modes';
import { rankMatch } from '../src/game/simulation/ranking';
import type { EndReason, Fighter, GameEvent, GameState, ModeId, PlayerInput } from '../src/game/simulation/types';
import {
  decodeWsServerMessage,
  encodeWsServerMessage,
  type WsMatchResult,
  type WsServerMessage,
} from '../src/game/networking/wsMessages';
import { SessionClientCore, type SessionClientHandlers } from '../src/game/networking/wsSessionClient';
import { computeMatchResult } from '../server/ws/matchResult';
import { AuthoritativeWsSession, type WsSessionOptions, type WsSessionPhase } from '../server/ws/authoritativeWsSession';

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

const fighter = (id: string, overrides: Partial<Fighter> = {}): Fighter => ({
  id, x: 0, y: 0, z: 0, vz: 0, facing: 1, health: 100, score: 0, koCount: 0, hitsReceived: 0,
  attackCooldown: 0, attackFrames: 0, attackMove: null, hitTargets: [], hitstun: 0, koTimer: 0,
  protection: 0, previousButtons: [], ...overrides,
});

const gameState = (mode: ModeId, fighters: Fighter[], events: GameEvent[] = []): GameState => ({
  tick: 7200, phase: 'results', countdownTicks: 0, remainingTicks: 0, fighters, events,
  ...(mode === 'score-brawl' ? {} : { mode }),
});

const ended = (tick: number, winner: string | null | undefined, reason?: EndReason): GameEvent => ({
  tick,
  type: 'MatchEnded',
  ...(reason === undefined ? {} : { reason }),
  ...(winner === undefined ? {} : { winner }),
});

const orderOf = (state: GameState, events: readonly GameEvent[]): WsMatchResult['ranking'] =>
  rankMatch(state, events).order.map(entry => ({ id: entry.id, rank: entry.rank, metric: entry.metric }));

describe('M9 online match result computation', () => {
  it('matches rankMatch for Score Brawl, including its historical reason-less MatchEnded', () => {
    const state = gameState('score-brawl', [
      fighter('P1', { score: 900, koCount: 1, hitsReceived: 2 }),
      fighter('P2', { score: 500, koCount: 0, hitsReceived: 4 }),
    ], [ended(7200, undefined)]);
    const result = computeMatchResult(state, state.events);
    expect(result.reason).toBe('time');
    expect(result.winner).toBe('P1');
    expect(result.ranking).toEqual(orderOf(state, state.events));
  });

  it('matches rankMatch for Last Man Standing elimination order', () => {
    const state = gameState('last-man-standing', [
      fighter('P1', { eliminated: false, damageDealt: 200 }),
      fighter('P2', { eliminated: true, koCount: 0 }),
      fighter('P3', { eliminated: true, koCount: 0 }),
    ]);
    const events: GameEvent[] = [
      { tick: 100, type: 'Knockout', attacker: 'P1', target: 'P2' },
      { tick: 200, type: 'Knockout', attacker: 'P1', target: 'P3' },
      ended(200, 'P1', 'elimination'),
    ];
    const result = computeMatchResult(state, events);
    expect(result).toMatchObject({ reason: 'elimination', winner: 'P1' });
    expect(result.ranking).toEqual(orderOf(state, events));
    // Survivors first, then the last eliminated fighter: standard competition ranks.
    expect(result.ranking.map(entry => [entry.id, entry.rank])).toEqual([['P1', 1], ['P3', 2], ['P2', 3]]);
  });

  it('matches rankMatch for Deathmatch frag-limit results', () => {
    const state = gameState('deathmatch', [
      fighter('P1', { frags: 4, deaths: 6, damageDealt: 120 }),
      fighter('P2', { frags: 20, deaths: 2, damageDealt: 80 }),
      fighter('P3', { frags: 7, deaths: 3, damageDealt: 90 }),
    ]);
    const events = [ended(4000, 'P2', 'frag-limit')];
    const result = computeMatchResult(state, events);
    expect(result).toMatchObject({ reason: 'frag-limit', winner: 'P2' });
    expect(result.ranking).toEqual(orderOf(state, events));
  });

  it('reports a shared top place as a draw instead of inventing a winner', () => {
    const state = gameState('score-brawl', [
      fighter('P2', { score: 600 }),
      fighter('P1', { score: 600 }),
      fighter('P3', { score: 100 }),
    ], [ended(7200, undefined)]);
    const result = computeMatchResult(state, state.events);
    expect(rankMatch(state, state.events).draw).toBe(true);
    expect(result.winner).toBeNull();
    expect(result.ranking.map(entry => entry.rank)).toEqual([1, 1, 3]);
  });

  it('honours an explicit null winner even when a mode event supplied it', () => {
    const state = gameState('deathmatch', [
      fighter('P1', { frags: 3 }),
      fighter('P2', { frags: 3 }),
    ]);
    const events = [ended(7200, null, 'time')];
    expect(rankMatch(state, events).draw).toBe(true);
    expect(computeMatchResult(state, events).winner).toBeNull();
  });

  it('emits the payload on every session match-end for all three modes', () => {
    for (const mode of MODE_IDS) {
      const { room, messages } = captureRoom({ playerIds: PLAYERS, mode });
      joinAll(room);
      expect(room.beginMatch()).toBe(true);
      while (room.phase === 'running') room.stepOnce();
      expect(room.phase).toBe('results');
      const end = last(messagesOf(messages, 'match-end')).message;
      if (end.kind !== 'match-end') throw new Error('Unexpected message');
      expect(end.result).toBeDefined();
      const expected = computeMatchResult(room.snapshot().state, room.orderedEvents());
      expect(end.result).toEqual(expected);
      expect(end.result?.ranking).toEqual(orderOf(room.snapshot().state, room.orderedEvents()));
      expect(end.result?.ranking).toHaveLength(PLAYERS.length);
      // No inputs: every mode ends level, so the payload must say draw.
      expect(end.result?.winner).toBeNull();
      expect(end.result?.ranking.every(entry => entry.rank === 1)).toBe(true);
      expect(rankMatch(room.snapshot().state, room.orderedEvents()).draw).toBe(true);
    }
  });

  it('decodes a legacy match-end without a result unchanged', () => {
    const legacy: WsServerMessage = { version: 1, kind: 'match-end', tick: 7200 };
    expect(encodeWsServerMessage(legacy)).toBe('{"version":1,"kind":"match-end","tick":7200}');
    expect(decodeWsServerMessage(encodeWsServerMessage(legacy))).toEqual(legacy);
  });
});

describe('M9 result payload codec', () => {
  const result: WsMatchResult = {
    reason: 'time',
    winner: 'P1',
    ranking: [
      { id: 'P1', rank: 1, metric: 3 },
      { id: 'P2', rank: 2, metric: 1 },
    ],
  };

  it('round-trips every result reason and a draw with canonical bytes', () => {
    for (const reason of ['elimination', 'frag-limit', 'time'] as const) {
      const message: WsServerMessage = {
        version: 1,
        kind: 'match-end',
        tick: 100,
        result: { ...result, reason },
      };
      expect(decodeWsServerMessage(encodeWsServerMessage(message))).toEqual(message);
      expect(decodeWsServerMessage(new TextEncoder().encode(encodeWsServerMessage(message)))).toEqual(message);
    }
    const draw: WsServerMessage = {
      version: 1,
      kind: 'match-end',
      tick: 100,
      result: {
        reason: 'time',
        winner: null,
        ranking: [{ id: 'P1', rank: 1, metric: 600 }, { id: 'P2', rank: 1, metric: 600 }],
      },
    };
    expect(decodeWsServerMessage(encodeWsServerMessage(draw))).toEqual(draw);
    expect(encodeWsServerMessage({
      version: 1,
      kind: 'match-end',
      tick: 7200,
      result,
    })).toBe(
      '{"version":1,"kind":"match-end","tick":7200,"result":{"reason":"time","winner":"P1",' +
      '"ranking":[{"id":"P1","rank":1,"metric":3},{"id":"P2","rank":2,"metric":1}]}}',
    );
  });

  it('keeps the legacy match-start bytes and adds an optional monotonic matchId', () => {
    const legacy: WsServerMessage = { version: 1, kind: 'match-start', startTick: 0, tickRate: 60, snapshotHz: 20 };
    expect(encodeWsServerMessage(legacy)).toBe(
      '{"version":1,"kind":"match-start","startTick":0,"tickRate":60,"snapshotHz":20}',
    );
    expect(decodeWsServerMessage(encodeWsServerMessage(legacy))).toEqual(legacy);

    const rematch: WsServerMessage = { ...legacy, matchId: 2 };
    expect(decodeWsServerMessage(encodeWsServerMessage(rematch))).toEqual(rematch);
    expect(() => decodeWsServerMessage('{"version":1,"kind":"match-start","startTick":0,' +
      '"tickRate":60,"snapshotHz":20,"matchId":"2"}')).toThrow();
    expect(() => decodeWsServerMessage('{"version":1,"kind":"match-start","startTick":0,' +
      '"tickRate":60,"snapshotHz":20,"matchId":-1}')).toThrow();
  });

  it('rejects malformed result payloads instead of trusting them', () => {
    const base = { version: 1, kind: 'match-end', tick: 7200, result };
    const reject = (mutate: (value: Record<string, unknown>) => void, options?: { roster?: readonly string[] }): void => {
      const value = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      mutate(value);
      expect(() => decodeWsServerMessage(JSON.stringify(value), options)).toThrow(/Malformed/);
    };

    reject(value => { (value.result as Record<string, unknown>).extra = true; });
    reject(value => { delete (value.result as Record<string, unknown>).reason; });
    reject(value => { (value.result as Record<string, unknown>).reason = 'mercy'; });
    reject(value => { (value.result as Record<string, unknown>).winner = 7; });
    reject(value => { (value.result as Record<string, unknown>).ranking = []; });
    reject(value => { (value.result as Record<string, unknown>).ranking = 'none'; });
    reject(value => {
      const entry = ((value.result as Record<string, unknown>).ranking as Record<string, unknown>[])[0];
      entry.rank = '1';
    });
    reject(value => {
      const entry = ((value.result as Record<string, unknown>).ranking as Record<string, unknown>[])[0];
      entry.rank = 0;
    });
    reject(value => {
      const entry = ((value.result as Record<string, unknown>).ranking as Record<string, unknown>[])[0];
      entry.rank = 1.5;
    });
    reject(value => {
      const entry = ((value.result as Record<string, unknown>).ranking as Record<string, unknown>[])[0];
      entry.metric = '3';
    });
    reject(value => {
      const entry = ((value.result as Record<string, unknown>).ranking as Record<string, unknown>[])[0];
      entry.metric = -2;
    });
    reject(value => {
      const entry = ((value.result as Record<string, unknown>).ranking as Record<string, unknown>[])[0];
      entry.id = 'P2';
    });
    reject(value => {
      (value.result as Record<string, unknown>).ranking = [
        { id: 'P1', rank: 1, metric: 3 },
        { id: 'P2', rank: 3, metric: 1 },
      ];
    });
    reject(value => { (value.result as Record<string, unknown>).winner = 'P2'; });
    reject(value => { (value.result as Record<string, unknown>).winner = 'P3'; });
    reject(value => { (value.result as Record<string, unknown>).ranking = [{ id: 'P1', rank: 1, metric: 3 }]; },
      { roster: ['P1', 'P2'] });
    reject(value => { (value.result as Record<string, unknown>).ranking = [
      { id: 'P1', rank: 1, metric: 3 },
      { id: 'P3', rank: 2, metric: 1 },
    ]; }, { roster: ['P1', 'P2'] });
    reject(value => { (value.result as Record<string, unknown>).reason = 'time'; value.extra = 1; });

    const accepted = { ...base, result: { ...result } };
    expect(decodeWsServerMessage(JSON.stringify(accepted), { roster: PLAYERS })).toEqual(accepted);
  });
});

describe('M9 online client result and match identity', () => {
  function makeClient(handlers: SessionClientHandlers = {}): { client: SessionClientCore; sent: string[] } {
    const sent: string[] = [];
    const client = new SessionClientCore(handlers);
    client.attachTransport(data => sent.push(data));
    return { client, sent };
  }

  const snapshotAt = (tick: number) => ({
    version: 1 as const,
    state: { ...createState(PLAYERS, 'fighting'), tick },
  });

  it('surfaces the server result and clears a stale snapshot on a new matchId', () => {
    const starts: Array<{ matchId?: number; startTick: number }> = [];
    const ends: Array<{ tick: number; result?: WsMatchResult }> = [];
    const { client } = makeClient({
      onMatchStart: info => starts.push({ matchId: info.matchId, startTick: info.startTick }),
      onMatchEnd: (tick, result) => ends.push({ tick, result }),
    });
    client.receive(encodeWsServerMessage({ version: 1, kind: 'join-result', accepted: true, playerIds: ['P1'] }));
    client.receive(encodeWsServerMessage({
      version: 1, kind: 'match-start', startTick: 0, tickRate: 60, snapshotHz: 20, matchId: 1,
    }));
    expect(client.matchId).toBe(1);
    client.receive(encodeWsServerMessage({ version: 1, kind: 'snapshot', snapshot: snapshotAt(120) }));
    expect(client.lastSnapshot?.state.tick).toBe(120);

    const result: WsMatchResult = {
      reason: 'elimination',
      winner: 'P1',
      ranking: [{ id: 'P1', rank: 1, metric: 1 }, { id: 'P2', rank: 2, metric: 0 }],
    };
    client.receive(encodeWsServerMessage({ version: 1, kind: 'match-end', tick: 120, result }));
    expect(client.matchResult).toEqual(result);
    expect(ends).toEqual([{ tick: 120, result }]);

    client.receive(encodeWsServerMessage({
      version: 1, kind: 'match-start', startTick: 120, tickRate: 60, snapshotHz: 20, matchId: 2,
    }));
    expect(client.matchId).toBe(2);
    expect(client.lastSnapshot).toBeNull();
    expect(starts).toEqual([{ matchId: 1, startTick: 0 }, { matchId: 2, startTick: 120 }]);
  });

  it('keeps a valid legacy match-start and ignores a malformed result without mutation', () => {
    const errors: string[] = [];
    const { client } = makeClient({ onProtocolError: message => errors.push(message) });
    client.receive(encodeWsServerMessage({
      version: 1, kind: 'match-start', startTick: 0, tickRate: 60, snapshotHz: 20,
    }));
    expect(client.matchId).toBeNull();
    client.receive(encodeWsServerMessage({ version: 1, kind: 'snapshot', snapshot: snapshotAt(5) }));
    client.receive('{"version":1,"kind":"match-end","tick":6,"result":{"reason":"time","winner":"P9",' +
      '"ranking":[{"id":"P1","rank":1,"metric":3}]}}');
    expect(errors).toHaveLength(1);
    expect(client.lastSnapshot?.state.tick).toBe(5);
    expect(client.matchResult).toBeNull();
  });

  it('sends a canonical rematch envelope only from a joined session', () => {
    const { client, sent } = makeClient();
    expect(() => client.rematch()).toThrow(/accepted join/);
    expect(client.join(['P1'])).toBe(1);
    client.receive(encodeWsServerMessage({ version: 1, kind: 'join-result', accepted: true, playerIds: ['P1'] }));
    expect(client.rematch()).toBe(2);
    expect(sent[1]).toBe('{"version":1,"kind":"rematch","sequence":2}');
    expect(decodeClientEnvelope(sent[1])).toEqual({ version: 1, kind: 'rematch', sequence: 2 });
    expect(() => decodeClientEnvelope('{"version":1,"kind":"rematch","sequence":2,"playerIds":["P1"]}'))
      .toThrow(/Unknown envelope field/);
  });
});
