import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { encodeStateSnapshot } from '../../src/game/protocol/stateSnapshot';
import type { SessionClientHandlers } from '../../src/game/networking/wsSessionClient';
import { startWsServer } from '../../server/ws/wsServer';
import { openNodeSession, type NodeSession } from '../../server/ws/nodeWsClient';
import { InMemoryBenchmarkAdapter } from '../inMemory';
import { createRoster, generateFixture, sha256 } from '../scenarios';
import {
  DEFAULT_TICKS,
  FIRST_TICK_DELAY_MS,
  MAX_LEAD_TICKS,
  MAX_RUN_TIMEOUT_MS,
  MAX_TICKS,
  START_DELAY_MS,
  wsBenchmarkRoster,
  argument,
  decodeFixtureSchedule,
  defaultRunTimeoutMs,
  positiveInteger,
  snapshotRate,
  tickModeArgument,
} from './benchmarkSetup';
import { DEFAULT_MANUAL_BARRIER_TIMEOUT_MS, driveManualTicks } from './manualTickDriver';
import { runClientRole, runServerRole } from './splitRoles';
import { createWsPrototypeManifest, type WsBenchmarkTickMode } from './wsManifest';

/**
 * Bounded WebSocket prototype runner with three explicit roles.
 *
 * - `--mode=loopback` (default) keeps the original single-process behaviour:
 *   one process starts the server and four synthetic clients over an ephemeral
 *   loopback port and writes the manifest. Its behaviour and output are
 *   unchanged.
 * - `--mode=server` binds an explicit `--host`/`--port`, prints one
 *   machine-readable ready line, waits for exactly the configured roster, runs
 *   the authoritative session and writes the coordinator manifest.
 * - `--mode=client --url=ws://host:port --player=P1` runs one synthetic client
 *   on an arbitrary machine and exits; the server role owns the manifest.
 *
 * Every role verifies that the authoritative server accepts the same
 * deterministic BASE-4 fixture through real sockets and produces the same
 * state/event fingerprints as the in-memory reference for the bounded tick
 * range. None of them measures latency, bandwidth, CPU or tick pacing; those
 * fields stay NOT_MEASURED in every manifest. A split run only proves that the
 * roles can execute across processes and machines — it selects no transport.
 *
 * Two pacing modes exist and are recorded in the manifest:
 * - `interval` (default) lets the server's 60 Hz timers drive the match, which
 *   approximates real-time pacing but still records no pacing measurement.
 * - `manual` submits a bounded input window, proves the server consumed it, then
 *   steps ticks on demand. It is a deterministic correctness mode; a 7200-tick
 *   run finishes quickly and must not be read as real-time.
 */

const MODES = ['loopback', 'server', 'client'] as const;
type WsBenchmarkMode = (typeof MODES)[number];

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

function modeArgument(raw: string | undefined): WsBenchmarkMode {
  if (raw === undefined) return 'loopback';
  if (!MODES.includes(raw as WsBenchmarkMode)) {
    throw new Error(`Invalid mode: ${raw} (expected ${MODES.join(', ')})`);
  }
  return raw as WsBenchmarkMode;
}

function portArgument(raw: string | undefined): number {
  if (raw === undefined) throw new Error('Server mode requires an explicit --port');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 65535) throw new Error(`Invalid port: ${raw}`);
  return value;
}

function currentCommitSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
}

type ClientRuntime = {
  playerId: string;
  session: NodeSession;
  nextToSend: number;
  matchStarted: boolean;
  lateTicks: number;
  lastPong: number;
  denials: Map<string, number>;
};

