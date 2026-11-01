import { readdirSync, readFileSync } from 'node:fs';
import { join as joinPath, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeClientEnvelope, encodeClientEnvelope, type ClientSessionEnvelope } from '../src/game/session/sessionEnvelope';
import { createState } from '../src/game/simulation/step';
import type { PlayerInput } from '../src/game/simulation/types';
import { decodeStateSnapshot, encodeStateSnapshot } from '../src/game/protocol/stateSnapshot';
import {
  MAX_WS_SERVER_MESSAGE_BYTES,
  SUPPORTED_SNAPSHOT_HZ,
  decodeWsServerMessage,
  encodeWsServerMessage,
  type SnapshotHz,
  type WsServerMessage,
} from '../src/game/networking/wsMessages';
import { SessionClientCore, type SessionClientHandlers } from '../src/game/networking/wsSessionClient';
import { openBrowserSession } from '../src/game/networking/browserWsAdapter';
import { createWsPrototypeManifest, validateWsPrototypeManifest } from '../benchmarks/ws/wsManifest';
import {
  AuthoritativeWsSession,
  type WsSessionOptions,
  type WsSessionPhase,
} from '../server/ws/authoritativeWsSession';

const PLAYERS = ['P1', 'P2', 'P3', 'P4'];
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

function envelopeText(envelope: ClientSessionEnvelope): string {
  return encodeClientEnvelope(envelope);
}

