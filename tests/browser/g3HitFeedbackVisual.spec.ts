import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function triggerFeedback(page: Page, targetHealth: number): Promise<void> {
  await page.evaluate(async targetHealth => {
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    const scene = (window as any).__turenkiGame.scene.getScene('StationScene');
    const state = simulation.createState({ ids: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'], phase: 'fighting' });
    const crowd = [
      { x: 270, y: 160 }, { x: 290, y: 160 }, { x: 250, y: 155 }, { x: 310, y: 155 },
      { x: 256, y: 174 }, { x: 304, y: 174 }, { x: 270, y: 145 }, { x: 290, y: 145 },
    ];
    state.fighters.forEach((fighter: { x: number; y: number }, index: number) => Object.assign(fighter, crowd[index]));
    const attacker = state.fighters[0];
    const target = state.fighters[1];
    Object.assign(attacker, { facing: 1 });
    Object.assign(target, { health: targetHealth });
    scene.state = state;
    scene.matchEvents = [];
    scene.elapsedMs = 0;
    scene.keys.F.isDown = true;
    scene.update(0, 150);
    scene.keys.F.isDown = false;
  }, targetHealth);
}

test('G3 hit and KO desktop visual evidence', async ({ page }) => {
  test.skip(!process.env.G3_CAPTURE_DIR, 'Set G3_CAPTURE_DIR to capture G3 visual evidence.');
  const directory = process.env.G3_CAPTURE_DIR!;
  await mkdir(directory, { recursive: true });
  const style = process.env.VITE_VISUAL_STYLE === 'retro' ? 'retro' : 'classic';

  for (const { width, height } of [{ width: 640, height: 360 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.locator('#game canvas')).toBeVisible();
    await triggerFeedback(page, 100);
    const hit = await page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').combatFeedbackDiagnostics());
    expect(hit.liveSparks).toBeGreaterThan(0);
    expect(hit.liveSparks).toBeLessThanOrEqual(hit.maxLiveSparks);
    await page.screenshot({ path: join(directory, `${style}-${width}x${height}-hit.png`) });

    await page.reload();
    await expect(page.locator('#game canvas')).toBeVisible();
    await triggerFeedback(page, 10);
    const knockout = await page.evaluate(() => (window as any).__turenkiGame.scene.getScene('StationScene').combatFeedbackDiagnostics());
    expect(knockout.knockoutTargets).toEqual(['P2']);
    await page.screenshot({ path: join(directory, `${style}-${width}x${height}-ko.png`) });
  }
});
