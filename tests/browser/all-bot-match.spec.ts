import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

type SceneView = {
  state: { phase: string; fighters: { id: string; x: number; y: number; health: number; score: number; eliminated?: boolean }[]; tick: number };
};
const scene = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => SceneView } } }).__turenkiGame;
  return game!.scene.getScene('StationScene').state;
});

test('ALL BOTS starts a visibly bot-driven P1-P8 match, finishes unattended, and RESET restores human P1', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('#all-bots-match')).toBeVisible();
  await expect(page.locator('#lobby-actions')).toContainText('P1 is bot-driven');
  mkdirSync('artifacts/visual', { recursive: true });
  const style = process.env.VITE_VISUAL_STYLE === 'retro' ? 'retro' : 'classic';
  await page.screenshot({ path: `artifacts/visual/${style}-all-bot-lobby-action.png`, animations: 'disabled' });

  // Last Man Standing ends as soon as seven bots are eliminated, while still
  // exercising the complete unattended all-bot loop without waiting for timer.
  await page.locator('#game-mode').selectOption('last-man-standing');
  await page.locator('#all-bots-match').click();
  await expect.poll(() => scene(page)).toMatchObject({ phase: 'countdown', fighters: Array.from({ length: 8 }, (_, i) => ({ id: `P${i+1}` })) });
  await expect(page.locator('#lobby-actions')).toBeHidden();
  const markers = await page.locator('.hud-player').evaluateAll(cards => cards.map(card => ({
    id: (card as HTMLElement).dataset.player,
    bot: (card as HTMLElement).dataset.bot,
    label: card.getAttribute('aria-label'),
    css: card.classList.contains('is-bot'),
  })));
  expect(markers).toHaveLength(8);
  for (const card of markers) {
    expect(card.bot, card.id).toBe('true');
    expect(card.css, card.id).toBe(true);
    expect(card.label, card.id).toContain(', bot,');
  }
  await expect.poll(() => scene(page).then(state => state.phase), { timeout: 10_000 }).toBe('fighting');
  const p1Start = (await scene(page)).fighters.find(fighter => fighter.id === 'P1')!;
  await expect.poll(async () => {
    const p1 = (await scene(page)).fighters.find(fighter => fighter.id === 'P1')!;
    return Math.abs(p1.x - p1Start.x) + Math.abs(p1.y - p1Start.y);
  }, { timeout: 8_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `artifacts/visual/${style}-all-bot-match.png`, animations: 'disabled' });

  await expect.poll(() => scene(page).then(state => state.phase), { timeout: 100_000, intervals: [100,250,500,1000] }).toBe('results');
  const finalState = await scene(page);
  expect(finalState.fighters).toHaveLength(8);
  expect(finalState.tick).toBeLessThan(8_000);
  const browserRun = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame!;
    const localScene = game.scene.getScene('StationScene') as { state: unknown; matchEvents: unknown[] };
    const canonical = JSON.stringify({ state: localScene.state, events: localScene.matchEvents });
    let hash = 0x811c9dc5;
    for (let i = 0; i < canonical.length; i++) hash = Math.imul(hash ^ canonical.charCodeAt(i), 0x01000193) >>> 0;
    return { fingerprint: hash.toString(16).padStart(8,'0'), eventCount: localScene.matchEvents.length };
  });
  // Cross-check the real Phaser input adapter against the two-run deterministic
  // simulation proof below, including the complete event stream.
  // M11 (hit stop + knockback): this match is pinned at tick 665,
  // fingerprint 20d2e967 and 72 events. The optional hit-stop/knockback
  // counters are omitted at the result, so this fingerprint reflects the
  // changed positions and event stream only. Previous M11 speed-only pins were
  // tick 526, 904d3be1 and 75 events (and 493, 9723adb8, 71 events at
  // 1.3 px/tick). These counts are recorded, not a trend claim.
  expect(finalState.tick).toBe(665);
  expect(browserRun).toEqual({ fingerprint: '20d2e967', eventCount: 72 });
  expect(errors).toEqual([]);

  await expect(page.locator('#reset-match')).toHaveAttribute('aria-label', /human P1 and no bots/i);
  await page.locator('#reset-match').click();
  await expect.poll(() => scene(page)).toMatchObject({ phase: 'lobby', fighters: [{ id: 'P1' }] });
  await expect(page.locator('#all-bots-match')).toBeVisible();
  await expect(page.locator('.hud-player[data-player="P1"]')).not.toHaveClass(/is-bot/);
  await expect(page.locator('.hud-player[data-player="P1"]')).not.toHaveAttribute('data-bot', 'true');
  await expect(page.locator('.hud-player[data-player="P2"]')).not.toHaveAttribute('data-bot');
  await expect(page.locator('.hud-player[data-player="P2"]')).toHaveClass(/is-empty/);
});

