/**
 * M14 eight-player single-machine measurement primitives.
 *
 * This module is test/harness-only. It drives the real authoritative WebSocket
 * server (`startWsServer`) with eight real clients over loopback and records
 * byte counts, tick durations, codec costs and process resources. It changes no
 * production behaviour and opens no path beyond 127.0.0.1.
 *
 * Every published number comes from the committed command
 * `npm run measure:m14-8p` on the recorded machine. Network fields are owned by
 * the manifest and stay `NOT_MEASURED`.
 */
import { decodeInputFrame } from '../../src/game/protocol/inputFrame';
import {
  decodeStateSnapshot,
  encodeStateSnapshot,
  type StateSnapshot,
} from '../../src/game/protocol/stateSnapshot';
import { TICK_RATE } from '../../src/game/simulation/step';
import type { PlayerInput } from '../../src/game/simulation/types';
import type { SnapshotHz } from '../../src/game/networking/wsMessages';
import type { SessionClientHandlers } from '../../src/game/networking/wsSessionClient';
import { startWsServer } from '../../server/ws/wsServer';
import type { WsSessionPhase } from '../../server/ws/authoritativeWsSession';
import { openNodeSession, type NodeSession } from '../../server/ws/nodeWsClient';
import { createRoster, generateFixture, sha256, type BenchmarkFixture } from '../scenarios';
import { summarizeBytes, summarizeSamples, type ByteSummary, type SampleDistribution } from '../local/statistics';
import { driveManualTicks } from '../ws/manualTickDriver';
import { snapshotSampleCount } from '../local/manifest';

export const M14_SCENARIO_ID = 'BASE-8-60-20' as const;
export const M14_PLAYERS = 8;
export const M14_TICKS = 7200;
export const M14_ROSTER: readonly string[] = createRoster(M14_PLAYERS);
export const M14_ROOM_CODE = 'M14X';
export const M14_MAX_LEAD_TICKS = 8;
export const M14_MANUAL_WINDOW_TICKS = 8;
export const M14_INTERVAL_SNAPSHOT_HZ: SnapshotHz = 20;
export const M14_FIRST_TICK_DELAY_MS = 250;
export const M14_START_DELAY_MS = 0;
export const M14_CONNECTION_MARGIN = 2;

const utf8 = new TextEncoder();
const byteLength = (text: string): number => utf8.encode(text).byteLength;
const microseconds = (nanoseconds: bigint): number => Number(nanoseconds) / 1000;

export type M14RatioSummary = {
  sampleCount: number;
  min: number;
  mean: number;
  max: number;
};

export type M14ObjectStats =
  | {
      status: 'ABSENT';
      snapshotsWithObjects: 0;
      snapshotsWithoutObjects: number;
    }
  | {
      status: 'PRESENT';
      snapshotsWithObjects: number;
      snapshotsWithoutObjects: number;
      objectCount: M14RatioSummary;
      bytesDeltaWithObjects: ByteSummary;
      bytesDeltaPerObject: M14RatioSummary;
    };

export type M14SnapshotBytes = {
  snapshotHz: SnapshotHz;
  sampleCount: number;
  canonical: ByteSummary;
  serverMessage: ByteSummary;
  serverMessageOverhead: ByteSummary;
  canonicalBytesPerSimulationTickPerClient: number;
  canonicalBytesPerSecondPerClient: number;
  serverMessageBytesPerSecondPerClient: number;
  serverMessageBytesPerSecondServerAggregate: number;
};

export type M14TickDuration = SampleDistribution & {
  totalStepMicroseconds: number;
  ticksPerSecondStepping: number;
};

export type M14CodecTiming = {
  iterationsPerSnapshot: 1;
  encode: SampleDistribution;
  decode: SampleDistribution;
};

export type M14ManualSession = {
  snapshotHz: SnapshotHz;
  pacing: 'manual';
  players: 8;
  measuredTicks: number;
  expectedSnapshots: number;
  receivedSnapshots: number;
  allClientsReceivedExpectedSnapshots: true;
  finalTick: number;
  /**
   * Observed production phase at the final tick. The bounded run reaches the
   * end of the timer at 7200 ticks, so a full run reports `results`; a shorter
   * exploratory run reports `running`. `runComplete` is the actual anchor.
   */
  finalPhase: WsSessionPhase;
  finalStateSha256: string;
  runComplete: true;
  lateTicks: number;
  deniedMessages: number;
  snapshotBytes: M14SnapshotBytes;
  objects: M14ObjectStats;
  tickDuration: M14TickDuration;
  codecTiming: M14CodecTiming;
};

export type M14ServerProcessMeasurement = {
  status: 'MEASURED';
  mode: 'interval';
  snapshotHz: SnapshotHz;
  measuredTicks: number;
  firstTickDelayMs: number;
  players: 8;
  clientCount: 8;
  wallClockMicroseconds: number;
  cpuUserMicroseconds: number;
  cpuSystemMicroseconds: number;
  cpuTotalMicroseconds: number;
  cpuPercentOfWallClock: number;
  peakRssBytes: number;
  rssAfterRunBytes: number;
  finalTick: number;
  /** Observed production phase at the final tick (the run is bounded by the match timer). */
  finalPhase: WsSessionPhase;
  finalStateSha256: string;
  matchesManual20HzHash: true;
  clientFinalSnapshotsMatchServerHash: true;
  lateTicks: 0;
  deniedMessages: 0;
  perTickDuration: {
    status: 'NOT_MEASURED';
    reason: string;
  };
};

