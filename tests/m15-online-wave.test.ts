import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { botInput } from '../src/game/input/botPolicy';
import { stateSnapshotFingerprint } from '../src/game/protocol/fingerprint';
import { encodeClientEnvelope } from '../src/game/session/sessionEnvelope';
import type { PlayerInput, Team } from '../src/game/simulation/types';
import {
  AuthoritativeWsSession,
  DEFAULT_WAVE_BOT_SEED,
  type WsSessionOptions,
  type WsSessionPhase,
} from '../server/ws/authoritativeWsSession';
import {
  parseServeMatchArgs,
  serveMatchUsage,
  startMatchServer,
  type MatchServerHandle,
} from '../server/ws/matchServer';
import { openNodeSession, type NodeSession } from '../server/ws/nodeWsClient';

/**
 * M15-ONLINE-WAVE: the authoritative server accepts `wave`, splits connected
 * humans from unclaimed bot enemies, refuses unwinnable starts with a typed
 * reason and stays deterministic. The real two-client test below starts the
 * same interval-tick server `serve:match` uses; nothing in the simulation is
 * stubbed.
 */

const WAVE_ROSTER = ['P1', 'P2', 'E1', 'E2'] as const;

function captureRoom(options: WsSessionOptions = {}): {
  room: AuthoritativeWsSession;
  phases: WsSessionPhase[];
} {
  const phases: WsSessionPhase[] = [];
  const room = new AuthoritativeWsSession({
    roomId: 'ws-wave',
    ...options,
    onPhaseChange: phase => phases.push(phase),
  });
  return { room, phases };
}

function join(room: AuthoritativeWsSession, connectionId: string, playerIds: string[], sequence = 1): void {
  room.handleMessage(connectionId, encodeClientEnvelope({
    version: 1,
    kind: 'join-request',
    sequence,
    playerIds,
  }));
}

function joinHumans(room: AuthoritativeWsSession, playerIds: readonly string[]): void {
  playerIds.forEach((playerId, index) => {
    room.addConnection(`conn-${index + 1}`);
    join(room, `conn-${index + 1}`, [playerId]);
  });
}

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
      // Already closed by the server.
    }
  }
  for (const server of openServers.splice(0)) {
    await server.close();
  }
});

