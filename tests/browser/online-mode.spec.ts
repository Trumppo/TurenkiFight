import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startMatchServer, type MatchServerHandle } from '../../server/ws/matchServer';
import { MOVES } from '../../src/game/simulation/step';
import type { ModeId } from '../../src/game/simulation/types';

/**
 * Real-browser proof that the online client renders the mode and the
 * mode-specific HUD fields the authoritative server actually sends.
 *
 * Unlike the local HUD tests these start the real match server, let two
 * browser clients claim both slots, and compare the DOM against the latest
 * snapshot the client itself received (the read-only
 * `window.__turenkiOnline.latestSnapshot()` diagnostics view). The Deathmatch
 * and Last Man Standing cases drive one real knockout through the normal
 * keyboard -> input frame -> authoritative tick -> snapshot path, so both the
 * counters and the elimination marker come from the simulation rule, not from
 * presentation-side bookkeeping.
 */

type SnapshotFighter = {
  id: string;
  x: number;
  y: number;
  facing: number;
  health: number;
  score: number;
  frags?: number;
  deaths?: number;
  eliminated?: boolean;
};

type SnapshotView = {
  mode?: ModeId;
  tick: number;
  phase: string;
  remainingTicks: number;
  fighters: SnapshotFighter[];
};

type RenderedFighter = { id: string; x: number; y: number; pose: string; alpha: number };

type OnlineBridge = {
  state: string;
  snapshotCount: number;
  latestSnapshot(): SnapshotView | null;
  renderedFighters(): RenderedFighter[];
  renderHudSnapshotForTest(state: unknown): void;
};

const DEFAULT_MODE_LABEL = 'ONLINE MODE · SCORE BRAWL (SERVER DEFAULT)';
const heldKeys = new WeakMap<Page, Set<string>>();

async function bridgeState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
    return api?.state ?? 'missing';
  });
}

async function snapshotCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
    return api?.snapshotCount ?? 0;
  });
}

async function readSnapshot(page: Page): Promise<SnapshotView | null> {
  return page.evaluate(() => {
    const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
    return api?.latestSnapshot() ?? null;
  });
}

async function startServer(mode?: ModeId): Promise<MatchServerHandle> {
  return startMatchServer({
    host: '127.0.0.1',
    // Port 0 asks the OS for a fresh ephemeral port per test.
    port: 0,
    playerIds: ['P1', 'P2'],
    ...(mode === undefined ? {} : { mode }),
    snapshotHz: 20,
    startDelayMs: 50,
    firstTickDelayMs: 50,
  });
}

async function openMatch(
  server: MatchServerHandle,
  context: BrowserContext,
  errors: string[],
): Promise<{ p1: Page; p2: Page }> {
  const p1 = await context.newPage();
  const p2 = await context.newPage();
  p1.on('pageerror', error => errors.push(`P1: ${error.message}`));
  p2.on('pageerror', error => errors.push(`P2: ${error.message}`));
  const url = server.url;
  expect(url).not.toBeNull();
  const query = `?server=${encodeURIComponent(url!)}&player=`;
  await p1.goto(`/online.html${query}P1`);
  await expect.poll(() => bridgeState(p1)).toBe('joined');
  await p2.goto(`/online.html${query}P2`);
  await expect.poll(() => bridgeState(p2), { timeout: 10_000 }).toMatch(/joined|running/);
  for (const page of [p1, p2]) {
    await expect.poll(() => bridgeState(page), { timeout: 10_000 }).toBe('running');
    await expect.poll(() => snapshotCount(page), { timeout: 10_000 }).toBeGreaterThan(0);
  }
  return { p1, p2 };
}

/** Press and hold exactly `keys`, releasing anything else. */
async function holdKeys(page: Page, keys: readonly string[]): Promise<void> {
  let held = heldKeys.get(page);
  if (!held) {
    held = new Set();
    heldKeys.set(page, held);
  }
  for (const key of [...held]) {
    if (keys.includes(key)) continue;
    await page.keyboard.up(key);
    held.delete(key);
  }
  for (const key of keys) {
    if (held.has(key)) continue;
    await page.keyboard.down(key);
    held.add(key);
  }
}

/**
 * Walks P1 into kick range of P2 using only the same keyboard input a human
 * would send. Reads the latest authoritative snapshot to decide the direction,
 * so the approach does not depend on wall-clock timing.
 */
