import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import WebSocket from 'ws';
import { encodeClientEnvelope } from '../src/game/session/sessionEnvelope';
import { AuthoritativeWsSession } from '../server/ws/authoritativeWsSession';
import {
  startWsServer,
  type WsServerEnvelopeEvent,
  type WsServerHandle,
} from '../server/ws/wsServer';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';
import { inMemoryReferenceFingerprints, loadWsBenchmarkSchedule } from '../benchmarks/ws/benchmarkSetup';
import {
  runClientRole,
  runServerRole,
  type ClientRoleResult,
  type ServerRoleOptions,
  type ServerRoleResult,
} from '../benchmarks/ws/splitRoles';
import { validateWsPrototypeManifest, type WsPrototypeManifest } from '../benchmarks/ws/wsManifest';

/**
 * Split-role coverage for the networkable WebSocket benchmark.
 *
 * The core test runs the server role and four client roles over a real socket
 * on an ephemeral loopback port and pins the same 7200-tick fingerprints as the
 * single-process benchmark and the WebRTC prototype. Negative tests cover a
 * missing client, a roster spread over the wrong number of connections and an
 * unexpected extra connection. Denial-audit tests prove room-level denials
 * (`not-started`, `unknown-player`, `session-closed`) reach the observer and are
 * counted with gateway-level denials.
 *
 * Nothing here measures latency, bandwidth, CPU or tick pacing, and a split
 * loopback run is not LAN or internet evidence.
 */

const ROOT = process.cwd();
const VITE_NODE = resolve(ROOT, 'node_modules/vite-node/vite-node.mjs');
const SCRIPT = 'benchmarks/ws/runWsBenchmark.ts';
const PLAYERS = ['P1', 'P2', 'P3', 'P4'] as const;
const COMMIT = 'd'.repeat(40);

// Pinned BASE-4-60-20 fingerprints, identical to the full-length WS/WebRTC runs.
// M11 (hit stop + knockback) changed both result pins. M12 items changed the
// final state pin again because the state now carries deterministic ground
// bottles; no fixture input sets `grab`, so the event stream is unchanged.
//   previous state 160db4542beeff43e4a44c4ddca9123bfefc9ca7a423b243f6d941b7d8541732
const FULL_TICKS = 7200;
const FULL_FINAL_STATE_SHA256 = '4f5a81d3ab8cd87e4baf710305e030840680865d114623ee198435ceaf795aba';
const FULL_ORDERED_EVENTS_SHA256 = 'b74691a838f7548b132b9b9eb9e8d418efbef005bf8aaae3268e9f15741232b6';

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

function baseServerOptions(overrides: Partial<ServerRoleOptions> = {}): ServerRoleOptions {
  return {
    host: '127.0.0.1',
    port: 0,
    ticks: 300,
    snapshotHz: 20,
    tickMode: 'manual',
    timeoutMs: 60000,
    commitSha: COMMIT,
    runId: `ws-split-test-${process.pid}`,
    writeManifest: false,
    ...overrides,
  };
}

type StartedServer = {
  url: string;
  result: Promise<ServerRoleResult>;
};

/**
 * Starts the server role and resolves its connect URL. A binding failure is
 * returned as a rejection, so the caller can skip the test like the existing
 * socket tests do.
 */
async function startServer(ctx: TestContext, overrides: Partial<ServerRoleOptions> = {}): Promise<StartedServer> {
  const ready = deferred<string>();
  const result = runServerRole(baseServerOptions({
    ...overrides,
    onReady: info => {
      if (info.url !== null) ready.resolve(info.url);
    },
  }));
  // The caller always awaits this promise; attach a handler so a failure while
  // another await is pending cannot become an unhandled rejection.
  void result.catch(() => undefined);
  let url: string;
  try {
    url = await Promise.race([
      ready.promise,
      result.then(
        () => Promise.reject(new Error('Server role ended before printing a ready line')),
        (error: unknown) => Promise.reject(error),
      ),
    ]);
  } catch (error) {
    const code = bindingFailure(error);
    ctx.skip(code === null
      ? `Local WebSocket server could not start: ${error instanceof Error ? error.message : String(error)}`
      : `Local WebSocket binding unavailable (${code})`);
    throw error;
  }
  return { url, result };
}

const openSessions: NodeSession[] = [];
const openServers: WsServerHandle[] = [];

afterEach(async () => {
  for (const session of openSessions.splice(0)) {
    try {
      session.close();
    } catch {
      // Already closed.
    }
  }
  for (const server of openServers.splice(0)) {
    await server.close();
  }
});

