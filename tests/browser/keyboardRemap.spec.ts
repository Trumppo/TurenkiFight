import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

type SceneProbe = {
  state: { phase: string; fighters: { id: string; x: number }[] };
  drawFighters: () => void;
};

async function scene(page: import('@playwright/test').Page): Promise<SceneProbe> {
  return page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => SceneProbe } } }).__turenkiGame;
    return game!.scene.getScene('StationScene');
  });
}

async function chooseSlot(page: import('@playwright/test').Page, slot: string): Promise<void> {
  const editor = page.locator('#keyboard-editor');
  if (!(await editor.evaluate(node => (node as HTMLDetailsElement).open))) await editor.locator('summary').click();
  await page.locator('#keyboard-slot').selectOption(slot);
}

async function assign(page: import('@playwright/test').Page, slot: string, binding: string, key: string): Promise<void> {
  await chooseSlot(page, slot);
  await page.locator(`#keyboard-actions [data-key-binding="${binding}"]`).click();
  await page.keyboard.press(key);
}

async function startProbeFight(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => SceneProbe } } }).__turenkiGame!;
    const current = game.scene.getScene('StationScene');
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    current.state = simulation.createState({ ids: current.state.fighters.map(fighter => fighter.id), phase: 'fighting', mode: 'score-brawl' });
    current.drawFighters();
  });
}

test('local P1-P4 keyboard bindings remap, join, persist and reset without moving the canvas', async ({ page }) => {
  const errors: string[] = [];
  const style = process.env.VITE_VISUAL_STYLE === 'retro' ? 'retro' : 'classic';
  mkdirSync('artifacts/screenshots', { recursive: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.locator('#keyboard-editor > summary').click();
  const desktopCanvas = await page.locator('#game canvas').boundingBox();
  expect(desktopCanvas).not.toBeNull();
  await page.screenshot({ path: `artifacts/screenshots/keyboard-remap-${style}-1280x720.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCanvas = await page.locator('#game canvas').boundingBox();
  expect(mobileCanvas).not.toBeNull();
  expect(mobileCanvas!.width).toBeLessThan(desktopCanvas!.width);
  await page.screenshot({ path: `artifacts/screenshots/keyboard-remap-${style}-390x844.png` });

  await chooseSlot(page, 'P2');
  await page.locator('#keyboard-actions [data-key-binding="punch"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#keyboard-message')).toHaveText('Capture cancelled.');
  expect((await scene(page)).state.fighters.map(fighter => fighter.id)).toEqual(['P1']);

  // Keep P1's original defaults intact until its player explicitly remaps.
  await assign(page, 'P1', 'moveXPositive', 'q');
  await assign(page, 'P3', 'moveXPositive', 'm');
  await assign(page, 'P3', 'jump', 'n');
  await expect.poll(async () => (await scene(page)).state.fighters.map(fighter => fighter.id)).toEqual(['P1', 'P3']);
  await page.locator('details.controls > summary').click();
  await expect(page.locator('details.controls tbody tr').first().locator('td').nth(0)).toHaveText('W / A / S / Q');
  await expect(page.locator('details.controls tbody tr').first().locator('td').nth(2)).toHaveText('M');
  await expect(page.locator('details.controls tbody tr').first().locator('td').nth(3)).toHaveText('—');

  await startProbeFight(page);
  const initialP1 = (await scene(page)).state.fighters.find(fighter => fighter.id === 'P1')!.x;
  await page.keyboard.down('d');
  await page.waitForTimeout(140);
  await page.keyboard.up('d');
  const afterOldKey = (await scene(page)).state.fighters.find(fighter => fighter.id === 'P1')!.x;
  expect(Math.abs(afterOldKey - initialP1)).toBeLessThan(0.1);
  await page.keyboard.down('q');
  const p1Samples = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { readInputs: (pads: Gamepad[]) => { playerId: string; moveX: number }[] } } } }).__turenkiGame!;
    return game.scene.getScene('StationScene').readInputs([]).filter(input => input.playerId === 'P1');
  });
  expect(p1Samples).toHaveLength(1);
  expect(p1Samples[0].moveX).toBe(1);
  await page.waitForTimeout(160);
  await page.keyboard.up('q');
  const afterNewKey = (await scene(page)).state.fighters.find(fighter => fighter.id === 'P1')!.x;
  expect(afterNewKey).toBeGreaterThan(afterOldKey + 1);

  const initialP3 = (await scene(page)).state.fighters.find(fighter => fighter.id === 'P3')!.x;
  await page.keyboard.down('m');
  await page.waitForTimeout(160);
  await page.keyboard.up('m');
  const afterP3Key = (await scene(page)).state.fighters.find(fighter => fighter.id === 'P3')!.x;
  expect(afterP3Key).toBeGreaterThan(initialP3 + 1);

  // Saved P3 mappings restore the third keyboard player and all bindings after reload.
  await page.reload();
  await expect.poll(async () => (await scene(page)).state.fighters.map(fighter => fighter.id)).toEqual(['P1', 'P3']);
  await startProbeFight(page);
  const reloadedP1 = (await scene(page)).state.fighters.find(fighter => fighter.id === 'P1')!.x;
  await page.keyboard.down('q');
  await page.waitForTimeout(150);
  await page.keyboard.up('q');
  expect((await scene(page)).state.fighters.find(fighter => fighter.id === 'P1')!.x).toBeGreaterThan(reloadedP1 + 1);

  // Back in the lobby, reset only P1; defaults return and a duplicate key is refused.
  await page.locator('#reset-match').click();
  await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => SceneProbe } } }).__turenkiGame!;
    const current = game.scene.getScene('StationScene');
    current.state.phase = 'lobby';
    current.drawFighters();
  });
  await expect(page.locator('#keyboard-editor')).toBeVisible();
  await chooseSlot(page, 'P1');
  await page.locator('#keyboard-reset-slot').click();
  await expect(page.locator('details.controls tbody tr').first().locator('td').nth(0)).toHaveText('W / A / S / D');
  await chooseSlot(page, 'P1');
  await page.locator('#keyboard-actions [data-key-binding="punch"]').click();
  await page.keyboard.press('d');
  await expect(page.locator('#keyboard-message')).toContainText('already bound');
  await expect(page.locator('#keyboard-message')).toContainText('P1 MOVE RIGHT');

  await page.locator('#keyboard-reset-all').click();
  await expect(page.locator('#keyboard-message')).toContainText('All keyboard bindings restored');
  await expect.poll(async () => (await scene(page)).state.fighters.map(fighter => fighter.id)).toEqual(['P1']);
  expect(errors).toEqual([]);
});
