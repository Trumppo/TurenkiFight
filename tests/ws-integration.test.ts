import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { encodeClientEnvelope } from '../src/game/session/sessionEnvelope';
import type { PlayerInput } from '../src/game/simulation/types';
import { startWsServer, type WsServerHandle } from '../server/ws/wsServer';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';

/**
 * One real loopback WebSocket test. It uses manual ticking so the assertions do
 * not depend on timer scheduling. If the sandbox cannot bind a local socket,
 * the test skips with an explicit reason instead of failing the build.
 */

const PLAYERS = ['P1', 'P2', 'P3', 'P4'];

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
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
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const controls = (playerId: string): PlayerInput => ({ playerId, moveX: 1, moveY: 0, jump: false });

function bindingFailure(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  if (code && ['EACCES', 'EPERM', 'EADDRINUSE', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return code;
  }
  return null;
}

const openServers: WsServerHandle[] = [];
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

describe('M2 WebSocket prototype loopback integration', () => {
  it('accepts owned input, rejects spoofing and terminates on host loss', async (ctx: TestContext) => {
    let server: WsServerHandle;
    try {
      server = await startWsServer({
        port: 0,
        host: '127.0.0.1',
        tickMode: 'manual',
        snapshotHz: 20,
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
    const errors: string[][] = [];
    const closeReasons: string[][] = [];
    const protocolErrors: string[][] = [];
    const joins = PLAYERS.map(() => deferred<void>());
    const starts = PLAYERS.map(() => deferred<void>());
    const clients: NodeSession[] = [];

    for (let index = 0; index < PLAYERS.length; index++) {
      const playerId = PLAYERS[index];
      errors.push([]);
      closeReasons.push([]);
      protocolErrors.push([]);
      const session = await openNodeSession({
        url,
        handlers: {
          onJoinResult: result => result.accepted
            ? joins[index].resolve()
            : joins[index].reject(new Error(`join denied: ${result.code ?? 'unknown'}`)),
          onMatchStart: () => starts[index].resolve(),
          onError: error => errors[index].push(error.code),
          onSessionClosed: reason => closeReasons[index].push(reason),
          onProtocolError: message => protocolErrors[index].push(message),
        },
      });
      openClients.push(session);
      clients.push(session);
      // The client cannot name its own connection; the server's welcome is informational only.
      expect(session.client.join([playerId])).toBe(1);
    }

    await Promise.all(joins.map(join => join.promise));
    expect(server.room.phase).toBe('starting');
    expect(server.room.playerCount).toBe(4);

    expect(server.room.beginMatch()).toBe(true);
    await Promise.all(starts.map(start => start.promise));

    // Authorized input from every socket is accepted for the target tick.
    clients.forEach((session, index) => {
      expect(session.client.submitInput(0, [controls(PLAYERS[index])])).toBe(2);
    });
    await waitFor('tick 0 input', () => server.room.bufferedTicks === 1);
    expect(server.room.stepOnce()).toMatchObject({ stepped: true, tick: 1 });
    const afterFirstTick = server.room.snapshot().state.fighters;

    // A raw spoofed frame claiming P1 is rejected over the real socket.
    clients[1].sendRaw(encodeClientEnvelope({
      version: 1,
      kind: 'input',
      sequence: 100,
      targetTick: 1,
      frame: { version: 1, tick: 1, inputs: [controls('P1')] },
    }));
    await waitFor('spoof denial', () => errors[1].includes('unauthorized-player'));
    expect(server.room.stepOnce()).toMatchObject({ stepped: true, tick: 2 });
    const afterSpoof = server.room.snapshot().state.fighters;
    // P1 supplied no authorized input for tick 1, so its position is neutral.
    expect(afterSpoof[0].x).toBe(afterFirstTick[0].x);
    // P2's earlier accepted input moved P2 only on tick 0.
    expect(afterSpoof[1].x).toBe(afterFirstTick[1].x);
    expect(protocolErrors.flat()).toEqual([]);

    // Host disconnect revokes authority and terminates; nobody becomes host.
    const hostConnection = clients[0].client.connectionId;
    expect(hostConnection).not.toBeNull();
    expect(server.room.hostConnectionId).toBe(hostConnection);
    clients[0].close();
    await waitFor('host-lost transition', () => server.room.phase === 'closed');
    await waitFor('host-lost broadcast', () => closeReasons.slice(1).every(reasons => reasons.includes('host-lost')));
    expect(server.room.hostConnectionId).toBe(hostConnection);
    expect(server.room.playerCount).toBe(0);
    expect(server.room.connectionCount).toBe(0);
    expect(server.room.stepOnce().stepped).toBe(false);
  }, 20000);
});
