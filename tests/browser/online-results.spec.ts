import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startMatchServer, type MatchServerHandle } from '../../server/ws/matchServer';
import type { GameState } from '../../src/game/simulation/types';
import { openNodeSession, type NodeSession } from '../../server/ws/nodeWsClient';

type ResultEntry = { id: string; rank: number; metric: number };
type MatchResult = { reason: string; winner: string | null; ranking: ResultEntry[] };
type OnlineBridge = {
  state: string;
  latestSnapshot(): { phase: string; remainingTicks: number } | null;
  resultPayload(): MatchResult | null;
};

const joinNodePlayer = async (server: MatchServerHandle, playerId: string): Promise<NodeSession> => {
  const url = server.url;
  expect(url).not.toBeNull();
  let accepted!: () => void;
  let denied!: (error: Error) => void;
  const joined = new Promise<void>((resolve, reject) => { accepted = resolve; denied = reject; });
  const session = await openNodeSession({
    url: url!,
    handlers: {
      onJoinResult: result => result.accepted ? accepted() : denied(new Error(`Join denied for ${playerId}`)),
    },
  });
  session.client.join([playerId]);
  await joined;
  return session;
};

/** Only the rendered P1 needs a browser; lightweight real clients fill the server roster. */
const openMatch = async (
  server: MatchServerHandle,
  context: BrowserContext,
  otherIds: readonly string[],
): Promise<{ page: Page; peers: NodeSession[] }> => {
  const page = await context.newPage();
  const url = server.url;
  expect(url).not.toBeNull();
  await page.goto(`/online.html?server=${encodeURIComponent(url!)}&player=P1`);
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
    return api?.state ?? 'missing';
  }), { timeout: 10_000 }).toMatch(/joined|running/);
  const peers: NodeSession[] = [];
  for (const id of otherIds) peers.push(await joinNodePlayer(server, id));
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
    return api?.state ?? 'missing';
  }), { timeout: 10_000 }).toBe('running');
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
    return api?.latestSnapshot()?.phase ?? '';
  }), { timeout: 10_000 }).toBe('fighting');
  return { page, peers };
};

/** Shortens a real authoritative match by setting its remaining time to one tick. */
function finishAtTime(server: MatchServerHandle, scores: readonly number[]): void {
  const roomState = server.room as unknown as { state: GameState };
  roomState.state.remainingTicks = 1;
  scores.forEach((score, index) => {
    if (roomState.state.fighters[index]) roomState.state.fighters[index].score = score;
  });
}

async function closeAll(page: Page | null, peers: readonly NodeSession[], server: MatchServerHandle, context: BrowserContext): Promise<void> {
  for (const peer of peers) peer.close();
  await Promise.all(peers.map(peer => peer.closed.catch(() => undefined)));
  await page?.close().catch(() => undefined);
  await context.close().catch(() => undefined);
  await server.close().catch(() => undefined);
}

