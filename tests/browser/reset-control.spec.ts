import { expect, test, type Page } from '@playwright/test';
import { startMatchServer, type MatchServerHandle } from '../../server/ws/matchServer';

/**
 * M9-RESET-CONTROL browser proof.
 *
 * Local RESET (HUD button and Esc) must rebuild the lobby in place: no page
 * reload, roster and mode kept, match state discarded. A second reset in the
 * lobby clears bots and joined slots back to P1 only. Online LEAVE must close
 * the socket and restore the join form without keeping the departed match's
 * mode, snapshots or page instance.
 */

type SceneView = {
  phase: string;
  tick: number;
  remainingTicks: number;
  mode: string;
  ids: string[];
  fighters: Array<{ score: number; frags: number | null; deaths: number | null; health: number }>;
  events: string[];
  bots: string[];
  selectedMode: string;
  resetDisabled: boolean;
  timer: string | null;
  status: string | null;
  statusLabel: string | null;
};

const DEFAULT_ONLINE_MODE = 'ONLINE MODE · SCORE BRAWL (SERVER DEFAULT)';

async function readScene(page: Page): Promise<SceneView> {
  return page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: any }).__turenkiGame;
    const scene = game.scene.getScene('StationScene');
    const state = scene.state;
    return {
      phase: state.phase,
      tick: state.tick,
      remainingTicks: state.remainingTicks,
      mode: state.mode ?? 'score-brawl',
      ids: state.fighters.map((fighter: { id: string }) => fighter.id),
      fighters: state.fighters.map((fighter: {
        score: number; frags?: number; deaths?: number; health: number;
      }) => ({
        score: fighter.score,
        frags: fighter.frags ?? null,
        deaths: fighter.deaths ?? null,
        health: fighter.health,
      })),
      events: state.events.map((event: { type: string }) => event.type),
      bots: [...scene.botSlots],
      selectedMode: scene.selectedMode,
      resetDisabled: (document.getElementById('reset-match') as HTMLButtonElement).disabled,
      timer: document.getElementById('match-timer')?.textContent ?? null,
      status: document.getElementById('match-status')?.textContent ?? null,
      statusLabel: document.getElementById('match-status')?.getAttribute('aria-label') ?? null,
    };
  });
}

/** Add one bot in P2 and start a real match, exactly as a player would. */
async function startBotMatch(page: Page, mode?: string): Promise<void> {
  if (mode) await page.selectOption('#game-mode', mode);
  await page.locator('[data-player="P2"] .hud-slot-action').click();
  await expect.poll(async () => (await readScene(page)).ids).toEqual(['P1', 'P2']);
  await expect(page.locator('[data-player="P2"]')).toHaveAttribute('data-bot', 'true');

  await page.keyboard.down('Enter');
  await expect.poll(async () => (await readScene(page)).phase).toBe('countdown');
  await page.keyboard.up('Enter');
  await expect.poll(async () => (await readScene(page)).phase, { timeout: 10_000 }).toBe('fighting');
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test('RESET during a match restores the lobby with the roster and mode kept, then clears it to P1', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const reset = page.locator('#reset-match');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(reset).toBeVisible();
  // A P1-only lobby has nothing to reset, so the control is legitimately inert.
  await expect(reset).toBeDisabled();
  await expect(reset).toHaveAttribute('aria-label', /in the lobby: remove bots and joined players/i);
  await expect(reset).toHaveAttribute('title', /In a match, countdown or results/i);

  await startBotMatch(page, 'deathmatch');
  await expect(reset).toBeEnabled();

  await reset.click();
  const kept = await readScene(page);
  expect(kept.phase).toBe('lobby');
  expect(kept.ids).toEqual(['P1', 'P2']);
  expect(kept.bots).toEqual(['P2']);
  // Mode is kept in both the scene selection and the authoritative state.
  expect(kept.selectedMode).toBe('deathmatch');
  expect(kept.mode).toBe('deathmatch');
  // Match state is fresh: timer, scores, health and events back to creation.
  expect(kept.remainingTicks).toBe(7200);
  expect(kept.events).toEqual([]);
  expect(kept.fighters).toEqual([
    { score: 0, frags: 0, deaths: 0, health: 100 },
    { score: 0, frags: 0, deaths: 0, health: 100 },
  ]);
  expect(kept.timer).toBe('02:00');
  expect(kept.statusLabel).toContain('LOBBY');
  expect(kept.status).not.toContain('RESULTS');
  expect(kept.statusLabel).not.toContain('RESULTS');
  await expect(page.locator('#game-mode')).toBeEnabled();
  await expect(page.locator('#game-mode')).toHaveValue('deathmatch');
  // The kept roster still has something to clear, so the control stays usable.
  await expect(reset).toBeEnabled();

  await reset.click();
  const cleared = await readScene(page);
  expect(cleared.phase).toBe('lobby');
  expect(cleared.ids).toEqual(['P1']);
  expect(cleared.bots).toEqual([]);
  expect(cleared.selectedMode).toBe('deathmatch');
  expect(cleared.remainingTicks).toBe(7200);
  expect(cleared.events).toEqual([]);
  await expect(page.locator('[data-player="P2"]')).not.toHaveAttribute('data-bot', 'true');
  await expect(reset).toBeDisabled();
  expect(errors).toEqual([]);
});

