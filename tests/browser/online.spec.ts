import { createServer } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { startMatchServer, type MatchServerHandle } from '../../server/ws/matchServer';
import { openNodeSession, type NodeSession } from '../../server/ws/nodeWsClient';

/**
 * Real-browser integration for the online entry page.
 *
 * The test starts the real match server (not the benchmark fixture driver),
 * opens two browser clients (P1 and P2), lets the server start the match and
 * verifies that holding a movement key changes the rendered P1 position. The
 * second client exists only to fill the roster, exactly like a human or bot
 * would. If the host refuses the socket bind the test skips with the reason
 * instead of failing the suite.
 */

type RenderedFighter = { id: string; x: number; y: number };

type OnlineBridge = {
  state: string;
  snapshotCount: number;
  rttMs: number | null;
  tick: number;
  renderedFighters(): RenderedFighter[];
  statusText(): string;
  metricsText(): string;
  hudFontSize(): string;
  controller?: { requestHostStart(): number };
  arenaId(): string;
  arenaBackdropTexture(): string | null;
};

async function renderedX(page: Page, id: string): Promise<number | null> {
  return page.evaluate((playerId: string) => {
    const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
    if (!api) return null;
    return api.renderedFighters().find(fighter => fighter.id === playerId)?.x ?? null;
  }, id);
}

async function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

test('online page joins P1, sends input and renders authoritative snapshots', async ({ browser }) => {
  test.setTimeout(60_000);
  let server: MatchServerHandle | null = null;
  try {
    server = await startMatchServer({
      host: '127.0.0.1',
      port: 0,
      playerIds: ['P1', 'P2'],
      snapshotHz: 20,
      startDelayMs: 50,
      firstTickDelayMs: 50,
    });
  } catch (error) {
    test.skip(true, `WebSocket server could not bind: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const context = await browser.newContext();
  const p1 = await context.newPage();
  const p2 = await context.newPage();
  const errors: string[] = [];
  p1.on('pageerror', error => errors.push(`P1: ${error.message}`));
  p2.on('pageerror', error => errors.push(`P2: ${error.message}`));

  try {
    const url = server.url;
    expect(url).not.toBeNull();
    const query = `?server=${encodeURIComponent(url!)}&player=`;

    await p1.goto('/online.html');
    await p1.fill('#server-url', url!);
    await p1.selectOption('#room-player-count', '2');
    await p1.selectOption('#player-slot', 'P1');
    await p1.click('#online-connect');
    await expect(p1.locator('#game canvas')).toBeVisible();
    await expect.poll(() => p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.state ?? 'missing';
    })).toBe('joined');

    await p2.goto(`/online.html${query}P2`);
    await expect.poll(() => p2.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.state ?? 'missing';
    })).toMatch(/joined|running/);

    for (const page of [p1, p2]) {
      await expect.poll(() => page.evaluate(() => {
        const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
        return api?.state ?? 'missing';
      }), { timeout: 10_000 }).toBe('running');
      await expect.poll(() => page.evaluate(() => {
        const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
        return api?.snapshotCount ?? 0;
      }), { timeout: 10_000 }).toBeGreaterThan(0);
    }

    const before = await renderedX(p1, 'P1');
    expect(before).not.toBeNull();

    await p1.keyboard.down('d');
    await p1.waitForTimeout(700);
    await p1.keyboard.up('d');

    await expect.poll(() => renderedX(p1, 'P1'), { timeout: 10_000 })
      .toBeGreaterThan((before ?? 0) + 20);

    const measured = await p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      if (!api) throw new Error('Online test hook is missing');
      return {
        snapshotCount: api.snapshotCount,
        rttMs: api.rttMs,
        status: api.statusText(),
        metrics: api.metricsText(),
        hudFontSize: api.hudFontSize(),
      };
    });
    expect(measured.snapshotCount).toBeGreaterThan(0);
    expect(measured.rttMs).not.toBeNull();
    expect(measured.rttMs).toBeGreaterThanOrEqual(0);
    expect(measured.status).toMatch(/Match started|Receiving snapshots/i);
    expect(measured.metrics).toMatch(/SNAP \d+/);
    expect(Number.parseFloat(measured.hudFontSize)).toBeGreaterThanOrEqual(14);
    expect(errors).toEqual([]);
  } finally {
    await p1.close().catch(() => undefined);
    await p2.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
  }
});

test('online browser can claim P8 and render the complete eight-player authoritative roster', async ({ browser }) => {
  test.setTimeout(60_000);
  const ids = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
  let server: MatchServerHandle | null = null;
  try {
    server = await startMatchServer({
      host: '127.0.0.1', port: 0, playerIds: ids, snapshotHz: 20, startDelayMs: 50, firstTickDelayMs: 50,
    });
  } catch (error) {
    test.skip(true, `WebSocket server could not bind: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const peers: NodeSession[] = [];
  try {
    await page.goto('/online.html');
    await expect(page.locator('#player-slot option')).toHaveCount(8);
    await expect(page.locator('#player-slot')).toContainText('P8');
    await page.fill('#server-url', server.url!);
    await page.fill('#room-code', '');
    await page.selectOption('#player-slot', 'P8');
    await page.selectOption('#room-player-count', '8');
    await page.click('#online-connect');
    await expect(page.locator('#online-connect-form')).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.state ?? 'missing';
    })).toBe('joined');

    for (const playerId of ids.slice(0, 7)) {
      let accept!: () => void;
      let reject!: (error: Error) => void;
      const joined = new Promise<void>((resolve, rejectJoin) => { accept = resolve; reject = rejectJoin; });
      const session = await openNodeSession({
        url: server.url!,
        handlers: { onJoinResult: result => result.accepted ? accept() : reject(new Error(`Join denied: ${playerId}`)) },
      });
      peers.push(session);
      session.client.join([playerId]);
      await joined;
    }

    await expect.poll(() => page.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.state ?? 'missing';
    }), { timeout: 10_000 }).toBe('running');
    await expect.poll(() => renderedX(page, 'P8'), { timeout: 10_000 }).not.toBeNull();
    expect(await page.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.renderedFighters().map(fighter => fighter.id).sort() ?? [];
    })).toEqual(ids);
  } finally {
    for (const peer of peers) peer.close();
    await Promise.all(peers.map(peer => peer.closed.catch(() => undefined)));
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
  }
});

