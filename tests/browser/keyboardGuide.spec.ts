import { test, expect } from '@playwright/test';

test('keyboard reference documents both players without obscuring the arena', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  const guide = page.locator('details.controls');
  await expect(guide).not.toHaveAttribute('open', '');
  await expect(guide.locator('summary')).toContainText('Näppäinkartta');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(361);
  await guide.locator('summary').click();
  await expect(guide).toHaveAttribute('open', '');
  const rows = guide.locator('tbody tr');
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(1)).toContainText('Välilyönti');
  await expect(rows.nth(1)).toContainText('K');
  await expect(rows.nth(4)).toContainText('H');
  await expect(rows.nth(4)).toContainText('U');
  await expect(rows.nth(5)).toContainText('Shift');
  await expect(rows.nth(6)).toContainText('Enter');
});