export type M14Scope = {
  measurement: 'single-machine';
  label: 'single machine, no network';
  networkAccess: 'loopback-only';
  networkImpairment: 'none';
  networkMeasurement: 'none';
  transportSelection: 'NOT_A_TRANSPORT_DECISION';
};

export type M14Provenance = {
  command: 'npm run measure:m14-8p';
  cliArguments: string[];
  dateUtc: string;
  nodeVersion: string;
  platform: string;
  osRelease: string;
  architecture: string;
  cpuModel: string;
  logicalCores: number;
  gitCommitSha: string;
  workingTreeDirty: boolean;
  dirtyExclusions: ['benchmarks/results/'];
  dirtyPaths: string[];
  productionSourceDirty: boolean;
  fixtureScenarioId: 'BASE-8-60-20';
  fixtureSha256: string;
  seed: number;
  players: string[];
  measuredTicks: number;
  snapshotRatesHz: [10, 20, 30];
  tickRateHz: 60;
};

export type M14Methodology = {
  snapshotBytes: 'utf8-byte-length-of-actual-server-message-received-by-a-real-websocket-client';
  canonicalBytes: 'utf8-byte-length-of-encodeStateSnapshot';
  tickDuration: 'process.hrtime.bigint-around-server.stepOnce';
  tickPacing: 'manual-fixture-input-barrier';
  codecTiming: 'one-timed-encode-and-decode-per-captured-snapshot-after-the-session';
  percentiles: 'nearest-rank';
  serverProcess: 'dedicated-node-process-interval-60hz';
  serverCpu: 'process.cpuUsage-delta-from-running-phase-to-results-detection';
  serverRss: 'process.resourceUsage.maxRSS-process-lifetime';
  transportFraming: 'excluded-websocket-frame-headers-not-counted';
};

export type M14Correctness = {
  expectedTicks: number;
  allSessionsReachedExpectedTick: true;
  finalStateHashesMatchAcrossSnapshotRates: true;
  intervalServerMatchesManual20HzHash: true;
  snapshotCountsMatchExpected: true;
  denialsObserved: 0;
};

export type M14NetworkFields = {
  latency: 'NOT_MEASURED';
  jitter: 'NOT_MEASURED';
  packetLoss: 'NOT_MEASURED';
  joinSuccess: 'NOT_MEASURED';
  turnCost: 'NOT_MEASURED';
  bandwidth: 'NOT_MEASURED';
  measuredNetworks: 0;
};

export type M14Manifest = {
  schemaVersion: 1;
  kind: 'm14-eight-player-single-machine-measurement';
  runId: string;
  scope: M14Scope;
  provenance: M14Provenance;
  methodology: M14Methodology;
  sessions: M14ManualSession[];
  serverProcess: M14ServerProcessMeasurement;
  correctness: M14Correctness;
  network: M14NetworkFields;
};

export type M14Schedule = {
  fixture: BenchmarkFixture;
  schedule: PlayerInput[][];
};

export type M14CapturedSnapshot = {
  snapshot: StateSnapshot;
  wireBytes: number;
};

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
  // A rejected join or lifecycle observation must never surface as an
  // unhandled rejection while another branch is being awaited.
  void promise.catch(() => undefined);
  return { promise, resolve: resolveFn, reject: rejectFn };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Decodes the committed BASE-8 fixture. A measurement cannot invent its own
 * input stream: every tick is the canonical eight-player fixture frame.
 */
export function loadEightPlayerSchedule(ticks: number): M14Schedule {
  if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > M14_TICKS) {
    throw new Error(`Invalid eight-player tick count: ${String(ticks)}`);
  }
  const fixture = generateFixture(M14_SCENARIO_ID);
  if (fixture.ticks !== M14_TICKS || fixture.framesByTick.length !== M14_TICKS) {
    throw new Error('Unexpected BASE-8 fixture length');
  }
  if (fixture.players !== M14_PLAYERS) throw new Error('Unexpected BASE-8 fixture roster size');
  const schedule: PlayerInput[][] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const frames = fixture.framesByTick[tick];
    if (frames.length !== 1) throw new Error('Unexpected BASE-8 fixture framing');
    const decoded = decodeInputFrame(frames[0]);
    if (decoded.tick !== tick || decoded.inputs.length !== M14_PLAYERS) {
      throw new Error('Unexpected BASE-8 fixture tick');
    }
    for (const playerId of M14_ROSTER) {
      if (!decoded.inputs.some(input => input.playerId === playerId)) {
        throw new Error('Unexpected BASE-8 fixture roster');
      }
    }
    schedule.push(decoded.inputs);
  }
  return { fixture, schedule };
}

function summarizeRatio(samples: readonly number[]): M14RatioSummary {
  if (samples.length === 0) throw new Error('Cannot summarize an empty ratio sample set');
  for (const value of samples) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Ratio samples must be finite and non-negative');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    sampleCount: sorted.length,
    min: sorted[0],
    mean: total / sorted.length,
    max: sorted[sorted.length - 1],
  };
}

/**
 * Re-encodes and decodes every snapshot captured from the real session once.
 * Byte counts come from the canonical encoder; server-message bytes are the
 * actual UTF-8 bytes the observer client received on its socket.
 */
