import WebSocket from 'ws';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import type { SessionClientHandlers } from '../src/game/networking/wsSessionClient';
import type { PlayerInput } from '../src/game/simulation/types';
import {
  DEFAULT_MATCH_HOST,
  DEFAULT_MATCH_PORT,
  formatMatchReadyLine,
  matchConnectUrl,
  parseServeMatchArgs,
  serveMatchUsage,
  startMatchServer,
  type MatchServerHandle,
} from '../server/ws/matchServer';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';

/**
 * Integration coverage for M7 real-match server mode on an ephemeral loopback
 * port. Every server here uses the same 60 Hz interval tick loop and the real
 * `AuthoritativeWsSession`; nothing is stubbed. If the sandbox cannot bind a
 * local socket the integration test skips with an explicit reason.
 */

const PLAYERS = ['P1', 'P2', 'P3', 'P4'];

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // A rejected join must never surface as an unhandled rejection.
  promise.catch(() => undefined);
  return { promise, resolve: resolvePromise, reject: rejectPromise };
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
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Waits for a promise while clearing the guard timer, so no timer leaks. */
function withTimeout(promise: Promise<void>, ms: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      error => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function controls(playerId: string): PlayerInput {
  return { playerId, moveX: 1, moveY: 0, jump: false };
}

function bindingFailure(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  if (code && ['EACCES', 'EPERM', 'EADDRINUSE', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return code;
  }
  return null;
}

/** Node timers active in this process; used to prove a clean shutdown. */
function activeTimeoutCount(): number | null {
  const resources = (process as unknown as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo;
  if (typeof resources !== 'function') return null;
  return resources.call(process).filter(entry => entry === 'Timeout').length;
}

const openServers: MatchServerHandle[] = [];
const openClients: NodeSession[] = [];

afterEach(async () => {
  for (const client of openClients.splice(0)) {
    try {
      client.close();
    } catch {
      // Already closed by the session.
    }
  }
  for (const server of openServers.splice(0)) {
    await server.close();
  }
});

describe('M7 real-match server mode', () => {
  it('serves four clients, rejects a fifth connection and shuts down cleanly', async (ctx: TestContext) => {
    const baselineTimeouts = activeTimeoutCount();
    const rejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    let server: MatchServerHandle;
    const statusLines: string[] = [];
    try {
      server = await startMatchServer({
        host: '127.0.0.1',
        port: 0,
        snapshotHz: 20,
        startDelayMs: 0,
        firstTickDelayMs: 0,
        log: line => statusLines.push(line),
      });
      openServers.push(server);
    } catch (error) {
      process.off('unhandledRejection', onUnhandledRejection);
      const code = bindingFailure(error);
      ctx.skip(code === null
        ? `Local WebSocket server could not start: ${error instanceof Error ? error.message : String(error)}`
        : `Local WebSocket binding unavailable (${code})`);
      return;
    }

    try {
      const url = `ws://127.0.0.1:${server.port}`;
      expect(server.url).toBe(url);
      expect(server.ready.url).toBe(url);
      expect(server.ready.playerIds).toEqual(PLAYERS);

      const errors = PLAYERS.map(() => [] as string[]);
      const snapshots = PLAYERS.map(() => 0);
      const joins = PLAYERS.map(() => deferred<void>());
      const starts = PLAYERS.map(() => deferred<void>());
      const closes = PLAYERS.map(() => [] as string[]);
      const clients: NodeSession[] = [];

      for (let index = 0; index < PLAYERS.length; index++) {
        const handlers: SessionClientHandlers = {
          onJoinResult: result => result.accepted
            ? joins[index].resolve()
            : joins[index].reject(new Error(`join denied: ${result.code ?? 'unknown'}`)),
          onMatchStart: () => starts[index].resolve(),
          onSnapshot: () => {
            snapshots[index] += 1;
          },
          onError: error => errors[index].push(error.code),
          onSessionClosed: reason => closes[index].push(reason),
        };
        const session = await openNodeSession({ url, handlers });
        openClients.push(session);
        clients.push(session);
        session.client.join([PLAYERS[index]]);
      }

      await Promise.all(joins.map(join => join.promise));
      await Promise.all(starts.map(start => start.promise));
      expect(server.room.phase).toBe('running');
      expect(server.room.playerCount).toBe(4);
      expect(server.room.connectionCount).toBe(4);

      // The 60 Hz interval loop really advances without any manual stepping.
      await waitFor('authoritative ticks to advance', () => server.room.tick >= 2);
      expect(server.room.hostConnectionId).not.toBeNull();

      // Every claimed slot can submit an accepted input for a near-future tick.
      const targetTick = server.room.tick + 3;
      clients.forEach((session, index) => {
        session.client.submitInput(targetTick, [controls(PLAYERS[index])]);
      });
      await waitFor('authoritative tick past the submitted input', () => server.room.tick > targetTick);
      await delay(30);
      expect(errors.flat()).toEqual([]);
      expect(statusLines.filter(line => line.includes('denied'))).toEqual([]);
      expect(snapshots.every(count => count > 0)).toBe(true);

      // A fifth connection is closed before registration with a clear code.
      const tickBeforeExtra = server.room.tick;
      const extra = new WebSocket(url);
      const extraClose = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          extra.terminate();
          reject(new Error('Timed out waiting for the fifth connection to be closed'));
        }, 5000);
        extra.once('close', (code, reason) => {
          clearTimeout(timer);
          resolve({ code, reason: reason.toString() });
        });
        // The server sends a close frame; a client-side error must not escape.
        extra.once('error', () => undefined);
      });
      expect(extraClose.code).toBe(1008);
      expect(extraClose.reason).toContain('connection limit');
      // The running match is untouched: same roster, same authority, advancing.
      expect(server.room.connectionCount).toBe(4);
      expect(server.room.playerCount).toBe(4);
      await waitFor('match to keep ticking after the rejected connection', () => server.room.tick > tickBeforeExtra);
      expect(server.room.phase).toBe('running');

      // A mid-match disconnect revokes that slot and changes nothing else.
      const hostConnection = server.room.hostConnectionId;
      const snapshotsBeforeDisconnect = snapshots[0];
      clients[1].close();
      await waitFor('slot revocation after disconnect', () => server.room.playerCount === 3);
      expect(server.room.hostConnectionId).toBe(hostConnection);
      expect(server.room.phase).toBe('running');
      await waitFor('match to keep ticking after a disconnect', () => snapshots[0] > snapshotsBeforeDisconnect);
      expect(errors[0]).toEqual([]);
      expect(closes[0]).toEqual([]);

      // Shutdown closes every socket and stops the authoritative timer.
      const tickBeforeClose = server.room.tick;
      const serverIndex = openServers.indexOf(server);
      if (serverIndex >= 0) openServers.splice(serverIndex, 1);
      await server.close();
      expect(server.room.phase).toBe('closed');
      for (const client of clients.splice(0)) {
        client.close();
        await withTimeout(client.closed, 1000, 'client close');
      }
      await delay(250);
      expect(server.room.tick).toBeGreaterThanOrEqual(tickBeforeClose);
      const tickAfterClose = server.room.tick;
      await delay(100);
      expect(server.room.tick).toBe(tickAfterClose);
      if (baselineTimeouts !== null) {
        expect(activeTimeoutCount()).toBeLessThanOrEqual(baselineTimeouts);
      }
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  }, 30000);

  it('waits for an explicit start request and refuses to start on a partial roster', async (ctx: TestContext) => {
    let server: MatchServerHandle;
    try {
      server = await startMatchServer({
        host: '127.0.0.1',
        port: 0,
        playerIds: ['P1', 'P2'],
        snapshotHz: 10,
        startMode: 'manual',
        startDelayMs: 0,
        firstTickDelayMs: 0,
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
    const clients: NodeSession[] = [];
    const joins = ['P1', 'P2'].map(() => deferred<void>());
    const starts = ['P1', 'P2'].map(() => deferred<void>());

    for (let index = 0; index < 2; index++) {
      const session = await openNodeSession({
        url,
        handlers: {
          onJoinResult: result => result.accepted
            ? joins[index].resolve()
            : joins[index].reject(new Error(`join denied: ${result.code ?? 'unknown'}`)),
          onMatchStart: () => starts[index].resolve(),
        },
      });
      openClients.push(session);
      clients.push(session);
    }

    clients[0].client.join(['P1']);
    await joins[0].promise;
    expect(server.room.playerCount).toBe(1);
    expect(server.start()).toEqual({ started: false, reason: 'roster-incomplete' });

    clients[1].client.join(['P2']);
    await joins[1].promise;
    await waitFor('frozen roster', () => server.room.phase === 'starting');

    // Manual mode holds the start even though the roster is complete.
    await delay(150);
    expect(server.room.phase).toBe('starting');
    expect(server.room.tick).toBe(0);

    expect(server.start()).toEqual({ started: true });
    await Promise.all(starts.map(start => start.promise));
    expect(server.room.phase).toBe('running');
    await waitFor('ticks after the explicit start', () => server.room.tick >= 2);
    expect(server.start()).toEqual({ started: false, reason: 'already-started' });

    for (const client of clients) client.close();
    await delay(50);
    expect(server.room.playerCount).toBe(0);
  }, 20000);
});

describe('M7 serve:match command surface', () => {
  it('parses explicit host, port, roster, snapshot rate and start mode', () => {
    expect(parseServeMatchArgs([])).toEqual({
      host: DEFAULT_MATCH_HOST,
      port: DEFAULT_MATCH_PORT,
      playerIds: PLAYERS,
      snapshotHz: 20,
      startMode: 'auto',
      mode: 'score-brawl',
      rematch: false,
      help: false,
    });
    expect(parseServeMatchArgs([
      '--host=0.0.0.0',
      '--port=9001',
      '--players=2',
      '--snapshot-hz=30',
      '--start=manual',
      '--mode=last-man-standing',
    ])).toEqual({
      host: '0.0.0.0',
      port: 9001,
      playerIds: ['P1', 'P2'],
      snapshotHz: 30,
      startMode: 'manual',
      mode: 'last-man-standing',
      rematch: false,
      help: false,
    });
    expect(parseServeMatchArgs(['--rematch']).rematch).toBe(true);
    expect(parseServeMatchArgs(['--help']).help).toBe(true);
    expect(parseServeMatchArgs(['--snapshot-hz=10', '--players=1']).playerIds).toEqual(['P1']);
    expect(parseServeMatchArgs(['--players=8']).playerIds)
      .toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  });

  it('rejects invalid flags with an explicit message', () => {
    expect(() => parseServeMatchArgs(['--port=70000'])).toThrow(/Invalid port/);
    expect(() => parseServeMatchArgs(['--port'])).toThrow(/--name=value/);
    expect(() => parseServeMatchArgs(['--snapshot-hz=15'])).toThrow(/Unsupported snapshot rate/);
    expect(() => parseServeMatchArgs(['--players=9'])).toThrow(/1\.\.8/);
    expect(() => parseServeMatchArgs(['--players=99'])).toThrow(/1\.\.8/);
    expect(() => parseServeMatchArgs(['--players=0'])).toThrow(/1\.\.8/);
    expect(() => parseServeMatchArgs(['--start=later'])).toThrow(/Invalid start mode/);
    expect(() => parseServeMatchArgs(['--mode=duel'])).toThrow(/Invalid mode/);
    expect(() => parseServeMatchArgs(['--host=ws://127.0.0.1'])).toThrow(/not a URL/);
    expect(() => parseServeMatchArgs(['--bogus=1'])).toThrow(/Unknown option/);
    expect(() => parseServeMatchArgs(['positional'])).toThrow(/Unexpected argument/);
    expect(serveMatchUsage()).toContain('npm run serve:match');
    expect(serveMatchUsage()).toContain('--host');
    expect(serveMatchUsage()).toContain('--mode');
  });

  it('emits one ready line with the URL and no manifest or peer data', () => {
    const line = formatMatchReadyLine({
      url: 'ws://192.168.1.20:8787',
      host: '192.168.1.20',
      port: 8787,
      roomId: 'match',
      playerIds: PLAYERS,
      snapshotHz: 20,
      startMode: 'auto',
      mode: 'deathmatch',
    });
    expect(line).not.toContain('\n');
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'host', 'kind', 'mode', 'players', 'port', 'roomId', 'snapshotHz', 'startMode', 'tickRate', 'url',
    ]);
    expect(parsed.kind).toBe('match-server-ready');
    expect(parsed.mode).toBe('deathmatch');
    expect(parsed.url).toBe('ws://192.168.1.20:8787');
    expect(parsed.tickRate).toBe(60);
    // No peer address, manifest path or invented measurement can appear.
    expect(line).not.toMatch(/remoteAddress|manifest|rtt|latency/i);
    expect(matchConnectUrl('0.0.0.0', 8787)).toBeNull();
    expect(matchConnectUrl('::1', 8787)).toBe('ws://[::1]:8787');
  });
});
