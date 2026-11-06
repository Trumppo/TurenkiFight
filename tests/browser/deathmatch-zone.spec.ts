import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const visualStyle = process.env.VITE_VISUAL_STYLE === 'retro' ? 'retro' : 'classic';

async function setLocalZoneState(page: Page, tick: number, mode = 'deathmatch', outside = false): Promise<void> {
  await page.evaluate(async ({ tick, mode, outside }) => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const state = simulation.createState({ ids: ['P1', 'P2', 'P3', 'P4'], phase: 'fighting', mode });
    state.tick = tick;
    for (const [index, fighter] of state.fighters.entries()) fighter.x = [80, 160, 240, 320][index];
    if (outside) state.fighters[0].x = 0;
    scene.state = state;
    scene.selectedMode = mode;
    scene.scene.pause();
    scene.drawFighters();
  }, { tick, mode, outside });
}

test('local Deathmatch shows the shrinking edge, schedule and outside danger only in Deathmatch', async ({ page }) => {
  mkdirSync('artifacts/visual', { recursive: true });
  for (const size of [{ width: 640, height: 360 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('#game canvas')).toBeVisible();

    await setLocalZoneState(page, 960);
    await expect(page.locator('#zone-status')).toBeVisible();
    await expect(page.locator('#zone-summary')).toHaveText('WARNING · STAGE 0 · SHRINK IN 2s · MOVE INSIDE');
    const before = await page.evaluate(() => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      return { visible: scene.zoneGraphics.visible, depth: scene.zoneGraphics.depth };
    });
    expect(before).toEqual({ visible: true, depth: 122 });
    await expect(page.locator('#zone-summary')).toHaveCSS('font-size', '14px');
    await page.locator('#game').screenshot({ path: `artifacts/visual/m10-zone-${visualStyle}-${size.width}-before-shrink.png` });

    await setLocalZoneState(page, 1080);
    await expect(page.locator('#zone-summary')).toHaveText('DEATHMATCH · STAGE 1 · NEXT SHRINK 15s');
    await page.locator('#game').screenshot({ path: `artifacts/visual/m10-zone-${visualStyle}-${size.width}-after-shrink.png` });

    await setLocalZoneState(page, 1080, 'deathmatch', true);
    await expect(page.locator('#zone-danger')).toHaveText('DANGER OUTSIDE SAFE AREA · P1');
    await expect(page.locator('[data-player="P1"]')).toHaveClass(/is-zone-danger/);
    await expect(page.locator('[data-player="P1"]')).toHaveAttribute('aria-label', /outside the safe zone/);

    for (const mode of ['score-brawl', 'last-man-standing']) {
      await setLocalZoneState(page, 1080, mode);
      await expect(page.locator('#zone-status')).toBeHidden();
      await expect.poll(() => page.evaluate(() =>
        (window as any).__turenkiGame.scene.getScene('StationScene').zoneGraphics.visible)).toBe(false);
    }
  }
});

test('online Deathmatch derives the same zone and warning from the snapshot tick', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/online.html');
  await expect(page.locator('#game canvas')).toBeVisible();
  const online = await page.evaluate(async () => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const api = (window as any).__turenkiOnline;
    const state = simulation.createState({ ids: ['P1', 'P2'], phase: 'fighting', mode: 'deathmatch' });
    state.tick = 960;
    state.fighters[0].x = 180;
    state.fighters[1].x = 200;
    api.renderHudSnapshotForTest(state);
    const before = {
      summary: document.querySelector('#zone-summary')?.textContent,
      visible: api.zoneGraphicsVisible(),
    };
    state.tick = 1080;
    state.fighters[0].x = 0;
    api.renderHudSnapshotForTest(state);
    const after = {
      summary: document.querySelector('#zone-summary')?.textContent,
      danger: document.querySelector('#zone-danger')?.textContent,
      marked: document.querySelector('[data-player="P1"]')?.classList.contains('is-zone-danger'),
      visible: api.zoneGraphicsVisible(),
    };
    api.renderHudSnapshotForTest(null);
    const cleared = {
      hidden: (document.querySelector('#zone-status') as HTMLElement)?.hidden,
      visible: api.zoneGraphicsVisible(),
    };
    return { before, after, cleared };
  });
  expect(online).toEqual({
    before: { summary: 'WARNING · STAGE 0 · SHRINK IN 2s · MOVE INSIDE', visible: true },
    after: {
      summary: 'DEATHMATCH · STAGE 1 · NEXT SHRINK 15s',
      danger: 'DANGER OUTSIDE SAFE AREA · P1',
      marked: true,
      visible: true,
    },
    cleared: { hidden: true, visible: false },
  });
  await expect(page.locator('#zone-summary')).toHaveCSS('font-size', '14px');
});
