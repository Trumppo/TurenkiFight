import { test, expect } from '@playwright/test';

import { enterLocalGame } from './titleFlow';
test('keyboard guide labels keyboard, gamepad and bot slots without obscuring the arena', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await enterLocalGame(page, '/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  const guide = page.locator('details.controls');
  await expect(guide).not.toHaveAttribute('open', '');
  // The native short viewport gives the full 16:9 camera to the match; the
  // keyboard table remains available on roomier layouts instead of covering play.
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(361);
  await expect(guide).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(guide).toBeVisible();
  await expect(guide.locator('summary')).toContainText('P1-P4');
  await expect(guide.locator('summary')).toContainText('P3/P4 keyboard after assignment');
  await guide.locator('summary').click();
  await expect(guide).toHaveAttribute('open', '');
  const rows = guide.locator('tbody tr');
  await expect(rows).toHaveCount(10);
  await expect(rows.nth(1)).toContainText('Hyppy');
  await expect(rows.nth(1)).toContainText('SPACE');
  await expect(rows.nth(1)).toContainText('K');
  await expect(rows.nth(4)).toContainText('Hyppypotku');
  await expect(rows.nth(4)).toContainText('H');
  await expect(rows.nth(4)).toContainText('U');
  // The M12 grab action is documented for both keyboard players.
  await expect(rows.nth(5)).toContainText('T');
  await expect(rows.nth(5)).toContainText('I');
  await expect(rows.nth(5)).toContainText('Poimi / heitä');
  await expect(rows.nth(6)).toContainText('Shift');
  await expect(rows.nth(7)).toContainText('Enter');
  await expect(rows.nth(8)).toContainText('Tauko / jatka');
  await expect(rows.nth(8)).toContainText('P');
  // The reset shortcut is documented with the other bindings.
  await expect(rows.nth(9)).toContainText('Esc');
  await expect(rows.nth(9)).toContainText('RESET');
  await expect(guide.locator('.controls-note')).toContainText('LB (button 4)');
  const guideLayout = await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas')!.getBoundingClientRect();
    const guide = document.querySelector('details.controls')!.getBoundingClientRect();
    const fonts = Array.from(document.querySelectorAll<HTMLElement>('details.controls summary, details.controls th, details.controls td'))
      .map(element => Number.parseFloat(getComputedStyle(element).fontSize));
    return { canvasBottom: canvas.bottom, guideTop: guide.top, minFontSize: Math.min(...fonts) };
  });
  expect(guideLayout.guideTop).toBeGreaterThanOrEqual(guideLayout.canvasBottom);
  expect(guideLayout.minFontSize).toBeGreaterThanOrEqual(14);
});
