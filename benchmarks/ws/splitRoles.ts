import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { encodeStateSnapshot } from '../../src/game/protocol/stateSnapshot';
import type { SessionClientHandlers } from '../../src/game/networking/wsSessionClient';
import type { SnapshotHz } from '../../src/game/networking/wsMessages';
import { startWsServer, type WsServerEnvelopeEvent, type WsServerHandle } from '../../server/ws/wsServer';
import { openNodeSession, type NodeSession } from '../../server/ws/nodeWsClient';
import { sha256 } from '../scenarios';
import {
  FIRST_TICK_DELAY_MS,
  MAX_LEAD_TICKS,
  MAX_TICKS,
  START_DELAY_MS,
  WS_BENCHMARK_ROSTER,
  inMemoryReferenceFingerprints,
  loadWsBenchmarkSchedule,
} from './benchmarkSetup';
import {
  createWsPrototypeManifest,
  type WsBenchmarkTickMode,
  type WsPrototypeManifest,
} from './wsManifest';

/**
 * Split WebSocket benchmark roles.
 *
 * `runServerRole` is the coordinator: it binds an explicit host/port, waits for
 * exactly the configured roster, runs the authoritative session for the
 * configured tick bound and owns the manifest. `runClientRole` is one synthetic
 * client on an arbitrary machine: it joins one roster slot, drives the same
 * scripted BASE-4 fixture slice and exits.
 *
 * Both roles run the identical fixture and validation path as the single-process
 * loopback default, so the split run can be compared fingerprint-for-fingerprint.
 * Neither role measures latency, bandwidth, CPU or tick pacing, and no
 * performance value is ever reported.
 *
 * Limits of this prototype: no TLS, authentication, origin checks, reconnect or
 * TURN. A network run only proves that the roles execute across processes and
 * machines; it is not a transport benchmark result.
 */

export type ServerRoleOptions = {
  host: string;
  port: number;
  ticks: number;
  snapshotHz: SnapshotHz;
  tickMode: WsBenchmarkTickMode;
  /** Whole-role hang guard: roster wait, run and shutdown. Never measured. */
  timeoutMs: number;
  /** Hang guard for one manual barrier window. */
  barrierTimeoutMs?: number;
  /** Recorded verbatim; tests inject a fixed value. */
  commitSha: string;
  runId: string;
  /** Defaults to `benchmarks/out/<runId>.json`. */
  outPath?: string;
  /** Tests can keep the manifest in memory instead of writing it. */
  writeManifest?: boolean;
  /** Called after bind and before the roster waits, with the connect URL. */
  onReady?: (info: { url: string | null; host: string; port: number }) => void;
  /** Called once the validated roster is complete, before the match starts. */
  onRosterComplete?: (info: { connections: number; playerIds: readonly string[] }) => void | Promise<void>;
};

export type ServerRoleResult = {
  readonly manifest: WsPrototypeManifest;
  readonly manifestPath: string | null;
  readonly url: string | null;
  /** Every accepted client envelope the observer saw (joins, inputs, pings). */
  readonly acceptedMessages: number;
  /**
   * Denials by decision source. `deniedMessages` in the manifest is the sum;
   * this split lets a coordinator see whether the gateway or the room rejected
   * an envelope without changing the manifest schema.
   */
  readonly deniedBySource: { readonly gateway: number; readonly room: number };
};

export type ClientRoleOptions = {
  /** Plain `ws://` only; the prototype has no TLS. */
  url: string;
  /** Exactly one slot of the BASE-4 roster, e.g. `P1`. */
  playerId: string;
  /** Must match the coordinator's bounded tick count. */
  ticks: number;
  /** Whole-client hang guard, never measured. */
  timeoutMs: number;
  maxLeadTicks?: number;
};

export type ClientRoleResult = {
  readonly playerId: string;
  readonly finalTick: number;
  readonly submittedTicks: number;
  readonly lateTicks: number;
  readonly deniedMessages: number;
  readonly denials: Readonly<Record<string, number>>;
};

/** Default manual barrier hang guard; a guard, not a pacing measurement. */
export const DEFAULT_SERVER_BARRIER_TIMEOUT_MS = 10000;
const CLOSE_GRACE_MS = 1000;
/**
 * Fallback wake-up while a manual barrier waits. Normal progress wakes the
 * barrier on the next client envelope; this bounded slice of wall-clock time
 * only exists so a transport close (which produces no envelope) or a slow peer
 * is still noticed. It is a hang guard, never a pacing measurement.
 */
