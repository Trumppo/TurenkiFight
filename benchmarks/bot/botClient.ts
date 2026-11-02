import { execFileSync } from 'node:child_process';
import { release as osRelease } from 'node:os';
import type { SnapshotHz } from '../../src/game/networking/wsMessages';
import type { SessionClientHandlers } from '../../src/game/networking/wsSessionClient';
import { TICK_RATE } from '../../src/game/simulation/step';
import type { PlayerInput } from '../../src/game/simulation/types';
import { openNodeSession, type NodeSession } from '../../server/ws/nodeWsClient';
import {
  BOT_ADDRESS_NOT_RECORDED,
  BOT_COMMAND,
  BOT_FIXTURE_NOT_APPLICABLE,
  BOT_NOT_MEASURED as NOT_MEASURED,
  BOT_ROLE,
  createBotManifest,
  type BotCompletion,
  type BotManifest,
  type BotNetworkPath,
  type BotNetworkPathSource,
} from './botManifest';
import { BotMetrics, monotonicClock, type BotClock } from './botMetrics';
import { createBotSchedule, WS_BENCHMARK_ROSTER, type BotInputPattern, type BotSchedule } from './botInput';

/**
 * One headless bot process for the real-match server.
 *
 * The process opens one socket through the shared `SessionClientCore` and the
 * approved session envelope, joins exactly the requested player slots and
 * refuses to continue if the server grants anything else. It then drives the
 * deterministic input schedule for those slots and records only what it can
 * observe on its own socket. There is no browser, no rendering, no client
 * prediction and no local simulation step.
 *
 * Exit-worthy outcomes are `BotClientError`s with a stable reason; the CLI turns
 * one into a single stderr line and a non-zero exit code.
 */

export type BotFailureReason =
  | 'invalid-options'
  | 'connect-failed'
  | 'join-denied'
  | 'grant-mismatch'
  | 'unexpected-match-config'
  | 'timeout'
  | 'transport-closed'
  | 'transport-error'
  | 'protocol-error'
  | 'server-denial'
  | 'session-closed';

export class BotClientError extends Error {
  readonly reason: BotFailureReason;

  constructor(reason: BotFailureReason, message: string) {
    super(message);
    this.name = 'BotClientError';
    this.reason = reason;
  }
}

export type BotClientOptions = {
  /** Plain `ws://` only: the prototype has no TLS. */
  readonly url: string;
  /** Exactly the slots this process claims; one envelope may own up to four. */
  readonly playerIds: readonly string[];
  readonly pattern: BotInputPattern;
  /** Planned authoritative ticks counted from the first post-start tick. */
  readonly ticks: number;
  readonly seed?: number;
  readonly pingIntervalMs?: number;
  /** Whole-run hang guard. Never measured. */
  readonly timeoutMs: number;
  readonly maxLeadTicks?: number;
  readonly networkPath?: BotNetworkPath;
  readonly networkPathSource?: BotNetworkPathSource;
  /** Sanitised argv recorded in the manifest. */
  readonly cliArguments?: readonly string[];
  /** Only set when the operator explicitly agreed to record it. */
  readonly serverAddress?: string;
  readonly gitCommitSha?: string;
  readonly runId?: string;
  readonly clock?: BotClock;
  readonly onStatus?: (line: string) => void;
};

export type BotClientResult = {
  readonly manifest: BotManifest;
  readonly schedule: BotSchedule;
};

type CompletionEvent = { readonly status: BotCompletion; readonly tick: number };

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolveFn: (value: T) => void = () => undefined;
  let rejectFn: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
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

function errorOf(value: unknown): BotClientError {
  if (value instanceof BotClientError) return value;
  return new BotClientError('invalid-options', value instanceof Error ? value.message : String(value));
}

