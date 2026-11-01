import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { decodeInputFrame } from '../src/game/protocol/inputFrame';
import { encodeStateSnapshot } from '../src/game/protocol/stateSnapshot';
import type { PlayerInput } from '../src/game/simulation/types';
import type { SessionClientHandlers } from '../src/game/networking/wsSessionClient';
import { startWsServer, type WsServerHandle } from '../server/ws/wsServer';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';
import { InMemoryBenchmarkAdapter } from '../benchmarks/inMemory';
import { createRoster, generateFixture, sha256 } from '../benchmarks/scenarios';
import { driveManualTicks } from '../benchmarks/ws/manualTickDriver';
import { createWsPrototypeManifest, validateWsPrototypeManifest } from '../benchmarks/ws/wsManifest';

/**
 * Full-length correctness coverage for the loopback WebSocket benchmark.
 *
 * Both tests pin the same 7200-tick (120 s) BASE-4 result. The in-memory test
 * guards the deterministic fingerprints without sockets; the socket test drives
 * the real manual tick mode end to end (four sockets, pong barriers, real
 * `stepOnce`) because that run takes only a few seconds on loopback. The
 * shorter bounded socket test in `ws-integration.test.ts` stays unchanged.
 *
 * Nothing here measures latency, bandwidth, CPU or tick pacing.
 */

const PLAYERS = createRoster(4);
const FULL_TICKS = 7200;
const SOCKET_TICKS = FULL_TICKS;

// Independently recorded fingerprints for the BASE-4-60-20 fixture, seed 12345.
const FIXTURE_SHA256 = '7fddf007fc1910d9944d409864fad101e70d0956d864f60a700135f6205b1790';
const FULL_FINAL_STATE_SHA256 = 'de544fcd7fae1bd2c25fd8ccf97ed7fb315014adafd692d45577913a01dff150';
const FULL_ORDERED_EVENTS_SHA256 = '5bb44bd6fc1173ab0b2a3d45c9662f65ad84b6619acd403a57d269108a11ebd5';
const EMPTY_EVENTS_SHA256 = sha256('[]');

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolveFn: (value: T) => void = () => undefined;
  let rejectFn: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

function bindingFailure(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  if (code && ['EACCES', 'EPERM', 'EADDRINUSE', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return code;
  }
  return null;
}

function scheduleFor(ticks: number): PlayerInput[][] {
  const fixture = generateFixture('BASE-4-60-20');
  const schedule: PlayerInput[][] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const tickFrames = fixture.framesByTick[tick];
    if (tickFrames.length !== 1) throw new Error('Invalid BASE-4 fixture framing');
    schedule.push(decodeInputFrame(tickFrames[0]).inputs);
  }
  return schedule;
}

function referenceHashes(ticks: number): { state: string; events: string } {
  const fixture = generateFixture('BASE-4-60-20');
  const adapter = new InMemoryBenchmarkAdapter();
  adapter.connect({ scenarioId: 'BASE-4-60-20' });
  adapter.join(PLAYERS);
  for (let tick = 0; tick < ticks; tick++) adapter.sendInput(fixture.framesByTick[tick][0]);
  const state = sha256(encodeStateSnapshot(adapter.observeSnapshot()));
  const events = sha256(JSON.stringify(adapter.observeEvents()));
  adapter.close();
  return { state, events };
}

const openServers: WsServerHandle[] = [];
const openClients: NodeSession[] = [];

afterEach(async () => {
  for (const client of openClients.splice(0)) {
    try {
      client.close();
    } catch {
      // Already closed by the session.
    }
  }
  for (const server of openServers.splice(0)) {
    await server.close();
  }
});