export function analyzeCapturedSnapshots(
  captured: readonly M14CapturedSnapshot[],
  snapshotHz: SnapshotHz,
): {
  snapshotBytes: M14SnapshotBytes;
  objects: M14ObjectStats;
  codecTiming: M14CodecTiming;
} {
  if (captured.length === 0) throw new Error('No snapshots were captured from the session');
  const canonicalBytes: number[] = [];
  const messageBytes: number[] = [];
  const overheadBytes: number[] = [];
  const encodeMicroseconds: number[] = [];
  const decodeMicroseconds: number[] = [];
  const objectCounts: number[] = [];
  const objectDeltas: number[] = [];
  const perObjectDeltas: number[] = [];
  let snapshotsWithObjects = 0;
  let snapshotsWithoutObjects = 0;

  for (const { snapshot, wireBytes } of captured) {
    if (!Number.isSafeInteger(wireBytes) || wireBytes < 1) {
      throw new Error('Captured server message has no measured byte length');
    }
    const encodeStart = process.hrtime.bigint();
    const canonical = encodeStateSnapshot(snapshot);
    const encodeEnd = process.hrtime.bigint();
    const decoded = decodeStateSnapshot(canonical);
    const decodeEnd = process.hrtime.bigint();
    if (decoded.state.tick !== snapshot.state.tick) {
      throw new Error('Decoded snapshot tick does not match the captured snapshot');
    }
    const canonicalCount = byteLength(canonical);
    if (wireBytes <= canonicalCount) {
      throw new Error('Server message is not larger than its canonical snapshot payload');
    }
    canonicalBytes.push(canonicalCount);
    messageBytes.push(wireBytes);
    overheadBytes.push(wireBytes - canonicalCount);
    encodeMicroseconds.push(microseconds(encodeEnd - encodeStart));
    decodeMicroseconds.push(microseconds(decodeEnd - encodeEnd));

    const objectCount = snapshot.state.objects?.length ?? 0;
    if (objectCount === 0) {
      snapshotsWithoutObjects += 1;
      continue;
    }
    snapshotsWithObjects += 1;
    const stateWithoutObjects = { ...snapshot.state };
    delete stateWithoutObjects.objects;
    const withoutText = encodeStateSnapshot({ version: snapshot.version, state: stateWithoutObjects });
    const delta = canonicalCount - byteLength(withoutText);
    if (delta <= 0) throw new Error('Object presence did not increase the canonical snapshot size');
    objectCounts.push(objectCount);
    objectDeltas.push(delta);
    perObjectDeltas.push(delta / objectCount);
  }

  const canonical = summarizeBytes(canonicalBytes);
  const serverMessage = summarizeBytes(messageBytes);
  const serverMessageOverhead = summarizeBytes(overheadBytes);
  const snapshotBytes: M14SnapshotBytes = {
    snapshotHz,
    sampleCount: canonical.sampleCount,
    canonical,
    serverMessage,
    serverMessageOverhead,
    canonicalBytesPerSimulationTickPerClient: canonical.mean * snapshotHz / TICK_RATE,
    canonicalBytesPerSecondPerClient: canonical.mean * snapshotHz,
    serverMessageBytesPerSecondPerClient: serverMessage.mean * snapshotHz,
    serverMessageBytesPerSecondServerAggregate: serverMessage.mean * snapshotHz * M14_PLAYERS,
  };

  const objects: M14ObjectStats = snapshotsWithObjects === 0
    ? { status: 'ABSENT', snapshotsWithObjects: 0, snapshotsWithoutObjects }
    : {
        status: 'PRESENT',
        snapshotsWithObjects,
        snapshotsWithoutObjects,
        objectCount: summarizeRatio(objectCounts),
        bytesDeltaWithObjects: summarizeBytes(objectDeltas),
        bytesDeltaPerObject: summarizeRatio(perObjectDeltas),
      };

  return {
    snapshotBytes,
    objects,
    codecTiming: {
      iterationsPerSnapshot: 1,
      encode: summarizeSamples(encodeMicroseconds, 'microseconds'),
      decode: summarizeSamples(decodeMicroseconds, 'microseconds'),
    },
  };
}

type ManualClientRuntime = {
  playerId: string;
  session: NodeSession;
  lastPong: number;
  snapshots: number;
  completed: boolean;
  errors: string[];
};

/**
 * Runs one real eight-player authoritative session with manual tick pacing.
 *
 * The transport, session, envelope gateway and simulation are the production
 * code paths. Only tick pacing is harness-controlled: each window of fixture
 * input is barrier-confirmed with a pong before the corresponding ticks are
 * stepped. That makes the tick and codec numbers deterministic-workload facts,
 * not real-time pacing measurements.
 */