test('authoritative winner, reason and full podium render without client-side ranking at desktop and mobile sizes', async ({ browser }) => {
  test.setTimeout(60_000);
  const server = await startMatchServer({
    host: '127.0.0.1', port: 0, playerIds: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'], snapshotHz: 20,
    startDelayMs: 50, firstTickDelayMs: 50,
  });
  const context = await browser.newContext();
  let page: Page | null = null;
  const peers: NodeSession[] = [];
  try {
    const match = await openMatch(server, context, ['P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
    page = match.page;
    peers.push(...match.peers);
    const p1 = page;
    finishAtTime(server, [80, 70, 60, 50, 40, 30, 20, 10]);
    await expect(p1.locator('#online-result')).toBeVisible({ timeout: 10_000 });

    const result = await p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.resultPayload() ?? null;
    });
    expect(result).toEqual({
      reason: 'time', winner: 'P1',
      ranking: [
        { id: 'P1', rank: 1, metric: 80 },
        { id: 'P2', rank: 2, metric: 70 },
        { id: 'P3', rank: 3, metric: 60 },
        { id: 'P4', rank: 4, metric: 50 },
        { id: 'P5', rank: 5, metric: 40 },
        { id: 'P6', rank: 6, metric: 30 },
        { id: 'P7', rank: 7, metric: 20 },
        { id: 'P8', rank: 8, metric: 10 },
      ],
    });
    await expect(p1.locator('#online-result-winner')).toHaveText('P1');
    await expect(p1.locator('#online-result-winner')).toHaveAttribute('aria-label', 'Winner: P1');
    await expect(p1.locator('#online-result-reason')).toHaveText('END REASON · TIME');
    await expect(p1.locator('#online-result-podium .online-result-place').nth(0)).toContainText('2ND');
    await expect(p1.locator('#online-result-podium .online-result-place').nth(0)).toContainText('P2');
    await expect(p1.locator('#online-result-podium .online-result-place').nth(0)).toContainText('SCORE 70');
    await expect(p1.locator('#online-result-podium .online-result-place').nth(1)).toContainText('3RD');
    await expect(p1.locator('#online-result-podium .online-result-place').nth(1)).toContainText('P3');
    await expect(p1.locator('#online-result-podium .online-result-place').nth(1)).toContainText('SCORE 60');
    await expect(p1.locator('#online-result-rest')).toHaveText(
      'PLACES · 4TH P4 · 5TH P5 · 6TH P6 · 7TH P7 · 8TH P8');
    await expect(p1.locator('#online-rematch')).toBeEnabled();
    await expect(p1.locator('#online-result')).toHaveAttribute('aria-live', 'polite');

    const screenshotDir = path.resolve('artifacts');
    await mkdir(screenshotDir, { recursive: true });
    const screenshotPrefix = 'online-results-retro';
    await p1.setViewportSize({ width: 1280, height: 720 });
    await p1.screenshot({ path: path.join(screenshotDir, `${screenshotPrefix}-1280x720.png`) });
    await p1.setViewportSize({ width: 390, height: 844 });
    await expect(p1.locator('#online-result')).toBeVisible();
    await p1.screenshot({ path: path.join(screenshotDir, `${screenshotPrefix}-390x844.png`) });
    const layout = await p1.locator('#online-result').evaluate(panel => {
      const texts = Array.from(panel.querySelectorAll<HTMLElement>('p, h2, li, button'));
      return {
        viewport: { width: innerWidth, height: innerHeight },
        panel: panel.getBoundingClientRect().toJSON(),
        clientHeight: panel.clientHeight,
        scrollHeight: panel.scrollHeight,
        textSizes: texts.map(node => Number.parseFloat(getComputedStyle(node).fontSize)),
        clippedText: texts.some(node => {
          const style = getComputedStyle(node);
          return style.textOverflow === 'ellipsis' || style.whiteSpace === 'nowrap' && node.scrollWidth > node.clientWidth;
        }),
      };
    });
    expect(layout.viewport).toEqual({ width: 390, height: 844 });
    expect(layout.panel.left).toBeGreaterThanOrEqual(0);
    expect(layout.panel.right).toBeLessThanOrEqual(390);
    expect(layout.panel.top).toBeGreaterThanOrEqual(0);
    expect(layout.panel.bottom).toBeLessThanOrEqual(844);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);
    expect(layout.textSizes.every(size => size >= 14)).toBe(true);
    expect(layout.clippedText).toBe(false);
    await p1.locator('#online-leave').focus();
    await p1.keyboard.press('Tab');
    await expect(p1.locator('#online-rematch')).toBeFocused();
    await p1.evaluate(() => {
      const controller = (window as typeof window & { __turenkiOnline?: any }).__turenkiOnline?.controller;
      controller.statusValue = { ...controller.statusValue, message: 'The finished result is ready.' };
    });
    await expect(p1.locator('#online-result')).toBeVisible();
  } finally {
    await closeAll(page, peers, server, context);
  }
});

test('a server-authored draw displays DRAW and does not invent a winner', async ({ browser }) => {
  test.setTimeout(45_000);
  const server = await startMatchServer({ host: '127.0.0.1', port: 0, playerIds: ['P1', 'P2'], snapshotHz: 20,
    startDelayMs: 50, firstTickDelayMs: 50 });
  const context = await browser.newContext();
  let page: Page | null = null;
  const peers: NodeSession[] = [];
  try {
    const match = await openMatch(server, context, ['P2']);
    page = match.page;
    peers.push(...match.peers);
    const p1 = page;
    finishAtTime(server, [0, 0]);
    await expect(p1.locator('#online-result')).toBeVisible({ timeout: 10_000 });
    const result = await p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.resultPayload() ?? null;
    });
    expect(result?.winner).toBeNull();
    expect(result?.ranking.filter(entry => entry.rank === 1).map(entry => entry.id)).toEqual(['P1', 'P2']);
    await expect(p1.locator('#online-result-winner')).toHaveText('DRAW');
    await expect(p1.locator('#online-result-winner')).not.toHaveText(/P[12]/);
    await expect(p1.locator('#online-result-ties')).toHaveText('TIED PLAYERS · P1 · P2');
  } finally {
    await closeAll(page, peers, server, context);
  }
});

test('rematch refusal explains the missing roster and keeps the result card', async ({ browser }) => {
  test.setTimeout(45_000);
  const server = await startMatchServer({ host: '127.0.0.1', port: 0, playerIds: ['P1', 'P2'], snapshotHz: 20,
    startDelayMs: 50, firstTickDelayMs: 50, allowRematch: true });
  const context = await browser.newContext();
  let page: Page | null = null;
  const peers: NodeSession[] = [];
  try {
    const match = await openMatch(server, context, ['P2']);
    page = match.page;
    peers.push(...match.peers);
    const p1 = page;
    finishAtTime(server, [2, 1]);
    await expect(p1.locator('#online-result')).toBeVisible({ timeout: 10_000 });
    peers[0].close();
    await peers[0].closed;
    await expect.poll(() => server.room.connectionCount).toBe(1);
    await p1.getByRole('button', { name: 'REMATCH' }).click();
    await expect(p1.locator('#online-rematch-status')).toHaveText(
      'Rematch refused: everyone must still be connected.', { timeout: 10_000 });
    await expect(p1.locator('#online-result')).toBeVisible();
    await expect(p1.locator('#online-rematch')).toBeEnabled();
    await expect(p1.locator('#online-result-winner')).toHaveText('P1');
  } finally {
    await closeAll(page, peers, server, context);
  }
});

