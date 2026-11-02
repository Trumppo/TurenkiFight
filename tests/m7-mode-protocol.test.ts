import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { encodeClientEnvelope } from '../src/game/session/sessionEnvelope';
import type { StateSnapshot } from '../src/game/protocol/stateSnapshot';
import { decodeWsServerMessage, encodeWsServerMessage, type WsServerMessage } from '../src/game/networking/wsMessages';
import type { SessionClientHandlers } from '../src/game/networking/wsSessionClient';
import type { ModeId } from '../src/game/simulation/types';
import { AuthoritativeWsSession } from '../server/ws/authoritativeWsSession';
import { formatMatchReadyLine, parseServeMatchArgs, startMatchServer, type MatchServerHandle } from '../server/ws/matchServer';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';

/**
 * M7-MODE-ONLINE protocol slice: the selected mode travels inside the existing
 * protocol v1 snapshot envelope. Score Brawl omits every optional mode field so
 * its bytes and fingerprints are unchanged; the rules-driven modes carry the
 * mode id and their counters.
 *
 * Nothing here renders or selects a mode in a client; the follow-up PR owns
 * presentation. No simulation rule is re-implemented in this file.
 */

type SnapshotMessage = Extract<WsServerMessage, { kind: 'snapshot' }>;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor<T>(label: string, check: () => T | undefined | false, timeoutMs = 5000): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
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
  for (const server of openServers.splice(0)) await server.close();
});

/** Drive a headless session to a snapshot tick and return the emitted messages. */
function sessionSnapshots(mode?: ModeId): { messages: WsServerMessage[]; state: Record<string, unknown> } {
  const messages: WsServerMessage[] = [];
  const session = new AuthoritativeWsSession({
    playerIds: ['P1', 'P2'],
    snapshotHz: 20,
    ...(mode === undefined ? {} : { mode }),
    onOutgoing: (_target, message) => messages.push(message),
  });
  session.addConnection('conn-1');
  session.addConnection('conn-2');
  session.handleMessage('conn-1', encodeClientEnvelope({
    version: 1, kind: 'join-request', sequence: 1, playerIds: ['P1'],
  }));
  session.handleMessage('conn-2', encodeClientEnvelope({
    version: 1, kind: 'join-request', sequence: 1, playerIds: ['P2'],
  }));
  expect(session.beginMatch()).toBe(true);
  for (let tick = 0; tick < 3; tick++) session.stepOnce();
  const snapshot = messages.filter((message): message is SnapshotMessage => message.kind === 'snapshot').at(-1);
  if (!snapshot) throw new Error('Session emitted no snapshot');
  return { messages, state: (JSON.parse(encodeWsServerMessage(snapshot)) as { snapshot: { state: Record<string, unknown> } }).snapshot.state };
}

