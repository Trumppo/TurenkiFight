import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const sizes = [
  { name: 'native', width: 640, height: 360 },
  { name: 'double', width: 1280, height: 720 },
  { name: 'triple', width: 1920, height: 1080 },
  { name: 'mobile', width: 390, height: 844 },
];

for (const size of sizes) {
  test(`VIS-05 retro arena at ${size.name} viewport`, async ({ page }) => {
    test.skip(process.env.VITE_VISUAL_STYLE !== 'retro', 'Retro visual review only');
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    const canvas = page.locator('#game canvas');
    await expect(canvas).toBeVisible();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.height).toBeGreaterThan(0);
    expect(bounds!.width).toBeLessThanOrEqual(size.width + 1);
    expect(bounds!.height).toBeLessThanOrEqual(size.height + 1);
    mkdirSync('artifacts/visual', { recursive: true });
    await page.screenshot({
      path: `artifacts/visual/vis-05-arena-${size.name}.png`,
      fullPage: true,
    });
  });
}