const PROGRESS_FALLBACK_MS = 2;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolveFn: (value: T) => void = () => undefined;
  let rejectFn: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolveFn = resolvePromise;
    rejectFn = rejectPromise;
  });
  return {
    promise,
    resolve: value => {
      if (settled) return;
      settled = true;
      resolveFn(value);
    },
    reject: error => {
      if (settled) return;
      settled = true;
      rejectFn(error);
    },
  };
}

function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Denials that prove the driver itself is wrong (spoofing, replayed identity,
 * a closed session) rather than a slow client. `late-tick` is counted, not fatal:
 * it makes the fingerprint comparison fail explicitly instead.
 */
const FATAL_DENIALS = new Set([
  'unauthorized-player',
  'unknown-player',
  'invalid-binding',
  'room-mismatch',
  'session-closed',
  'session-full',
  'player-owned',
  'already-joined',
  'not-joined',
  'malformed-input',
  'invalid-envelope',
]);

function countDenial(denials: Map<string, number>, code: string): void {
  denials.set(code, (denials.get(code) ?? 0) + 1);
}

function denialTotal(denials: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of denials.values()) total += count;
  return total;
}

function denialRecord(denials: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...denials.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}

function connectUrl(host: string, port: number): string | null {
  // Printing `ws://0.0.0.0:port` would be unusable for a client; the ready line
  // carries the separate host/port fields instead.
  return isWildcardHost(host) ? null : `ws://${host}:${port}`;
}

type RosterObservation = {
  readonly joins: Map<string, readonly string[]>;
  readonly nextInputTick: Map<string, number>;
  readonly denials: Map<string, number>;
  /** Denials decided by the gateway (returned from `handleMessage`). */
  gatewayDenials: number;
  /** Denials decided by the room before the gateway (reported by the session). */
  roomDenials: number;
  /** Accepted envelopes the observer saw; pinned by the regression tests. */
  acceptedMessages: number;
  lateTicks: number;
  violation: Error | null;
  /** Wakes the current barrier as soon as a client envelope was observed. */
  wake: (() => void) | null;
};

function signalProgress(state: RosterObservation): void {
  const wake = state.wake;
  state.wake = null;
  wake?.();
}

/**
 * Waits for the next client envelope or, as a fallback, for a bounded slice of
 * wall-clock time. The fallback is a hang guard that also notices a transport
 * close (which produces no envelope); it is not a measurement.
 */
function waitForProgress(state: RosterObservation, timeoutMs: number): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      state.wake = null;
      resolve();
    }, timeoutMs);
    state.wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function observeEnvelope(state: RosterObservation, event: WsServerEnvelopeEvent): void {
  signalProgress(state);
  if (!event.accepted) {
    countDenial(state.denials, event.code);
    if (event.source === 'room') state.roomDenials += 1;
    else state.gatewayDenials += 1;
    if (event.code === 'late-tick') state.lateTicks += 1;
    if (FATAL_DENIALS.has(event.code) && state.violation === null) {
      state.violation = new Error(`Unexpected server denial during the split run: ${event.code}`);
    }
    return;
  }
  state.acceptedMessages += 1;
  if (state.violation !== null) return;
  switch (event.kind) {
    case 'join-request':
      state.joins.set(event.connectionId, [...event.playerIds]);
      return;
    case 'leave-request':
      state.joins.delete(event.connectionId);
      return;
    case 'input': {
      // Every client role submits its slice once, in ascending order, with no
      // gaps. A gap would silently step a tick with missing fixture input.
      const expected = state.nextInputTick.get(event.connectionId) ?? 0;
      if (event.targetTick !== expected) {
        state.violation = new Error(
          `Client ${event.connectionId} submitted tick ${event.targetTick}, expected ${expected}`,
        );
        return;
      }
      state.nextInputTick.set(event.connectionId, expected + 1);
      return;
    }
    case 'ping':
      return;
  }
}

/**
 * Binds the server, waits for exactly the expected roster, runs the
 * authoritative session and returns the coordinator manifest.
 */