describe('M7 mode-aware snapshots on the wire', () => {
  it('keeps Score Brawl snapshots free of every mode field', () => {
    const { state } = sessionSnapshots();
    expect(state).not.toHaveProperty('mode');
    const fighters = state.fighters as Array<Record<string, unknown>>;
    for (const fighter of fighters) {
      for (const key of ['eliminated', 'frags', 'deaths', 'damageDealt']) {
        expect(fighter).not.toHaveProperty(key);
      }
    }
    // Byte-for-byte Score Brawl regression is pinned by stateSnapshot.test.ts
    // against the pre-M7 fixtures; this asserts the server adds nothing.
    expect(Object.keys(state).sort()).toEqual(
      ['countdownTicks', 'events', 'fighters', 'phase', 'remainingTicks', 'tick'],
    );
  });

  it('emits Deathmatch mode and counters and nobody is eliminated', () => {
    const { messages, state } = sessionSnapshots('deathmatch');
    expect(state.mode).toBe('deathmatch');
    const fighters = state.fighters as Array<Record<string, unknown>>;
    for (const fighter of fighters) {
      expect(fighter.frags).toBe(0);
      expect(fighter.deaths).toBe(0);
      expect(fighter.damageDealt).toBe(0);
      expect(fighter).not.toHaveProperty('eliminated');
    }
    // The exact bytes the server sent decode back through the strict codec.
    const snapshot = messages.filter((message): message is SnapshotMessage => message.kind === 'snapshot').at(-1)!;
    const decoded = decodeWsServerMessage(encodeWsServerMessage(snapshot)) as SnapshotMessage;
    expect(decoded.snapshot.state.mode).toBe('deathmatch');
    expect(decoded.snapshot.state.fighters.map(fighter => [fighter.frags, fighter.deaths]))
      .toEqual([[0, 0], [0, 0]]);
  });

  it('emits Last Man Standing mode and omits the alive marker', () => {
    const { state } = sessionSnapshots('last-man-standing');
    expect(state.mode).toBe('last-man-standing');
    const fighters = state.fighters as Array<Record<string, unknown>>;
    for (const fighter of fighters) {
      expect(fighter).not.toHaveProperty('eliminated');
      expect(fighter).not.toHaveProperty('frags');
      expect(fighter).not.toHaveProperty('deaths');
      expect(fighter.damageDealt).toBe(0);
    }
  });

  it('reports the selected mode in the ready line', () => {
    const parsed = JSON.parse(formatMatchReadyLine({
      url: 'ws://127.0.0.1:8787',
      host: '127.0.0.1',
      port: 8787,
      roomId: 'match',
      playerIds: ['P1', 'P2'],
      snapshotHz: 20,
      startMode: 'auto',
      mode: 'last-man-standing',
    })) as Record<string, unknown>;
    expect(parsed.mode).toBe('last-man-standing');
  });
});

describe('M7 serve:match --mode', () => {
  it('parses every supported mode and defaults to Score Brawl', () => {
    expect(parseServeMatchArgs([]).mode).toBe('score-brawl');
    for (const mode of ['score-brawl', 'last-man-standing', 'deathmatch']) {
      expect(parseServeMatchArgs([`--mode=${mode}`]).mode).toBe(mode);
    }
  });

  it('fails clearly on an unknown mode instead of falling back', async () => {
    expect(() => parseServeMatchArgs(['--mode=duel']))
      .toThrow('Invalid mode: duel (expected score-brawl, last-man-standing, deathmatch)');
    await expect(startMatchServer({
      host: '127.0.0.1',
      port: 0,
      mode: 'duel' as unknown as ModeId,
    })).rejects.toThrow('Invalid match mode: duel');
    expect(() => new AuthoritativeWsSession({ mode: 'duel' as unknown as ModeId }))
      .toThrow('Unsupported match mode: duel');
  });
});

describe('M7 match server in a rules-driven mode', () => {
  it('serves Deathmatch snapshots that clients decode', async (ctx: TestContext) => {
    let server: MatchServerHandle;
    try {
      server = await startMatchServer({
        host: '127.0.0.1',
        port: 0,
        playerIds: ['P1', 'P2'],
        mode: 'deathmatch',
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

    expect(server.ready.mode).toBe('deathmatch');
    expect(server.room.modeValue).toBe('deathmatch');

    const snapshots: StateSnapshot[] = [];
    const protocolErrors: string[] = [];
    const handlers: SessionClientHandlers = {
      onSnapshot: snapshot => snapshots.push(snapshot),
      onProtocolError: message => protocolErrors.push(message),
    };
    const url = `ws://127.0.0.1:${server.port}`;
    const clients: NodeSession[] = [];
    for (const playerId of ['P1', 'P2']) {
      const client = await openNodeSession({ url, handlers });
      openClients.push(client);
      clients.push(client);
      client.client.join([playerId]);
    }

    const snapshot = await waitFor('a decoded Deathmatch snapshot',
      () => snapshots.find(candidate => candidate.state.mode === 'deathmatch'));
    expect(snapshot.state.fighters.map(fighter => [fighter.frags, fighter.deaths]))
      .toEqual([[0, 0], [0, 0]]);
    for (const fighter of snapshot.state.fighters) {
      expect(fighter.damageDealt).toBe(0);
      expect(fighter).not.toHaveProperty('eliminated');
    }
    expect(protocolErrors).toEqual([]);
    expect(server.room.phase).toBe('running');

    for (const client of clients) client.close();
  }, 20000);
});