export async function runManualSession(input: {
  snapshotHz: SnapshotHz;
  ticks: number;
  schedule: PlayerInput[][];
}): Promise<M14ManualSession> {
  const { snapshotHz, ticks, schedule } = input;
  if (schedule.length !== ticks) throw new Error('Fixture schedule does not cover the requested ticks');

  let server: Awaited<ReturnType<typeof startWsServer>> | null = null;
  const runtimes: ManualClientRuntime[] = [];
  const joins = M14_ROSTER.map(() => deferred<void>());
  const starts = M14_ROSTER.map(() => deferred<void>());
  const completes = M14_ROSTER.map(() => deferred<void>());
  const captured: M14CapturedSnapshot[] = [];
  let lastObserverInboundBytes = 0;
  let fatalError: Error | null = null;
  let finished = false;

  const fail = (error: unknown): void => {
    if (fatalError !== null) return;
    fatalError = error instanceof Error ? error : new Error(String(error));
  };

  try {
    const activeServer = await startWsServer({
      host: '127.0.0.1',
      port: 0,
      playerIds: [...M14_ROSTER],
      roomCode: M14_ROOM_CODE,
      snapshotHz,
      maxLead: M14_MAX_LEAD_TICKS,
      maxTicks: ticks,
      startDelayMs: M14_START_DELAY_MS,
      firstTickDelayMs: 0,
      tickMode: 'manual',
      maxConnections: M14_PLAYERS + M14_CONNECTION_MARGIN,
      rejoinWindowMs: 0,
      // No message policy: the manual barrier deliberately submits a window of
      // synthetic input as fast as the event loop allows, which is not a
      // realistic client cadence. The policy is exercised by the interval
      // server-process run and by the M14 unit tests.
    });
    server = activeServer;
    const url = `ws://127.0.0.1:${activeServer.port}`;

    for (let index = 0; index < M14_ROSTER.length; index++) {
      const playerId = M14_ROSTER[index];
      const runtime: ManualClientRuntime = {
        playerId,
        session: null as unknown as NodeSession,
        lastPong: 0,
        snapshots: 0,
        completed: false,
        errors: [],
      };
      runtimes.push(runtime);
      const isObserver = index === 0;
      const handlers: SessionClientHandlers = {
        onJoinResult: result => {
          if (result.accepted) joins[index].resolve();
          else joins[index].reject(new Error(`Join for ${playerId} denied: ${result.code ?? 'unknown'}`));
        },
        onMatchStart: () => starts[index].resolve(),
        onSnapshot: snapshot => {
          runtime.snapshots += 1;
          if (!isObserver) return;
          if (lastObserverInboundBytes < 1) {
            fail(new Error('Observer snapshot arrived without a measured wire byte length'));
            return;
          }
          captured.push({ snapshot, wireBytes: lastObserverInboundBytes });
        },
        onError: error => {
          runtime.errors.push(error.code);
          if (!finished) fail(new Error(`Server denied ${playerId}: ${error.code}`));
        },
        onPong: sequence => {
          if (sequence > runtime.lastPong) runtime.lastPong = sequence;
        },
        onRunComplete: () => {
          runtime.completed = true;
          completes[index].resolve();
        },
        onProtocolError: message => {
          if (!finished) fail(new Error(`Malformed server message for ${playerId}: ${message}`));
        },
        onSessionClosed: reason => {
          if (!finished) fail(new Error(`Session closed for ${playerId}: ${reason}`));
        },
        onTransportClosed: () => {
          if (!finished) fail(new Error(`WebSocket closed for ${playerId} during the bounded run`));
        },
        onTransportError: message => {
          if (!finished) fail(new Error(`WebSocket error for ${playerId}: ${message}`));
        },
      };
      const session = await openNodeSession({
        url,
        handlers,
        onWireMessage: event => {
          if (isObserver && event.direction === 'in') lastObserverInboundBytes = event.bytes;
        },
      });
      runtime.session = session;
      session.client.join([playerId], M14_ROOM_CODE);
    }

    await Promise.all(joins.map((join, index) =>
      withTimeout(join.promise, 15_000, `join ${M14_ROSTER[index]}`)));
    if (!activeServer.room.beginMatch()) throw new Error('Could not start the manual eight-player match');
    await Promise.all(starts.map((start, index) =>
      withTimeout(start.promise, 10_000, `match-start ${M14_ROSTER[index]}`)));

    const tickMicroseconds: number[] = [];
    await driveManualTicks({
      ticks,
      nextTick: () => activeServer.room.tick,
      stepOnce: () => {
        const start = process.hrtime.bigint();
        const result = activeServer.stepOnce();
        tickMicroseconds.push(microseconds(process.hrtime.bigint() - start));
        return result;
      },
      clients: runtimes.map(runtime => ({
        submitInput: tick => {
          const playerInput = schedule[tick].find(candidate => candidate.playerId === runtime.playerId);
          if (!playerInput) throw new Error(`Fixture lost ${runtime.playerId} input at tick ${tick}`);
          runtime.session.client.submitInput(tick, [playerInput]);
        },
        ping: () => runtime.session.client.ping(),
        lastPongSequence: () => runtime.lastPong,
      })),
      windowTicks: M14_MANUAL_WINDOW_TICKS,
      barrierTimeoutMs: 15_000,
      abortReason: () => fatalError,
    });

    await Promise.all(completes.map((complete, index) =>
      withTimeout(complete.promise, 15_000, `run-complete ${M14_ROSTER[index]}`)));
    finished = true;
    if (fatalError !== null) throw fatalError;

    if (activeServer.room.tick !== ticks) {
      throw new Error(`Manual run ended at tick ${activeServer.room.tick}, expected ${ticks}`);
    }
    if (!activeServer.room.isRunComplete) throw new Error('Manual bounded run did not report completion');
    // The bounded `maxTicks` stop sets `runComplete` without forcing the game
    // phase. A full timer-length run additionally reaches the simulation's own
    // `results` phase; record whichever phase the production code produced.
    if (activeServer.room.phase !== 'results' && activeServer.room.phase !== 'running') {
      throw new Error(`Manual run ended in unexpected phase ${activeServer.room.phase}`);
    }
    const expectedSnapshots = snapshotSampleCount(ticks, snapshotHz);
    if (captured.length !== expectedSnapshots) {
      throw new Error(`Observer captured ${captured.length} snapshots, expected ${expectedSnapshots}`);
    }
    const badCounts = runtimes.filter(runtime => runtime.snapshots !== expectedSnapshots);
    if (badCounts.length > 0) {
      throw new Error(
        `Not every client received ${expectedSnapshots} snapshots: ` +
        badCounts.map(runtime => `${runtime.playerId}=${runtime.snapshots}`).join(', '),
      );
    }
    const deniedMessages = runtimes.reduce((total, runtime) => total + runtime.errors.length, 0);
    if (deniedMessages !== 0) {
      throw new Error(`Manual run observed ${deniedMessages} server denials`);
    }
    if (tickMicroseconds.length !== ticks) {
      throw new Error(`Manual run collected ${tickMicroseconds.length} tick samples, expected ${ticks}`);
    }

    const finalSnapshot = activeServer.room.snapshot();
    if (finalSnapshot.state.tick !== ticks) {
      throw new Error(`Final snapshot tick is ${finalSnapshot.state.tick}, expected ${ticks}`);
    }
    const finalStateSha256 = sha256(encodeStateSnapshot(finalSnapshot));
    const analysis = analyzeCapturedSnapshots(captured, snapshotHz);
    const tickDistribution = summarizeSamples(tickMicroseconds, 'microseconds');
    const totalStepMicroseconds = tickMicroseconds.reduce((sum, value) => sum + value, 0);

    return {
      snapshotHz,
      pacing: 'manual',
      players: M14_PLAYERS,
      measuredTicks: ticks,
      expectedSnapshots,
      receivedSnapshots: captured.length,
      allClientsReceivedExpectedSnapshots: true,
      finalTick: activeServer.room.tick,
      finalPhase: activeServer.room.phase,
      finalStateSha256,
      runComplete: true,
      lateTicks: 0,
      deniedMessages: 0,
      snapshotBytes: analysis.snapshotBytes,
      objects: analysis.objects,
      tickDuration: {
        ...tickDistribution,
        totalStepMicroseconds,
        ticksPerSecondStepping: ticks * 1_000_000 / totalStepMicroseconds,
      },
      codecTiming: analysis.codecTiming,
    };
  } finally {
    finished = true;
    for (const runtime of runtimes) {
      try {
        runtime.session.close();
      } catch {
        // Already closed.
      }
    }
    await Promise.race([
      Promise.all(runtimes.map(runtime => runtime.session.closed)),
      delay(1000),
    ]);
    if (server !== null) await server.close();
  }
}