export async function runServerRole(options: ServerRoleOptions): Promise<ServerRoleResult> {
  if (typeof options?.host !== 'string' || options.host.length === 0) throw new Error('Server role requires a host');
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error('Server role requires a port between 0 and 65535');
  }
  if (!Number.isSafeInteger(options.ticks) || options.ticks < 1 || options.ticks > MAX_TICKS) {
    throw new Error(`Server role requires 1..${MAX_TICKS} bounded ticks`);
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error('Invalid run timeout');
  if (typeof options.commitSha !== 'string' || !/^[0-9a-f]{40}$/.test(options.commitSha)) {
    throw new Error('Server role requires a 40-character commit SHA');
  }
  if (typeof options.runId !== 'string' || options.runId.length === 0) throw new Error('Server role requires a run ID');

  const players = [...WS_BENCHMARK_ROSTER];
  const expected = players.length;
  const { fixture } = loadWsBenchmarkSchedule(options.ticks);
  const barrierTimeoutMs = options.barrierTimeoutMs ?? DEFAULT_SERVER_BARRIER_TIMEOUT_MS;
  if (!Number.isSafeInteger(barrierTimeoutMs) || barrierTimeoutMs < 1) {
    throw new Error('Invalid barrier timeout');
  }

  const state: RosterObservation = {
    joins: new Map(),
    nextInputTick: new Map(),
    denials: new Map(),
    gatewayDenials: 0,
    roomDenials: 0,
    acceptedMessages: 0,
    lateTicks: 0,
    violation: null,
    wake: null,
  };
  const startedAt = Date.now();
  const deadline = startedAt + options.timeoutMs;
  let server: WsServerHandle | null = null;

  try {
    server = await startWsServer({
      host: options.host,
      port: options.port,
      snapshotHz: options.snapshotHz,
      maxLead: MAX_LEAD_TICKS,
      maxTicks: options.ticks,
      startDelayMs: START_DELAY_MS,
      firstTickDelayMs: FIRST_TICK_DELAY_MS,
      tickMode: options.tickMode,
      // Exactly the configured roster: an unexpected socket is closed before it
      // can register, join or influence the run.
      maxConnections: expected,
      onClientEnvelope: event => observeEnvelope(state, event),
    });
    const room = server.room;
    const url = connectUrl(options.host, server.port);
    options.onReady?.({ url, host: server.host, port: server.port });

    await waitForRoster(state, room, expected, deadline);
    const claimed = [...state.joins.values()].flat();
    await options.onRosterComplete?.({ connections: state.joins.size, playerIds: claimed });

    if (options.tickMode === 'manual') {
      if (!room.beginMatch()) throw new Error('Could not start the authoritative split match');
      while (!room.isRunComplete) {
        if (state.violation) throw state.violation;
        if (room.phase === 'closed') throw new Error('Session closed before the bounded run completed');
        if (Date.now() > deadline) {
          throw new Error(
            `Split run did not finish within ${options.timeoutMs} ms at tick ${room.tick}/${options.ticks} ` +
            `(barrier timeout ${barrierTimeoutMs} ms)`,
          );
        }
        const tick = room.tick;
        await waitForFixtureInput(state, tick, barrierTimeoutMs, () => room.phase === 'closed');
        const result = room.stepOnce();
        if (!result.stepped || result.tick !== tick + 1) {
          throw new Error(`Manual server step did not advance deterministically at tick ${tick}`);
        }
      }
    } else {
      await waitForIntervalCompletion(room, options.ticks, options.timeoutMs, deadline, state);
    }

    if (state.violation) throw state.violation;
    if (room.tick !== options.ticks) {
      throw new Error(`Split run ended at tick ${room.tick}, expected ${options.ticks}`);
    }

    const finalStateSha256 = sha256(encodeStateSnapshot(room.snapshot()));
    const orderedEventsSha256 = sha256(JSON.stringify(room.orderedEvents()));
    const reference = inMemoryReferenceFingerprints(options.ticks);
    const manifest = createWsPrototypeManifest({
      runId: options.runId,
      commitSha: options.commitSha,
      fixtureSha256: fixture.fixtureSha256,
      seed: fixture.seed,
      snapshotHz: options.snapshotHz,
      maxLeadTicks: MAX_LEAD_TICKS,
      boundedTicks: options.ticks,
      tickMode: options.tickMode,
      topology: { role: 'server-coordinator', bindHostProvided: true, bindPortProvided: true },
      correctness: {
        finalTick: room.tick,
        matchesInMemoryReference:
          finalStateSha256 === reference.finalStateSha256 &&
          orderedEventsSha256 === reference.orderedEventsSha256,
        finalStateSha256,
        referenceFinalStateSha256: reference.finalStateSha256,
        orderedEventsSha256,
        referenceOrderedEventsSha256: reference.orderedEventsSha256,
        lateTicks: state.lateTicks,
        deniedMessages: denialTotal(state.denials),
      },
    });

    let manifestPath: string | null = null;
    if (options.writeManifest !== false) {
      manifestPath = resolve(process.cwd(), options.outPath ?? `benchmarks/out/${options.runId}.json`);
      mkdirSync(dirname(manifestPath), { recursive: true });
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }

    return {
      manifest,
      manifestPath,
      url,
      acceptedMessages: state.acceptedMessages,
      deniedBySource: { gateway: state.gatewayDenials, room: state.roomDenials },
    };
  } finally {
    if (server) await server.close();
  }
}

