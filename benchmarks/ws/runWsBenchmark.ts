import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { decodeInputFrame } from '../../src/game/protocol/inputFrame';
import { encodeStateSnapshot } from '../../src/game/protocol/stateSnapshot';
import { TICK_RATE } from '../../src/game/simulation/step';
import type { PlayerInput } from '../../src/game/simulation/types';
import type { SnapshotHz } from '../../src/game/networking/wsMessages';
import type { SessionClientHandlers } from '../../src/game/networking/wsSessionClient';
import { SUPPORTED_SNAPSHOT_HZ } from '../../src/game/networking/wsMessages';
import { startWsServer } from '../../server/ws/wsServer';
import { openNodeSession, type NodeSession } from '../../server/ws/nodeWsClient';
import { InMemoryBenchmarkAdapter } from '../inMemory';
import { createRoster, generateFixture, sha256 } from '../scenarios';
import { DEFAULT_MANUAL_BARRIER_TIMEOUT_MS, driveManualTicks } from './manualTickDriver';
import { createWsPrototypeManifest, type WsBenchmarkTickMode } from './wsManifest';

/**
 * Bounded loopback WebSocket prototype runner.
 *
 * It verifies that the authoritative server accepts the same deterministic
 * BASE-4 fixture through real sockets and produces the same state/event
 * fingerprints as the in-memory reference for the bounded tick range. It does
 * not measure latency, bandwidth, CPU or tick pacing, and it writes those
 * fields as NOT_MEASURED.
 *
 * Two pacing modes exist and are recorded in the manifest:
 * - `interval` (default) lets the server's 60 Hz timers drive the match, which
 *   approximates real-time pacing but still records no pacing measurement.
 * - `manual` submits a bounded input window, waits for the server to prove it
 *   consumed it, then steps ticks on demand. It is a deterministic correctness
 *   mode; a 7200-tick run finishes quickly and must not be read as real-time.
 */

const DEFAULT_TICKS = 300;
const MAX_TICKS = 7200;
const MAX_LEAD_TICKS = 8;
const START_DELAY_MS = 400;
const FIRST_TICK_DELAY_MS = 250;
/**
 * Wall-clock guard only. A 7200-tick interval run legitimately needs 120 s, so
 * the default is derived from the tick count instead of a fixed 30 s.
 */
const RUN_TIMEOUT_BASE_MS = 30000;
const MANUAL_TICK_BUDGET_MS = 5;
const MAX_RUN_TIMEOUT_MS = 30 * 60 * 1000;

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

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find(entry => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function positiveInteger(raw: string | undefined, fallback: number, max: number, label: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${label}: ${raw}`);
  return value;
}

function snapshotRate(raw: string | undefined): SnapshotHz {
  if (raw === undefined) return 20;
  const value = Number(raw);
  if (!SUPPORTED_SNAPSHOT_HZ.includes(value as SnapshotHz)) {
    throw new Error(`Unsupported snapshot rate: ${raw}`);
  }
  return value as SnapshotHz;
}

function tickModeArgument(raw: string | undefined): WsBenchmarkTickMode {
  if (raw === undefined) return 'interval';
  if (raw !== 'interval' && raw !== 'manual') throw new Error(`Invalid tick mode: ${raw}`);
  return raw;
}

/** Hang guard derived from the tick count, never a measured duration. */
function defaultRunTimeoutMs(tickMode: WsBenchmarkTickMode, ticks: number): number {
  return tickMode === 'interval'
    ? RUN_TIMEOUT_BASE_MS + Math.ceil((ticks * 1000) / TICK_RATE)
    : RUN_TIMEOUT_BASE_MS + ticks * MANUAL_TICK_BUDGET_MS;
}

function decodeSchedule(frames: string[][], players: readonly string[], ticks: number): PlayerInput[][] {
  if (frames.length !== 7200) throw new Error('Invalid fixture');
  const schedule: PlayerInput[][] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const tickFrames = frames[tick];
    if (tickFrames.length !== 1) throw new Error('Invalid BASE-4 fixture framing');
    const frame = decodeInputFrame(tickFrames[0]);
    if (frame.tick !== tick || frame.inputs.length !== players.length) throw new Error('Invalid fixture tick');
    for (const playerId of players) {
      if (!frame.inputs.some(input => input.playerId === playerId)) throw new Error('Invalid fixture roster');
    }
    schedule.push(frame.inputs);
  }
  return schedule;
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

async function main(): Promise<void> {
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
  const schedule = decodeSchedule(fixture.framesByTick as string[][], players, ticks);

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
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
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

main().catch(error => {
  process.stderr.write(`ws benchmark failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