async function rawSession(url: string): Promise<NodeSession> {
  const session = await openNodeSession({ url });
  openSessions.push(session);
  return session;
}

async function waitFor<T>(
  label: string,
  check: () => T | undefined | false,
  timeoutMs = 5000,
): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
  }
}

const controls = (playerId: string) => ({ playerId, moveX: 1 as const, moveY: 0 as const, jump: false });

describe('M2 split WebSocket benchmark roles', () => {
  it('reproduces the pinned 7200-tick fingerprints through separate roles', async (ctx: TestContext) => {
    const server = await startServer(ctx, { ticks: FULL_TICKS, timeoutMs: 90000 });

    const clientResults: PromiseSettledResult<ClientRoleResult>[] = await Promise.allSettled(
      PLAYERS.map(playerId => runClientRole({
        url: server.url,
        playerId,
        ticks: FULL_TICKS,
        timeoutMs: 90000,
      })),
    );
    const roleResult = await server.result;

    const rejected = clientResults.filter(entry => entry.status === 'rejected');
    expect(rejected).toEqual([]);
    const clients = clientResults.map(entry => (entry as PromiseFulfilledResult<ClientRoleResult>).value);
    expect(clients.map(client => client.playerId).sort()).toEqual([...PLAYERS].sort());
    for (const client of clients) {
      expect(client.finalTick).toBe(FULL_TICKS);
      expect(client.submittedTicks).toBe(FULL_TICKS);
      expect(client.deniedMessages).toBe(0);
      expect(client.lateTicks).toBe(0);
    }

    const manifest = roleResult.manifest;
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.topology).toEqual({
      role: 'server-coordinator',
      mode: 'network',
      bindHostProvided: true,
      bindPortProvided: true,
      clientCount: 4,
      clientsInProcess: false,
      tls: false,
    });
    expect(manifest.environment.bindAddress).toBe('NOT_RECORDED');
    expect(manifest.tickMode).toBe('manual');
    expect(manifest.pacing).toBe('unsynchronized-correctness');
    expect(manifest.correctness.finalTick).toBe(FULL_TICKS);
    expect(manifest.correctness.matchesInMemoryReference).toBe(true);
    expect(manifest.correctness.lateTicks).toBe(0);
    expect(manifest.correctness.deniedMessages).toBe(0);
    // Accepted observations are pinned: four accepted joins plus one accepted
    // fixture input per player per tick. The denial audit must not add, drop or
    // duplicate an accepted event, so this count is identical to the run on
    // 1f5aff9.
    expect(roleResult.acceptedMessages).toBe(PLAYERS.length + PLAYERS.length * FULL_TICKS);
    expect(roleResult.deniedBySource).toEqual({ gateway: 0, room: 0 });
    // The split path must reproduce the same pinned fingerprints as the
    // single-process loopback and WebRTC prototype runs.
    expect(manifest.correctness.finalStateSha256).toBe(FULL_FINAL_STATE_SHA256);
    expect(manifest.correctness.orderedEventsSha256).toBe(FULL_ORDERED_EVENTS_SHA256);
    const reference = inMemoryReferenceFingerprints(FULL_TICKS);
    expect(manifest.correctness.referenceFinalStateSha256).toBe(reference.finalStateSha256);
    expect(manifest.correctness.referenceOrderedEventsSha256).toBe(reference.orderedEventsSha256);
    // A split run still measures nothing.
    expect(manifest.result).toBe('NOT_MEASURED');
    expect(manifest.measurements).toEqual({
      latency: 'NOT_MEASURED',
      bandwidth: 'NOT_MEASURED',
      cpu: 'NOT_MEASURED',
      tickPacing: 'NOT_MEASURED',
    });
    // The network manifest never contains the bind URL or address.
    expect(JSON.stringify(manifest)).not.toContain('ws://');
    expect(JSON.stringify(manifest)).not.toContain('127.0.0.1');
  }, 180000);

  it('fails with an explicit bounded error when a client never joins', async (ctx: TestContext) => {
    const started = Date.now();
    const server = await startServer(ctx, { ticks: 60, timeoutMs: 1200 });
    for (const playerId of ['P1', 'P2', 'P3']) {
      const session = await rawSession(server.url);
      session.client.join([playerId]);
    }

    await expect(server.result).rejects.toThrow(/Timed out waiting for the roster: 3\/4 player slots/);
    expect(Date.now() - started).toBeLessThan(15000);
  }, 30000);

  it('fails fast when the roster is spread over too few connections', async (ctx: TestContext) => {
    const server = await startServer(ctx, { ticks: 60, timeoutMs: 5000 });
    // Three connections claim all four slots; the coordinator expects one slot
    // per client connection and must reject the roster instead of starting.
    const claims: string[][] = [['P1', 'P2'], ['P3'], ['P4']];
    for (const playerIds of claims) {
      const session = await rawSession(server.url);
      session.client.join(playerIds);
    }

    await expect(server.result).rejects.toThrow(/Expected 4 client connections, received 3/);
  }, 30000);

  it('rejects an unexpected extra connection without corrupting the run', async (ctx: TestContext) => {
    let extraCloseCode: number | null = null;
    const server = await startServer(ctx, {
      ticks: 300,
      timeoutMs: 60000,
      onRosterComplete: async () => {
        // The roster is complete and the match has not started: a fifth socket
        // must be closed by the transport before it can register or join.
        const extra = new WebSocket(server.url);
        extraCloseCode = await new Promise<number>((resolveClose, rejectClose) => {
          extra.on('close', code => resolveClose(code));
          extra.on('error', error => rejectClose(error instanceof Error ? error : new Error(String(error))));
        });
      },
    });

    const clientResults = await Promise.allSettled(PLAYERS.map(playerId => runClientRole({
      url: server.url,
      playerId,
      ticks: 300,
      timeoutMs: 60000,
    })));
    const roleResult = await server.result;

    expect(extraCloseCode).toBe(1008);
    expect(clientResults.every(entry => entry.status === 'fulfilled')).toBe(true);
    expect(roleResult.manifest.correctness.finalTick).toBe(300);
    expect(roleResult.manifest.correctness.matchesInMemoryReference).toBe(true);
    expect(roleResult.manifest.correctness.deniedMessages).toBe(0);
    expect(roleResult.manifest.correctness.lateTicks).toBe(0);
    expect(roleResult.manifest.topology.clientCount).toBe(4);
  }, 60000);

  it('runs the server and client CLIs as separate processes over loopback', async (ctx: TestContext) => {
    const ticks = 120;
    const outPath = join(tmpdir(), `tf-ws-split-${process.pid}-${Date.now()}.json`);
    const children: ChildProcess[] = [];
    try {
      const server = spawnRunner([
        '--mode=server',
        '--host=127.0.0.1',
        '--port=0',
        `--ticks=${ticks}`,
        '--tick-mode=manual',
        `--out=${outPath}`,
      ]);
      children.push(server.child);
      const ready = await waitForReadyLine(server, 60000);
      expect(ready.kind).toBe('ws-benchmark-server-ready');
      expect(typeof ready.url).toBe('string');

      const clients = PLAYERS.map(playerId => spawnRunner([
        '--mode=client',
        `--url=${String(ready.url)}`,
        `--player=${playerId}`,
        `--ticks=${ticks}`,
        '--tick-mode=manual',
      ]));
      children.push(...clients.map(client => client.child));

      const [serverOutcome, ...clientOutcomes] = await Promise.all([
        server.output,
        ...clients.map(client => client.output),
      ]);
      if (serverOutcome.code !== 0) {
        throw new Error(`server process failed: ${serverOutcome.stderr || serverOutcome.stdout}`);
      }
      for (const outcome of clientOutcomes) {
        if (outcome.code !== 0) throw new Error(`client process failed: ${outcome.stderr || outcome.stdout}`);
      }

      const resultLine = serverOutcome.stdout
        .split(/\r?\n/)
        .filter(line => line.includes('ws-benchmark-server-result'))
        .map(line => JSON.parse(line) as { manifest?: string; topology?: unknown })
        .find(entry => entry.manifest !== undefined);
      expect(resultLine?.manifest).toBe(outPath);

      const manifest = JSON.parse(readFileSync(outPath, 'utf8')) as unknown;
      validateWsPrototypeManifest(manifest);
      const typed = manifest as WsPrototypeManifest;
      const reference = inMemoryReferenceFingerprints(ticks);
      expect(typed.topology.role).toBe('server-coordinator');
      expect(typed.topology.mode).toBe('network');
      expect(typed.correctness.finalTick).toBe(ticks);
      expect(typed.correctness.finalStateSha256).toBe(reference.finalStateSha256);
      expect(typed.correctness.orderedEventsSha256).toBe(reference.orderedEventsSha256);
      expect(typed.result).toBe('NOT_MEASURED');
      for (const measurement of Object.values(typed.measurements)) {
        expect(measurement).toBe('NOT_MEASURED');
      }
    } catch (error) {
      const code = bindingFailure(error);
      if (code !== null || /EADDR|EACCES|EPERM|spawn/.test(String(error))) {
        ctx.skip(`Local process/WebSocket run unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      throw error;
    } finally {
      for (const child of children) {
        if (child.exitCode === null && !child.killed) {
          try {
            child.kill();
          } catch {
            // Already gone.
          }
        }
      }
    }
  }, 180000);
});

describe('M2 split benchmark denial audit', () => {
  it('surfaces room-level and gateway-level denials to the transport observer', async (ctx: TestContext) => {
    const events: WsServerEnvelopeEvent[] = [];
    let server: WsServerHandle;
    try {
      server = await startWsServer({
        port: 0,
        host: '127.0.0.1',
        tickMode: 'manual',
        snapshotHz: 20,
        startDelayMs: 0,
        firstTickDelayMs: 0,
        onClientEnvelope: event => events.push(event),
      });
      openServers.push(server);
    } catch (error) {
      const code = bindingFailure(error);
      ctx.skip(code === null
        ? `Local WebSocket server could not start: ${error instanceof Error ? error.message : String(error)}`
        : `Local WebSocket binding unavailable (${code})`);
      return;
    }
    const url = `ws://127.0.0.1:${server.port}`;

    // Room-level denial: an input before the match is running never reaches the
    // gateway and still has to be visible to the audit.
    const early = await rawSession(url);
    early.client.join(['P1']);
    await waitFor('P1 join', () => early.client.sessionState === 'joined');
    early.client.submitInput(0, [controls('P1')]);
    await waitFor('not-started denial', () => events.some(event => !event.accepted && event.code === 'not-started'));

    // Room-level denial: a join claim outside the configured roster.
    const rogue = await rawSession(url);
    rogue.client.join(['P9']);
    await waitFor('unknown-player denial', () =>
      events.some(event => !event.accepted && event.code === 'unknown-player'));

    // Gateway-level denial: a ping from a connection the gateway never joined.
    rogue.sendRaw(encodeClientEnvelope({ version: 1, kind: 'ping', sequence: 1 }));
    await waitFor('not-joined denial', () => events.some(event => !event.accepted && event.code === 'not-joined'));

    const denials = events.filter(event => !event.accepted);
    expect(denials).toHaveLength(3);
    expect(denials).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'not-started', source: 'room' }),
      expect.objectContaining({ code: 'unknown-player', source: 'room' }),
      expect.objectContaining({ code: 'not-joined', source: 'gateway' }),
    ]));
    // Accepted observations are unchanged: only P1's join was accepted, and no
    // denial is duplicated or re-emitted as an accepted event.
    const accepted = events.filter(event => event.accepted);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ kind: 'join-request', playerIds: ['P1'] });
    expect(server.room.playerCount).toBe(1);
    expect(server.room.phase).toBe('lobby');
  }, 30000);

  it('counts a room-level denial in the coordinator manifest audit', async (ctx: TestContext) => {
    const ticks = 60;
    const { schedule } = loadWsBenchmarkSchedule(ticks);
    const joined = deferred<void>();
    const notStarted = deferred<void>();
    const ready = deferred<NodeSession>();
    const deniedCodes: string[] = [];
    let session: NodeSession | null = null;
    let started = false;
    let nextToSend = 0;

    const pump = (): void => {
      if (!started || session === null) return;
      const maxSend = Math.min(ticks - 1, session.client.serverTick + 7);
      while (nextToSend <= maxSend) {
        const input = schedule[nextToSend].find(candidate => candidate.playerId === 'P4');
        if (!input) throw new Error('Fixture lost P4 input');
        session.client.submitInput(nextToSend, [input]);
        nextToSend += 1;
      }
    };

    const server = await startServer(ctx, {
      ticks,
      timeoutMs: 60000,
      onRosterComplete: async () => {
        const active = await ready.promise;
        // The raw client must have seen its accepted join before it can submit.
        await Promise.race([
          joined.promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('P4 join was not acknowledged')), 5000)),
        ]);
        // Deliberate room-level denial: the match is still `starting`, so any
        // input is rejected with `not-started` before the gateway sees it.
        active.client.submitInput(0, [schedule[0].find(candidate => candidate.playerId === 'P4')!]);
        await Promise.race([
          notStarted.promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('not-started denial did not arrive')), 5000)),
        ]);
      },
    });

    session = await openNodeSession({
      url: server.url,
      handlers: {
        onJoinResult: result => {
          if (result.accepted) joined.resolve();
          else joined.reject(new Error(`P4 join denied: ${result.code ?? 'unknown'}`));
        },
        onMatchStart: () => {
          started = true;
          pump();
        },
        onSnapshot: () => pump(),
        onError: error => {
          deniedCodes.push(error.code);
          if (error.code === 'not-started') notStarted.resolve();
        },
      },
    });
    openSessions.push(session);
    ready.resolve(session);
    session.client.join(['P4']);

    const clients = await Promise.allSettled(
      ['P1', 'P2', 'P3'].map(playerId => runClientRole({ url: server.url, playerId, ticks, timeoutMs: 60000 })),
    );
    const roleResult = await server.result;

    expect(clients.every(entry => entry.status === 'fulfilled')).toBe(true);
    expect(deniedCodes.filter(code => code === 'not-started')).toHaveLength(1);
    expect(roleResult.manifest.correctness.deniedMessages).toBe(1);
    expect(roleResult.deniedBySource).toEqual({ gateway: 0, room: 1 });
    expect(roleResult.acceptedMessages).toBe(PLAYERS.length + PLAYERS.length * ticks);
    expect(roleResult.manifest.correctness.lateTicks).toBe(0);
    expect(roleResult.manifest.correctness.matchesInMemoryReference).toBe(true);
    const reference = inMemoryReferenceFingerprints(ticks);
    expect(roleResult.manifest.correctness.finalStateSha256).toBe(reference.finalStateSha256);
    expect(roleResult.manifest.correctness.orderedEventsSha256).toBe(reference.orderedEventsSha256);
  }, 60000);

  it('surfaces the defensive session-closed room denial without changing the client-visible result', () => {
    const events: string[] = [];
    const room = new AuthoritativeWsSession({
      onOutgoing: (_target, message) => events.push(
        `out:${message.kind}${message.kind === 'error' ? `:${message.code}` : ''}`,
      ),
      onRoomDenial: (connectionId, code) => events.push(`denied:${connectionId}:${code}`),
    });
    room.addConnection('conn-1');
    // `close()` clears connections before setting the phase, so the transport
    // cannot reach this defensive branch today. Pin it directly so a future
    // lifecycle change cannot silently drop `session-closed` from the audit.
    (room as unknown as { phaseValue: string }).phaseValue = 'closed';
    const result = room.handleMessage('conn-1', encodeClientEnvelope({
      version: 1,
      kind: 'ping',
      sequence: 1,
    }));
    // The authority decision, return value and client-visible error are
    // unchanged; the observation happens after the error is emitted.
    expect(result).toBeNull();
    expect(events).toEqual(['out:welcome', 'out:error:session-closed', 'denied:conn-1:session-closed']);
  });
});