test('O is the stated keyboard shortcut for an all-bot match', async ({ page }) => {
  test.setTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { sys: { isActive: () => boolean } } } } }).__turenkiGame;
    return !!game?.scene.getScene('StationScene')?.sys.isActive();
  })).toBe(true);
  await expect(page.locator('#all-bots-match')).toBeVisible();
  await expect(page.locator('#all-bots-match')).toContainText('O');
  await expect(page.locator('#lobby-actions')).toContainText('P1 is bot-driven');
  mkdirSync('artifacts/visual', { recursive: true });
  const style = process.env.VITE_VISUAL_STYLE === 'retro' ? 'retro' : 'classic';
  await page.screenshot({ path: `artifacts/visual/${style}-all-bot-lobby-mobile.png`, fullPage: true, animations: 'disabled' });
  await page.keyboard.down('o');
  await expect.poll(() => scene(page), { timeout: 5_000 }).toMatchObject({ phase: 'countdown', fighters: Array.from({ length: 8 }, (_, i) => ({ id: `P${i+1}` })) });
  await page.keyboard.up('o');
  await expect(page.locator('.hud-player[data-player="P1"]')).toHaveAttribute('data-bot', 'true');
  await page.locator('#reset-match').click();
  await expect.poll(() => scene(page)).toMatchObject({ phase: 'lobby', fighters: [{ id: 'P1' }] });
});

test('same seed and all-bot roster reproduce the same full match fingerprint', async ({ page }) => {
  await page.goto('/');
  const runs = await page.evaluate(async () => {
    const simulationPath = '/src/game/simulation/step.ts';
    const botPolicyPath = '/src/game/input/botPolicy.ts';
    const [{ createState, step, MATCH_TICKS, COUNTDOWN_TICKS }, { botInput }] = await Promise.all([
      import(/* @vite-ignore */ simulationPath),
      import(/* @vite-ignore */ botPolicyPath),
    ]);
    const ids = Array.from({ length: 8 }, (_, i) => `P${i+1}`);
    const seed = 0x5eed;
    const simulate = () => {
      let state = createState(ids, 'countdown', { mode: 'last-man-standing' });
      const events: unknown[] = [];
      let steps = 0;
      const maxSteps = MATCH_TICKS + COUNTDOWN_TICKS + 1;
      while (state.phase !== 'results' && steps < maxSteps) {
        state = step(state, ids.map(id => botInput(state, id, seed)));
        events.push(...state.events);
        steps++;
      }
      const canonical = JSON.stringify({ state, events });
      let hash = 0x811c9dc5;
      for (let i = 0; i < canonical.length; i++) hash = Math.imul(hash ^ canonical.charCodeAt(i), 0x01000193) >>> 0;
      return { phase: state.phase, steps, tick: state.tick, eventCount: events.length, fingerprint: hash.toString(16).padStart(8,'0'), state: canonical };
    };
    const first = simulate();
    const second = simulate();
    return { first: { ...first, state: undefined }, second: { ...second, state: undefined }, identical: first.state === second.state };
  });
  expect(runs.first.phase).toBe('results');
  expect(runs.first.steps).toBeLessThan(8_000);
  expect(runs.first.eventCount).toBeGreaterThan(0);
  expect(runs.first.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  expect(runs.second.fingerprint).toBe(runs.first.fingerprint);
  expect(runs.identical).toBe(true);
});
