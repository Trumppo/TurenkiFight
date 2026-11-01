import { expect, test } from '@playwright/test';
import { startSignalingServer, type SignalingServerHandle } from '../../server/signaling/signalingServer';

/**
 * ONE real-browser architecture-B integration test.
 *
 * Two Chromium pages (host and client) negotiate a loopback WebRTC DataChannel
 * through a room-scoped signaling relay started on an ephemeral port for this
 * test. The host then accepts one slot and one authorized input through the
 * existing authoritative session.
 *
 * If the Chromium build has no `RTCPeerConnection` at all, the test skips with
 * an explicit reason instead of failing the suite.
 */

const ROOM = 'playwright-webrtc';

test('browser host accepts one WebRTC client slot and one input', async ({ browser }) => {
  test.setTimeout(90_000);

  const hostContext = await browser.newContext();
  const clientContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const clientPage = await clientContext.newPage();
  let signaling: SignalingServerHandle | null = null;

  try {
    signaling = await startSignalingServer({ port: 0, host: '127.0.0.1', roomId: ROOM });
    const signalingUrl = `ws://127.0.0.1:${signaling.port}`;

    await Promise.all([hostPage.goto('/'), clientPage.goto('/')]);

    const webrtcAvailable = await hostPage.evaluate(
      () => typeof (globalThis as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection === 'function',
    );
    test.skip(!webrtcAvailable, 'RTCPeerConnection is unavailable in this Chromium build');

    await hostPage.evaluate(async ({ signalingUrl, roomId }) => {
      // Vite serves the TypeScript modules directly in development.
      const modulePath = '/src/game/networking/browserWebrtcHost.ts';
      const mod = await import(modulePath) as {
        openBrowserWebrtcHost: (options: unknown) => Promise<unknown>;
      };
      const host = await mod.openBrowserWebrtcHost({
        signalingUrl,
        roomId,
        playerIds: ['P1'],
        snapshotHz: 20,
        timeoutMs: 30_000,
      });
      (globalThis as unknown as { __webrtcHost?: unknown }).__webrtcHost = host;
    }, { signalingUrl, roomId: ROOM });

    await expect.poll(
      () => hostPage.evaluate(() => {
        const host = (globalThis as unknown as {
          __webrtcHost?: { session: { phase: string } };
        }).__webrtcHost;
        return host?.session.phase ?? 'missing';
      }),
      { timeout: 30_000 },
    ).toBe('lobby');

    await clientPage.evaluate(async ({ signalingUrl, roomId }) => {
      const modulePath = '/src/game/networking/browserWebrtcAdapter.ts';
      const mod = await import(modulePath) as {
        openBrowserWebrtcSession: (options: unknown) => Promise<unknown>;
      };
      const events: string[] = [];
      const session = await mod.openBrowserWebrtcSession({
        signalingUrl,
        roomId,
        timeoutMs: 30_000,
        handlers: {
          onJoinResult: (result: { accepted: boolean; playerIds: string[] }) =>
            events.push(`join:${String(result.accepted)}:${result.playerIds.join(',')}`),
          onMatchStart: () => events.push('match-start'),
          onSnapshot: (snapshot: { state: { tick: number } }) => events.push(`snapshot:${snapshot.state.tick}`),
          onError: (error: { code: string }) => events.push(`error:${error.code}`),
          onSessionClosed: (reason: string) => events.push(`closed:${reason}`),
          onTransportClosed: () => events.push('transport-closed'),
        },
      });
      const bridge = globalThis as unknown as { __webrtcClient?: unknown; __webrtcEvents?: string[] };
      bridge.__webrtcClient = session;
      bridge.__webrtcEvents = events;
    }, { signalingUrl, roomId: ROOM });

    // The host has registered the DataChannel before the client resolved.
    await expect.poll(
      () => hostPage.evaluate(() => {
        const host = (globalThis as unknown as { __webrtcHost?: { session: { connectionCount: number } } })
          .__webrtcHost;
        return host?.session.connectionCount ?? -1;
      }),
      { timeout: 30_000 },
    ).toBe(1);

    const joinSequence = await clientPage.evaluate(() => {
      const client = (globalThis as unknown as { __webrtcClient: { client: { join(ids: string[]): number } } })
        .__webrtcClient;
      return client.client.join(['P1']);
    });
    expect(joinSequence).toBe(1);

    await expect.poll(
      () => hostPage.evaluate(() => {
        const host = (globalThis as unknown as { __webrtcHost?: { session: { playerCount: number } } })
          .__webrtcHost;
        return host?.session.playerCount ?? -1;
      }),
      { timeout: 30_000 },
    ).toBe(1);
    await expect.poll(
      () => hostPage.evaluate(() => {
        const host = (globalThis as unknown as { __webrtcHost?: { session: { phase: string } } }).__webrtcHost;
        return host?.session.phase ?? 'missing';
      }),
      { timeout: 30_000 },
    ).toBe('starting');

    const owned = await clientPage.evaluate(() => {
      const client = (globalThis as unknown as {
        __webrtcClient: { client: { sessionState: string; ownedPlayerIds: string[] } };
      }).__webrtcClient;
      return { state: client.client.sessionState, owned: client.client.ownedPlayerIds };
    });
    expect(owned).toEqual({ state: 'joined', owned: ['P1'] });

    const started = await hostPage.evaluate(() => {
      const host = (globalThis as unknown as { __webrtcHost: { session: { beginMatch(): boolean } } })
        .__webrtcHost;
      return host.session.beginMatch();
    });
    expect(started).toBe(true);

    await expect.poll(
      () => clientPage.evaluate(() => {
        const client = (globalThis as unknown as {
          __webrtcClient: { client: { matchStart: { startTick: number } | null } };
        }).__webrtcClient;
        return client.client.matchStart?.startTick ?? -1;
      }),
      { timeout: 30_000 },
    ).toBe(0);

    await clientPage.evaluate(() => {
      const client = (globalThis as unknown as {
        __webrtcClient: { client: { submitInput(tick: number, inputs: unknown[]): number } };
      }).__webrtcClient;
      client.client.submitInput(0, [{ playerId: 'P1', moveX: 1, moveY: 0, jump: false }]);
    });

    await expect.poll(
      () => hostPage.evaluate(() => {
        const host = (globalThis as unknown as { __webrtcHost?: { session: { bufferedTicks: number } } })
          .__webrtcHost;
        return host?.session.bufferedTicks ?? -1;
      }),
      { timeout: 30_000 },
    ).toBe(1);

    const step = await hostPage.evaluate(() => {
      const host = (globalThis as unknown as {
        __webrtcHost: { session: { stepOnce(): { stepped: boolean; tick: number } } };
      }).__webrtcHost;
      return host.session.stepOnce();
    });
    expect(step).toMatchObject({ stepped: true, tick: 1 });

    // 20 Hz snapshots are emitted on every third tick; advance to tick 3.
    const later = await hostPage.evaluate(() => {
      const host = (globalThis as unknown as {
        __webrtcHost: { session: { stepOnce(): { stepped: boolean; tick: number } } };
      }).__webrtcHost;
      host.session.stepOnce();
      return host.session.stepOnce();
    });
    expect(later).toMatchObject({ stepped: true, tick: 3 });

    await expect.poll(
      () => clientPage.evaluate(() => {
        const client = (globalThis as unknown as {
          __webrtcClient: { client: { lastSnapshot: { state: { tick: number } } | null } };
        }).__webrtcClient;
        return client.client.lastSnapshot?.state.tick ?? -1;
      }),
      { timeout: 30_000 },
    ).toBe(3);

    const outcome = await clientPage.evaluate(() => {
      const bridge = globalThis as unknown as {
        __webrtcClient: {
          client: {
            lastSnapshot: { state: { fighters: { id: string; x: number }[] } } | null;
          };
        };
        __webrtcEvents: string[];
      };
      const fighter = bridge.__webrtcClient.client.lastSnapshot?.state.fighters[0];
      return { fighter, events: bridge.__webrtcEvents };
    });
    // P1 spawns at x=70; one accepted moveX=1 input moves it right.
    expect(outcome.fighter?.id).toBe('P1');
    expect(outcome.fighter?.x).toBeGreaterThan(70);
    expect(outcome.events.filter(event => event.startsWith('error:'))).toEqual([]);
    expect(outcome.events).toContain('join:true:P1');
  } finally {
    await hostContext.close().catch(() => undefined);
    await clientContext.close().catch(() => undefined);
    if (signaling) await signaling.close().catch(() => undefined);
  }
});
