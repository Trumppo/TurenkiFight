/**
 * `npm run measure:m14-8p`
 *
 * M14 eight-player single-machine measurement. One command runs:
 *
 * 1. three real eight-player authoritative WebSocket sessions over loopback at
 *    10, 20 and 30 Hz snapshot rates, with manual fixture barrier pacing;
 * 2. one dedicated server process hosting eight real loopback clients for a
 *    bounded 7200-tick interval-mode run at 20 Hz snapshots.
 *
 * It writes a timestamped JSON manifest and a short Markdown summary under
 * `benchmarks/results/`. No network path is opened beyond 127.0.0.1, and no
 * latency, jitter, loss, join-rate, TURN or bandwidth figure is produced.
 *
 * This file is harness/test code. It does not modify production behaviour.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { arch as osArch, cpus, platform as osPlatform, release as osRelease } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import type { PlayerInput } from '../../src/game/simulation/types';
import type { SessionClientHandlers } from '../../src/game/networking/wsSessionClient';
import { startWsServer } from '../../server/ws/wsServer';
import { CLIENT_MESSAGE_POLICY } from '../../server/ws/clientMessageLimits';
import type { WsSessionPhase } from '../../server/ws/authoritativeWsSession';
import { openNodeSession, type NodeSession } from '../../server/ws/nodeWsClient';
import { TICK_RATE } from '../../src/game/simulation/step';
import {
  M14_CONNECTION_MARGIN,
  M14_FIRST_TICK_DELAY_MS,
  M14_INTERVAL_SNAPSHOT_HZ,
  M14_MAX_LEAD_TICKS,
  M14_PLAYERS,
  M14_ROOM_CODE,
  M14_ROSTER,
  M14_SCENARIO_ID,
  M14_START_DELAY_MS,
  M14_TICKS,
  loadEightPlayerSchedule,
  runManualSession,
  validateM14Manifest,
  type M14Correctness,
  type M14Manifest,
  type M14Methodology,
  type M14NetworkFields,
  type M14Provenance,
  type M14Scope,
  type M14ServerProcessMeasurement,
} from './eightPlayerMeasurement';
import { summaryFileText } from './summary';
import { sha256 } from '../scenarios';
import { encodeStateSnapshot } from '../../src/game/protocol/stateSnapshot';

const DEFAULT_TICKS = M14_TICKS;
const MAX_TICKS = M14_TICKS;
const MAX_SERVER_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const SERVER_READY_TIMEOUT_MS = 30_000;
const SERVER_RESULT_TIMEOUT_MS = 30_000;

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

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find(entry => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function integerArgument(raw: string | undefined, fallback: number, max: number, label: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${label}: ${raw}`);
  return value;
}

function snapshotRateArgument(raw: string | undefined): 10 | 20 | 30 {
  const value = raw === undefined ? M14_INTERVAL_SNAPSHOT_HZ : Number(raw);
  if (value !== 10 && value !== 20 && value !== 30) throw new Error(`Unsupported snapshot rate: ${String(raw)}`);
  return value;
}

function runStamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

function recordedArguments(): string[] {
  // `--out`, `--role` and the generated run identity do not affect the
  // measured workload and may contain a local path or implementation detail.
  return process.argv.filter(entry =>
    entry.startsWith('--') &&
    !entry.startsWith('--out=') && entry !== '--out' &&
    !entry.startsWith('--role=') && entry !== '--role');
}

type TreeState = {
  gitCommitSha: string;
  workingTreeDirty: boolean;
  dirtyPaths: string[];
  productionSourceDirty: boolean;
};

const COMMIT = /^[0-9a-f]{40}$/;
const DIRTY_EXCLUSIONS = ['benchmarks/results/'] as const;

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function entryPaths(line: string): string[] {
  const rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  const paths = arrow === -1 ? [rest] : [rest.slice(0, arrow), rest.slice(arrow + 4)];
  return paths.map(path => normalizePath(path).replace(/^"|"$/g, ''));
}

function readTreeState(): TreeState {
  const gitCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  if (!COMMIT.test(gitCommitSha)) throw new Error('Could not read the git commit SHA for provenance');
  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: process.cwd(), encoding: 'utf8' });
  const dirtyPaths = [...new Set(
    porcelain
      .split(/\r?\n/)
      .filter(line => line.length >= 4)
      .flatMap(entryPaths)
      .filter(path => !DIRTY_EXCLUSIONS.some(exclusion =>
        path === exclusion.replace(/\/+$/, '') || path.startsWith(exclusion))),
  )].sort();
  return {
    gitCommitSha,
    workingTreeDirty: dirtyPaths.length > 0,
    dirtyPaths,
    productionSourceDirty: dirtyPaths.some(path => path.startsWith('src/') || path.startsWith('server/')),
  };
}

function buildProvenance(input: { ticks: number; fixtureSha256: string; seed: number }): M14Provenance {
  const cpu = cpus();
  const model = cpu[0]?.model?.trim();
  if (!model) throw new Error('Could not read the CPU model for provenance');
  if (cpu.length < 1) throw new Error('Could not read the logical core count for provenance');
  const tree = readTreeState();
  return {
    command: 'npm run measure:m14-8p',
    cliArguments: recordedArguments(),
    dateUtc: new Date().toISOString(),
    nodeVersion: process.version,
    platform: osPlatform(),
    osRelease: osRelease(),
    architecture: osArch(),
    cpuModel: model,
    logicalCores: cpu.length,
    gitCommitSha: tree.gitCommitSha,
    workingTreeDirty: tree.workingTreeDirty,
    dirtyExclusions: [...DIRTY_EXCLUSIONS] as ['benchmarks/results/'],
    dirtyPaths: tree.dirtyPaths,
    productionSourceDirty: tree.productionSourceDirty,
    fixtureScenarioId: M14_SCENARIO_ID,
    fixtureSha256: input.fixtureSha256,
    seed: input.seed,
    players: [...M14_ROSTER],
    measuredTicks: input.ticks,
    snapshotRatesHz: [10, 20, 30],
    tickRateHz: TICK_RATE,
  };
}

const SCOPE: M14Scope = {
  measurement: 'single-machine',
  label: 'single machine, no network',
  networkAccess: 'loopback-only',
  networkImpairment: 'none',
  networkMeasurement: 'none',
  transportSelection: 'NOT_A_TRANSPORT_DECISION',
};

const METHODOLOGY: M14Methodology = {
  snapshotBytes: 'utf8-byte-length-of-actual-server-message-received-by-a-real-websocket-client',
  canonicalBytes: 'utf8-byte-length-of-encodeStateSnapshot',
  tickDuration: 'process.hrtime.bigint-around-server.stepOnce',
  tickPacing: 'manual-fixture-input-barrier',
  codecTiming: 'one-timed-encode-and-decode-per-captured-snapshot-after-the-session',
  percentiles: 'nearest-rank',
  serverProcess: 'dedicated-node-process-interval-60hz',
  serverCpu: 'process.cpuUsage-delta-from-running-phase-to-results-detection',
  serverRss: 'process.resourceUsage.maxRSS-process-lifetime',
  transportFraming: 'excluded-websocket-frame-headers-not-counted',
};

const NETWORK: M14NetworkFields = {
  latency: 'NOT_MEASURED',
  jitter: 'NOT_MEASURED',
  packetLoss: 'NOT_MEASURED',
  joinSuccess: 'NOT_MEASURED',
  turnCost: 'NOT_MEASURED',
  bandwidth: 'NOT_MEASURED',
  measuredNetworks: 0,
};

type ServerReadyLine = {
  kind: 'm14-8p-server-ready';
  port: number;
  roomCode: string;
  snapshotHz: number;
  ticks: number;
};

type ServerResultLine = {
  kind: 'm14-8p-server-result';
  finalTick: number;
  finalPhase: WsSessionPhase;
  finalStateSha256: string;
  wallClockMicroseconds: number;
  cpuUserMicroseconds: number;
  cpuSystemMicroseconds: number;
  cpuTotalMicroseconds: number;
  peakRssBytes: number;
  rssAfterRunBytes: number;
  firstTickDelayMs: number;
  snapshotHz: number;
  measuredTicks: number;
};

function isServerReadyLine(value: unknown): value is ServerReadyLine {
  return typeof value === 'object' && value !== null &&
    (value as { kind?: unknown }).kind === 'm14-8p-server-ready';
}

function isServerResultLine(value: unknown): value is ServerResultLine {
  return typeof value === 'object' && value !== null &&
    (value as { kind?: unknown }).kind === 'm14-8p-server-result';
}

type IntervalClientRuntime = {
  playerId: string;
  session: NodeSession;
  started: boolean;
  completed: boolean;
  snapshots: number;
  lastSnapshotTick: number | null;
  lastSnapshotHash: string | null;
  lastSubmittedTick: number | null;
  errors: string[];
};

/**
 * Spawns the dedicated server process and waits for its ready/result lines.
 * The server process measures only its own CPU and RSS; clients stay in this
 * parent process, so the resource numbers are not contaminated by eight client
 * sockets.
 */