describe('M15 serve:match accepts wave', () => {
  it('parses --mode=wave and documents the bot enemy rule', () => {
    expect(parseServeMatchArgs(['--mode=wave']).mode).toBe('wave');
    expect(parseServeMatchArgs(['--mode', 'wave', '--players=4', '--start=manual'])).toMatchObject({
      mode: 'wave',
      playerIds: ['P1', 'P2', 'P3', 'P4'],
      startMode: 'manual',
    });
    expect(serveMatchUsage()).toContain('wave');
    // Unknown mode strings are still rejected instead of falling back.
    expect(() => parseServeMatchArgs(['--mode=duel'])).toThrow(/Invalid mode/);
  });

  it('refuses a wave match with no human or no enemy slot, with a typed reason', async (ctx: TestContext) => {
    let server: MatchServerHandle;
    try {
      server = await startMatchServer({
        host: '127.0.0.1',
        port: 0,
        playerIds: ['P1', 'P2'],
        mode: 'wave',
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
    // No human claims a slot yet.
    expect(server.start()).toEqual({ started: false, reason: 'wave-needs-humans' });

    // Both configured slots claimed by humans leaves no enemy.
    const url = `ws://127.0.0.1:${server.port}`;
    for (let index = 0; index < 2; index++) {
      const joined = deferred<void>();
      const session = await openNodeSession({
        url,
        handlers: {
          onJoinResult: result => result.accepted ? joined.resolve() : undefined,
        },
      });
      openClients.push(session);
      session.client.join([['P1', 'P2'][index]]);
      await joined.promise;
    }
    expect(server.room.playerCount).toBe(2);
    expect(server.start()).toEqual({ started: false, reason: 'wave-needs-enemies' });
    expect(server.room.phase).toBe('starting');
  });

  it('rejects an unknown mode at server creation', async () => {
    await expect(startMatchServer({ port: 0, mode: 'duel' as never }))
      .rejects.toThrow(/Invalid match mode/);
  });
});

describe('M15 wave team split and enemy authority', () => {
  it('freezes claimed slots as players and unclaimed slots as bot enemies', () => {
    const { room, phases } = captureRoom({ playerIds: [...WAVE_ROSTER], mode: 'wave' });
    joinHumans(room, ['P1', 'P2']);
    expect(phases).toContain('starting');
    expect(room.matchStartRefusal()).toBeNull();
    expect(room.beginMatch()).toBe(true);
    expect(room.phase).toBe('running');

    const state = room.snapshot().state;
    expect(state.mode).toBe('wave');
    expect(state.fighters.map(fighter => [fighter.id, fighter.team])).toEqual([
      ['P1', 'players'],
      ['P2', 'players'],
      ['E1', 'enemies'],
      ['E2', 'enemies'],
    ]);
    expect(state.wave).toEqual({ index: 0, countdownTicks: 0, remaining: 1 });
    // Enemy slots are eliminated until their wave activates them, exactly as
    // the M13 simulation defines.
    expect(state.fighters.find(fighter => fighter.id === 'E2')?.eliminated).toBe(true);
  });

  it('drives an enemy with the seeded bot even when no human input exists', () => {
    const { room } = captureRoom({ playerIds: [...WAVE_ROSTER], mode: 'wave' });
    joinHumans(room, ['P1', 'P2']);
    expect(room.beginMatch()).toBe(true);
    const before = room.snapshot().state.fighters.find(fighter => fighter.id === 'E1');
    for (let tick = 0; tick < 60; tick++) room.stepOnce();
    const after = room.snapshot().state.fighters.find(fighter => fighter.id === 'E1');
    expect(after?.x).not.toBe(before?.x);
  });

  it('rejects client input for an enemy slot and leaves the run byte-identical', () => {
    const run = (sendSpoofedEnemyInput: boolean): string => {
      const { room } = captureRoom({ playerIds: [...WAVE_ROSTER], mode: 'wave' });
      joinHumans(room, ['P1', 'P2']);
      expect(room.beginMatch()).toBe(true);
      if (sendSpoofedEnemyInput) {
        const denial = room.handleMessage('conn-1', encodeClientEnvelope({
          version: 1,
          kind: 'input',
          sequence: 2,
          targetTick: room.tick + 2,
          frame: {
            version: 1,
            tick: room.tick + 2,
            inputs: [{ playerId: 'E1', moveX: -1, moveY: 0, jump: false }],
          },
        }));
        expect(denial).toMatchObject({ accepted: false, code: 'unauthorized-player' });
      }
      for (let tick = 0; tick < 240; tick++) room.stepOnce();
      return stateSnapshotFingerprint(room.snapshot());
    };
    expect(run(true)).toBe(run(false));
  });
});

describe('M15 wave determinism', () => {
  it('replays the same roster, seed and inputs to the same wave outcomes', () => {
    const scriptedInput = (tick: number): PlayerInput => ({
      playerId: 'P1',
      moveX: tick % 120 < 60 ? 1 : -1,
      moveY: 0,
      jump: false,
      punch: tick % 17 === 0,
      kick: tick % 23 === 0,
    });
    const run = (): { fingerprint: string; tick: number; wave: unknown } => {
      const { room } = captureRoom({ playerIds: [...WAVE_ROSTER], mode: 'wave' });
      joinHumans(room, ['P1', 'P2']);
      expect(room.beginMatch()).toBe(true);
      for (let tick = 0; tick < 900; tick++) {
        // The human input is submitted one tick ahead through the authorized
        // gateway, so both runs exercise the identical input path.
        const targetTick = room.tick + 1;
        room.handleMessage('conn-1', encodeClientEnvelope({
          version: 1,
          kind: 'input',
          sequence: tick + 2,
          targetTick,
          frame: { version: 1, tick: targetTick, inputs: [scriptedInput(tick)] },
        }));
        room.stepOnce();
      }
      const snapshot = room.snapshot();
      return {
        fingerprint: stateSnapshotFingerprint(snapshot),
        tick: snapshot.state.tick,
        wave: snapshot.state.wave,
      };
    };
    const first = run();
    const second = run();
    expect(second).toEqual(first);
    expect(first.tick).toBe(900);
    expect(first.wave).toBeDefined();
  });
});

describe('M15 real two-client wave match', () => {
  it('starts with two humans and two bot enemies, clears waves and ends waves-cleared', async (ctx: TestContext) => {
    let server: MatchServerHandle;
    try {
      server = await startMatchServer({
        host: '127.0.0.1',
        port: 0,
        playerIds: [...WAVE_ROSTER],
        mode: 'wave',
        startMode: 'manual',
        startDelayMs: 0,
        firstTickDelayMs: 0,
        snapshotHz: 20,
        rejoinWindowMs: 0,
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
    const joins = [deferred<void>(), deferred<void>()];
    const errors: string[][] = [[], []];
    const snapshotCounts = [0, 0];
    const waveSeen: Array<{ index: number; countdownTicks: number; remaining: number }> = [];
    const teams = new Map<string, Team | undefined>();
    const matchEnd = deferred<{ reason: string; winner: string | null }>();
    const clients: NodeSession[] = [];

    for (let index = 0; index < 2; index++) {
      const playerId = ['P1', 'P2'][index];
      const session = await openNodeSession({
        url,
        handlers: {
          onJoinResult: result => result.accepted
            ? joins[index].resolve()
            : joins[index].reject?.(new Error(`join denied: ${result.code ?? 'unknown'}`)),
          onSnapshot: snapshot => {
            snapshotCounts[index] += 1;
            const wave = snapshot.state.wave;
            if (wave) waveSeen.push({ ...wave });
            for (const fighter of snapshot.state.fighters) teams.set(fighter.id, fighter.team);
          },
          onError: error => errors[index].push(error.code),
          onMatchEnd: (_tick, result) => {
            if (result) matchEnd.resolve({ reason: result.reason, winner: result.winner });
          },
        },
      });
      openClients.push(session);
      clients.push(session);
      session.client.join([playerId]);
    }

    await Promise.all(joins.map(joinResult => joinResult.promise));
    expect(server.room.phase).toBe('starting');
    expect(server.start()).toEqual({ started: true });
    await waitFor('wave match running', () => server.room.phase === 'running' && server.room.tick >= 2);
    await waitFor('first snapshot on both clients', () => snapshotCounts.every(count => count > 0));

    // Two humans are players, two unclaimed slots are bot enemies.
    expect(Object.fromEntries([...teams].sort(([a], [b]) => a.localeCompare(b)))).toEqual({
      E1: 'enemies',
      E2: 'enemies',
      P1: 'players',
      P2: 'players',
    });

    // Drive both humans with the same deterministic bot policy from the
    // received snapshots. One frame is sent at a time inside the server's
    // bounded look-ahead window; the server stays authoritative and the enemy
    // slots are still driven only by the server.
    const timers: Array<ReturnType<typeof setInterval>> = [];
    clients.forEach((session, index) => {
      const playerId = ['P1', 'P2'][index];
      let lastSent = -1;
      timers.push(setInterval(() => {
        if (server.room.phase !== 'running') return;
        const state = session.client.lastSnapshot?.state;
        if (!state || state.phase !== 'fighting') return;
        const candidate = lastSent + 1;
        const target = candidate >= state.tick + 4 ? candidate : state.tick + 4;
        if (target > state.tick + 7) return;
        try {
          session.client.submitInput(target, [botInput(state, playerId, DEFAULT_WAVE_BOT_SEED)]);
        } catch {
          return;
        }
        lastSent = target;
      }, 8));
    });

    try {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let ended: { reason: string; winner: string | null };
      try {
        ended = await Promise.race([
          matchEnd.promise,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Timed out waiting for the wave match to end')), 110_000);
          }),
        ]);
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }
      expect(ended.reason).toBe('waves-cleared');

      // Wave transitions observed on the wire: wave 1 is fought at index 0,
      // later waves follow with a non-zero inter-wave countdown.
      const indexes = new Set(waveSeen.map(wave => wave.index));
      expect(indexes.has(0)).toBe(true);
      expect(indexes.has(1)).toBe(true);
      expect(indexes.has(2)).toBe(true);
      expect(waveSeen.some(wave => wave.remaining === 0 && wave.countdownTicks > 0)).toBe(true);

      // The authoritative event log carries the M13 end reason.
      const matchEnded = [...server.room.orderedEvents()].reverse()
        .find(event => event.type === 'MatchEnded');
      expect(matchEnded).toMatchObject({ type: 'MatchEnded', reason: 'waves-cleared' });
      expect(server.room.snapshot().state.phase).toBe('results');
      // No client ever steered an enemy slot.
      expect(errors.flat().filter(code => code === 'unauthorized-player')).toEqual([]);
    } finally {
      for (const timer of timers) clearInterval(timer);
    }
    expect(server.room.phase).toBe('results');
  }, 125_000);

  it('refuses to let a client claim an enemy slot after the match starts', async (ctx: TestContext) => {
    let server: MatchServerHandle;
    try {
      server = await startMatchServer({
        host: '127.0.0.1',
        port: 0,
        playerIds: [...WAVE_ROSTER],
        mode: 'wave',
        startMode: 'manual',
        startDelayMs: 0,
        firstTickDelayMs: 0,
        snapshotHz: 20,
        connectionMargin: 1,
        rejoinWindowMs: 0,
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
    const joined = deferred<void>();
    const human = await openNodeSession({
      url,
      handlers: { onJoinResult: result => result.accepted ? joined.resolve() : undefined },
    });
    openClients.push(human);
    human.client.join(['P1']);
    await joined.promise;
    expect(server.start()).toEqual({ started: true });
    await waitFor('wave match running', () => server.room.phase === 'running');

    const denial = deferred<string>();
    const latecomer = await openNodeSession({
      url,
      handlers: { onError: error => denial.resolve(error.code) },
    });
    openClients.push(latecomer);
    latecomer.client.join(['E1']);
    expect(await denial.promise).toBe('match-started');
    expect(server.room.snapshot().state.fighters.find(fighter => fighter.id === 'E1')?.team).toBe('enemies');
  }, 30_000);
});