async function approachTarget(page: Page, targetId: string, deadline: number): Promise<void> {
  let last: SnapshotView | null = null;
  while (Date.now() < deadline) {
    last = await readSnapshot(page);
    const me = last?.fighters.find(fighter => fighter.id === 'P1');
    const target = last?.fighters.find(fighter => fighter.id === targetId);
    if (me && target) {
      // Sit 30 px to the left: inside kick reach (42) but outside overlap.
      const dx = target.x - 30 - me.x;
      const dy = target.y - me.y;
      const inRange = Math.abs(dx) <= 6 && Math.abs(dy) <= 6;
      if (inRange && me.facing === 1) {
        await holdKeys(page, []);
        return;
      }
      const keys: string[] = [];
      if (dx > 2) keys.push('d');
      else if (dx < -2) keys.push('a');
      // A close correction must face the target again before the next kick.
      if (Math.abs(dx) <= 6 && me.facing !== 1) keys.push('d');
      if (dy > 2) keys.push('s');
      else if (dy < -2) keys.push('w');
      await holdKeys(page, keys);
    }
    await page.waitForTimeout(40);
  }
  await holdKeys(page, []);
  throw new Error(`P1 did not reach ${targetId}. Last snapshot: ${JSON.stringify(last)}`);
}

/**
 * Taps the kick button until `isDone` observes the authoritative result. A tap
 * is long enough for the 60 Hz input sampler to see a fresh press edge.
 *
 * Kick knockback slides the target out of reach after a couple of hits, so
 * before each kick this checks the latest snapshot and, when the target is no
 * longer inside the kick hitbox (or P1 is facing away), walks back into range
 * with `approachTarget`. That is what a player does between kicks; the
 * simulation and its knockback values are untouched.
 */
async function kickUntil(
  page: Page,
  isDone: (state: SnapshotView) => boolean,
  deadline: number,
): Promise<void> {
  while (Date.now() < deadline) {
    const state = await readSnapshot(page);
    if (state && isDone(state)) return;
    const me = state?.fighters.find(fighter => fighter.id === 'P1');
    const target = state?.fighters.find(fighter => fighter.id !== 'P1');
    if (me && target) {
      // Mirror the simulation's kick hitbox (`dx > 0`, within reach/depth).
      const dx = target.x - me.x;
      const dy = target.y - me.y;
      const inKickReach = me.facing === 1 && dx > 0 && dx <= MOVES.kick.reach &&
        Math.abs(dy) <= MOVES.kick.depth;
      if (!inKickReach) {
        await approachTarget(page, target.id, deadline);
        continue;
      }
    }
    await page.keyboard.down('g');
    await page.waitForTimeout(90);
    await page.keyboard.up('g');
    // Kick is 29 ticks (~483 ms) at 60 Hz; leave room for the snapshot.
    await page.waitForTimeout(320);
  }
  const last = await readSnapshot(page);
  throw new Error(`P1 did not land the knockout. Last snapshot: ${JSON.stringify(last)}`);
}

/**
 * Fails with the concrete mismatch when the DOM stops agreeing with the latest
 * snapshot the page received. The expected text is derived only from snapshot
 * fields, never from a constant.
 */
async function expectHudMatchesSnapshot(page: Page, playerId: string): Promise<void> {
  await expect.poll(() => page.evaluate((id: string) => {
    const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
    const state = api?.latestSnapshot();
    const fighter = state?.fighters.find(candidate => candidate.id === id);
    const card = document.querySelector(`[data-player="${id}"]`);
    const hudScore = card?.querySelector('.hud-score')?.textContent ?? null;
    const hudHealth = card?.querySelector('.hud-health')?.textContent ?? null;
    if (!state || !fighter) return 'missing snapshot or fighter';
    let expectedScore: string;
    let expectedHealth: string;
    if (state.mode === 'deathmatch') {
      expectedScore = fighter.frags === undefined ? 'FRAGS —' : `FRAGS ${fighter.frags}`;
      expectedHealth = fighter.deaths === undefined ? 'DEATHS —' : `DEATHS ${fighter.deaths}`;
    } else if (state.mode === 'last-man-standing') {
      expectedScore = `STOCK ${fighter.eliminated ? 0 : 1}`;
      expectedHealth = fighter.eliminated ? 'ELIMINATED' : 'ALIVE';
    } else {
      expectedScore = String(fighter.score);
      expectedHealth = `HP ${Math.max(0, Math.min(100, fighter.health))}`;
    }
    return hudScore === expectedScore && hudHealth === expectedHealth
      ? 'match'
      : `HUD ${hudScore} / ${hudHealth} != snapshot ${expectedScore} / ${expectedHealth}`;
  }, playerId), { timeout: 5_000 }).toBe('match');
}

