import { test, expect } from '@playwright/test';
import { installVirtualPads, setPadButton, snapshot, advanceUntilResults } from './harness/gameHarness';

test.describe('M1 automated game harness', () => {
  test('four virtual players complete a real 120-second Score Brawl', async ({ page }, testInfo) => {
    const errors: string[] = [];
    const failedResponses: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
    await installVirtualPads(page, 3);
    await page.goto('/');
    await expect(page.locator('#game canvas')).toBeVisible();
    // Explicit join edge for each pad; each press is observed by the scene.
    for (let i = 0; i < 3; i++) {
      await setPadButton(page, i, 8, true);
      await page.evaluate(() => {
        const game = (window as typeof window & { __turenkiGame: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
        (game.scene.getScene('StationScene') as { update: (t: number, d: number) => void }).update(0, 17);
      });
      await setPadButton(page, i, 8, false);
    }
    expect((await snapshot(page)).fighters.map(f => f.id)).toEqual(['P1', 'P2', 'P3', 'P4']);
    await page.screenshot({ path: testInfo.outputPath('four-player-lobby.png') });
    await testInfo.attach('four-player-lobby', { path: testInfo.outputPath('four-player-lobby.png'), contentType: 'image/png' });

    await page.keyboard.down('Enter');
    await page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
      (game.scene.getScene('StationScene') as { update: (t: number, d: number) => void }).update(0, 17);
    });
    await page.keyboard.up('Enter');
    expect((await snapshot(page)).phase).toBe('countdown');
    const final = await advanceUntilResults(page);
    expect(final.phase).toBe('results');
    expect(final.remainingTicks).toBe(0);
    expect(final.fighters).toHaveLength(4);
    await page.screenshot({ path: testInfo.outputPath('results.png') });
    await testInfo.attach('results', { path: testInfo.outputPath('results.png'), contentType: 'image/png' });
    await testInfo.attach('match-state', { body: JSON.stringify(final, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
    expect(failedResponses).toEqual([]);
  });

  test('browser combat: P1 punch lands, scores and reduces P2 health', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#game canvas')).toBeVisible();
    // P2 joins via the documented keyboard join key.
    await page.keyboard.down('Shift');
    await page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
      (game.scene.getScene('StationScene') as { update: (t: number, d: number) => void }).update(0, 17);
    });
    await page.keyboard.up('Shift');
    expect((await snapshot(page)).fighters).toHaveLength(2);
    await page.keyboard.down('Enter');
    await page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
      (game.scene.getScene('StationScene') as { update: (t: number, d: number) => void }).update(0, 17);
    });
    await page.keyboard.up('Enter');
    // Set a controlled combat position through the existing test-visible scene.
    // This does not replace the real simulation or bypass hit resolution.
    await page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
      const scene = game.scene.getScene('StationScene') as {
        update: (t: number, d: number) => void;
        state: { phase: string; countdownTicks: number; fighters: Array<{ x: number; y: number; facing: number; health: number; score: number }> };
      };
      // Finish countdown via the actual scene update.
      for (let i = 0; i < 14; i++) scene.update(0, 250);
      if (scene.state.phase !== 'fighting') throw new Error('Countdown did not finish');
      const [p1, p2] = scene.state.fighters;
      p1.x = 170; p1.y = 160; p1.facing = 1;
      p2.x = 190; p2.y = 160;
    });
    const before = await snapshot(page);
    await page.keyboard.down('f');
    await page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
      (game.scene.getScene('StationScene') as { update: (t: number, d: number) => void }).update(0, 150);
    });
    await page.keyboard.up('f');
    const after = await snapshot(page);
    expect(after.fighters[1].health).toBeLessThan(before.fighters[1].health);
    expect(after.fighters[0].score).toBeGreaterThan(before.fighters[0].score);
    await page.screenshot({ path: testInfo.outputPath('combat-hit.png') });
    await testInfo.attach('combat-hit', { path: testInfo.outputPath('combat-hit.png'), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });

  test('mobile layout renders without runtime exceptions', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const canvas = page.locator('#game canvas');
    await expect(canvas).toBeVisible();
    const dims = await canvas.evaluate((el: HTMLCanvasElement) => ({
      width: el.width, height: el.height,
      cssWidth: el.getBoundingClientRect().width,
      cssHeight: el.getBoundingClientRect().height,
    }));
    expect(dims.width).toBe(640);
    expect(dims.height).toBe(360);
    expect(dims.cssWidth / dims.cssHeight).toBeCloseTo(16 / 9, 1);
    await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
    await testInfo.attach('mobile', { path: testInfo.outputPath('mobile.png'), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
});
