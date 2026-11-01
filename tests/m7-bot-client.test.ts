import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { encodeWsServerMessage, type WsServerMessage } from '../src/game/networking/wsMessages';
import { startMatchServer, type MatchServerHandle } from '../server/ws/matchServer';
import { startWsServer, type WsServerHandle } from '../server/ws/wsServer';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';
import { BotClientError, runBotClient, type BotClientResult } from '../benchmarks/bot/botClient';
import { BotMetrics, type BotMetricsSnapshot } from '../benchmarks/bot/botMetrics';
import {
  BOT_CLIENT_VIEW_NOTE,
  BOT_COMMAND,
  BOT_NO_PREDICTION_NOTE,
  createBotManifest,
  validateBotManifest,
  writeBotManifest,
  type BotManifest,
} from '../benchmarks/bot/botManifest';
import { createBotSchedule } from '../benchmarks/bot/botInput';
import { botUsage, manifestArguments, parseBotArgs, runBot } from '../benchmarks/bot/runBot';
import { defaultRunTimeoutMs, loadWsBenchmarkSchedule } from '../benchmarks/ws/benchmarkSetup';

/**
 * M7 bot client coverage.
 *
 * Positive cases use a real `startMatchServer` (real 60 Hz interval loop, real
 * sockets) and real bot runs in this process. Negative cases use a fake or a
 * single-purpose server so a wrong grant, a duplicate slot and a refused
 * connection are reproducible in bounded time.
 */

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(label: string, check: () => boolean, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await delay(5);
  }
}

function bindingFailure(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  if (code && ['EACCES', 'EPERM', 'EADDRINUSE', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return code;
  }
  return null;
}

/** Node timers active in this process; used to prove the bot leaks none. */
function activeTimeoutCount(): number | null {
  const resources = (process as unknown as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo;
  if (typeof resources !== 'function') return null;
  return resources.call(process).filter(entry => entry === 'Timeout').length;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

const openServers: MatchServerHandle[] = [];
const openWsServers: WsServerHandle[] = [];
const openClients: NodeSession[] = [];
const openFakeServers: FakeServer[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const client of openClients.splice(0)) {
    try {
      client.close();
    } catch {
      // Already closed by the session.
    }
  }
  for (const server of openFakeServers.splice(0)) await server.close();
  for (const server of openWsServers.splice(0)) await server.close();
  for (const server of openServers.splice(0)) await server.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempManifestPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'turenkifight-bot-'));
  tempDirs.push(dir);
  return join(dir, 'bot-manifest.json');
}

type FakeServer = { url: string; close: () => Promise<void> };