test('a real Deathmatch server shows frags and deaths from received snapshots', async ({ browser }) => {
  test.setTimeout(90_000);
  let server: MatchServerHandle | null = null;
  try {
    server = await startServer('deathmatch');
  } catch (error) {
    test.skip(true, `WebSocket server could not bind: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const context = await browser.newContext();
  const errors: string[] = [];
  try {
    const { p1 } = await openMatch(server, context, errors);

    // The label names the server's rule, not the Score Brawl fallback.
    await expect(p1.locator('#match-mode')).toHaveText('ONLINE MODE · DEATHMATCH');
    await expect(p1.locator('#player-hud')).toHaveClass(/mode-specific/);

    const initial = await readSnapshot(p1);
    expect(initial?.mode).toBe('deathmatch');
    // The wire snapshot carries the counters before any knockout.
    expect(initial?.fighters.map(fighter => [typeof fighter.frags, typeof fighter.deaths]))
      .toEqual([['number', 'number'], ['number', 'number']]);
    for (const id of ['P1', 'P2']) await expectHudMatchesSnapshot(p1, id);
    await expect(p1.locator('[data-player="P1"] .hud-score')).toHaveText('FRAGS 0');
    await expect(p1.locator('[data-player="P1"] .hud-health')).toHaveText('DEATHS 0');

    // Drive one real knockout so the displayed counters cannot be hardcoded zeros.
    await approachTarget(p1, 'P2', Date.now() + 15_000);
    await kickUntil(p1, state => state.fighters.find(fighter => fighter.id === 'P2')?.deaths === 1,
      Date.now() + 20_000);

    await expect.poll(async () => (await readSnapshot(p1))?.fighters.find(fighter => fighter.id === 'P1')?.frags,
      { timeout: 5_000 }).toBe(1);
    const afterKnockout = await readSnapshot(p1);
    expect(afterKnockout?.mode).toBe('deathmatch');
    expect(afterKnockout?.fighters.find(fighter => fighter.id === 'P2')?.deaths).toBe(1);
    await expectHudMatchesSnapshot(p1, 'P1');
    await expectHudMatchesSnapshot(p1, 'P2');
    await expect(p1.locator('[data-player="P1"] .hud-score')).toHaveText('FRAGS 1');
    await expect(p1.locator('[data-player="P1"] .hud-health')).toHaveText('DEATHS 0');
    await expect(p1.locator('[data-player="P2"] .hud-score')).toHaveText('FRAGS 0');
    await expect(p1.locator('[data-player="P2"] .hud-health')).toHaveText('DEATHS 1');
    await expect(p1.locator('[data-player="P1"]')).toHaveAttribute('aria-label', /1 frags, 0 deaths/);
    expect(errors).toEqual([]);
  } finally {
    await context.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
  }
});

test('a real Last Man Standing server shows stocks, elimination and the eliminated rendering', async ({ browser }) => {
  test.setTimeout(90_000);
  let server: MatchServerHandle | null = null;
  try {
    server = await startServer('last-man-standing');
  } catch (error) {
    test.skip(true, `WebSocket server could not bind: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const context = await browser.newContext();
  const errors: string[] = [];
  try {
    const { p1 } = await openMatch(server, context, errors);

    await expect(p1.locator('#match-mode')).toHaveText('ONLINE MODE · LAST MAN STANDING');
    await expect(p1.locator('#player-hud')).toHaveClass(/mode-specific/);

    const initial = await readSnapshot(p1);
    expect(initial?.mode).toBe('last-man-standing');
    // The alive marker is canonical only when true; absent means "still alive".
    expect(initial?.fighters.map(fighter => fighter.eliminated)).toEqual([undefined, undefined]);
    await expect(p1.locator('[data-player="P1"] .hud-score')).toHaveText('STOCK 1');
    await expect(p1.locator('[data-player="P1"] .hud-health')).toHaveText('ALIVE');
    await expect(p1.locator('[data-player="P2"] .hud-score')).toHaveText('STOCK 1');
    await expect(p1.locator('[data-player="P2"] .hud-health')).toHaveText('ALIVE');
    for (const id of ['P1', 'P2']) await expectHudMatchesSnapshot(p1, id);

    // The elimination rule runs on the real server: one knockout ends the match.
    await approachTarget(p1, 'P2', Date.now() + 15_000);
    await kickUntil(p1, state => state.fighters.find(fighter => fighter.id === 'P2')?.eliminated === true,
      Date.now() + 20_000);

    await expect.poll(async () => (await readSnapshot(p1))?.fighters.find(fighter => fighter.id === 'P2')?.eliminated,
      { timeout: 5_000 }).toBe(true);
    const afterKnockout = await readSnapshot(p1);
    expect(afterKnockout?.mode).toBe('last-man-standing');
    expect(afterKnockout?.fighters.find(fighter => fighter.id === 'P2')?.health).toBe(0);
    expect(afterKnockout?.phase).toBe('results');

    await expectHudMatchesSnapshot(p1, 'P2');
    await expect(p1.locator('[data-player="P2"] .hud-score')).toHaveText('STOCK 0');
    await expect(p1.locator('[data-player="P2"] .hud-health')).toHaveText('ELIMINATED');
    await expect(p1.locator('[data-player="P2"]')).toHaveClass(/is-eliminated/);
    await expect(p1.locator('[data-player="P2"]')).toHaveAttribute('aria-label', 'P2, stock 0, eliminated');
    await expect(p1.locator('[data-player="P1"] .hud-score')).toHaveText('STOCK 1');
    await expect(p1.locator('[data-player="P1"] .hud-health')).toHaveText('ALIVE');
    // The eliminated fighter is drawn knocked out and dimmed, from snapshot state.
    await expect.poll(() => p1.evaluate(() => {
      const api = (window as typeof window & { __turenkiOnline?: OnlineBridge }).__turenkiOnline;
      const fighter = api?.renderedFighters().find(candidate => candidate.id === 'P2');
      return fighter ? { pose: fighter.pose, alpha: fighter.alpha } : null;
    }), { timeout: 5_000 }).toEqual({ pose: 'ko', alpha: 0.72 });
    expect(errors).toEqual([]);
  } finally {
    await context.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
  }
});

test('a Score Brawl server (no mode) still shows the honest server-default label', async ({ browser }) => {
  test.setTimeout(60_000);
  let server: MatchServerHandle | null = null;
  try {
    server = await startServer();
  } catch (error) {
    test.skip(true, `WebSocket server could not bind: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const context = await browser.newContext();
  const errors: string[] = [];
  try {
    const { p1 } = await openMatch(server, context, errors);

    await expect(p1.locator('#match-mode')).toHaveText(DEFAULT_MODE_LABEL);
    await expect(p1.locator('#player-hud')).not.toHaveClass(/mode-specific/);
    const snapshot = await readSnapshot(p1);
    // Score Brawl omits `mode` from the canonical wire state.
    expect(snapshot).not.toBeNull();
    expect('mode' in (snapshot ?? {})).toBe(false);
    await expectHudMatchesSnapshot(p1, 'P1');
    await expectHudMatchesSnapshot(p1, 'P2');
    await expect(p1.locator('[data-player="P1"] .hud-score')).toHaveText('0');
    await expect(p1.locator('[data-player="P1"] .hud-health')).toHaveText('HP 100');
    expect(errors).toEqual([]);
  } finally {
    await context.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
  }
});

test('online HUD reports a missing Deathmatch counter instead of inventing zero', async ({ page }) => {
  await page.goto('/online.html');
  await expect(page.locator('#game canvas')).toBeVisible();
  const hud = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const api = (window as unknown as { __turenkiOnline: OnlineBridge }).__turenkiOnline;
    const state = simulation.createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' });
    delete state.fighters[0].frags;
    delete state.fighters[0].deaths;
    api.renderHudSnapshotForTest(state);
    const reported = {
      mode: document.querySelector('#match-mode')?.textContent,
      score: document.querySelector('[data-player="P1"] .hud-score')?.textContent,
      health: document.querySelector('[data-player="P1"] .hud-health')?.textContent,
      label: document.querySelector('[data-player="P1"]')?.getAttribute('aria-label'),
    };
    api.renderHudSnapshotForTest(null);
    return { ...reported, afterNullSnapshot: document.querySelector('#match-mode')?.textContent };
  });
  expect(hud).toEqual({
    mode: 'ONLINE MODE · DEATHMATCH',
    score: 'FRAGS —',
    health: 'DEATHS —',
    label: 'P1, frags not measured, deaths not measured, health 100',
    afterNullSnapshot: DEFAULT_MODE_LABEL,
  });
});