async function runLoopback(): Promise<void> {
  const ticks = positiveInteger(argument('ticks'), DEFAULT_TICKS, MAX_TICKS, 'tick count');
  const snapshotHz = snapshotRate(argument('snapshot-hz'));
  const tickMode = tickModeArgument(argument('tick-mode'));
  const timeoutMs = positiveInteger(
    argument('timeout-ms'),
    defaultRunTimeoutMs(tickMode, ticks),
    MAX_RUN_TIMEOUT_MS,
    'run timeout',
  );
  const players = createRoster(4);
  const fixture = generateFixture('BASE-4-60-20');
  const schedule = decodeFixtureSchedule(fixture.framesByTick, players, ticks);

  const runComplete = deferred<number>();
  const fatal = deferred<never>();
  // The race that observes this rejection is only installed after joins and the
  // manual tick loop. Attach a handler now so an early failure cannot surface
  // as an unhandled rejection and take the process down without diagnostics.
  void fatal.promise.catch(() => undefined);
  const runtimes: ClientRuntime[] = [];
  let server: Awaited<ReturnType<typeof startWsServer>> | null = null;
  let pumpTimer: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let settled = false;
  let fatalError: Error | null = null;

  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (pumpTimer) clearInterval(pumpTimer);
    if (timeout) clearTimeout(timeout);
    for (const runtime of runtimes) {
      try {
        runtime.session.close();
      } catch {
        // Already closed.
      }
    }
    await Promise.race([
      Promise.all(runtimes.map(runtime => runtime.session.closed)),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
    if (server) await server.close();
  };

  const fail = (error: unknown): void => {
    if (settled) return;
    fatalError = error instanceof Error ? error : new Error(String(error));
    fatal.reject(fatalError);
  };

  const pump = (): void => {
    try {
      for (const runtime of runtimes) {
        if (!runtime.matchStarted) continue;
        const client = runtime.session.client;
        const maxSend = Math.min(ticks - 1, client.serverTick + MAX_LEAD_TICKS - 1);
        while (runtime.nextToSend <= maxSend) {
          const tick = runtime.nextToSend;
          const input = schedule[tick].find(candidate => candidate.playerId === runtime.playerId);
          if (!input) throw new Error('Fixture lost a player input');
          client.submitInput(tick, [input]);
          runtime.nextToSend = tick + 1;
        }
      }
    } catch (error) {
      fail(error);
    }
  };

  try {
    server = await startWsServer({
      port: 0,
      host: '127.0.0.1',
      snapshotHz,
      maxLead: MAX_LEAD_TICKS,
      maxTicks: ticks,
      startDelayMs: START_DELAY_MS,
      firstTickDelayMs: FIRST_TICK_DELAY_MS,
      tickMode,
    });
    const url = `ws://127.0.0.1:${server.port}`;

    const joins: Promise<void>[] = [];
    for (const playerId of players) {
      const joined = deferred<void>();
      const runtime: ClientRuntime = {
        playerId,
        session: null as unknown as NodeSession,
        nextToSend: 0,
        matchStarted: false,
        lateTicks: 0,
        lastPong: 0,
        denials: new Map<string, number>(),
      };
      const handlers: SessionClientHandlers = {
        onJoinResult: result => {
          if (result.accepted) joined.resolve();
          else joined.reject(new Error(`Join for ${playerId} denied: ${result.code ?? 'unknown'}`));
        },
        onMatchStart: () => {
          runtime.matchStarted = true;
          // Manual mode submits windows from the driver, never from a snapshot.
          if (tickMode === 'interval') pump();
        },
        onSnapshot: () => {
          if (tickMode === 'interval') pump();
        },
        onPong: sequence => {
          // Monotonic acknowledgement used by the manual input barrier.
          if (sequence > runtime.lastPong) runtime.lastPong = sequence;
        },
        onError: error => {
          runtime.denials.set(error.code, (runtime.denials.get(error.code) ?? 0) + 1);
          if (error.code === 'late-tick') runtime.lateTicks += 1;
          if (error.code === 'not-started' && error.targetTick !== undefined) {
            runtime.nextToSend = Math.min(runtime.nextToSend, error.targetTick);
          }
          // Authority/ownership denials mean the driver itself is wrong.
          if (error.code === 'unauthorized-player' || error.code === 'unknown-player' ||
              error.code === 'session-closed' || error.code === 'invalid-binding') {
            fail(new Error(`Unexpected server denial: ${error.code}`));
          }
        },
        onProtocolError: message => fail(new Error(`Malformed server message: ${message}`)),
        onRunComplete: tick => runComplete.resolve(tick),
        onSessionClosed: reason => {
          if (!closed) fail(new Error(`Session closed during the bounded run: ${reason}`));
        },
        onTransportClosed: () => {
          if (!closed) fail(new Error('WebSocket closed during the bounded run'));
        },
        onTransportError: message => fail(new Error(`WebSocket error: ${message}`)),
      };
      const session = await openNodeSession({ url, handlers });
      runtime.session = session;
      runtimes.push(runtime);
      joins.push(joined.promise);
      session.client.join([playerId]);
    }

    timeout = setTimeout(() => {
      const state = server
        ? `phase=${server.room.phase} tick=${server.room.tick} buffered=${server.room.bufferedTicks}`
        : 'server=null';
      const clients = runtimes
        .map(runtime => `${runtime.playerId}:joined=${runtime.session.client.sessionState}:started=${runtime.matchStarted}:next=${runtime.nextToSend}:serverTick=${runtime.session.client.serverTick}`)
        .join(',');
      fail(new Error(
        `Benchmark did not finish within ${timeoutMs} ms (tickMode=${tickMode}; ${state}; ${clients})`,
      ));
    }, timeoutMs);

    await Promise.all(joins);

    if (tickMode === 'manual') {
      // The transport schedules neither the start delay nor a tick timer, so the
      // benchmark starts the match and advances the authority itself. Every
      // submitted window is confirmed by a pong barrier before stepping, so no
      // tick is consumed with missing fixture input.
      const manualServer = server;
      if (!manualServer.room.beginMatch()) throw new Error('Could not start the manual benchmark match');
      await driveManualTicks({
        ticks,
        nextTick: () => manualServer.room.tick,
        stepOnce: () => manualServer.stepOnce(),
        clients: runtimes.map(runtime => ({
          submitInput: tick => {
            const input = schedule[tick].find(candidate => candidate.playerId === runtime.playerId);
            if (!input) throw new Error('Fixture lost a player input');
            runtime.session.client.submitInput(tick, [input]);
            runtime.nextToSend = tick + 1;
          },
          ping: () => runtime.session.client.ping(),
          lastPongSequence: () => runtime.lastPong,
        })),
        barrierTimeoutMs: DEFAULT_MANUAL_BARRIER_TIMEOUT_MS,
        abortReason: () => fatalError,
      });
    } else {
      pumpTimer = setInterval(pump, 5);
    }

    const completedTick = await Promise.race([runComplete.promise, fatal.promise]);
    settled = true;

    if (server.room.tick !== ticks || completedTick !== ticks) {
      throw new Error(`Bounded run ended at tick ${server.room.tick}/${completedTick}, expected ${ticks}`);
    }

    const finalSnapshot = server.room.snapshot();
    const finalStateSha256 = sha256(encodeStateSnapshot(finalSnapshot));
    const orderedEventsSha256 = sha256(JSON.stringify(server.room.orderedEvents()));

    const reference = new InMemoryBenchmarkAdapter();
    reference.connect({ scenarioId: 'BASE-4-60-20' });
    reference.join(players);
    for (let tick = 0; tick < ticks; tick++) reference.sendInput(fixture.framesByTick[tick][0]);
    const referenceFinalStateSha256 = sha256(encodeStateSnapshot(reference.observeSnapshot()));
    const referenceOrderedEventsSha256 = sha256(JSON.stringify(reference.observeEvents()));
    reference.close();

    const lateTicks = runtimes.reduce((total, runtime) => total + runtime.lateTicks, 0);
    const deniedMessages = runtimes.reduce((total, runtime) =>
      total + [...runtime.denials.values()].reduce((sum, count) => sum + count, 0), 0);

    const runId = `ws-base4-${Date.now()}`;
    const commitSha = currentCommitSha();
    const manifest = createWsPrototypeManifest({
      runId,
      commitSha,
      fixtureSha256: fixture.fixtureSha256,
      seed: fixture.seed,
      snapshotHz,
      maxLeadTicks: MAX_LEAD_TICKS,
      boundedTicks: ticks,
      tickMode,
      correctness: {
        finalTick: server.room.tick,
        matchesInMemoryReference:
          finalStateSha256 === referenceFinalStateSha256 &&
          orderedEventsSha256 === referenceOrderedEventsSha256,
        finalStateSha256,
        referenceFinalStateSha256,
        orderedEventsSha256,
        referenceOrderedEventsSha256,
        lateTicks,
        deniedMessages,
      },
    });

    const output = resolve(process.cwd(), argument('out') ?? `benchmarks/out/${runId}.json`);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    process.stdout.write(`${JSON.stringify({
      manifest: output,
      scenarioId: manifest.scenarioId,
      boundedTicks: manifest.boundedTicks,
      snapshotHz: manifest.snapshotHz,
      tickMode: manifest.tickMode,
      pacing: manifest.pacing,
      finalTick: manifest.correctness.finalTick,
      matchesInMemoryReference: manifest.correctness.matchesInMemoryReference,
      lateTicks: manifest.correctness.lateTicks,
      deniedMessages: manifest.correctness.deniedMessages,
      result: manifest.result,
      measurements: manifest.measurements,
    }, null, 2)}\n`);
  } finally {
    await shutdown();
  }
}

async function runServerCli(): Promise<void> {
  const ticks = positiveInteger(argument('ticks'), DEFAULT_TICKS, MAX_TICKS, 'tick count');
  const snapshotHz = snapshotRate(argument('snapshot-hz'));
  const tickMode = tickModeArgument(argument('tick-mode'));
  const timeoutMs = positiveInteger(
    argument('timeout-ms'),
    defaultRunTimeoutMs(tickMode, ticks),
    MAX_RUN_TIMEOUT_MS,
    'run timeout',
  );
  const host = argument('host');
  if (host === undefined || host.length === 0) {
    throw new Error('Server mode requires an explicit --host (for example --host=0.0.0.0)');
  }
  const port = portArgument(argument('port'));
  const playerCountRaw = argument('players');
  const playerCount = playerCountRaw === undefined ? 4 : Number(playerCountRaw);
  if (playerCount !== 4 && playerCount !== 8) throw new Error(`Invalid player count: ${playerCountRaw} (expected 4 or 8)`);
  const roster = wsBenchmarkRoster(playerCount);
  const runId = `ws-base${playerCount}-server-${Date.now()}`;
  const commitSha = currentCommitSha();

  const result = await runServerRole({
    host,
    port,
    ticks,
    playerCount,
    snapshotHz,
    tickMode,
    timeoutMs,
    commitSha,
    runId,
    ...(argument('out') === undefined ? {} : { outPath: argument('out') as string }),
    onReady: info => {
      // One machine-readable line on stdout so clients on other machines can
      // connect. A wildcard bind has no usable URL; host/port are separate.
      process.stdout.write(`${JSON.stringify({
        kind: 'ws-benchmark-server-ready',
        role: 'server-coordinator',
        url: info.url,
        host: info.host,
        port: info.port,
        players: [...roster],
        boundedTicks: ticks,
        snapshotHz,
        tickMode,
        maxLeadTicks: MAX_LEAD_TICKS,
      })}\n`);
    },
  });

  process.stdout.write(`${JSON.stringify({
    kind: 'ws-benchmark-server-result',
    role: 'server-coordinator',
    manifest: result.manifestPath,
    scenarioId: result.manifest.scenarioId,
    boundedTicks: result.manifest.boundedTicks,
    snapshotHz: result.manifest.snapshotHz,
    tickMode: result.manifest.tickMode,
    pacing: result.manifest.pacing,
    topology: result.manifest.topology,
    finalTick: result.manifest.correctness.finalTick,
    matchesInMemoryReference: result.manifest.correctness.matchesInMemoryReference,
    lateTicks: result.manifest.correctness.lateTicks,
    deniedMessages: result.manifest.correctness.deniedMessages,
    deniedBySource: result.deniedBySource,
    acceptedMessages: result.acceptedMessages,
    result: result.manifest.result,
    measurements: result.manifest.measurements,
  })}\n`);
}

async function runClientCli(): Promise<void> {
  const ticks = positiveInteger(argument('ticks'), DEFAULT_TICKS, MAX_TICKS, 'tick count');
  const tickMode = tickModeArgument(argument('tick-mode'));
  const timeoutMs = positiveInteger(
    argument('timeout-ms'),
    defaultRunTimeoutMs(tickMode, ticks),
    MAX_RUN_TIMEOUT_MS,
    'run timeout',
  );
  const url = argument('url');
  if (url === undefined || url.length === 0) throw new Error('Client mode requires --url=ws://host:port');
  const playerCountRaw = argument('players');
  const playerCount = playerCountRaw === undefined ? 4 : Number(playerCountRaw);
  if (playerCount !== 4 && playerCount !== 8) throw new Error(`Invalid player count: ${playerCountRaw} (expected 4 or 8)`);
  const roster = wsBenchmarkRoster(playerCount);
  const playerId = argument('player');
  if (playerId === undefined || playerId.length === 0) {
    throw new Error(`Client mode requires --player (one of ${roster.join(', ')})`);
  }

  const result = await runClientRole({ url, playerId, playerCount, ticks, timeoutMs });
  process.stdout.write(`${JSON.stringify({
    kind: 'ws-benchmark-client-result',
    role: 'client',
    playerId: result.playerId,
    boundedTicks: ticks,
    finalTick: result.finalTick,
    submittedTicks: result.submittedTicks,
    lateTicks: result.lateTicks,
    deniedMessages: result.deniedMessages,
    denials: result.denials,
  })}\n`);
}

async function main(): Promise<void> {
  const mode = modeArgument(argument('mode'));
  if (mode === 'server') return runServerCli();
  if (mode === 'client') return runClientCli();
  return runLoopback();
}

main().catch(error => {
  process.stderr.write(`ws benchmark failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