/** Minimal server double: enough of the message schema to answer a join. */
async function startFakeServer(joinResult: (requested: readonly string[]) => WsServerMessage): Promise<FakeServer> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  const sockets = new Set<WebSocket>();
  wss.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.send(encodeWsServerMessage({
      version: 1,
      kind: 'welcome',
      connectionId: 'conn-1',
      roomId: 'match',
    }));
    socket.on('message', raw => {
      let header: { kind?: string; playerIds?: string[]; sequence?: number };
      try {
        header = JSON.parse(raw.toString()) as typeof header;
      } catch {
        return;
      }
      if (header.kind === 'join-request') {
        socket.send(encodeWsServerMessage(joinResult(header.playerIds ?? [])));
      }
      if (header.kind === 'ping' && typeof header.sequence === 'number') {
        socket.send(encodeWsServerMessage({ version: 1, kind: 'pong', sequence: header.sequence }));
      }
    });
  });
  const address = wss.address() as AddressInfo;
  const handle: FakeServer = {
    url: `ws://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
    },
  };
  openFakeServers.push(handle);
  return handle;
}

function skipIfUnbindable(ctx: TestContext, error: unknown): void {
  const code = bindingFailure(error);
  ctx.skip(code === null
    ? `Local WebSocket server could not start: ${error instanceof Error ? error.message : String(error)}`
    : `Local WebSocket binding unavailable (${code})`);
}

describe('M7 bot client: real match server', () => {
  it('plays three bots plus a fourth client to the tick bound with zero denials', async (ctx: TestContext) => {
    const rejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      let server: MatchServerHandle;
      try {
        server = await startMatchServer({
          host: '127.0.0.1',
          port: 0,
          snapshotHz: 20,
          startDelayMs: 0,
          // One delivery window so the bots can submit their first inputs.
          firstTickDelayMs: 100,
        });
        openServers.push(server);
      } catch (error) {
        skipIfUnbindable(ctx, error);
        return;
      }

      const url = `ws://127.0.0.1:${server.port}`;
      let humanSnapshots = 0;
      let firstPositions: Record<string, number> | null = null;
      let lastPositions: Record<string, number> | null = null;
      const humanErrors: string[] = [];
      const humanJoined = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('human join timed out')), 5000);
        const settle = (error?: Error): void => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        void (async () => {
          try {
            const human = await openNodeSession({
              url,
              handlers: {
                onJoinResult: result => result.accepted
                  ? settle()
                  : settle(new Error(`human join denied: ${result.code ?? 'unknown'}`)),
                onSnapshot: snapshot => {
                  humanSnapshots += 1;
                  const positions = Object.fromEntries(
                    snapshot.state.fighters.map(fighter => [fighter.id, fighter.x]),
                  );
                  if (firstPositions === null) firstPositions = positions;
                  lastPositions = positions;
                },
                onError: error => humanErrors.push(error.code),
              },
            });
            openClients.push(human);
            human.client.join(['P1']);
          } catch (error) {
            settle(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      });
      await humanJoined;

      const bots: BotClientResult[] = await Promise.all(
        ['P2', 'P3', 'P4'].map((playerId, index) => runBotClient({
          url,
          playerIds: [playerId],
          pattern: 'wander',
          seed: 101 + index * 101,
          ticks: 180,
          timeoutMs: 20000,
          cliArguments: [
            '--url=<redacted>',
            `--players=${playerId}`,
            '--pattern=wander',
            `--ticks=180`,
            `--seed=${101 + index * 101}`,
          ],
        })),
      );

      expect(server.room.tick).toBeGreaterThanOrEqual(180);
      expect(humanSnapshots).toBeGreaterThan(0);
      // The wander inputs really move fighters: the human sees positions change.
      expect(firstPositions).not.toBeNull();
      expect(lastPositions).not.toBeNull();
      const moved = Object.keys(firstPositions ?? {}).some(
        playerId => (lastPositions as Record<string, number> | null)?.[playerId] !==
          (firstPositions as Record<string, number>)[playerId],
      );
      expect(moved).toBe(true);
      expect(humanErrors).toEqual([]);
      expect(rejections).toEqual([]);

      const seen = new Set<string>();
      for (const { manifest } of bots) {
        // Throws on any dishonest or inconsistent field.
        validateBotManifest(manifest);
        seen.add(manifest.provenance.playerIds[0]);
        expect(manifest.provenance.role).toBe('bot-client');
        expect(manifest.provenance.pattern).toBe('wander');
        expect(manifest.provenance.plannedTicks).toBe(180);
        expect(manifest.provenance.achievedTicks).toBeGreaterThanOrEqual(180);
        expect(manifest.provenance.snapshotHz).toBe(20);
        expect(manifest.provenance.serverTickRate).toBe(60);
        expect(manifest.provenance.nodeVersion).toBe(process.version);
        expect(manifest.provenance.scheduleSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(manifest.provenance.fixtureSha256).toBe('NOT_APPLICABLE');
        expect(manifest.provenance.serverAddress).toBe('NOT_RECORDED');
        expect(manifest.provenance.networkPath).toBe('loopback');
        expect(manifest.result.status).toBe('tick-bound');

        expect(manifest.metrics.inputs.submitted).toBe(180);
        expect(manifest.metrics.inputs.denied).toBe(0);
        expect(manifest.metrics.inputs.accepted).toBe(180);
        expect(manifest.metrics.inputs.lateTicks).toBe(0);
        expect(manifest.metrics.inputs.denials).toEqual({});
        expect(manifest.metrics.disconnects).toEqual({
          observed: 0,
          sessionClosedReasons: [],
          transportClosed: false,
          transportErrors: 0,
        });

        const rtt = manifest.metrics.rtt;
        expect(rtt.status).toBe('MEASURED');
        if (rtt.status === 'MEASURED') expect(rtt.sampleCount).toBeGreaterThan(0);
        const gaps = manifest.metrics.snapshotInterArrival;
        expect(gaps.status).toBe('MEASURED');
        if (gaps.status === 'MEASURED') expect(gaps.sampleCount).toBeGreaterThan(0);
        const bandwidth = manifest.metrics.bandwidth;
        expect(bandwidth.status).toBe('MEASURED');
        if (bandwidth.status === 'MEASURED') {
          expect(bandwidth.sentBytes).toBeGreaterThan(0);
          expect(bandwidth.receivedBytes).toBeGreaterThan(0);
          expect(bandwidth.windowMs).toBeGreaterThan(0);
        }

        // The manifest must not disclose where the server is.
        const text = JSON.stringify(manifest);
        expect(text).not.toContain('127.0.0.1');
        expect(text).not.toContain(String(server.port));
      }
      expect([...seen].sort()).toEqual(['P2', 'P3', 'P4']);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  }, 60000);

  it('drives two slots from one socket and releases every timer', async (ctx: TestContext) => {
    const before = activeTimeoutCount();
    let server: MatchServerHandle;
    try {
      server = await startMatchServer({
        host: '127.0.0.1',
        port: 0,
        playerIds: ['P1', 'P2'],
        snapshotHz: 20,
        startDelayMs: 0,
        firstTickDelayMs: 100,
      });
    } catch (error) {
      skipIfUnbindable(ctx, error);
      return;
    }

    let result: BotClientResult;
    try {
      result = await runBotClient({
        url: `ws://127.0.0.1:${server.port}`,
        playerIds: ['P1', 'P2'],
        pattern: 'wander',
        seed: 7,
        ticks: 30,
        timeoutMs: 15000,
      });
    } finally {
      await server.close();
    }

    validateBotManifest(result.manifest);
    expect(result.manifest.provenance.playerIds).toEqual(['P1', 'P2']);
    expect(result.manifest.result.status).toBe('tick-bound');
    expect(result.manifest.metrics.inputs.submitted).toBe(30);
    expect(result.manifest.metrics.inputs.accepted).toBe(30);
    expect(result.manifest.metrics.inputs.denied).toBe(0);

    await delay(100);
    if (before !== null) expect(activeTimeoutCount()).toBeLessThanOrEqual(before);
  }, 30000);
});

