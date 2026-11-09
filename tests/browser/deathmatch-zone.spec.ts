import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const visualStyle = process.env.VITE_VISUAL_STYLE === 'retro' ? 'retro' : 'classic';

async function setLocalZoneState(page: Page, tick: number, mode = 'deathmatch', outside = false): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as any).__turenkiGame?.scene.getScene('StationScene');
    return !!scene?.zoneGraphics;
  })).toBe(true);
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

async function captureCanvas(page: Page, path: string, scale: number): Promise<void> {
  mkdirSync('artifacts/screenshots', { recursive: true });
  const canvas = page.locator('#game canvas');
  const raw = await canvas.screenshot();
  const scaled = await page.evaluate(async ({ base64, width, height }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, width, height);
    return output.toDataURL('image/png');
  }, { base64: raw.toString('base64'), width: 640 * scale, height: 360 * scale });
  const png = Buffer.from(scaled.split(',')[1]!, 'base64');
  writeFileSync(path, png);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640 * scale, 360 * scale]);
}

test('local Deathmatch shows the shrinking edge, schedule and outside danger only in Deathmatch', async ({ page }) => {
  mkdirSync('artifacts/visual', { recursive: true });
  for (const size of [
    { width: 640, height: 360, scale: 1 },
    { width: 1280, height: 720, scale: 2 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('#game canvas')).toBeVisible();
    await page.addStyleTag({ content: '#game { width: 648px !important; max-width: none !important; margin-left: 0 !important; margin-right: 0 !important; } #game canvas { width: 640px !important; height: 360px !important; max-width: none !important; margin: 0 !important; } main { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }' });

    await setLocalZoneState(page, 929);
    await expect(page.locator('#zone-summary')).toHaveText('MODE: SHRINKING ZONE · STAGE 0 · NEXT 3s');
    await expect(page.locator('#zone-status')).not.toHaveClass(/is-warning/);
    await expect.poll(() => page.evaluate(() =>
      (window as any).__turenkiGame.scene.getScene('StationScene').zoneGraphics.visible)).toBe(true);

    await setLocalZoneState(page, 930);
    await expect(page.locator('#zone-status')).toBeVisible();
    await expect(page.locator('#zone-summary')).toHaveText('MODE: SHRINKING ZONE · FIRST SHRINK IN 2.5s · MOVE INSIDE');
    const before = await page.evaluate(() => {
      const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
      const status = document.querySelector('#zone-status');
      return { visible: scene.zoneGraphics.visible, depth: scene.zoneGraphics.depth,
        warningFlash: status?.classList.contains('is-warning-flash') };
    });
    expect(before).toEqual({ visible: true, depth: 122, warningFlash: true });
    await expect(page.locator('#zone-summary')).toContainText('MODE: SHRINKING ZONE');
    await expect(page.locator('#zone-summary')).toHaveCSS('font-size', '14px');
    await captureCanvas(page, `artifacts/screenshots/g6-zone-${visualStyle}-${size.width}-before-shrink.png`, size.scale);

    await setLocalZoneState(page, 1080);
    await expect(page.locator('#zone-summary')).toHaveText('MODE: SHRINKING ZONE · STAGE 1 · NEXT 15s');
    await captureCanvas(page, `artifacts/screenshots/g6-zone-${visualStyle}-${size.width}-after-shrink.png`, size.scale);

    await setLocalZoneState(page, 1829);
    await expect(page.locator('#zone-summary')).toHaveText('MODE: SHRINKING ZONE · STAGE 1 · NEXT 3s');
    await expect(page.locator('#zone-status')).not.toHaveClass(/is-warning/);
    await setLocalZoneState(page, 1830);
    await expect(page.locator('#zone-summary')).toHaveText('MODE: SHRINKING ZONE · SHRINK IN 2.5s · MOVE INSIDE');
    await expect(page.locator('#zone-status')).toHaveClass(/is-warning/);
    await expect.poll(() => page.evaluate(() =>
      (window as any).__turenkiGame.scene.getScene('StationScene').zoneGraphics.visible)).toBe(true);

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
    state.tick = 930;
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
    before: { summary: 'MODE: SHRINKING ZONE · FIRST SHRINK IN 2.5s · MOVE INSIDE', visible: true },
    after: {
      summary: 'MODE: SHRINKING ZONE · STAGE 1 · NEXT 15s',
      danger: 'DANGER OUTSIDE SAFE AREA · P1',
      marked: true,
      visible: true,
    },
    cleared: { hidden: true, visible: false },
  });
  await expect(page.locator('#zone-summary')).toHaveCSS('font-size', '14px');
});

test('reduced motion keeps both mode boundaries and warnings steady', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await setLocalZoneState(page, 930);
  await expect(page.locator('#zone-summary')).toContainText('MODE: SHRINKING ZONE');
  await expect(page.locator('#zone-status')).toHaveClass(/is-warning/);
  await expect(page.locator('#zone-status')).not.toHaveClass(/is-warning-flash/);
  const result = await page.evaluate(() => {
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    return { visible: scene.zoneGraphics.visible, reducedFlash: scene.zoneGraphics.visible &&
      document.querySelector('#zone-status')?.classList.contains('is-warning-flash') };
  });
  expect(result).toEqual({ visible: true, reducedFlash: false });
});