describe('manual tick driver contract', () => {
  const client = (submitted: number[], pong: () => number) => ({
    submitInput: (tick: number) => submitted.push(tick),
    ping: () => 1,
    lastPongSequence: pong,
  });

  it('submits every tick exactly once and steps the authority in order', async () => {
    let tick = 0;
    const submittedA: number[] = [];
    const submittedB: number[] = [];
    await driveManualTicks({
      ticks: 20,
      nextTick: () => tick,
      stepOnce: () => {
        tick += 1;
        return { stepped: true, tick, snapshotSent: false, complete: tick === 20 };
      },
      clients: [client(submittedA, () => 1), client(submittedB, () => 1)],
      windowTicks: 8,
    });
    const expected = Array.from({ length: 20 }, (_, index) => index);
    expect(submittedA).toEqual(expected);
    expect(submittedB).toEqual(expected);
    expect(tick).toBe(20);
  });

  it('fails instead of silently consuming a tick when the authority does not advance', async () => {
    let tick = 0;
    await expect(driveManualTicks({
      ticks: 3,
      nextTick: () => tick,
      stepOnce: () => ({ stepped: false, tick, snapshotSent: false, complete: false }),
      clients: [client([], () => 1)],
      windowTicks: 3,
    })).rejects.toThrow(/did not advance deterministically/);
  });

  it('fails on a missing pong barrier instead of stepping without fixture input', async () => {
    let tick = 0;
    let clockCalls = 0;
    await expect(driveManualTicks({
      ticks: 1,
      nextTick: () => tick,
      stepOnce: () => {
        tick += 1;
        return { stepped: true, tick, snapshotSent: false, complete: true };
      },
      clients: [client([], () => 0)],
      barrierTimeoutMs: 10,
      // First read is the barrier start, later reads exceed the guard.
      now: () => (clockCalls++ === 0 ? 0 : 1000),
      yieldTurn: () => Promise.resolve(),
    })).rejects.toThrow(/barrier timed out/);
  });

  it('stops promptly with the original failure when the run already failed fatally', async () => {
    let tick = 0;
    await expect(driveManualTicks({
      ticks: 5,
      nextTick: () => tick,
      stepOnce: () => {
        tick += 1;
        return { stepped: true, tick, snapshotSent: false, complete: false };
      },
      clients: [client([], () => 1)],
      abortReason: () => new Error('run already failed'),
    })).rejects.toThrow(/run already failed/);
  });
});