async function runServerProcessSession(input: {
  ticks: number;
  schedule: PlayerInput[][];
  manual20HzHash: string;
}): Promise<M14ServerProcessMeasurement> {
  const scriptPath = resolve(process.cwd(), 'benchmarks/m14/runEightPlayerMeasurement.ts');
  const viteNodePath = resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs');
  if (!existsSync(viteNodePath)) throw new Error('vite-node CLI is missing; run npm ci first');
  if (!existsSync(scriptPath)) throw new Error('M14 measurement entry point is missing');

  const ready = deferred<ServerReadyLine>();
  const result = deferred<ServerResultLine>();
  const child = spawn(process.execPath, [
    viteNodePath,
    scriptPath,
    '--role=server',
    `--ticks=${input.ticks}`,
    `--snapshot-hz=${M14_INTERVAL_SNAPSHOT_HZ}`,
    `--room=${M14_ROOM_CODE}`,
  ], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let stderr = '';
  let stdoutBuffer = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    for (;;) {
      const index = stdoutBuffer.indexOf('\n');
      if (index === -1) break;
      const line = stdoutBuffer.slice(0, index).trim();
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (isServerReadyLine(parsed)) ready.resolve(parsed);
      else if (isServerResultLine(parsed)) result.resolve(parsed);
    }
  });
  child.on('error', error => {
    ready.reject(error);
    result.reject(error);
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal === null) {
      const error = new Error(`Server process exited with code ${code}: ${stderr.trim() || '(no stderr)'}`);
      ready.reject(error);
      result.reject(error);
    }
  });

  const clients: IntervalClientRuntime[] = [];
  const joins = M14_ROSTER.map(() => deferred<void>());
  const starts = M14_ROSTER.map(() => deferred<void>());
  const ends = M14_ROSTER.map(() => deferred<void>());
  const fatal = deferred<never>();
  let pumpTimer: ReturnType<typeof setInterval> | null = null;
  let fatalError: Error | null = null;
  let closed = false;

  const fail = (error: unknown): void => {
    if (fatalError === null) {
      fatalError = error instanceof Error ? error : new Error(String(error));
      fatal.reject(fatalError);
    }
  };

  const pump = (): void => {
    if (fatalError !== null) return;
    try {
      for (const runtime of clients) {
        if (!runtime.started) continue;
        const client = runtime.session.client;
        const maxSend = Math.min(input.ticks - 1, client.serverTick + M14_MAX_LEAD_TICKS - 1);
        const first = runtime.lastSubmittedTick === null ? 0 : runtime.lastSubmittedTick + 1;
        for (let tick = first; tick <= maxSend; tick++) {
          const playerInput = input.schedule[tick].find(candidate => candidate.playerId === runtime.playerId);
          if (!playerInput) throw new Error(`Fixture lost ${runtime.playerId} input at tick ${tick}`);
          client.submitInput(tick, [playerInput]);
          runtime.lastSubmittedTick = tick;
        }
      }
    } catch (error) {
      fail(error);
    }
  };

  try {
    const readyLine = await withTimeout(ready.promise, SERVER_READY_TIMEOUT_MS, 'server process ready');
    const url = `ws://127.0.0.1:${readyLine.port}`;

    for (let index = 0; index < M14_ROSTER.length; index++) {
      const playerId = M14_ROSTER[index];
      const runtime: IntervalClientRuntime = {
        playerId,
        session: null as unknown as NodeSession,
        started: false,
        completed: false,
        snapshots: 0,
        lastSnapshotTick: null,
        lastSnapshotHash: null,
        errors: [],
        lastSubmittedTick: null,
      };
      clients.push(runtime);
      const handlers: SessionClientHandlers = {
        onJoinResult: join => {
          if (join.accepted) joins[index].resolve();
          else joins[index].reject(new Error(`Join for ${playerId} denied: ${join.code ?? 'unknown'}`));
        },
        onMatchStart: () => {
          runtime.started = true;
          starts[index].resolve();
          pump();
        },
        onSnapshot: snapshot => {
          runtime.snapshots += 1;
          runtime.lastSnapshotTick = snapshot.state.tick;
          runtime.lastSnapshotHash = sha256(encodeStateSnapshot(snapshot));
          pump();
        },
        onError: error => {
          runtime.errors.push(error.code);
          if (!closed) fail(new Error(`Server denied ${playerId}: ${error.code}`));
        },
        onMatchEnd: () => {
          runtime.completed = true;
          ends[index].resolve();
        },
        onRunComplete: () => {
          runtime.completed = true;
          ends[index].resolve();
        },
        onProtocolError: message => {
          if (!closed) fail(new Error(`Malformed server message for ${playerId}: ${message}`));
        },
        onSessionClosed: reason => {
          if (!closed) fail(new Error(`Session closed for ${playerId}: ${reason}`));
        },
        onTransportClosed: () => {
          if (!closed && !runtime.completed) fail(new Error(`WebSocket closed for ${playerId} during the bounded run`));
        },
        onTransportError: message => {
          if (!closed) fail(new Error(`WebSocket error for ${playerId}: ${message}`));
        },
      };
      const session = await openNodeSession({ url, handlers });
      runtime.session = session;
      session.client.join([playerId], readyLine.roomCode);
    }

    await Promise.all(joins.map((join, index) =>
      withTimeout(join.promise, 15_000, `join ${M14_ROSTER[index]}`)));
    await Promise.all(starts.map((start, index) =>
      withTimeout(start.promise, 15_000, `match-start ${M14_ROSTER[index]}`)));
    pumpTimer = setInterval(pump, 5);
    pump();

    await Promise.race([
      Promise.all(ends.map((end, index) =>
        withTimeout(end.promise, MAX_SERVER_RUN_TIMEOUT_MS, `match-end ${M14_ROSTER[index]}`))),
      fatal.promise,
    ]);
    if (fatalError !== null) throw fatalError;
    closed = true;
    if (pumpTimer !== null) {
      clearInterval(pumpTimer);
      pumpTimer = null;
    }

    const serverResult = await withTimeout(result.promise, SERVER_RESULT_TIMEOUT_MS, 'server process result');
    if (serverResult.finalTick !== input.ticks) {
      throw new Error(`Interval server ended at tick ${serverResult.finalTick}, expected ${input.ticks}`);
    }
    if (serverResult.finalPhase !== 'results' && serverResult.finalPhase !== 'running') {
      throw new Error(`Interval server ended in unexpected phase ${serverResult.finalPhase}`);
    }
    if (serverResult.snapshotHz !== M14_INTERVAL_SNAPSHOT_HZ) {
      throw new Error(`Interval server reported ${serverResult.snapshotHz} Hz, expected ${M14_INTERVAL_SNAPSHOT_HZ}`);
    }
    if (serverResult.measuredTicks !== input.ticks) {
      throw new Error(`Interval server measured ${serverResult.measuredTicks} ticks, expected ${input.ticks}`);
    }
    if (serverResult.firstTickDelayMs !== M14_FIRST_TICK_DELAY_MS) {
      throw new Error(`Interval server reported firstTickDelayMs=${serverResult.firstTickDelayMs}`);
    }

    const deniedMessages = clients.reduce((total, runtime) => total + runtime.errors.length, 0);
    if (deniedMessages !== 0) {
      throw new Error(`Interval server run observed ${deniedMessages} server denials`);
    }
    const lateTicks = clients.reduce((total, runtime) =>
      total + runtime.errors.filter(code => code === 'late-tick').length, 0);
    if (lateTicks !== 0) throw new Error(`Interval server run observed ${lateTicks} late ticks`);

    const badClients = clients.filter(runtime =>
      runtime.lastSnapshotTick !== input.ticks || runtime.lastSnapshotHash === null);
    if (badClients.length > 0) {
      throw new Error(
        `Not every client ended on tick ${input.ticks}: ` +
        badClients.map(runtime => `${runtime.playerId}=${runtime.lastSnapshotTick ?? 'none'}`).join(', '),
      );
    }
    const clientHashMismatch = clients.filter(runtime =>
      runtime.lastSnapshotHash !== serverResult.finalStateSha256);
    if (clientHashMismatch.length > 0) {
      throw new Error('Client final snapshot hash does not match the server final state hash');
    }
    if (serverResult.finalStateSha256 !== input.manual20HzHash) {
      throw new Error('Interval server final state hash does not match the manual 20 Hz session');
    }

    return {
      status: 'MEASURED',
      mode: 'interval',
      snapshotHz: M14_INTERVAL_SNAPSHOT_HZ,
      measuredTicks: input.ticks,
      firstTickDelayMs: M14_FIRST_TICK_DELAY_MS,
      players: M14_PLAYERS,
      clientCount: M14_PLAYERS,
      wallClockMicroseconds: serverResult.wallClockMicroseconds,
      cpuUserMicroseconds: serverResult.cpuUserMicroseconds,
      cpuSystemMicroseconds: serverResult.cpuSystemMicroseconds,
      cpuTotalMicroseconds: serverResult.cpuTotalMicroseconds,
      cpuPercentOfWallClock:
        serverResult.cpuTotalMicroseconds / serverResult.wallClockMicroseconds * 100,
      peakRssBytes: serverResult.peakRssBytes,
      rssAfterRunBytes: serverResult.rssAfterRunBytes,
      finalTick: serverResult.finalTick,
      finalPhase: serverResult.finalPhase,
      finalStateSha256: serverResult.finalStateSha256,
      matchesManual20HzHash: true,
      clientFinalSnapshotsMatchServerHash: true,
      lateTicks: 0,
      deniedMessages: 0,
      perTickDuration: {
        status: 'NOT_MEASURED',
        reason: 'The production 60 Hz interval tick loop is not instrumented; per-tick duration was measured only in the manual-pacing sessions.',
      },
    };
  } finally {
    closed = true;
    if (pumpTimer !== null) clearInterval(pumpTimer);
    for (const runtime of clients) {
      try {
        runtime.session.close();
      } catch {
        // Already closed.
      }
    }
    await Promise.race([
      Promise.all(clients.map(runtime => runtime.session.closed)),
      delay(1000),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }
  }
}