async function waitForRoster(
  state: RosterObservation,
  room: WsServerHandle['room'],
  expected: number,
  deadline: number,
): Promise<void> {
  for (;;) {
    if (state.violation) throw state.violation;
    if (room.phase === 'closed') throw new Error('Session closed while waiting for the roster');
    const joined = state.joins.size;
    // A fully claimed roster spread over the wrong number of connections is a
    // driver error and must fail immediately, not after the timeout.
    if (room.playerCount === expected && joined !== expected) {
      throw new Error(
        `Expected ${expected} client connections, received ${joined} while ${room.playerCount}/${expected} player slots were claimed`,
      );
    }
    if (joined === expected) {
      const claimed = [...state.joins.values()].flat();
      if (claimed.length !== expected || new Set(claimed).size !== expected ||
          claimed.some(playerId => !WS_BENCHMARK_ROSTER.includes(playerId))) {
        throw new Error(
          `Expected exactly one roster slot per client connection, received ${claimed.length} slot(s) over ${joined} connection(s)`,
        );
      }
      // A connection that closed between its join and this check still appears
      // in the observation log; the authoritative room does not. Fail explicitly
      // instead of starting with a stale slot.
      if (room.connectionCount !== expected || room.playerCount !== expected) {
        throw new Error(
          `Roster mismatch: ${joined} joined client connection(s), room reports ` +
          `${room.connectionCount} connection(s) and ${room.playerCount}/${expected} player slots`,
        );
      }
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for the roster: ${room.playerCount}/${expected} player slots and ${joined}/${expected} client connections`,
      );
    }
    await waitForProgress(state, PROGRESS_FALLBACK_MS);
  }
}

async function waitForFixtureInput(
  state: RosterObservation,
  tick: number,
  barrierTimeoutMs: number,
  isClosed: () => boolean,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (state.violation) throw state.violation;
    if (isClosed()) throw new Error(`Session closed while waiting for fixture input at tick ${tick}`);
    const waiting: string[] = [];
    for (const connectionId of state.joins.keys()) {
      if ((state.nextInputTick.get(connectionId) ?? 0) <= tick) waiting.push(connectionId);
    }
    if (waiting.length === 0) return;
    if (Date.now() - startedAt > barrierTimeoutMs) {
      throw new Error(
        `Timed out waiting for fixture input at tick ${tick} from ${waiting.length} client connection(s)`,
      );
    }
    await waitForProgress(state, PROGRESS_FALLBACK_MS);
  }
}

async function waitForIntervalCompletion(
  room: WsServerHandle['room'],
  ticks: number,
  timeoutMs: number,
  deadline: number,
  state: RosterObservation,
): Promise<void> {
  for (;;) {
    if (state.violation) throw state.violation;
    if (room.isRunComplete) return;
    if (room.phase === 'closed') throw new Error('Session closed before the bounded run completed');
    if (Date.now() > deadline) {
      throw new Error(
        `Split run did not finish within ${timeoutMs} ms at tick ${room.tick}/${ticks} ` +
        `(phase=${room.phase}, buffered=${room.bufferedTicks})`,
      );
    }
    await delay(5);
  }
}

/**
 * One synthetic client for the split run: joins a single roster slot, submits
 * this player's slice of the same fixture and exits when the coordinator
 * broadcasts `run-complete`.
 */
export async function runClientRole(options: ClientRoleOptions): Promise<ClientRoleResult> {
  if (typeof options?.url !== 'string' || !options.url.startsWith('ws://')) {
    throw new Error('Client role requires a ws:// URL (TLS is not implemented in this prototype)');
  }
  if (!WS_BENCHMARK_ROSTER.includes(options.playerId)) {
    throw new Error(`Unknown benchmark player: ${String(options.playerId)} (expected one of ${WS_BENCHMARK_ROSTER.join(', ')})`);
  }
  if (!Number.isSafeInteger(options.ticks) || options.ticks < 1 || options.ticks > MAX_TICKS) {
    throw new Error(`Client role requires 1..${MAX_TICKS} bounded ticks`);
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error('Invalid run timeout');
  const maxLead = options.maxLeadTicks ?? MAX_LEAD_TICKS;
  if (!Number.isSafeInteger(maxLead) || maxLead < 1) throw new Error('Invalid input lead');

  const playerId = options.playerId;
  const { schedule } = loadWsBenchmarkSchedule(options.ticks);
  const denials = new Map<string, number>();
  const joined = deferred<void>();
  const started = deferred<void>();
  const complete = deferred<number>();
  const fatal = deferred<never>();
  // Attach a handler now so an early failure never becomes unhandled.
  void fatal.promise.catch(() => undefined);

  let session: NodeSession | null = null;
  let joinedState = false;
  let startedState = false;
  let nextToSend = 0;
  let completedTick: number | null = null;
  let settled = false;

  const fail = (error: unknown): void => {
    if (settled || completedTick !== null) return;
    fatal.reject(errorOf(error));
  };

  const pump = (): void => {
    if (!joinedState || !startedState || session === null || completedTick !== null) return;
    try {
      const maxSend = Math.min(options.ticks - 1, session.client.serverTick + maxLead - 1);
      while (nextToSend <= maxSend) {
        const input = schedule[nextToSend].find(candidate => candidate.playerId === playerId);
        if (!input) throw new Error('Fixture lost a player input');
        session.client.submitInput(nextToSend, [input]);
        nextToSend += 1;
      }
    } catch (error) {
      fail(error);
    }
  };

  const handlers: SessionClientHandlers = {
    onJoinResult: result => {
      if (!result.accepted) {
        joined.reject(new Error(`Join for ${playerId} denied: ${result.code ?? 'unknown'}`));
        return;
      }
      if (result.playerIds.length !== 1 || result.playerIds[0] !== playerId) {
        joined.reject(new Error(`Join for ${playerId} granted unexpected slots: ${result.playerIds.join(', ')}`));
        return;
      }
      joinedState = true;
      joined.resolve();
    },
    onMatchStart: () => {
      startedState = true;
      started.resolve();
      pump();
    },
    onSnapshot: () => pump(),
    onError: error => {
      countDenial(denials, error.code);
      if (FATAL_DENIALS.has(error.code)) fail(new Error(`Unexpected server denial: ${error.code}`));
    },
    onProtocolError: message => fail(new Error(`Malformed server message: ${message}`)),
    onRunComplete: tick => {
      if (completedTick === null) completedTick = tick;
      complete.resolve(tick);
    },
    onSessionClosed: reason => {
      if (completedTick === null) fail(new Error(`Session closed before run completion: ${reason}`));
    },
    onTransportClosed: () => {
      if (completedTick === null) fail(new Error('WebSocket closed before run-complete'));
    },
    onTransportError: message => fail(new Error(`WebSocket error: ${message}`)),
  };

  const timeoutMs = options.timeoutMs;
  let pumpTimer: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    session = await openNodeSession({ url: options.url, handlers, openTimeoutMs: Math.min(timeoutMs, 10000) });
    timeout = setTimeout(() => {
      const tick = session === null ? 'no-session' : `${session.client.serverTick}`;
      fail(new Error(
        `Split client ${playerId} did not finish within ${timeoutMs} ms ` +
        `(joined=${joinedState}, started=${startedState}, next=${nextToSend}, serverTick=${tick})`,
      ));
    }, timeoutMs);

    session.client.join([playerId]);
    await Promise.race([joined.promise, fatal.promise]);
    await Promise.race([started.promise, fatal.promise]);
    pumpTimer = setInterval(pump, 5);
    pump();

    const tick = await Promise.race([complete.promise, fatal.promise]);
    if (tick !== options.ticks) {
      throw new Error(`Client ${playerId} observed run-complete at tick ${tick}, expected ${options.ticks}`);
    }
    if (nextToSend !== options.ticks) {
      throw new Error(`Client ${playerId} submitted ${nextToSend}/${options.ticks} fixture ticks`);
    }
    return {
      playerId,
      finalTick: tick,
      submittedTicks: nextToSend,
      lateTicks: denials.get('late-tick') ?? 0,
      deniedMessages: denialTotal(denials),
      denials: denialRecord(denials),
    };
  } catch (error) {
    throw errorOf(error);
  } finally {
    settled = true;
    if (pumpTimer) clearInterval(pumpTimer);
    if (timeout) clearTimeout(timeout);
    if (session) {
      try {
        session.close();
      } catch {
        // Already closed.
      }
      await Promise.race([session.closed, delay(CLOSE_GRACE_MS)]);
    }
  }
}