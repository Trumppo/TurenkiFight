import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import WebSocket from 'ws';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';
import { inMemoryReferenceFingerprints } from '../benchmarks/ws/benchmarkSetup';
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
 * unexpected extra connection.
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
const FULL_TICKS = 7200;
const FULL_FINAL_STATE_SHA256 = 'de544fcd7fae1bd2c25fd8ccf97ed7fb315014adafd692d45577913a01dff150';
const FULL_ORDERED_EVENTS_SHA256 = '5bb44bd6fc1173ab0b2a3d45c9662f65ad84b6619acd403a57d269108a11ebd5';

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

afterEach(() => {
  for (const session of openSessions.splice(0)) {
    try {
      session.close();
    } catch {
      // Already closed.
    }
  }
});

async function rawSession(url: string): Promise<NodeSession> {
  const session = await openNodeSession({ url });
  openSessions.push(session);
  return session;
}

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