describe('M7 bot client: failure paths', () => {
  it('refuses a wrong grant, exits 1 and writes no manifest', async () => {
    const fake = await startFakeServer(() => ({
      version: 1,
      kind: 'join-result',
      accepted: true,
      playerIds: ['P1'],
    }));
    const out = tempManifestPath();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runBot(
      [`--url=${fake.url}`, '--players=P2', '--ticks=10', `--out=${out}`, '--timeout-ms=5000'],
      { stdout: line => stdout.push(line), stderr: line => stderr.push(line) },
    );
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('\n')).toContain('grant-mismatch');
    expect(stderr.join('\n')).toContain('[P1]');
    expect(existsSync(out)).toBe(false);
  }, 20000);

  it('rejects a second claim on an already owned slot', async (ctx: TestContext) => {
    let server: WsServerHandle;
    try {
      server = await startWsServer({
        host: '127.0.0.1',
        port: 0,
        playerIds: ['P1', 'P2'],
        snapshotHz: 20,
        startDelayMs: 0,
        firstTickDelayMs: 100,
      });
      openWsServers.push(server);
    } catch (error) {
      skipIfUnbindable(ctx, error);
      return;
    }
    const url = `ws://127.0.0.1:${server.port}`;
    const holder = await openNodeSession({ url });
    openClients.push(holder);
    holder.client.join(['P2']);
    await waitFor('the holder to claim P2', () => server.room.playerCount === 1);

    let failure: unknown = null;
    try {
      await runBotClient({ url, playerIds: ['P2'], pattern: 'wander', ticks: 10, timeoutMs: 5000 });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(BotClientError);
    expect((failure as BotClientError).reason).toBe('join-denied');
    expect((failure as BotClientError).message).toMatch(/player-owned/);
    // The existing owner is untouched.
    expect(server.room.playerCount).toBe(1);
  }, 20000);

  it('reports a refused connection with one line, exit 1, no manifest and no timer', async () => {
    const port = await freePort();
    const out = tempManifestPath();
    const before = activeTimeoutCount();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runBot(
      [`--url=ws://127.0.0.1:${port}`, '--players=P2', '--ticks=10', `--out=${out}`, '--timeout-ms=5000'],
      { stdout: line => stdout.push(line), stderr: line => stderr.push(line) },
    );
    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr.join('\n')).toContain('connect-failed');
    expect(stderr.join('\n').split('\n').filter(line => line.includes('connect-failed'))).toHaveLength(1);
    expect(existsSync(out)).toBe(false);
    await delay(50);
    if (before !== null) expect(activeTimeoutCount()).toBeLessThanOrEqual(before);
  }, 20000);

  it('treats a denied join as a failure', async () => {
    const fake = await startFakeServer(() => ({
      version: 1,
      kind: 'join-result',
      accepted: false,
      playerIds: [],
      code: 'session-full',
    }));
    let failure: unknown = null;
    try {
      await runBotClient({
        url: fake.url,
        playerIds: ['P2'],
        pattern: 'wander',
        ticks: 10,
        timeoutMs: 5000,
      });
    } catch (error) {
      failure = error;
    }
    expect((failure as BotClientError).reason).toBe('join-denied');
    expect((failure as BotClientError).message).toContain('session-full');
  }, 20000);
});

