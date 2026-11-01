import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { decodeInputFrame } from '../../src/game/protocol/inputFrame';
import { encodeStateSnapshot } from '../../src/game/protocol/stateSnapshot';
import type { PlayerInput } from '../../src/game/simulation/types';
import type { SnapshotHz } from '../../src/game/networking/wsMessages';
import type { SessionClientHandlers } from '../../src/game/networking/wsSessionClient';
import { SUPPORTED_SNAPSHOT_HZ } from '../../src/game/networking/wsMessages';
import { startWsServer } from '../../server/ws/wsServer';
import { openNodeSession, type NodeSession } from '../../server/ws/nodeWsClient';
import { InMemoryBenchmarkAdapter } from '../inMemory';
import { createRoster, generateFixture, sha256 } from '../scenarios';
import { createWsPrototypeManifest } from './wsManifest';

/**
 * Bounded loopback WebSocket prototype runner.
 *
 * It verifies that the authoritative server accepts the same deterministic
 * BASE-4 fixture through real sockets and produces the same state/event
 * fingerprints as the in-memory reference for the bounded tick range. It does
 * not measure latency, bandwidth, CPU or tick pacing, and it writes those
 * fields as NOT_MEASURED.
 */

const DEFAULT_TICKS = 300;
const MAX_LEAD_TICKS = 8;
const START_DELAY_MS = 400;
const FIRST_TICK_DELAY_MS = 250;
const RUN_TIMEOUT_MS = 30000;

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
  denials: Map<string, number>;
};

async function main(): Promise<void> {
  const ticks = positiveInteger(argument('ticks'), DEFAULT_TICKS, 7200, 'tick count');
  const snapshotHz = snapshotRate(argument('snapshot-hz'));
  const players = createRoster(4);
  const fixture = generateFixture('BASE-4-60-20');
  const schedule = decodeSchedule(fixture.framesByTick as string[][], players, ticks);

  const runComplete = deferred<number>();
  const fatal = deferred<never>();
  const runtimes: ClientRuntime[] = [];
  let server: Awaited<ReturnType<typeof startWsServer>> | null = null;
  let pumpTimer: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let settled = false;

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
    fatal.reject(error instanceof Error ? error : new Error(String(error)));
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
      tickMode: 'interval',
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
        denials: new Map<string, number>(),
      };
      const handlers: SessionClientHandlers = {
        onJoinResult: result => {
          if (result.accepted) joined.resolve();
          else joined.reject(new Error(`Join for ${playerId} denied: ${result.code ?? 'unknown'}`));
        },
        onMatchStart: () => {
          runtime.matchStarted = true;
          pump();
        },
        onSnapshot: () => pump(),
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
      fail(new Error(`Benchmark did not finish within ${RUN_TIMEOUT_MS} ms (${state}; ${clients})`));
    }, RUN_TIMEOUT_MS);

    await Promise.all(joins);
    pumpTimer = setInterval(pump, 5);

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