function join(room: AuthoritativeWsSession, connectionId: string, playerIds: string[], sequence = 1): void {
  room.handleMessage(connectionId, envelopeText({
    version: 1, kind: 'join-request', sequence, playerIds,
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

const controls = (playerId: string, moveX: -1 | 0 | 1 = 1): PlayerInput =>
  ({ playerId, moveX, moveY: 0, jump: false });

function joinAll(room: AuthoritativeWsSession): void {
  PLAYERS.forEach((playerId, index) => {
    room.addConnection(`conn-${index + 1}`);
    join(room, `conn-${index + 1}`, [playerId]);
  });
}

const messagesOf = (messages: Captured[], kind: WsServerMessage['kind']): Captured[] =>
  messages.filter(entry => entry.message.kind === kind);

const last = <T,>(values: T[]): T => values[values.length - 1];

describe('M2 WebSocket prototype authoritative session', () => {
  it('assigns trusted connection identity outside payloads and rejects spoofed slots', () => {
    const { room, messages } = captureRoom();
    room.addConnection('conn-1');
    expect(last(messages).message).toEqual({
      version: 1, kind: 'welcome', connectionId: 'conn-1', roomId: ROOM,
    });

    join(room, 'conn-1', ['P1']);
    expect(last(messagesOf(messages, 'join-result')).message).toMatchObject({
      accepted: true, playerIds: ['P1'],
    });
    expect(room.hostConnectionId).toBe('conn-1');

    room.addConnection('conn-2');
    // Another connection may not claim an owned slot.
    join(room, 'conn-2', ['P1']);
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({ code: 'player-owned' });
    expect(room.playerCount).toBe(1);

    // A payload field cannot name the connection or elevate it.
    room.handleMessage('conn-2',
      '{"version":1,"kind":"join-request","sequence":1,"playerIds":["P2"],"connectionId":"conn-1","host":true}');
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({ code: 'unknown-field' });
    expect(room.isJoined('conn-2')).toBe(false);

    // Arbitrary slot names outside the configured BASE-4 roster fail closed.
    join(room, 'conn-2', ['P9']);
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({ code: 'unknown-player' });
    expect(room.playerCount).toBe(1);

    // Cross-room payload assertions are denied by the gateway, not trusted.
    room.handleMessage('conn-2', envelopeText({
      version: 1, kind: 'join-request', sequence: 1, roomId: 'other-room', playerIds: ['P2'],
    }));
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({ code: 'room-mismatch' });
  });

  it('freezes the roster at match start and rejects premature or spoofed input without mutation', () => {
    const { room, messages, phases } = captureRoom();
    joinAll(room);
    expect(room.phase).toBe('starting');
    expect(phases).toEqual(['starting']);
    expect(last(messagesOf(messages, 'roster')).message).toMatchObject({ playerIds: PLAYERS });

    // Premature gameplay input is denied before the gateway buffer sees it.
    input(room, 'conn-2', 2, 0, [controls('P2')]);
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({
      code: 'not-started', targetTick: 0,
    });
    expect(room.bufferedTicks).toBe(0);

    // Roster is frozen; a late join cannot claim a slot.
    room.addConnection('conn-5');
    join(room, 'conn-5', ['P1']);
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({
      code: 'match-started',
    });

    expect(room.beginMatch()).toBe(true);
    expect(room.phase).toBe('running');
    expect(last(messagesOf(messages, 'match-start')).message).toMatchObject({
      startTick: 0, tickRate: 60, snapshotHz: 20,
    });

    const before = room.snapshot().state.fighters.map(fighter => fighter.x);
    // conn-2 may not submit P1's slot.
    input(room, 'conn-2', 2, 0, [controls('P1')]);
    expect(last(messagesOf(messages, 'error')).message).toMatchObject({ code: 'unauthorized-player' });
    expect(room.bufferedTicks).toBe(0);

    // The denied sequence is not burned: conn-2 can still submit its own slot.
    input(room, 'conn-2', 2, 0, [controls('P2')]);
    expect(room.bufferedTicks).toBe(1);
    expect(room.stepOnce().stepped).toBe(true);
    const after = room.snapshot().state.fighters;
    expect(after[1].x).toBeGreaterThan(before[1]);
    expect(after[0].x).toBe(before[0]);
    // Missing P1/P3/P4 input is neutral; the accepted P2 input is consumed once.
    expect(room.stepOnce().stepped).toBe(true);
    expect(room.snapshot().state.fighters[1].x).toBe(after[1].x);
  });

  it('emits validated StateSnapshot messages at 10, 20 and 30 Hz', () => {
    for (const snapshotHz of SUPPORTED_SNAPSHOT_HZ as readonly SnapshotHz[]) {
      const { room, messages } = captureRoom({ snapshotHz });
      joinAll(room);
      room.beginMatch();
      for (let tick = 0; tick < 60; tick++) room.stepOnce();
      const snapshots = messagesOf(messages, 'snapshot');
      expect(snapshots).toHaveLength(snapshotHz);
      for (const [index, entry] of snapshots.entries()) {
        if (entry.message.kind !== 'snapshot') throw new Error('Unexpected message');
        const decoded = decodeWsServerMessage(encodeWsServerMessage(entry.message));
        if (decoded.kind !== 'snapshot') throw new Error('Unexpected message');
        expect(decodeStateSnapshot(encodeStateSnapshot(decoded.snapshot)).state.tick)
          .toBe((index + 1) * (60 / snapshotHz));
      }
      expect(last(snapshots).message.kind === 'snapshot').toBe(true);
      const finalSnapshot = last(snapshots).message;
      if (finalSnapshot.kind !== 'snapshot') throw new Error('Unexpected message');
      expect(finalSnapshot.snapshot.state.tick).toBe(60);
    }
    expect(() => captureRoom({ snapshotHz: 15 as SnapshotHz })).toThrow(/snapshot rate/);
  });

  it('revokes a non-host disconnect but keeps the match running without implicit authority', () => {
    const { room, messages } = captureRoom();
    joinAll(room);
    room.beginMatch();
    for (let tick = 0; tick < 3; tick++) room.stepOnce();

    expect(room.disconnect('conn-2')).toEqual(['P2']);
    expect(room.phase).toBe('running');
    expect(room.hostConnectionId).toBe('conn-1');
    expect(room.playerCount).toBe(3);
    expect(last(messagesOf(messages, 'roster')).message).toMatchObject({ playerIds: ['P1', 'P3', 'P4'] });

    // The vacated slot consumes neutral input; the session does not stall.
    expect(room.stepOnce().stepped).toBe(true);
    expect(room.tick).toBe(4);
    // A closed socket no longer has trusted context, so late bytes are ignored.
    expect(room.handleMessage('conn-2', envelopeText({
      version: 1, kind: 'input', sequence: 2, targetTick: 4, frame: { version: 1, tick: 4, inputs: [controls('P2')] },
    }))).toBeNull();
    expect(room.tick).toBe(4);
  });

  it('terminates on host disconnect without migrating host authority', () => {
    const { room, messages, phases } = captureRoom();
    joinAll(room);
    room.beginMatch();
    for (let tick = 0; tick < 5; tick++) room.stepOnce();

    expect(room.disconnect('conn-1')).toEqual(['P1']);
    expect(room.phase).toBe('closed');
    expect(phases).toEqual(['starting', 'running', 'closed']);
    expect(room.hostConnectionId).toBe('conn-1');
    expect(room.playerCount).toBe(0);
    expect(room.connectionCount).toBe(0);
    // No successor is assigned and no remaining connection can reclaim authority.
    expect(messagesOf(messages, 'session-closed')).toHaveLength(1);
    expect(messagesOf(messages, 'session-closed')[0].message).toMatchObject({ reason: 'host-lost' });
    expect(() => room.addConnection('conn-6')).toThrow(/closed/);
    expect(room.handleMessage('conn-2', envelopeText({
      version: 1, kind: 'input', sequence: 9, targetTick: 5, frame: { version: 1, tick: 5, inputs: [controls('P2')] },
    }))).toBeNull();
    expect(room.stepOnce().stepped).toBe(false);
  });

  it('returns to lobby when a non-host leaves during starting', () => {
    const { room, messages } = captureRoom();
    joinAll(room);
    expect(room.phase).toBe('starting');
    expect(room.disconnect('conn-2')).toEqual(['P2']);
    expect(room.phase).toBe('lobby');
    expect(room.hostConnectionId).toBe('conn-1');
    expect(room.playerCount).toBe(3);
    expect(last(messagesOf(messages, 'roster')).message).toMatchObject({ playerIds: ['P1', 'P3', 'P4'] });
    // A replacement can claim the freed slot and re-enter starting; host is unchanged.
    room.addConnection('conn-5');
    join(room, 'conn-5', ['P2']);
    expect(room.phase).toBe('starting');
    expect(room.hostConnectionId).toBe('conn-1');
    expect(room.playerCount).toBe(4);
  });

  it('treats a host leave-request as the same explicit host-lost transition', () => {
    const starting = captureRoom();
    joinAll(starting.room);
    expect(starting.room.phase).toBe('starting');
    expect(starting.room.disconnect('conn-1')).toEqual(['P1']);
    expect(starting.room.phase).toBe('closed');
    expect(messagesOf(starting.messages, 'session-closed')[0]?.message)
      .toMatchObject({ reason: 'host-lost' });

    const { room, messages } = captureRoom();
    joinAll(room);
    room.beginMatch();
    room.handleMessage('conn-1', envelopeText({ version: 1, kind: 'leave-request', sequence: 2 }));
    expect(room.phase).toBe('closed');
    expect(messagesOf(messages, 'session-closed')[0]?.message).toMatchObject({ reason: 'host-lost' });
    expect(room.hostConnectionId).toBe('conn-1');
    expect(room.playerCount).toBe(0);
  });

  it('stops a bounded run exactly at the configured tick and reports it once', () => {
    const { room, messages } = captureRoom({ maxTicks: 10, snapshotHz: 20 });
    joinAll(room);
    room.beginMatch();
    for (let attempt = 0; attempt < 40; attempt++) room.stepOnce();
    expect(room.tick).toBe(10);
    expect(room.isRunComplete).toBe(true);
    expect(messagesOf(messages, 'run-complete')).toHaveLength(1);
    expect(last(messagesOf(messages, 'run-complete')).message).toMatchObject({ tick: 10, reason: 'bounded' });
    expect(messagesOf(messages, 'snapshot')).toHaveLength(4);
    expect(room.stepOnce()).toMatchObject({ stepped: false, tick: 10, complete: true });
  });

  it('rejects invalid configuration explicitly', () => {
    expect(() => captureRoom({ roomId: 'bad room' })).toThrow(/room/);
    expect(() => captureRoom({ playerIds: ['P1', 'P1'] })).toThrow(/roster/);
    expect(() => captureRoom({ playerIds: ['P1', 'P2', 'P3', 'P4', 'P5'] })).toThrow(/roster/);
    expect(() => captureRoom({ maxTicks: 0 })).toThrow(/tick/);
    expect(() => captureRoom({ maxTicks: 7201 })).toThrow(/tick/);
  });
});

describe('M2 WebSocket prototype server message codec', () => {
  it('round-trips every server message kind with a valid snapshot', () => {
    const snapshot = { version: 1 as const, state: createState(PLAYERS, 'fighting') };
    const messages: WsServerMessage[] = [
      { version: 1, kind: 'welcome', connectionId: 'conn-1', roomId: ROOM },
      { version: 1, kind: 'join-result', accepted: true, playerIds: ['P1'] },
      { version: 1, kind: 'join-result', accepted: false, playerIds: [], code: 'player-owned' },
      { version: 1, kind: 'roster', playerIds: PLAYERS },
      { version: 1, kind: 'match-start', startTick: 0, tickRate: 60, snapshotHz: 20 },
      { version: 1, kind: 'snapshot', snapshot },
      { version: 1, kind: 'error', code: 'late-tick', message: 'late', targetTick: 3 },
      { version: 1, kind: 'pong', sequence: 4 },
      { version: 1, kind: 'match-end', tick: 7200 },
      { version: 1, kind: 'run-complete', tick: 300, reason: 'bounded' },
      { version: 1, kind: 'session-closed', reason: 'host-lost' },
    ];
    for (const message of messages) {
      expect(decodeWsServerMessage(encodeWsServerMessage(message))).toEqual(message);
      expect(decodeWsServerMessage(new TextEncoder().encode(encodeWsServerMessage(message)))).toEqual(message);
    }
  });

  it('rejects unknown versions, kinds, fields and malformed snapshots', () => {
    expect(() => decodeWsServerMessage('{"version":2,"kind":"pong","sequence":1}')).toThrow();
    expect(() => decodeWsServerMessage('{"version":1,"kind":"start","sequence":1}')).toThrow();
    expect(() => decodeWsServerMessage('{"version":1,"kind":"pong","sequence":1,"host":true}')).toThrow();
    expect(() => decodeWsServerMessage('{"version":1,"kind":"snapshot","snapshot":{"version":1,"state":{}}}')).toThrow();
    expect(() => decodeWsServerMessage('{"version":1,"kind":"session-closed","reason":"network"}')).toThrow();
    expect(() => decodeWsServerMessage('not json')).toThrow();
    expect(() => decodeWsServerMessage(new Uint8Array([0xff, 0xfe]))).toThrow();
    expect(() => decodeWsServerMessage(' '.repeat(MAX_WS_SERVER_MESSAGE_BYTES + 1))).toThrow(/size/);
  });
});

describe('M2 WebSocket prototype client core', () => {
  function makeClient(handlers: SessionClientHandlers = {}): {
    client: SessionClientCore;
    sent: string[];
  } {
    const sent: string[] = [];
    const client = new SessionClientCore(handlers);
    client.attachTransport(data => sent.push(data));
    return { client, sent };
  }

  it('increments sequences and reuses the canonical session envelope codec', () => {
    const { client, sent } = makeClient();
    expect(client.join(['P1'])).toBe(1);
    expect(decodeClientEnvelope(sent[0])).toEqual({
      version: 1, kind: 'join-request', sequence: 1, playerIds: ['P1'],
    });

    client.receive(encodeWsServerMessage({
      version: 1, kind: 'join-result', accepted: true, playerIds: ['P1'],
    }));
    expect(client.sessionState).toBe('joined');
    expect(client.ownedPlayerIds).toEqual(['P1']);

    expect(client.submitInput(0, [controls('P1')])).toBe(2);
    expect(decodeClientEnvelope(sent[1])).toEqual({
      version: 1,
      kind: 'input',
      sequence: 2,
      targetTick: 0,
      frame: { version: 1, tick: 0, inputs: [controls('P1')] },
    });
    expect(() => client.submitInput(0, [controls('P2')])).toThrow(/unowned/);
    // A denied join never exposes a slot for input.
    const denied = makeClient();
    denied.client.receive(encodeWsServerMessage({
      version: 1, kind: 'join-result', accepted: false, playerIds: [], code: 'player-owned',
    }));
    expect(() => denied.client.submitInput(0, [controls('P1')])).toThrow(/accepted join/);
  });

  it('tracks match start, snapshots, errors and closure without inventing authority', () => {
    const events: string[] = [];
    const { client } = makeClient({
      onMatchStart: info => events.push(`start:${info.startTick}:${info.tickRate}:${info.snapshotHz}`),
      onSnapshot: snapshot => events.push(`snapshot:${snapshot.state.tick}`),
      onError: error => events.push(`error:${error.code}:${String(error.targetTick)}`),
      onSessionClosed: reason => events.push(`closed:${reason}`),
      onProtocolError: message => events.push(`protocol:${message}`),
    });
    client.receive(encodeWsServerMessage({
      version: 1, kind: 'match-start', startTick: 0, tickRate: 60, snapshotHz: 10,
    }));
    expect(client.serverTick).toBe(0);
    client.receive(encodeWsServerMessage({
      version: 1, kind: 'snapshot', snapshot: { version: 1, state: createState(PLAYERS, 'fighting') },
    }));
    expect(client.serverTick).toBe(0);
    expect(client.lastSnapshot?.state.fighters).toHaveLength(4);
    client.receive(encodeWsServerMessage({ version: 1, kind: 'error', code: 'late-tick', message: 'late', targetTick: 2 }));
    client.receive('{"version":1,"kind":"snapshot"}');
    client.receive(encodeWsServerMessage({ version: 1, kind: 'session-closed', reason: 'host-lost' }));
    expect(events).toEqual([
      'start:0:60:10',
      'snapshot:0',
      'error:late-tick:2',
      'protocol:Malformed server message',
      'closed:host-lost',
    ]);
    expect(client.sessionState).toBe('closed');
    expect(client.ownedPlayerIds).toEqual([]);
  });

  it('uses the global WebSocket API in the browser adapter', () => {
    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      readyState = 1;
      binaryType = 'blob';
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      constructor(readonly url: string) {
        FakeWebSocket.instances.push(this);
      }
      send(data: string): void { this.sent.push(data); }
      close(): void { this.readyState = 3; this.onclose?.(); }
    }
    const original = (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    try {
      const received: string[] = [];
      const session = openBrowserSession({
        url: 'ws://127.0.0.1:1/',
        roomId: ROOM,
        handlers: {
          onWelcome: info => received.push(`welcome:${info.connectionId}`),
          onJoinResult: result => received.push(`join:${String(result.accepted)}`),
        },
      });
      const socket = FakeWebSocket.instances[0];
      expect(socket.url).toBe('ws://127.0.0.1:1/');
      expect(socket.binaryType).toBe('arraybuffer');
      // Join may be requested before the handshake; it is queued, then flushed.
      expect(session.client.join(['P1'])).toBe(1);
      expect(socket.sent).toEqual([]);
      socket.onopen?.();
      expect(socket.sent).toHaveLength(1);
      expect(decodeClientEnvelope(socket.sent[0]).kind).toBe('join-request');

      socket.onmessage?.({ data: encodeWsServerMessage({
        version: 1, kind: 'welcome', connectionId: 'conn-7', roomId: ROOM,
      }) });
      socket.onmessage?.({ data: encodeWsServerMessage({
        version: 1, kind: 'join-result', accepted: true, playerIds: ['P1'],
      }) });
      expect(received).toEqual(['welcome:conn-7', 'join:true']);
      session.close();
      expect(session.client.sessionState).toBe('closed');
    } finally {
      (globalThis as unknown as { WebSocket?: unknown }).WebSocket = original;
    }
  });
});

describe('M2 WebSocket prototype browser boundary', () => {
  it('keeps Node socket imports out of src/game/networking', () => {
    const directory = resolve(process.cwd(), 'src/game/networking');
    const files = readdirSync(directory).filter(file => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(joinPath(directory, file), 'utf8');
      expect(content).not.toMatch(/from\s+['"]ws['"]/);
      expect(content).not.toMatch(/require\(['"]ws['"]\)/);
      expect(content).not.toMatch(/from\s+['"]node:/);
      expect(content).not.toMatch(/WebSocketServer/);
    }
  });
});

describe('M2 WebSocket prototype manifest', () => {
  const hash = 'a'.repeat(64);
  const correctness = {
    finalTick: 300,
    matchesInMemoryReference: true,
    finalStateSha256: hash,
    referenceFinalStateSha256: hash,
    orderedEventsSha256: hash,
    referenceOrderedEventsSha256: hash,
    lateTicks: 0,
    deniedMessages: 0,
  };
  const manifest = (tickMode: 'interval' | 'manual' = 'interval') => createWsPrototypeManifest({
    runId: 'ws-base4-1',
    commitSha: 'b'.repeat(40),
    fixtureSha256: 'c'.repeat(64),
    seed: 12345,
    snapshotHz: 20,
    maxLeadTicks: 8,
    boundedTicks: 300,
    tickMode,
    correctness,
  });

  it('records only correctness fingerprints and keeps performance NOT_MEASURED', () => {
    const value = manifest();
    expect(value.result).toBe('NOT_MEASURED');
    expect(value.measurements).toEqual({
      latency: 'NOT_MEASURED', bandwidth: 'NOT_MEASURED', cpu: 'NOT_MEASURED', tickPacing: 'NOT_MEASURED',
    });
    expect(value.environment).toEqual({
      bindAddress: '127.0.0.1', tls: false, os: 'NOT_MEASURED', browser: 'NOT_MEASURED', cpu: 'NOT_MEASURED',
    });
  });

  it('distinguishes timer-driven pacing from an unsynchronized correctness run', () => {
    const interval = manifest('interval');
    expect(interval.schemaVersion).toBe(2);
    expect(interval.tickMode).toBe('interval');
    expect(interval.pacing).toBe('timer-driven-approximation');
    expect(interval.measurements.tickPacing).toBe('NOT_MEASURED');

    const manual = manifest('manual');
    expect(manual.tickMode).toBe('manual');
    expect(manual.pacing).toBe('unsynchronized-correctness');
    expect(manual.measurements).toEqual(interval.measurements);

    // A fast run must not be re-labelled as an approximation of real time.
    const relabelled = structuredClone(manual) as unknown as { pacing: unknown };
    relabelled.pacing = 'timer-driven-approximation';
    expect(() => validateWsPrototypeManifest(relabelled)).toThrow();
    const unknownMode = structuredClone(manifest()) as unknown as { tickMode: unknown };
    unknownMode.tickMode = 'realtime';
    expect(() => validateWsPrototypeManifest(unknownMode)).toThrow();
    // Schema v1 manifests did not record a tick mode and are no longer accepted.
    const oldSchema = structuredClone(manifest()) as unknown as { schemaVersion: unknown };
    oldSchema.schemaVersion = 1;
    expect(() => validateWsPrototypeManifest(oldSchema)).toThrow();
  });

  it('rejects substituted numbers, inconsistent fingerprints and invalid bounds', () => {
    const base = manifest();
    expect(() => createWsPrototypeManifest({
      runId: 'ws-base4-1', commitSha: 'b'.repeat(40), fixtureSha256: 'c'.repeat(64), seed: 12345,
      snapshotHz: 20, maxLeadTicks: 8, boundedTicks: 0, tickMode: 'interval', correctness,
    })).toThrow();
    expect(() => createWsPrototypeManifest({
      runId: 'ws-base4-1', commitSha: 'b'.repeat(40), fixtureSha256: 'c'.repeat(64), seed: 12345,
      snapshotHz: 20, maxLeadTicks: 8, boundedTicks: 300, tickMode: 'interval',
      correctness: { ...correctness, finalTick: 301 },
    })).toThrow();
    expect(() => createWsPrototypeManifest({
      runId: 'ws-base4-1', commitSha: 'b'.repeat(40), fixtureSha256: 'c'.repeat(64), seed: 12345,
      snapshotHz: 20, maxLeadTicks: 8, boundedTicks: 300, tickMode: 'interval',
      correctness: { ...correctness, matchesInMemoryReference: false },
    })).toThrow();

    const withMeasurement = structuredClone(base) as unknown as { measurements: { latency: unknown } };
    withMeasurement.measurements.latency = 0;
    expect(() => validateWsPrototypeManifest(withMeasurement)).toThrow();
    expect(() => createWsPrototypeManifest({
      runId: 'ws-base4-1', commitSha: 'short', fixtureSha256: 'c'.repeat(64), seed: 12345,
      snapshotHz: 20, maxLeadTicks: 8, boundedTicks: 300, tickMode: 'interval', correctness,
    })).toThrow();
  });
});