describe('M7 bot schedules and CLI', () => {
  it('reproduces the committed fixture slice for a single player', () => {
    const schedule = createBotSchedule({ pattern: 'fixture', players: ['P2'], ticks: 60 });
    const reference = loadWsBenchmarkSchedule(60);
    expect(schedule.fixtureSha256).toBe(reference.fixture.fixtureSha256);
    expect(schedule.seed).toBe(reference.fixture.seed);
    for (let tick = 0; tick < 60; tick++) {
      expect(schedule.inputsByPlayer.get('P2')?.[tick]).toEqual(
        reference.schedule[tick].find(input => input.playerId === 'P2'),
      );
    }
    const again = createBotSchedule({ pattern: 'fixture', players: ['P2'], ticks: 60 });
    expect(again.scheduleSha256).toBe(schedule.scheduleSha256);
    expect(() => createBotSchedule({ pattern: 'fixture', players: ['P2'], ticks: 10, seed: 5 }))
      .toThrow(/seed/);
  });

  it('makes wander deterministic per seed and different per player', () => {
    const first = createBotSchedule({ pattern: 'wander', players: ['P2', 'P3'], ticks: 120, seed: 42 });
    const again = createBotSchedule({ pattern: 'wander', players: ['P2', 'P3'], ticks: 120, seed: 42 });
    const other = createBotSchedule({ pattern: 'wander', players: ['P2', 'P3'], ticks: 120, seed: 43 });
    expect(first.scheduleSha256).toBe(again.scheduleSha256);
    expect(first.scheduleSha256).not.toBe(other.scheduleSha256);
    expect(first.fixtureSha256).toBeNull();
    const p2 = first.inputsByPlayer.get('P2');
    const p3 = first.inputsByPlayer.get('P3');
    expect(p2).toHaveLength(120);
    expect(p3).toHaveLength(120);
    expect(p2).not.toEqual(p3);
    for (const input of p2 ?? []) {
      expect([-1, 0, 1]).toContain(input.moveX);
      expect(input.playerId).toBe('P2');
    }
    // Movement is visible to a human: both directions occur in a 2 s window.
    expect(new Set((p2 ?? []).map(input => input.moveX)).size).toBeGreaterThan(1);
    expect(() => createBotSchedule({ pattern: 'wander', players: ['P2'], ticks: 10, seed: 0 }))
      .toThrow(/Seed/);
  });

  it('parses the documented command and rejects invalid or unsafe options', () => {
    const parsed = parseBotArgs([
      '--url=ws://192.0.2.1:8787',
      '--players=P2,P3,P4',
      '--pattern=wander',
      '--ticks=600',
      '--seed=7',
    ]);
    expect(parsed).toMatchObject({
      url: 'ws://192.0.2.1:8787',
      playerIds: ['P2', 'P3', 'P4'],
      pattern: 'wander',
      ticks: 600,
      seed: 7,
      pingIntervalMs: 250,
      networkPath: null,
      recordAddress: false,
      help: false,
    });
    expect(parsed.timeoutMs).toBe(defaultRunTimeoutMs('interval', 600));

    const defaults = parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P2']);
    expect(defaults.ticks).toBe(7200);
    expect(defaults.pattern).toBe('fixture');
    expect(defaults.timeoutMs).toBe(defaultRunTimeoutMs('interval', 7200));
    expect(parseBotArgs(['--help']).help).toBe(true);
    expect(botUsage()).toContain('npm run bot');
    expect(botUsage()).toContain('--players');

    expect(() => parseBotArgs([])).toThrow(/--url/);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787'])).toThrow(/--players/);
    expect(() => parseBotArgs(['--url=http://192.0.2.1:8787', '--players=P2'])).toThrow(/ws:\/\//);
    expect(() => parseBotArgs(['--url=wss://192.0.2.1:8787', '--players=P2'])).toThrow(/ws:\/\//);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P2,P2'])).toThrow(/duplicate/);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P9'])).toThrow(/Unknown player slot/);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P2', '--pattern=cheat']))
      .toThrow(/Invalid --pattern/);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P2', '--ticks=0']))
      .toThrow(/tick count/);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P2', '--ticks=7201']))
      .toThrow(/tick count/);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P2', '--seed=5']))
      .toThrow(/--seed/);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P2', '--path=moon']))
      .toThrow(/Invalid --path/);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P2', '--out=']))
      .toThrow(/--out/);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P2', '--bogus=1']))
      .toThrow(/Unknown option/);
    expect(() => parseBotArgs(['--url=ws://192.0.2.1:8787', '--players=P2', 'positional']))
      .toThrow(/Unexpected argument/);
  });

  it('redacts the server address unless the operator asked to record it', () => {
    const redacted = parseBotArgs(['--url=ws://10.9.8.7:8787', '--players=P2', '--ticks=60']);
    expect(manifestArguments(redacted)).toContain('--url=<redacted>');
    expect(manifestArguments(redacted).join(' ')).not.toContain('10.9.8.7');
    const recorded = parseBotArgs([
      '--url=ws://10.9.8.7:8787', '--players=P2', '--ticks=60', '--record-address',
    ]);
    expect(manifestArguments(recorded)).toContain('--url=ws://10.9.8.7:8787');
    expect(manifestArguments(recorded)).toContain('--record-address');
  });
});

function sampleMetrics(): BotMetricsSnapshot {
  return {
    rtt: {
      status: 'MEASURED',
      unit: 'milliseconds',
      sampleCount: 2,
      min: 1,
      mean: 1.5,
      p50: 1,
      p95: 2,
      p99: 2,
      max: 2,
    },
    snapshotInterArrival: {
      status: 'MEASURED',
      unit: 'milliseconds',
      sampleCount: 2,
      min: 40,
      mean: 45,
      p50: 40,
      p95: 50,
      p99: 50,
      max: 50,
      maxGapMs: 50,
    },
    bandwidth: {
      status: 'MEASURED',
      windowMs: 2000,
      sentBytes: 300,
      receivedBytes: 500,
      sentBytesPerSecond: 150,
      receivedBytesPerSecond: 250,
      sentMessages: 10,
      receivedMessages: 20,
      perSecond: [
        {
          second: 0,
          sentBytes: 300,
          receivedBytes: 0,
          sentMessages: 10,
          receivedMessages: 0,
          snapshots: 5,
          pongs: 4,
          inputsSubmitted: 60,
        },
        {
          second: 1,
          sentBytes: 0,
          receivedBytes: 500,
          sentMessages: 0,
          receivedMessages: 20,
          snapshots: 35,
          pongs: 14,
          inputsSubmitted: 60,
        },
      ],
    },
    inputs: {
      submitted: 300,
      accepted: 300,
      acceptedBasis: 'submitted-minus-observed-denials',
      lateTicks: 0,
      denied: 0,
      denials: {},
    },
    disconnects: {
      observed: 0,
      sessionClosedReasons: [],
      transportClosed: false,
      transportErrors: 0,
    },
  };
}

function sampleManifest(): BotManifest {
  return createBotManifest({
    runId: 'bot-test-1',
    provenance: {
      command: BOT_COMMAND,
      cliArguments: ['--url=<redacted>', '--players=P2,P3', '--pattern=wander', '--ticks=300'],
      role: 'bot-client',
      pattern: 'wander',
      playerIds: ['P2', 'P3'],
      plannedTicks: 300,
      achievedTicks: 300,
      seed: 1337,
      fixtureSha256: 'NOT_APPLICABLE',
      scheduleSha256: 'a'.repeat(64),
      networkPath: 'loopback',
      networkPathSource: 'loopback-url-default',
      serverAddress: 'NOT_RECORDED',
      snapshotHz: 20,
      serverTickRate: 60,
      pingIntervalMs: 250,
      nodeVersion: process.version,
      platform: process.platform,
      osRelease: '10.0.26100',
      architecture: process.arch,
      gitCommitSha: 'b'.repeat(40),
    },
    metrics: sampleMetrics(),
    result: { status: 'tick-bound', finalTick: 300 },
  });
}

describe('M7 bot metrics and manifest honesty', () => {
  it('summarizes only observed samples and derives rates from its own window', () => {
    let now = 0;
    const metrics = new BotMetrics(() => now);
    metrics.start();
    metrics.noteOutbound(100);
    metrics.noteSnapshot(0);
    now = 1000;
    metrics.noteInbound(250);
    metrics.noteSnapshot(1000);
    metrics.notePing(1, 1000);
    metrics.notePong(1, 1020);
    metrics.notePong(999, 1030); // unmatched: ignored, never guessed
    metrics.noteInputSubmitted();
    now = 2000;
    metrics.finish();
    const summary = metrics.build();

    expect(summary.rtt).toMatchObject({ status: 'MEASURED', sampleCount: 1, min: 20, max: 20, p50: 20 });
    expect(summary.snapshotInterArrival).toMatchObject({
      status: 'MEASURED',
      sampleCount: 1,
      maxGapMs: 1000,
    });
    expect(summary.bandwidth).toMatchObject({
      status: 'MEASURED',
      windowMs: 2000,
      sentBytes: 100,
      receivedBytes: 250,
      sentBytesPerSecond: 50,
      receivedBytesPerSecond: 125,
    });
    if (summary.bandwidth.status !== 'MEASURED') throw new Error('bandwidth should be measured');
    expect(summary.bandwidth.perSecond).toEqual([
      {
        second: 0,
        sentBytes: 100,
        receivedBytes: 0,
        sentMessages: 1,
        receivedMessages: 0,
        snapshots: 1,
        pongs: 0,
        inputsSubmitted: 0,
      },
      {
        second: 1,
        sentBytes: 0,
        receivedBytes: 250,
        sentMessages: 0,
        receivedMessages: 1,
        snapshots: 1,
        pongs: 1,
        inputsSubmitted: 1,
      },
    ]);
    expect(summary.inputs).toEqual({
      submitted: 1,
      accepted: 1,
      acceptedBasis: 'submitted-minus-observed-denials',
      lateTicks: 0,
      denied: 0,
      denials: {},
    });
    expect(summary.disconnects).toEqual({
      observed: 0,
      sessionClosedReasons: [],
      transportClosed: false,
      transportErrors: 0,
    });
  });

  it('never turns a missing sample into zero', () => {
    const metrics = new BotMetrics(() => 0);
    metrics.start(0);
    expect(() => metrics.build()).toThrow(/finished/);
    metrics.finish(10);
    const summary = metrics.build();
    expect(summary.rtt).toEqual({ status: 'NOT_MEASURED', reason: expect.any(String) });
    expect(summary.snapshotInterArrival).toEqual({ status: 'NOT_MEASURED', reason: expect.any(String) });
    expect(summary.bandwidth).toMatchObject({ status: 'MEASURED', sentBytes: 0, receivedBytes: 0 });
    expect(() => metrics.noteOutbound(0)).not.toThrow(); // frozen after finish
  });

  it('carries the honesty notes and no address unless recorded', () => {
    const manifest = sampleManifest();
    validateBotManifest(manifest);
    expect(manifest.scope.clientViewNote).toBe(BOT_CLIENT_VIEW_NOTE);
    expect(manifest.scope.noPredictionNote).toBe(BOT_NO_PREDICTION_NOTE);
    expect(manifest.provenance.serverAddress).toBe('NOT_RECORDED');
    const text = JSON.stringify(manifest);
    expect(text).not.toMatch(/ws:\/\//);
    expect(text).toContain('Server-internal tick timing');
    expect(text).toContain('No client prediction');
  });

  it('rejects malformed, inconsistent or dishonest metrics', () => {
    const mutations: Array<[string, (manifest: Record<string, any>) => void]> = [
      ['non-monotonic percentiles', manifest => {
        manifest.metrics.rtt.p50 = 9;
      }],
      ['zero samples', manifest => {
        manifest.metrics.rtt.sampleCount = 0;
      }],
      ['measured status without samples', manifest => {
        manifest.metrics.rtt.status = 'NOT_MEASURED';
      }],
      ['invented byte rate', manifest => {
        manifest.metrics.bandwidth.sentBytesPerSecond = 999;
      }],
      ['per-second sum mismatch', manifest => {
        manifest.metrics.bandwidth.perSecond[0].sentBytes = 1;
      }],
      ['max gap disagrees with max', manifest => {
        manifest.metrics.snapshotInterArrival.maxGapMs = 1;
      }],
      ['accepted count does not follow denials', manifest => {
        manifest.metrics.inputs.accepted = 299;
      }],
      ['denial sum mismatch', manifest => {
        manifest.metrics.inputs.denials = { 'late-tick': 2 };
      }],
      ['late ticks exceed denials', manifest => {
        manifest.metrics.inputs.lateTicks = 5;
      }],
      ['achieved ticks disagree with the result', manifest => {
        manifest.provenance.achievedTicks = 301;
      }],
      ['weaker tick-bound claim', manifest => {
        manifest.provenance.achievedTicks = 200;
        manifest.result.finalTick = 200;
      }],
      ['unknown network path', manifest => {
        manifest.provenance.networkPath = 'moon';
      }],
      ['path label contradicts its source', manifest => {
        manifest.provenance.networkPath = 'internet';
      }],
      ['dropped honesty note', manifest => {
        manifest.scope.clientViewNote = 'trust me';
      }],
      ['leaked private address', manifest => {
        manifest.provenance.cliArguments = ['--url=ws://10.0.0.5:8787'];
      }],
      ['unknown metric key', manifest => {
        manifest.metrics.extra = 1;
      }],
      ['fixture hash missing for the fixture pattern', manifest => {
        manifest.provenance.pattern = 'fixture';
      }],
      ['impossible snapshot count', manifest => {
        manifest.metrics.snapshotInterArrival = {
          status: 'MEASURED',
          unit: 'milliseconds',
          sampleCount: 1,
          min: 1,
          mean: 2,
          p50: 1,
          p95: 3,
          p99: 4,
          max: 4,
          maxGapMs: 4,
        };
      }],
    ];

    const baseline = JSON.stringify(sampleManifest());
    expect(baseline.length).toBeGreaterThan(0);
    for (const [label, mutate] of mutations) {
      const clone = JSON.parse(baseline) as Record<string, any>;
      mutate(clone);
      expect(() => validateBotManifest(clone), label).toThrow(/Invalid bot manifest/);
    }
  });

  it('writes exactly one manifest and refuses to overwrite any file', () => {
    const path = tempManifestPath();
    const manifest = sampleManifest();
    const written = writeBotManifest(path, manifest);
    expect(written).toBe(path);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    validateBotManifest(parsed);
    expect(() => writeBotManifest(path, manifest)).toThrow(/Refusing to overwrite/);
    expect(() => writeBotManifest(path, { ...manifest, kind: 'wrong' } as unknown as BotManifest))
      .toThrow(/Invalid bot manifest|Refusing/);
  });
});