/** Dedicated server process entry (`--role=server`). */
async function runServerChild(): Promise<void> {
  const ticks = integerArgument(argument('ticks'), DEFAULT_TICKS, MAX_TICKS, 'tick count');
  const snapshotHz = snapshotRateArgument(argument('snapshot-hz'));
  const roomCode = argument('room') ?? M14_ROOM_CODE;

  // `startMatchServer` (the `serve:match` host) does not expose the benchmark's
  // bounded `maxTicks` hook, so this dedicated measurement process starts the
  // same authoritative WebSocket server directly with the exact options
  // `serve:match` would use: eight-player roster, room code, connection cap,
  // rejoin window and the production client-message policy. It adds no TLS and
  // no stdin control channel, which this measurement does not exercise.
  const handle = await startWsServer({
    host: '127.0.0.1',
    port: 0,
    playerIds: [...M14_ROSTER],
    roomCode,
    snapshotHz,
    maxLead: M14_MAX_LEAD_TICKS,
    maxTicks: ticks,
    startDelayMs: M14_START_DELAY_MS,
    firstTickDelayMs: M14_FIRST_TICK_DELAY_MS,
    tickMode: 'interval',
    maxConnections: M14_PLAYERS + M14_CONNECTION_MARGIN,
    rejoinWindowMs: 0,
    messagePolicy: CLIENT_MESSAGE_POLICY,
  });

  process.stdout.write(`${JSON.stringify({
    kind: 'm14-8p-server-ready',
    port: handle.port,
    roomCode,
    snapshotHz,
    ticks,
  })}\n`);

  let cpuBefore: NodeJS.CpuUsage | null = null;
  let wallStart = 0n;
  let recorded = false;
  const deadline = Date.now() + (ticks / TICK_RATE + 120) * 1000;

  const finish = async (): Promise<void> => {
    if (recorded) return;
    recorded = true;
    if (cpuBefore === null) throw new Error('Server child finished without a running-phase CPU baseline');
    const cpu = process.cpuUsage(cpuBefore);
    const wallEnd = process.hrtime.bigint();
    const usage = process.resourceUsage();
    const memory = process.memoryUsage();
    const snapshot = handle.room.snapshot();
    const result: ServerResultLine = {
      kind: 'm14-8p-server-result',
      finalTick: handle.room.tick,
      finalPhase: handle.room.phase,
      finalStateSha256: sha256(encodeStateSnapshot(snapshot)),
      wallClockMicroseconds: Number(wallEnd - wallStart) / 1000,
      cpuUserMicroseconds: cpu.user,
      cpuSystemMicroseconds: cpu.system,
      cpuTotalMicroseconds: cpu.user + cpu.system,
      peakRssBytes: usage.maxRSS * 1024,
      rssAfterRunBytes: memory.rss,
      firstTickDelayMs: M14_FIRST_TICK_DELAY_MS,
      snapshotHz,
      measuredTicks: ticks,
    };
    await new Promise<void>(resolveWrite => {
      process.stdout.write(`${JSON.stringify(result)}\n`, () => resolveWrite());
    });
    // Give the final snapshot and match-end frames a moment to flush before
    // closing the sockets. This wall time is not included in the measured CPU.
    await delay(100);
    await handle.close();
    process.exitCode = 0;
  };

  const timer = setInterval(() => {
    if (recorded) return;
    if (Date.now() > deadline) {
      recorded = true;
      clearInterval(timer);
      process.stderr.write(`m14-8p server child exceeded its wall-clock guard at tick ${handle.room.tick}\n`);
      void handle.close().then(() => { process.exitCode = 1; });
      return;
    }
    if (cpuBefore === null) {
      if (handle.room.phase === 'running') {
        cpuBefore = process.cpuUsage();
        wallStart = process.hrtime.bigint();
      }
      return;
    }
    if (handle.room.phase === 'results' || handle.room.isRunComplete) {
      clearInterval(timer);
      void finish().catch(error => {
        process.stderr.write(`m14-8p server child could not record its result: ${String(error)}\n`);
        process.exitCode = 1;
        void handle.close();
      });
    }
  }, 2);
}