test('manual room lobby gates host start on every player ready and rejects a guest start request', async ({ browser }) => {
  test.setTimeout(45_000);
  let server: MatchServerHandle | null = null;
  try {
    server = await startMatchServer({
      host: '127.0.0.1', port: 0, playerIds: ['P1', 'P2'], startMode: 'manual',
      snapshotHz: 20, startDelayMs: 0, firstTickDelayMs: 20,
    });
  } catch (error) {
    test.skip(true, `WebSocket server could not bind: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const context = await browser.newContext();
  const host = await context.newPage();
  const guest = await context.newPage();
  const errors: string[] = [];
  host.on('pageerror', error => errors.push(`host: ${error.message}`));
  guest.on('pageerror', error => errors.push(`guest: ${error.message}`));
  try {
    const query = `?server=${encodeURIComponent(server.url!)}&player=`;
    await host.goto('/online.html');
    await host.fill('#server-url', server.url!);
    await host.selectOption('#room-player-count', '2');
    await host.selectOption('#player-slot', 'P1');
    await host.click('#online-connect');
    await expect.poll(() => host.evaluate(() => (window as any).__turenkiOnline?.state)).toBe('joined');
    await guest.goto(`/online.html${query}P2`);
    for (const page of [host, guest]) {
      await expect(page.locator('#online-lobby')).toBeVisible();
      await expect(page.locator('#online-lobby-summary')).toContainText('2');
    }

    await expect(host.locator('#online-host-start')).toBeVisible();
    await expect(guest.locator('#online-host-start')).toBeHidden();
    await host.locator('#online-ready').click();
    await expect(host.locator('#online-lobby-roster')).toContainText('P1 READY');
    await expect(host.locator('#online-host-start')).toBeDisabled();

    // Hiding the host-only button is presentation; the server must still reject
    // a forged start request from the joined guest connection.
    await guest.evaluate(() => (window as any).__turenkiOnline.controller.requestHostStart());
    await expect.poll(() => server!.room.phase).toBe('starting');
    await expect(host.locator('#online-host-start')).toBeDisabled();

    await guest.locator('#online-ready').click();
    await expect(host.locator('#online-lobby-roster')).toContainText('P2 READY');
    await expect(host.locator('#online-host-start')).toBeEnabled();
    await host.locator('#online-host-start').click();
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => (window as any).__turenkiOnline?.state), { timeout: 10_000 })
        .toBe('running');
    }
    expect(errors).toEqual([]);
  } finally {
    await host.close().catch(() => undefined);
    await guest.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
  }
});

test('browser-created room applies mode, arena, roster and timer through the complete results flow', async ({ browser }) => {
  test.setTimeout(100_000);
  const server = await startMatchServer({
    host: '127.0.0.1', port: 0, playerIds: ['P1', 'P2'], startMode: 'manual',
    snapshotHz: 10, startDelayMs: 0, firstTickDelayMs: 1,
  });
  const context = await browser.newContext();
  const host = await context.newPage();
  const guest = await context.newPage();
  try {
    await host.goto('/online.html');
    await host.fill('#server-url', server.url!);
    await host.selectOption('#room-mode', 'deathmatch');
    await host.selectOption('#room-arena', 'mesku');
    await host.selectOption('#room-player-count', '2');
    await host.selectOption('#room-duration', '1');
    await host.click('#online-connect');
    await expect.poll(() => host.evaluate(() => (window as any).__turenkiOnline?.state)).toBe('joined');
    await expect.poll(() => host.evaluate(() => (window as any).__turenkiOnline?.controller.lobbyState)).toMatchObject({
      requiredPlayerIds: ['P1', 'P2'], playerIds: ['P1'], mode: 'deathmatch', arena: 'mesku', durationMinutes: 1,
    });
    await expect.poll(() => host.evaluate(() => (window as any).__turenkiOnline?.arenaId())).toBe('mesku');
    await expect.poll(() => host.evaluate(() => (window as any).__turenkiOnline?.arenaBackdropTexture()))
      .toBe('arena-mesku-backdrop');
    expect(server.room.snapshot().state).toMatchObject({ mode: 'deathmatch', arena: 'mesku' });
    expect(server.room.snapshot().state.remainingTicks).toBeLessThanOrEqual(3600);

    await guest.goto('/online.html');
    await guest.fill('#server-url', server.url!);
    await guest.selectOption('#player-slot', 'P2');
    await guest.selectOption('#room-player-count', '2');
    await guest.click('#online-connect');
    await expect(guest.locator('#online-status')).toContainText('room-config-refused');
    expect(server.room.playerCount).toBe(1); // rejected create request allocated no guest slot
    await guest.selectOption('#room-action', 'join');
    await guest.click('#online-connect');
    await expect.poll(() => guest.evaluate(() => (window as any).__turenkiOnline?.state)).toBe('joined');
    await expect.poll(() => guest.evaluate(() => (window as any).__turenkiOnline?.arenaId())).toBe('mesku');
    await expect.poll(() => guest.evaluate(() => (window as any).__turenkiOnline?.arenaBackdropTexture()))
      .toBe('arena-mesku-backdrop');
    await host.locator('#online-ready').click();
    await guest.locator('#online-ready').click();
    await expect(host.locator('#online-host-start')).toBeEnabled();
    await host.locator('#online-host-start').click();
    await expect.poll(() => host.evaluate(() => (window as any).__turenkiOnline?.state)).toBe('running');
    expect(server.room.snapshot().state).toMatchObject({ mode: 'deathmatch', arena: 'mesku' });
    expect(server.room.snapshot().state.remainingTicks).toBeLessThanOrEqual(3600);

    await expect(host.locator('#online-result')).toBeVisible({ timeout: 75_000 });
    expect(server.room.phase).toBe('results');
    await expect(host.locator('#online-result-reason')).toContainText(/time/i);
  } finally {
    await host.close().catch(() => undefined);
    await guest.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});

test('host disconnect closes the session with a visible message for the remaining player', async ({ browser }) => {
  test.setTimeout(60_000);
  let server: MatchServerHandle | null = null;
  try {
    server = await startMatchServer({
      host: '127.0.0.1',
      port: 0,
      playerIds: ['P1', 'P2'],
      snapshotHz: 20,
      startDelayMs: 50,
      firstTickDelayMs: 50,
    });
  } catch (error) {
    test.skip(true, `WebSocket server could not bind: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const context = await browser.newContext();
  const host = await context.newPage();
  const guest = await context.newPage();
  try {
    const url = server.url;
    expect(url).not.toBeNull();
    const query = `?server=${encodeURIComponent(url!)}&player=`;
    await host.goto('/online.html');
    await host.fill('#server-url', server.url!);
    await host.selectOption('#room-player-count', '2');
    await host.selectOption('#player-slot', 'P1');
    await host.click('#online-connect');
    await expect.poll(() => host.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.state ?? 'missing';
    })).toBe('joined');
    await guest.goto(`/online.html${query}P2`);
    await expect.poll(() => guest.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.state ?? 'missing';
    }), { timeout: 10_000 }).toBe('running');

    await guest.evaluate(async () => {
      const moduleUrl = '/src/game/simulation/step.ts';
      const simulation = await import(/* @vite-ignore */ moduleUrl);
      const api = (window as any).__turenkiOnline;
      const modeSnapshot = simulation.createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' });
      api.controller.renderState = () => modeSnapshot;
      api.renderHudSnapshotForTest(modeSnapshot);
    });
    await expect(guest.locator('#match-mode')).toHaveText('ONLINE MODE · DEATHMATCH');

    await host.close();
    await expect(guest.locator('#online-status')).toContainText(/Session closed|host disconnected/i, {
      timeout: 10_000,
    });
    await guest.evaluate(() => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(guest.locator('#match-mode')).toHaveText('ONLINE MODE · SCORE BRAWL (SERVER DEFAULT)');
    await expect(guest.locator('#fight-hud')).toBeVisible();
  } finally {
    await host.close().catch(() => undefined);
    await guest.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
  }
});