const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,120}$/;
const EPSILON = 1e-6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const positiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;

const nonnegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const closeEnough = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= Math.max(EPSILON, Math.abs(expected) * 1e-9);

const boundedRunPhase = (value: unknown): value is WsSessionPhase =>
  typeof value === 'string' && (value === 'running' || value === 'results');

function validByteSummary(value: unknown): value is ByteSummary {
  if (!isRecord(value) ||
      Object.keys(value).sort().join(',') !== 'max,mean,min,sampleCount,unit' ||
      value.unit !== 'bytes' || !positiveInteger(value.sampleCount) ||
      !positiveInteger(value.min) || !positiveInteger(value.max) ||
      !finiteNonNegative(value.mean)) {
    return false;
  }
  return (value.min as number) <= (value.max as number) &&
    (value.mean as number) >= (value.min as number) - EPSILON &&
    (value.mean as number) <= (value.max as number) + EPSILON;
}

function validDistribution(value: unknown): value is SampleDistribution {
  if (!isRecord(value) ||
      Object.keys(value).sort().join(',') !== 'max,mean,min,p50,p95,p99,sampleCount,unit' ||
      value.unit !== 'microseconds' || !positiveInteger(value.sampleCount) ||
      !['min', 'mean', 'p50', 'p95', 'p99', 'max'].every(key => finiteNonNegative(value[key]))) {
    return false;
  }
  const min = value.min as number;
  const mean = value.mean as number;
  const p50 = value.p50 as number;
  const p95 = value.p95 as number;
  const p99 = value.p99 as number;
  const max = value.max as number;
  return min <= p50 && p50 <= p95 && p95 <= p99 && p99 <= max &&
    mean >= min - EPSILON && mean <= max + EPSILON;
}