/** Waits for a close while clearing the guard timer, so no timer is leaked. */
async function waitForClose(closed: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      closed,
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function sameSlots(granted: readonly string[], requested: readonly string[]): boolean {
  if (granted.length !== requested.length) return false;
  const left = [...granted].sort();
  const right = [...requested].sort();
  return left.every((playerId, index) => playerId === right[index]);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackUrl(url: string): boolean {
  const host = hostOf(url);
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]' ||
    (host !== null && host.startsWith('127.'));
}

function currentCommitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  } catch {
    // A run from a tarball has no git metadata; say so instead of inventing one.
    return NOT_MEASURED;
  }
}

function assertOptions(options: BotClientOptions): void {
  if (typeof options?.url !== 'string' || !options.url.startsWith('ws://')) {
    throw new BotClientError(
      'invalid-options',
      'Bot requires a ws:// URL (TLS is not implemented in this prototype)',
    );
  }
  if (hostOf(options.url) === null) {
    throw new BotClientError('invalid-options', `Invalid WebSocket URL: ${options.url}`);
  }
  // The bot replays the BASE-4 benchmark fixture roster, so its slot bound is
  // that fixture's roster size, not the general MAX_PLAYERS match cap.
  if (!Array.isArray(options.playerIds) || options.playerIds.length < 1 ||
      options.playerIds.length > WS_BENCHMARK_ROSTER.length) {
    throw new BotClientError('invalid-options', `Bot requires 1..${WS_BENCHMARK_ROSTER.length} player slots`);
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new BotClientError('invalid-options', 'Invalid run timeout');
  }
  const pingIntervalMs = options.pingIntervalMs ?? 250;
  if (!Number.isSafeInteger(pingIntervalMs) || pingIntervalMs < 1 || pingIntervalMs > 60000) {
    throw new BotClientError('invalid-options', 'Invalid ping interval');
  }
  const maxLead = options.maxLeadTicks ?? 8;
  if (!Number.isSafeInteger(maxLead) || maxLead < 1 || maxLead > 120) {
    throw new BotClientError('invalid-options', 'Invalid input lead');
  }
}

/**
 * Joins, verifies the grant, plays the schedule and returns this bot's manifest.
 * The caller owns writing and naming the manifest file.
 */