test('form fallback joins a match when query parameters are missing', async ({ page }) => {
  test.setTimeout(30_000);
  let server: MatchServerHandle | null = null;
  try {
    server = await startMatchServer({
      host: '127.0.0.1',
      port: 0,
      playerIds: ['P1'],
      snapshotHz: 20,
      startDelayMs: 50,
      firstTickDelayMs: 50,
    });
  } catch (error) {
    test.skip(true, `WebSocket server could not bind: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/online.html');
    await expect(page.locator('#online-connect-form')).toBeVisible();
    await page.selectOption('#room-action', 'join');
    await page.fill('#server-url', server.url!);
    await page.selectOption('#player-slot', 'P1');
    await page.click('#online-connect');
    await expect(page.locator('#online-connect-form')).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.state ?? 'missing';
    }), { timeout: 10_000 }).toBe('running');
    await expect.poll(() => page.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.snapshotCount ?? 0;
    }), { timeout: 10_000 }).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    await page.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
  }
});

test('roster rejection shows the denial instead of silently claiming a slot', async ({ browser }) => {
  test.setTimeout(45_000);
  let server: MatchServerHandle | null = null;
  try {
    server = await startMatchServer({
      host: '127.0.0.1',
      port: 0,
      playerIds: ['P1', 'P2'],
      snapshotHz: 20,
      startDelayMs: 50,
      firstTickDelayMs: 50,
    });
  } catch (error) {
    test.skip(true, `WebSocket server could not bind: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  try {
    const url = server.url;
    expect(url).not.toBeNull();
    await first.goto('/online.html');
    await first.fill('#server-url', url!);
    await first.selectOption('#room-player-count', '2');
    await first.selectOption('#player-slot', 'P1');
    await first.click('#online-connect');
    await expect.poll(() => first.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.state ?? 'missing';
    })).toBe('joined');

    await second.goto('/online.html');
    await second.fill('#server-url', url!);
    await second.selectOption('#room-action', 'join');
    await second.selectOption('#player-slot', 'P1');
    await second.click('#online-connect');
    await expect(second.locator('#online-status')).toContainText(/Join denied|player-owned/i, {
      timeout: 10_000,
    });
    expect(await second.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.state ?? 'missing';
    })).toBe('error');
    await expect(second.locator('#online-connect-form')).toBeVisible();
    expect(await first.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.state ?? 'missing';
    })).toBe('joined');
  } finally {
    await first.close().catch(() => undefined);
    await second.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
  }
});

test('failed connection shows a clear error instead of a blank screen', async ({ page }) => {
  test.setTimeout(30_000);
  const port = await unusedPort();
  const url = `ws://127.0.0.1:${port}`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(`/online.html?server=${encodeURIComponent(url)}&player=P1`);
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('#online-status')).toContainText(
    /Could not connect|Connection failed|No join response/i,
    { timeout: 15_000 },
  );
  const text = await page.locator('#online-status').innerText();
  expect(text.length).toBeGreaterThan(20);
  expect(text).toContain(url);
  // The fallback form is reopened so the URL can be corrected, and the HUD is
  // still visible: the failure is visible, not a blank page.
  await expect(page.locator('#online-connect-form')).toBeVisible();
  await expect(page.locator('#fight-hud')).toBeVisible();
  expect(errors).toEqual([]);
});