test('disabled rematch gives a readable typed refusal and retains the result', async ({ browser }) => {
  test.setTimeout(45_000);
  const server = await startMatchServer({ host: '127.0.0.1', port: 0, playerIds: ['P1'], snapshotHz: 20,
    startDelayMs: 50, firstTickDelayMs: 50 });
  const context = await browser.newContext();
  let page: Page | null = null;
  const peers: NodeSession[] = [];
  try {
    const match = await openMatch(server, context, []);
    page = match.page;
    const p1 = page;
    finishAtTime(server, [1]);
    await expect(p1.locator('#online-result')).toBeVisible({ timeout: 10_000 });
    await p1.getByRole('button', { name: 'REMATCH' }).click();
    await expect(p1.locator('#online-rematch-status')).toHaveText('Rematch is disabled on this server.', {
      timeout: 10_000,
    });
    await expect(p1.locator('#online-result')).toBeVisible();
    await expect(p1.locator('#online-rematch')).toBeEnabled();
    await p1.locator('#online-leave').click();
    await expect(p1.locator('#online-connect-form')).toBeVisible();
    await expect(p1.locator('#online-result')).toBeHidden();
    await expect(p1.locator('#fight-hud')).toBeVisible();
  } finally {
    await closeAll(page, peers, server, context);
  }
});

test('not-in-results refusal is readable and leaves the finished result visible', async ({ browser }) => {
  test.setTimeout(45_000);
  const server = await startMatchServer({ host: '127.0.0.1', port: 0, playerIds: ['P1'], snapshotHz: 20,
    startDelayMs: 50, firstTickDelayMs: 50, allowRematch: true });
  const context = await browser.newContext();
  let page: Page | null = null;
  const peers: NodeSession[] = [];
  try {
    const match = await openMatch(server, context, []);
    page = match.page;
    const p1 = page;
    finishAtTime(server, [1]);
    await expect(p1.locator('#online-result')).toBeVisible({ timeout: 10_000 });
    // Simulate the server leaving results between display and request, as can
    // happen in a state race. The authoritative handler still emits its typed refusal.
    (server.room as unknown as { phaseValue: string }).phaseValue = 'starting';
    await p1.getByRole('button', { name: 'REMATCH' }).click();
    await expect(p1.locator('#online-rematch-status')).toHaveText(
      'Rematch is only available after a finished match.', { timeout: 10_000 });
    await expect(p1.locator('#online-result')).toBeVisible();
    await expect(p1.locator('#online-result-winner')).toHaveText('P1');
    await expect(p1.locator('#online-rematch')).toBeEnabled();
  } finally {
    await closeAll(page, peers, server, context);
  }
});

test('accepted rematch clears the old result and returns to countdown before a second result', async ({ browser }) => {
  test.setTimeout(60_000);
  const server = await startMatchServer({ host: '127.0.0.1', port: 0, playerIds: ['P1', 'P2'], snapshotHz: 20,
    startDelayMs: 50, firstTickDelayMs: 50, allowRematch: true });
  const context = await browser.newContext();
  let page: Page | null = null;
  const peers: NodeSession[] = [];
  try {
    const match = await openMatch(server, context, ['P2']);
    page = match.page;
    peers.push(...match.peers);
    const p1 = page;
    finishAtTime(server, [2, 1]);
    await expect(p1.locator('#online-result')).toBeVisible({ timeout: 10_000 });
    const firstMatchId = await p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: any }).__turenkiOnline;
      return api.controller.matchStart?.matchId;
    });

    await p1.getByRole('button', { name: 'REMATCH' }).click();
    await expect(p1.locator('#online-rematch-status')).toContainText('Waiting for the others');
    await expect(p1.locator('#online-result')).toBeHidden({ timeout: 10_000 });
    await expect.poll(() => p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.latestSnapshot()?.phase ?? '';
    }), { timeout: 10_000 }).toBe('countdown');
    const secondMatchId = await p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: any }).__turenkiOnline;
      return api.controller.matchStart?.matchId;
    });
    expect(secondMatchId).toBeGreaterThan(firstMatchId);
    await expect(p1.locator('[data-player="P1"] .hud-score')).toHaveText('0');

    await expect.poll(() => p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.latestSnapshot()?.phase ?? '';
    }), { timeout: 20_000 }).toBe('fighting');
    const cleanState = await p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.latestSnapshot() ?? null;
    });
    expect(cleanState?.remainingTicks).toBeGreaterThan(0);
    finishAtTime(server, [0, 0]);
    await expect(p1.locator('#online-result')).toBeVisible({ timeout: 10_000 });
    await expect(p1.locator('#online-result-winner')).toHaveText('DRAW');
    const secondResult = await p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      return api?.resultPayload() ?? null;
    });
    expect(secondResult?.winner).toBeNull();
    expect(secondResult?.reason).toBe('time');
  } finally {
    await closeAll(page, peers, server, context);
  }
});