function createManifest(input: {
  runId: string;
  provenance: M14Provenance;
  sessions: Awaited<ReturnType<typeof runManualSession>>[];
  serverProcess: M14ServerProcessMeasurement;
  ticks: number;
}): M14Manifest {
  const correctness: M14Correctness = {
    expectedTicks: input.ticks,
    allSessionsReachedExpectedTick: true,
    finalStateHashesMatchAcrossSnapshotRates: true,
    intervalServerMatchesManual20HzHash: true,
    snapshotCountsMatchExpected: true,
    denialsObserved: 0,
  };
  return {
    schemaVersion: 1,
    kind: 'm14-eight-player-single-machine-measurement',
    runId: input.runId,
    scope: SCOPE,
    provenance: input.provenance,
    methodology: METHODOLOGY,
    sessions: input.sessions,
    serverProcess: input.serverProcess,
    correctness,
    network: NETWORK,
  };
}

function uniqueRunId(): string {
  const base = `m14-8p-${runStamp()}`;
  let candidate = base;
  let suffix = 1;
  while (existsSync(resolve(process.cwd(), `benchmarks/results/${candidate}.json`))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function main(): Promise<void> {
  const ticks = integerArgument(argument('ticks'), DEFAULT_TICKS, MAX_TICKS, 'tick count');
  const loaded = loadEightPlayerSchedule(ticks);
  const sessions: Awaited<ReturnType<typeof runManualSession>>[] = [];

  for (const snapshotHz of [10, 20, 30] as const) {
    process.stdout.write(`m14-8p: manual eight-player session at ${snapshotHz} Hz\n`);
    sessions.push(await runManualSession({
      snapshotHz,
      ticks,
      schedule: loaded.schedule,
    }));
  }

  const manual20 = sessions.find(session => session.snapshotHz === 20);
  if (!manual20) throw new Error('Manual 20 Hz session is missing');
  process.stdout.write(`m14-8p: interval server-process session at ${M14_INTERVAL_SNAPSHOT_HZ} Hz\n`);
  const serverProcess = await runServerProcessSession({
    ticks,
    schedule: loaded.schedule,
    manual20HzHash: manual20.finalStateSha256,
  });

  const runId = uniqueRunId();
  const manifest = createManifest({
    runId,
    provenance: buildProvenance({
      ticks,
      fixtureSha256: loaded.fixture.fixtureSha256,
      seed: loaded.fixture.seed,
    }),
    sessions,
    serverProcess,
    ticks,
  });
  validateM14Manifest(manifest);

  const output = resolve(process.cwd(), argument('out') ?? `benchmarks/results/${runId}.json`);
  mkdirSync(dirname(output), { recursive: true });
  if (existsSync(output)) throw new Error(`Refusing to overwrite an existing result: ${basename(output)}`);
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const summaryPath = output.replace(/\.json$/i, '.md');
  if (existsSync(summaryPath)) throw new Error(`Refusing to overwrite an existing summary: ${basename(summaryPath)}`);
  writeFileSync(summaryPath, summaryFileText(manifest), 'utf8');

  process.stdout.write(`\nM14 eight-player measurement written:\n`);
  process.stdout.write(`  ${basename(output)}\n`);
  process.stdout.write(`  ${basename(summaryPath)}\n`);
  process.stdout.write(`  final tick: ${sessions[0].finalTick}; final state: ${sessions[0].finalStateSha256}\n`);
  process.stdout.write(`  server peak RSS: ${(serverProcess.peakRssBytes / (1024 * 1024)).toFixed(1)} MiB\n`);
}

const isServerRole = argument('role') === 'server';
if (isServerRole) {
  runServerChild().catch(error => {
    process.stderr.write(`m14-8p server child failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
} else {
  main().catch(error => {
    process.stderr.write(`m14-8p measurement failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