type Runner = {
  child: ChildProcess;
  output: Promise<{ code: number | null; stdout: string; stderr: string }>;
  stdout: () => string;
  stderr: () => string;
  spawnError: () => Error | null;
};

function spawnRunner(args: string[]): Runner {
  const child = spawn(process.execPath, [VITE_NODE, SCRIPT, ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let spawnError: Error | null = null;
  child.stdout?.on('data', chunk => { stdout += String(chunk); });
  child.stderr?.on('data', chunk => { stderr += String(chunk); });
  child.on('error', error => { spawnError = error; });
  const output = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveOutput, rejectOutput) => {
    child.on('error', rejectOutput);
    child.on('close', code => resolveOutput({ code, stdout, stderr }));
  });
  return {
    child,
    output,
    stdout: () => stdout,
    stderr: () => stderr,
    spawnError: () => spawnError,
  };
}

async function waitForReadyLine(
  runner: Runner,
  timeoutMs: number,
): Promise<{ kind: string; url?: unknown; port?: unknown }> {
  const startedAt = Date.now();
  for (;;) {
    for (const line of runner.stdout().split(/\r?\n/)) {
      if (!line.includes('ws-benchmark-server-ready')) continue;
      return JSON.parse(line) as { kind: string; url?: unknown; port?: unknown };
    }
    const spawnError = runner.spawnError();
    if (spawnError !== null) throw spawnError;
    if (runner.child.exitCode !== null) {
      throw new Error(`Server process exited before printing a ready line: ${runner.stderr()}`);
    }
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for the server ready line');
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
}