describe('M2 full-length WebSocket benchmark correctness', () => {
  it('pins the 7200-tick in-memory fingerprints with a non-empty ordered event stream', () => {
    const fixture = generateFixture('BASE-4-60-20');
    expect(fixture.fixtureSha256).toBe(FIXTURE_SHA256);

    const adapter = new InMemoryBenchmarkAdapter();
    adapter.connect({ scenarioId: 'BASE-4-60-20' });
    adapter.join(PLAYERS);
    for (let tick = 0; tick < FULL_TICKS; tick++) adapter.sendInput(fixture.framesByTick[tick][0]);

    const state = adapter.observeState();
    const events = adapter.observeEvents();
    const finalStateSha256 = sha256(encodeStateSnapshot(adapter.observeSnapshot()));
    const orderedEventsSha256 = sha256(JSON.stringify(events));
    adapter.close();

    expect(state.tick).toBe(FULL_TICKS);
    expect(events.length).toBeGreaterThan(0);
    expect(finalStateSha256).toBe(FULL_FINAL_STATE_SHA256);
    expect(orderedEventsSha256).toBe(FULL_ORDERED_EVENTS_SHA256);
    // A correctness pass must not be an empty event stream in disguise.
    expect(orderedEventsSha256).not.toBe(EMPTY_EVENTS_SHA256);
    // The same fingerprints the WebRTC prototype run reports for this fixture.
    expect(referenceHashes(FULL_TICKS)).toEqual({
      state: FULL_FINAL_STATE_SHA256,
      events: FULL_ORDERED_EVENTS_SHA256,
    });
  });

  it('drives a full-length manual-pacing socket run to the pinned in-memory reference', async (ctx: TestContext) => {
    let server: WsServerHandle;
    try {
      server = await startWsServer({
        port: 0,
        host: '127.0.0.1',
        tickMode: 'manual',
        snapshotHz: 20,
        maxLead: 8,
        maxTicks: SOCKET_TICKS,
        startDelayMs: 0,
        firstTickDelayMs: 0,
      });
      openServers.push(server);
    } catch (error) {
      const code = bindingFailure(error);
      ctx.skip(code === null
        ? `Local WebSocket server could not start: ${error instanceof Error ? error.message : String(error)}`
        : `Local WebSocket binding unavailable (${code})`);
      return;
    }

    const fixture = generateFixture('BASE-4-60-20');
    const schedule = scheduleFor(SOCKET_TICKS);
    const runComplete = deferred<number>();
    const denials: string[] = [];
    const protocolErrors: string[] = [];
    const closeReasons: string[] = [];
    const pongs = new Map<string, number>();
    const joins = PLAYERS.map(() => deferred<void>());
    const runtimes: { playerId: string; session: NodeSession }[] = [];

    const url = `ws://127.0.0.1:${server.port}`;
    for (let index = 0; index < PLAYERS.length; index++) {
      const playerId = PLAYERS[index];
      const handlers: SessionClientHandlers = {
        onJoinResult: result => result.accepted
          ? joins[index].resolve()
          : joins[index].reject(new Error(`Join for ${playerId} denied: ${result.code ?? 'unknown'}`)),
        onPong: sequence => {
          const current = pongs.get(playerId) ?? 0;
          if (sequence > current) pongs.set(playerId, sequence);
        },
        onError: error => denials.push(error.code),
        onProtocolError: message => protocolErrors.push(message),
        onRunComplete: tick => runComplete.resolve(tick),
        onSessionClosed: reason => closeReasons.push(reason),
      };
      const session = await openNodeSession({ url, handlers });
      openClients.push(session);
      runtimes.push({ playerId, session });
      session.client.join([playerId]);
    }

    await Promise.all(joins.map(join => join.promise));
    expect(server.room.beginMatch()).toBe(true);

    await driveManualTicks({
      ticks: SOCKET_TICKS,
      nextTick: () => server.room.tick,
      stepOnce: () => server.stepOnce(),
      clients: runtimes.map(runtime => ({
        submitInput: (tick: number) => {
          const input = schedule[tick].find(candidate => candidate.playerId === runtime.playerId);
          if (!input) throw new Error('Fixture lost a player input');
          runtime.session.client.submitInput(tick, [input]);
        },
        ping: () => runtime.session.client.ping(),
        lastPongSequence: () => pongs.get(runtime.playerId) ?? 0,
      })),
    });

    // `run-complete` is delivered over the socket after the last stepped tick.
    expect(await runComplete.promise).toBe(SOCKET_TICKS);
    expect(server.room.tick).toBe(SOCKET_TICKS);
    expect(server.room.isRunComplete).toBe(true);
    expect(denials).toEqual([]);
    expect(protocolErrors).toEqual([]);
    expect(closeReasons).toEqual([]);

    const finalStateSha256 = sha256(encodeStateSnapshot(server.room.snapshot()));
    const orderedEventsSha256 = sha256(JSON.stringify(server.room.orderedEvents()));
    const reference = referenceHashes(SOCKET_TICKS);
    expect(finalStateSha256).toBe(reference.state);
    expect(orderedEventsSha256).toBe(reference.events);
    // Cross-check the pinned full-length fingerprints, not only the reference.
    expect(finalStateSha256).toBe(FULL_FINAL_STATE_SHA256);
    expect(orderedEventsSha256).toBe(FULL_ORDERED_EVENTS_SHA256);
    expect(server.room.orderedEvents().length).toBeGreaterThan(0);
    expect(orderedEventsSha256).not.toBe(EMPTY_EVENTS_SHA256);

    const manifest = createWsPrototypeManifest({
      runId: 'ws-base4-manual-test',
      commitSha: 'd'.repeat(40),
      fixtureSha256: fixture.fixtureSha256,
      seed: fixture.seed,
      snapshotHz: 20,
      maxLeadTicks: 8,
      boundedTicks: SOCKET_TICKS,
      tickMode: 'manual',
      correctness: {
        finalTick: server.room.tick,
        matchesInMemoryReference:
          finalStateSha256 === reference.state && orderedEventsSha256 === reference.events,
        finalStateSha256,
        referenceFinalStateSha256: reference.state,
        orderedEventsSha256,
        referenceOrderedEventsSha256: reference.events,
        lateTicks: 0,
        deniedMessages: denials.length,
      },
    });
    validateWsPrototypeManifest(manifest);
    expect(manifest.tickMode).toBe('manual');
    expect(manifest.pacing).toBe('unsynchronized-correctness');
    expect(manifest.result).toBe('NOT_MEASURED');
    expect(manifest.measurements.tickPacing).toBe('NOT_MEASURED');
  }, 120000);
});