function validRatio(value: unknown): value is M14RatioSummary {
  return isRecord(value) &&
    Object.keys(value).sort().join(',') === 'max,mean,min,sampleCount' &&
    positiveInteger(value.sampleCount) &&
    ['min', 'mean', 'max'].every(key => finiteNonNegative(value[key])) &&
    (value.min as number) <= (value.max as number) &&
    (value.mean as number) >= (value.min as number) - EPSILON &&
    (value.mean as number) <= (value.max as number) + EPSILON;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

/**
 * Fail closed before a result is written. A missing or inconsistent number is
 * never replaced with zero or a guess.
 */
export function validateM14Manifest(value: unknown): asserts value is M14Manifest {
  function fail(): never {
    throw new Error('Invalid M14 eight-player measurement manifest');
  }
  if (!isRecord(value) ||
      !exactKeys(value, [
        'schemaVersion', 'kind', 'runId', 'scope', 'provenance', 'methodology',
        'sessions', 'serverProcess', 'correctness', 'network',
      ]) ||
      value.schemaVersion !== 1 ||
      value.kind !== 'm14-eight-player-single-machine-measurement' ||
      typeof value.runId !== 'string' || !RUN_ID.test(value.runId)) {
    fail();
  }

  const scope = value.scope;
  if (!isRecord(scope) ||
      !exactKeys(scope, [
        'measurement', 'label', 'networkAccess', 'networkImpairment',
        'networkMeasurement', 'transportSelection',
      ]) ||
      scope.measurement !== 'single-machine' ||
      scope.label !== 'single machine, no network' ||
      scope.networkAccess !== 'loopback-only' ||
      scope.networkImpairment !== 'none' ||
      scope.networkMeasurement !== 'none' ||
      scope.transportSelection !== 'NOT_A_TRANSPORT_DECISION') {
    fail();
  }

  const provenance = value.provenance;
  if (!isRecord(provenance) ||
      !exactKeys(provenance, [
        'command', 'cliArguments', 'dateUtc', 'nodeVersion', 'platform', 'osRelease',
        'architecture', 'cpuModel', 'logicalCores', 'gitCommitSha', 'workingTreeDirty',
        'dirtyExclusions', 'dirtyPaths', 'productionSourceDirty', 'fixtureScenarioId',
        'fixtureSha256', 'seed', 'players', 'measuredTicks', 'snapshotRatesHz', 'tickRateHz',
      ]) ||
      provenance.command !== 'npm run measure:m14-8p' ||
      !Array.isArray(provenance.cliArguments) ||
      !provenance.cliArguments.every(argument => typeof argument === 'string' && argument.length <= 200) ||
      typeof provenance.dateUtc !== 'string' || Number.isNaN(Date.parse(provenance.dateUtc)) ||
      typeof provenance.nodeVersion !== 'string' || !/^v\d+\.\d+\.\d+/.test(provenance.nodeVersion) ||
      typeof provenance.platform !== 'string' || provenance.platform.length === 0 ||
      typeof provenance.osRelease !== 'string' || provenance.osRelease.length === 0 ||
      typeof provenance.architecture !== 'string' || provenance.architecture.length === 0 ||
      typeof provenance.cpuModel !== 'string' || provenance.cpuModel.length === 0 ||
      !positiveInteger(provenance.logicalCores) ||
      typeof provenance.gitCommitSha !== 'string' || !COMMIT.test(provenance.gitCommitSha) ||
      typeof provenance.workingTreeDirty !== 'boolean' ||
      !Array.isArray(provenance.dirtyExclusions) ||
      provenance.dirtyExclusions.length !== 1 ||
      provenance.dirtyExclusions[0] !== 'benchmarks/results/' ||
      !Array.isArray(provenance.dirtyPaths) ||
      !provenance.dirtyPaths.every(path => typeof path === 'string' && path.length > 0 && path.length <= 300) ||
      typeof provenance.productionSourceDirty !== 'boolean' ||
      provenance.productionSourceDirty !==
        provenance.dirtyPaths.some(path => path.startsWith('src/') || path.startsWith('server/')) ||
      provenance.fixtureScenarioId !== 'BASE-8-60-20' ||
      typeof provenance.fixtureSha256 !== 'string' || !HASH.test(provenance.fixtureSha256) ||
      !positiveInteger(provenance.seed) ||
      !Array.isArray(provenance.players) || provenance.players.length !== M14_PLAYERS ||
      !provenance.players.every(player => typeof player === 'string' && player.length > 0) ||
      !positiveInteger(provenance.measuredTicks) ||
      (provenance.measuredTicks as number) > M14_TICKS ||
      !Array.isArray(provenance.snapshotRatesHz) ||
      provenance.snapshotRatesHz.length !== 3 ||
      provenance.snapshotRatesHz[0] !== 10 ||
      provenance.snapshotRatesHz[1] !== 20 ||
      provenance.snapshotRatesHz[2] !== 30 ||
      provenance.tickRateHz !== TICK_RATE) {
    fail();
  }

  const methodology = value.methodology;
  if (!isRecord(methodology) ||
      !exactKeys(methodology, [
        'snapshotBytes', 'canonicalBytes', 'tickDuration', 'tickPacing', 'codecTiming',
        'percentiles', 'serverProcess', 'serverCpu', 'serverRss', 'transportFraming',
      ]) ||
      methodology.snapshotBytes !==
        'utf8-byte-length-of-actual-server-message-received-by-a-real-websocket-client' ||
      methodology.canonicalBytes !== 'utf8-byte-length-of-encodeStateSnapshot' ||
      methodology.tickDuration !== 'process.hrtime.bigint-around-server.stepOnce' ||
      methodology.tickPacing !== 'manual-fixture-input-barrier' ||
      methodology.codecTiming !==
        'one-timed-encode-and-decode-per-captured-snapshot-after-the-session' ||
      methodology.percentiles !== 'nearest-rank' ||
      methodology.serverProcess !== 'dedicated-node-process-interval-60hz' ||
      methodology.serverCpu !== 'process.cpuUsage-delta-from-running-phase-to-results-detection' ||
      methodology.serverRss !== 'process.resourceUsage.maxRSS-process-lifetime' ||
      methodology.transportFraming !== 'excluded-websocket-frame-headers-not-counted') {
    fail();
  }

  const ticks = (value.provenance as M14Provenance).measuredTicks;
  const sessions = value.sessions;
  if (!Array.isArray(sessions) || sessions.length !== 3) fail();
  const expectedRates = [10, 20, 30] as const;
  const finalHashes: string[] = [];
  for (let index = 0; index < sessions.length; index++) {
    const session = sessions[index];
    const expectedHz = expectedRates[index];
    if (!isRecord(session) ||
        !exactKeys(session, [
          'snapshotHz', 'pacing', 'players', 'measuredTicks', 'expectedSnapshots',
          'receivedSnapshots', 'allClientsReceivedExpectedSnapshots', 'finalTick',
          'finalPhase', 'finalStateSha256', 'runComplete', 'lateTicks', 'deniedMessages',
          'snapshotBytes', 'objects', 'tickDuration', 'codecTiming',
        ]) ||
        session.snapshotHz !== expectedHz ||
        session.pacing !== 'manual' ||
        session.players !== M14_PLAYERS ||
        session.measuredTicks !== ticks ||
        session.expectedSnapshots !== snapshotSampleCount(ticks, expectedHz) ||
        session.receivedSnapshots !== session.expectedSnapshots ||
        session.allClientsReceivedExpectedSnapshots !== true ||
        session.finalTick !== ticks ||
        !boundedRunPhase(session.finalPhase) ||
        typeof session.finalStateSha256 !== 'string' || !HASH.test(session.finalStateSha256) ||
        session.runComplete !== true ||
        session.lateTicks !== 0 ||
        session.deniedMessages !== 0) {
      fail();
    }
    finalHashes.push(session.finalStateSha256 as string);

    const snapshotBytes = session.snapshotBytes;
    if (!isRecord(snapshotBytes) ||
        !exactKeys(snapshotBytes, [
          'snapshotHz', 'sampleCount', 'canonical', 'serverMessage', 'serverMessageOverhead',
          'canonicalBytesPerSimulationTickPerClient', 'canonicalBytesPerSecondPerClient',
          'serverMessageBytesPerSecondPerClient', 'serverMessageBytesPerSecondServerAggregate',
        ]) ||
        snapshotBytes.snapshotHz !== expectedHz ||
        snapshotBytes.sampleCount !== session.expectedSnapshots ||
        !validByteSummary(snapshotBytes.canonical) ||
        !validByteSummary(snapshotBytes.serverMessage) ||
        !validByteSummary(snapshotBytes.serverMessageOverhead) ||
        (snapshotBytes.canonical as ByteSummary).sampleCount !== session.expectedSnapshots ||
        (snapshotBytes.serverMessage as ByteSummary).sampleCount !== session.expectedSnapshots ||
        (snapshotBytes.serverMessageOverhead as ByteSummary).sampleCount !== session.expectedSnapshots ||
        !finiteNonNegative(snapshotBytes.canonicalBytesPerSimulationTickPerClient) ||
        !finiteNonNegative(snapshotBytes.canonicalBytesPerSecondPerClient) ||
        !finiteNonNegative(snapshotBytes.serverMessageBytesPerSecondPerClient) ||
        !finiteNonNegative(snapshotBytes.serverMessageBytesPerSecondServerAggregate)) {
      fail();
    }
    const canonical = snapshotBytes.canonical as ByteSummary;
    const serverMessage = snapshotBytes.serverMessage as ByteSummary;
    const overhead = snapshotBytes.serverMessageOverhead as ByteSummary;
    if (!closeEnough(
      snapshotBytes.canonicalBytesPerSimulationTickPerClient as number,
      canonical.mean * expectedHz / TICK_RATE,
    ) ||
        !closeEnough(
          snapshotBytes.canonicalBytesPerSecondPerClient as number,
          canonical.mean * expectedHz,
        ) ||
        !closeEnough(
          snapshotBytes.serverMessageBytesPerSecondPerClient as number,
          serverMessage.mean * expectedHz,
        ) ||
        !closeEnough(
          snapshotBytes.serverMessageBytesPerSecondServerAggregate as number,
          serverMessage.mean * expectedHz * M14_PLAYERS,
        ) ||
        !closeEnough(overhead.mean, serverMessage.mean - canonical.mean)) {
      fail();
    }

    const objects = session.objects;
    if (!isRecord(objects) || typeof objects.status !== 'string') fail();
    if (objects.status === 'ABSENT') {
      if (!exactKeys(objects, ['status', 'snapshotsWithObjects', 'snapshotsWithoutObjects']) ||
          objects.snapshotsWithObjects !== 0 ||
          objects.snapshotsWithoutObjects !== session.expectedSnapshots) {
        fail();
      }
    } else if (objects.status === 'PRESENT') {
      if (!exactKeys(objects, [
        'status', 'snapshotsWithObjects', 'snapshotsWithoutObjects',
        'objectCount', 'bytesDeltaWithObjects', 'bytesDeltaPerObject',
      ]) ||
          !positiveInteger(objects.snapshotsWithObjects) ||
          !nonnegativeInteger(objects.snapshotsWithoutObjects) ||
          (objects.snapshotsWithObjects as number) + (objects.snapshotsWithoutObjects as number) !==
            session.expectedSnapshots ||
          !validRatio(objects.objectCount) ||
          !validByteSummary(objects.bytesDeltaWithObjects) ||
          !validRatio(objects.bytesDeltaPerObject) ||
          (objects.objectCount as M14RatioSummary).sampleCount !== objects.snapshotsWithObjects ||
          (objects.bytesDeltaWithObjects as ByteSummary).sampleCount !== objects.snapshotsWithObjects ||
          (objects.bytesDeltaPerObject as M14RatioSummary).sampleCount !== objects.snapshotsWithObjects ||
          (objects.objectCount as M14RatioSummary).min < 1) {
        fail();
      }
    } else {
      fail();
    }

    const tickDuration = session.tickDuration;
    if (!isRecord(tickDuration) ||
        !exactKeys(tickDuration, [
          'unit', 'sampleCount', 'min', 'mean', 'p50', 'p95', 'p99', 'max',
          'totalStepMicroseconds', 'ticksPerSecondStepping',
        ]) ||
        !validDistribution({
          unit: tickDuration.unit,
          sampleCount: tickDuration.sampleCount,
          min: tickDuration.min,
          mean: tickDuration.mean,
          p50: tickDuration.p50,
          p95: tickDuration.p95,
          p99: tickDuration.p99,
          max: tickDuration.max,
        }) ||
        tickDuration.sampleCount !== ticks ||
        !finiteNonNegative(tickDuration.totalStepMicroseconds) ||
        !finiteNonNegative(tickDuration.ticksPerSecondStepping) ||
        (tickDuration.totalStepMicroseconds as number) <= 0 ||
        !closeEnough(
          tickDuration.ticksPerSecondStepping as number,
          ticks * 1_000_000 / (tickDuration.totalStepMicroseconds as number),
        )) {
      fail();
    }

    const codecTiming = session.codecTiming;
    if (!isRecord(codecTiming) ||
        !exactKeys(codecTiming, ['iterationsPerSnapshot', 'encode', 'decode']) ||
        codecTiming.iterationsPerSnapshot !== 1 ||
        !validDistribution(codecTiming.encode) ||
        !validDistribution(codecTiming.decode) ||
        (codecTiming.encode as SampleDistribution).sampleCount !== session.expectedSnapshots ||
        (codecTiming.decode as SampleDistribution).sampleCount !== session.expectedSnapshots) {
      fail();
    }
  }
  if (new Set(finalHashes).size !== 1) fail();

  const serverProcess = value.serverProcess;
  if (!isRecord(serverProcess) ||
      !exactKeys(serverProcess, [
        'status', 'mode', 'snapshotHz', 'measuredTicks', 'firstTickDelayMs', 'players',
        'clientCount', 'wallClockMicroseconds', 'cpuUserMicroseconds', 'cpuSystemMicroseconds',
        'cpuTotalMicroseconds', 'cpuPercentOfWallClock', 'peakRssBytes', 'rssAfterRunBytes',
        'finalTick', 'finalPhase', 'finalStateSha256', 'matchesManual20HzHash',
        'clientFinalSnapshotsMatchServerHash', 'lateTicks', 'deniedMessages',
        'perTickDuration',
      ]) ||
      serverProcess.status !== 'MEASURED' ||
      serverProcess.mode !== 'interval' ||
      serverProcess.snapshotHz !== M14_INTERVAL_SNAPSHOT_HZ ||
      serverProcess.measuredTicks !== ticks ||
      serverProcess.firstTickDelayMs !== M14_FIRST_TICK_DELAY_MS ||
      serverProcess.players !== M14_PLAYERS ||
      serverProcess.clientCount !== M14_PLAYERS ||
      !finiteNonNegative(serverProcess.wallClockMicroseconds) ||
      (serverProcess.wallClockMicroseconds as number) <= 0 ||
      !nonnegativeInteger(serverProcess.cpuUserMicroseconds) ||
      !nonnegativeInteger(serverProcess.cpuSystemMicroseconds) ||
      !nonnegativeInteger(serverProcess.cpuTotalMicroseconds) ||
      serverProcess.cpuTotalMicroseconds !==
        (serverProcess.cpuUserMicroseconds as number) + (serverProcess.cpuSystemMicroseconds as number) ||
      !finiteNonNegative(serverProcess.cpuPercentOfWallClock) ||
      !closeEnough(
        serverProcess.cpuPercentOfWallClock as number,
        (serverProcess.cpuTotalMicroseconds as number) /
          (serverProcess.wallClockMicroseconds as number) * 100,
      ) ||
      !positiveInteger(serverProcess.peakRssBytes) ||
      !positiveInteger(serverProcess.rssAfterRunBytes) ||
      serverProcess.finalTick !== ticks ||
      !boundedRunPhase(serverProcess.finalPhase) ||
      typeof serverProcess.finalStateSha256 !== 'string' ||
      !HASH.test(serverProcess.finalStateSha256) ||
      serverProcess.finalStateSha256 !== finalHashes[1] ||
      serverProcess.matchesManual20HzHash !== true ||
      serverProcess.clientFinalSnapshotsMatchServerHash !== true ||
      serverProcess.lateTicks !== 0 ||
      serverProcess.deniedMessages !== 0) {
    fail();
  }
  const perTickDuration = serverProcess.perTickDuration;
  if (!isRecord(perTickDuration) ||
      !exactKeys(perTickDuration, ['status', 'reason']) ||
      perTickDuration.status !== 'NOT_MEASURED' ||
      typeof perTickDuration.reason !== 'string' || perTickDuration.reason.length === 0) {
    fail();
  }

  const correctness = value.correctness;
  if (!isRecord(correctness) ||
      !exactKeys(correctness, [
        'expectedTicks', 'allSessionsReachedExpectedTick',
        'finalStateHashesMatchAcrossSnapshotRates', 'intervalServerMatchesManual20HzHash',
        'snapshotCountsMatchExpected', 'denialsObserved',
      ]) ||
      correctness.expectedTicks !== ticks ||
      correctness.allSessionsReachedExpectedTick !== true ||
      correctness.finalStateHashesMatchAcrossSnapshotRates !== true ||
      correctness.intervalServerMatchesManual20HzHash !== true ||
      correctness.snapshotCountsMatchExpected !== true ||
      correctness.denialsObserved !== 0) {
    fail();
  }

  const network = value.network;
  if (!isRecord(network) ||
      !exactKeys(network, [
        'latency', 'jitter', 'packetLoss', 'joinSuccess', 'turnCost', 'bandwidth',
        'measuredNetworks',
      ]) ||
      network.latency !== 'NOT_MEASURED' ||
      network.jitter !== 'NOT_MEASURED' ||
      network.packetLoss !== 'NOT_MEASURED' ||
      network.joinSuccess !== 'NOT_MEASURED' ||
      network.turnCost !== 'NOT_MEASURED' ||
      network.bandwidth !== 'NOT_MEASURED' ||
      network.measuredNetworks !== 0) {
    fail();
  }
}