test('Esc performs the same reset as the button', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();

  await startBotMatch(page);
  await page.keyboard.down('Escape');
  await page.waitForTimeout(100);
  await page.keyboard.up('Escape');
  await expect.poll(async () => {
    const view = await readScene(page);
    return { phase: view.phase, ids: view.ids, remainingTicks: view.remainingTicks };
  }).toEqual({ phase: 'lobby', ids: ['P1', 'P2'], remainingTicks: 7200 });

  // A second Esc in the lobby clears the joined slot, leaving the host only.
  await page.waitForTimeout(60);
  await page.keyboard.down('Escape');
  await page.waitForTimeout(100);
  await page.keyboard.up('Escape');
  await expect.poll(async () => {
    const view = await readScene(page);
    return { phase: view.phase, ids: view.ids, bots: view.bots };
  }).toEqual({ phase: 'lobby', ids: ['P1'], bots: [] });
  await expect(page.locator('#reset-match')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('RESET after a finished match cannot leak results or MatchEnded into the new lobby', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as typeof window & { __turenkiGame?: any }).__turenkiGame.scene.getScene('StationScene');
    scene.selectedMode = 'deathmatch';
    scene.botSlots = new Set(['P2']);
    const state = simulation.createState({ ids: ['P1', 'P2'], phase: 'results', mode: 'deathmatch' });
    state.tick = 7200;
    state.remainingTicks = 0;
    state.fighters[0].frags = 5;
    state.fighters[1].health = 0;
    state.fighters[1].deaths = 5;
    state.events = [{ tick: 7200, type: 'MatchEnded', reason: 'time', winner: 'P1' }];
    scene.state = state;
    scene.drawFighters();
  });
  await expect(page.locator('#match-status')).toContainText('RESULTS');
  await expect(page.locator('#reset-match')).toBeEnabled();

  await page.locator('#reset-match').click();
  await expect.poll(async () => (await readScene(page)).phase).toBe('lobby');

  // Running further frames must not resurrect the ended match, its event or the
  // results summary in the lobby.
  const settled = await page.evaluate(() => {
    const scene = (window as typeof window & { __turenkiGame?: any }).__turenkiGame.scene.getScene('StationScene');
    for (let frame = 0; frame < 5; frame++) scene.update(0, 250);
    return {
      phase: scene.state.phase,
      events: scene.state.events,
      remainingTicks: scene.state.remainingTicks,
      lastResult: scene.lastResult ?? null,
      status: document.getElementById('match-status')?.textContent ?? '',
      statusLabel: document.getElementById('match-status')?.getAttribute('aria-label') ?? '',
      timer: document.getElementById('match-timer')?.textContent ?? '',
    };
  });
  expect(settled.phase).toBe('lobby');
  expect(settled.events).toEqual([]);
  expect(settled.remainingTicks).toBe(7200);
  expect(settled.lastResult).toBeNull();
  expect(settled.statusLabel).toContain('LOBBY');
  expect(settled.status).not.toContain('RESULTS');
  expect(settled.statusLabel).not.toContain('RESULTS');
  expect(settled.timer).toBe('02:00');
  expect(errors).toEqual([]);
});

test('online LEAVE closes the socket, restores the join form and drops the stale mode and snapshots', async ({ browser }) => {
  test.setTimeout(60_000);
  let server: MatchServerHandle | null = null;
  try {
    server = await startMatchServer({
      host: '127.0.0.1',
      port: 0,
      playerIds: ['P1'],
      mode: 'deathmatch',
      snapshotHz: 20,
      startDelayMs: 50,
      firstTickDelayMs: 50,
    });
  } catch (error) {
    test.skip(true, `WebSocket server could not bind: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const page = await browser.newPage();
  const errors = collectErrors(page);
  try {
    const url = server.url;
    expect(url).not.toBeNull();
    await page.goto(`/online.html?server=${encodeURIComponent(url!)}&player=P1`);
    await expect(page.locator('#game canvas')).toBeVisible();
    const state = () => page.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: any }).__turenkiOnline;
      return api?.state ?? 'missing';
    });
    const snapshots = () => page.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: any }).__turenkiOnline;
      return api?.snapshotCount ?? -1;
    });

    await expect.poll(state, { timeout: 15_000 }).toBe('running');
    await expect.poll(snapshots, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.locator('#match-mode')).toHaveText('ONLINE MODE · DEATHMATCH');
    const leave = page.locator('#online-leave');
    await expect(leave).toBeVisible();
    await expect(leave).toBeEnabled();

    // A sentinel on the existing page proves the click did not navigate.
    await page.evaluate(() => {
      (window as typeof window & { __resetControlSentinel?: string }).__resetControlSentinel = 'same-page';
    });

    await leave.click();
    await expect(page.locator('#online-connect-form')).toBeVisible();
    await expect(leave).toBeDisabled();
    await expect.poll(state).toBe('closed');
    await expect(page.locator('#online-status')).toContainText(/Disconnected from the match server/);

    // No stale mode, snapshot or score survives the disconnect.
    await expect(page.locator('#match-mode')).toHaveText(DEFAULT_ONLINE_MODE);
    await expect(page.locator('#match-timer')).toHaveText('--:--');
    await expect(page.locator('[data-player="P1"] .hud-score')).toHaveText('—');
    expect(await snapshots()).toBe(0);
    expect(await page.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: any }).__turenkiOnline;
      return api?.latestSnapshot() ?? null;
    })).toBeNull();

    // The server sees the socket close, and the page instance is unchanged.
    await expect.poll(() => server!.room.connectionCount, { timeout: 10_000 }).toBe(0);
    expect(await page.evaluate(() =>
      (window as typeof window & { __resetControlSentinel?: string }).__resetControlSentinel)).toBe('same-page');

    // A late frame must not re-claim a snapshot or the mode label.
    await page.waitForTimeout(400);
    expect(await snapshots()).toBe(0);
    await expect(page.locator('#match-mode')).toHaveText(DEFAULT_ONLINE_MODE);
    expect(errors).toEqual([]);
  } finally {
    await page.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
  }
});