export async function runBotClient(options: BotClientOptions): Promise<BotClientResult> {
  assertOptions(options);
  const status = options.onStatus ?? (() => undefined);
  const clock = options.clock ?? monotonicClock();
  const pingIntervalMs = options.pingIntervalMs ?? 250;
  const maxLead = options.maxLeadTicks ?? 8;
  const expected = [...options.playerIds];

  let schedule: BotSchedule;
  try {
    schedule = createBotSchedule({
      pattern: options.pattern,
      players: expected,
      ticks: options.ticks,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    });
  } catch (error) {
    throw new BotClientError('invalid-options', error instanceof Error ? error.message : String(error));
  }

  const loopback = isLoopbackUrl(options.url);
  const networkPath: BotNetworkPath = options.networkPath ?? (loopback ? 'loopback' : 'NOT_SUPPLIED');
  const networkPathSource: BotNetworkPathSource = options.networkPathSource ??
    (loopback ? 'loopback-url-default' : 'not-supplied');

  const metrics = new BotMetrics(clock);
  const joined = deferred<void>();
  const started = deferred<void>();
  const complete = deferred<CompletionEvent>();

  let session: NodeSession | null = null;
  let joinedState = false;
  let startedState = false;
  let completed = false;
  let nextToSend = 0;
  let firstTick = 0;
  let lastTickExclusive = options.ticks;
  let observedSnapshotHz: SnapshotHz | typeof NOT_MEASURED = NOT_MEASURED;
  let observedTickRate: number | typeof NOT_MEASURED = NOT_MEASURED;

  const fail = (error: unknown): void => {
    const failure = errorOf(error);
    joined.reject(failure);
    started.reject(failure);
    complete.reject(failure);
  };
  // A rejection that the current race has not observed yet must never surface as
  // an unhandled rejection.
  for (const pending of [joined.promise, started.promise, complete.promise]) {
    void pending.catch(() => undefined);
  }

  /** Records the completion exactly once and freezes the measured window. */
  const finishRun = (kind: BotCompletion, absoluteTick: number): void => {
    if (completed) return;
    completed = true;
    metrics.finish();
    complete.resolve({ status: kind, tick: absoluteTick });
  };

  const pump = (): void => {
    if (!joinedState || !startedState || completed || session === null) return;
    try {
      const serverTick = session.client.serverTick;
      const maxSend = Math.min(lastTickExclusive - 1, serverTick + maxLead - 1);
      while (nextToSend <= maxSend) {
        const index = nextToSend - firstTick;
        const inputs: PlayerInput[] = [];
        for (const playerId of expected) {
          const input = schedule.inputsByPlayer.get(playerId)?.[index];
          if (!input) throw new BotClientError(
            'invalid-options',
            `Input schedule for ${playerId} ended at index ${index}`,
          );
          inputs.push(input);
        }
        session.client.submitInput(nextToSend, inputs);
        metrics.noteInputSubmitted();
        nextToSend += 1;
      }
    } catch (error) {
      fail(error);
    }
  };

  const handlers: SessionClientHandlers = {
    onJoinResult: result => {
      if (completed) return;
      if (!result.accepted) {
        fail(new BotClientError('join-denied', `Join denied: ${result.code ?? 'unknown'}`));
        return;
      }
      if (!sameSlots(result.playerIds, expected)) {
        fail(new BotClientError(
          'grant-mismatch',
          `Server granted [${result.playerIds.join(', ')}] but the bot requested [${expected.join(', ')}]`,
        ));
        return;
      }
      if (joinedState) return;
      joinedState = true;
      joined.resolve();
    },
    onMatchStart: info => {
      if (completed || startedState) return;
      if (options.pattern === 'fixture' && info.startTick !== 0) {
        fail(new BotClientError(
          'unexpected-match-config',
          `The BASE-4 fixture starts at tick 0, but the server started at tick ${info.startTick}`,
        ));
        return;
      }
      if (info.tickRate !== TICK_RATE) {
        fail(new BotClientError(
          'unexpected-match-config',
          `Server announced ${info.tickRate} Hz but this prototype is ${TICK_RATE} Hz`,
        ));
        return;
      }
      firstTick = info.startTick;
      lastTickExclusive = firstTick + options.ticks;
      observedSnapshotHz = info.snapshotHz;
      observedTickRate = info.tickRate;
      startedState = true;
      status(`match started at tick ${firstTick} (${info.snapshotHz} Hz snapshots)`);
      started.resolve();
      pump();
    },
    onSnapshot: snapshot => {
      if (completed) return;
      metrics.noteSnapshot();
      if (startedState && snapshot.state.tick >= lastTickExclusive) {
        status(`tick bound reached at ${snapshot.state.tick - firstTick} authoritative ticks`);
        finishRun('tick-bound', snapshot.state.tick);
      }
    },
    onPong: sequence => {
      if (completed) return;
      metrics.notePong(sequence);
    },
    onError: error => {
      if (completed) return;
      metrics.noteDenial(error.code);
      if (!joinedState) {
        // Before a grant every denial rejects the join, whatever the code.
        fail(new BotClientError('join-denied', `Join denied: ${error.code}`));
        return;
      }
      // The match may end while our last inputs are still in flight; that is not
      // a driver failure, and the denial is recorded in the manifest.
      if (error.code === 'late-tick' || error.code === 'match-complete') return;
      fail(new BotClientError('server-denial', `Unexpected server denial: ${error.code}`));
    },
    onProtocolError: message => {
      if (completed) return;
      fail(new BotClientError('protocol-error', `Malformed server message: ${message}`));
    },
    onMatchEnd: tick => {
      if (completed) return;
      status(`authoritative match ended at tick ${tick}`);
      finishRun('completed-match', tick);
    },
    onRunComplete: tick => {
      if (completed) return;
      status(`server ended its bounded run at tick ${tick}`);
      finishRun('run-complete', tick);
    },
    onSessionClosed: reason => {
      if (completed) return;
      metrics.noteSessionClosed(reason);
      fail(new BotClientError('session-closed', `Session closed before completion: ${reason}`));
    },
    onTransportClosed: () => {
      if (completed) return;
      metrics.noteTransportClosed();
      fail(new BotClientError('transport-closed', 'WebSocket closed before the run completed'));
    },
    onTransportError: message => {
      if (completed) return;
      metrics.noteTransportError();
      fail(new BotClientError('transport-error', `WebSocket error: ${message}`));
    },
  };

  let pumpTimer: ReturnType<typeof setInterval> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    try {
      session = await openNodeSession({
        url: options.url,
        handlers,
        openTimeoutMs: Math.min(options.timeoutMs, 10000),
        onWireMessage: event => {
          if (event.direction === 'in') metrics.noteInbound(event.bytes);
          else metrics.noteOutbound(event.bytes);
        },
      });
    } catch (error) {
      throw new BotClientError(
        'connect-failed',
        `Could not connect to the match server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    metrics.start();
    const activeSession = session;

    timeoutTimer = setTimeout(() => {
      fail(new BotClientError(
        'timeout',
        `Bot ${expected.join(',')} did not finish within ${options.timeoutMs} ms ` +
        `(joined=${joinedState}, started=${startedState}, next=${nextToSend}, ` +
        `serverTick=${activeSession.client.serverTick})`,
      ));
    }, options.timeoutMs);

    activeSession.client.join(expected);
    await Promise.race([joined.promise, complete.promise]);
    status(`server granted exactly ${expected.join(', ')}`);

    pingTimer = setInterval(() => {
      if (completed || session === null) return;
      try {
        metrics.notePing(session.client.ping());
      } catch {
        // A closed transport is reported by its own handler.
      }
    }, pingIntervalMs);

    await Promise.race([started.promise, complete.promise]);
    pumpTimer = setInterval(pump, 5);
    pump();

    const completion = await complete.promise;
    const achieved = Math.max(0, completion.tick - firstTick);

    const manifest = createBotManifest({
      runId: options.runId ?? `bot-${expected.join('-')}-${Date.now()}`,
      provenance: {
        command: BOT_COMMAND,
        cliArguments: [...(options.cliArguments ?? [])],
        role: BOT_ROLE,
        pattern: options.pattern,
        playerIds: [...expected],
        plannedTicks: options.ticks,
        achievedTicks: achieved,
        seed: schedule.seed,
        fixtureSha256: schedule.fixtureSha256 ?? BOT_FIXTURE_NOT_APPLICABLE,
        scheduleSha256: schedule.scheduleSha256,
        networkPath,
        networkPathSource,
        serverAddress: options.serverAddress ?? BOT_ADDRESS_NOT_RECORDED,
        snapshotHz: observedSnapshotHz,
        serverTickRate: observedTickRate,
        pingIntervalMs,
        nodeVersion: process.version,
        platform: process.platform,
        osRelease: osRelease(),
        architecture: process.arch,
        gitCommitSha: options.gitCommitSha ?? currentCommitSha(),
      },
      metrics: metrics.build(),
      result: { status: completion.status, finalTick: achieved },
    });
    const bandwidth = manifest.metrics.bandwidth;
    status(
      `finished after ${achieved} ticks; ` +
      (bandwidth.status === 'MEASURED'
        ? `${bandwidth.sentBytes} bytes sent, ${bandwidth.receivedBytes} bytes received`
        : 'no bandwidth sample'),
    );
    return { manifest, schedule };
  } finally {
    if (pumpTimer) clearInterval(pumpTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (session !== null) {
      const activeSession = session;
      try {
        activeSession.close();
      } catch {
        // Already closed.
      }
      await waitForClose(activeSession.closed, 1000);
    }
  }
}

/** A short, single-line diagnostic for the CLI; never multi-line stack noise. */
export function describeBotFailure(error: unknown): { reason: string; message: string } {
  if (error instanceof BotClientError) return { reason: error.reason, message: error.message };
  return { reason: 'unexpected', message: error instanceof Error ? error.message : String(error) };
}
