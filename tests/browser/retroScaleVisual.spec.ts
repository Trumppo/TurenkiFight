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
    await expect.poll(() => page.evaluate(() => {
      const game = (window as typeof window & { __turenkiGame?: {
        scene: { getScene: (key: string) => {
          sys: { isActive: () => boolean };
          textures: { exists: (key: string) => boolean };
        } };
      } }).__turenkiGame;
      const scene = game?.scene.getScene('StationScene');
      return !!scene?.sys.isActive() && scene.textures.exists('station-backdrop') &&
        ['P1', 'P2', 'P3', 'P4'].every(id =>
          ['idle', 'punch', 'kick', 'hit', 'ko', 'respawn'].every(pose =>
            scene.textures.exists(`fighter-${id}-${pose}-0`)));
    })).toBe(true);
    await expect(canvas).toHaveAttribute('width', '640');
    await expect(canvas).toHaveAttribute('height', '360');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.height).toBeGreaterThan(0);
    expect(bounds!.width).toBeLessThanOrEqual(size.width + 1);
    expect(bounds!.height).toBeLessThanOrEqual(size.height + 1);
    // Mobile fit must include the whole arena, not just a nonzero canvas size.
    if (size.name === 'mobile') {
      expect(bounds!.x, 'Mobile playfield must start inside the viewport').toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width, 'Mobile playfield must fit horizontally').toBeLessThanOrEqual(size.width + 1);
      expect(bounds!.y, 'Mobile playfield must start inside the viewport').toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height, 'Mobile playfield must fit vertically').toBeLessThanOrEqual(size.height + 1);
    }
    // A visible canvas may still be clipped below the viewport by page chrome.
    // At the native viewport the entire playfield must be visible without scrolling.
    if (size.name === 'native') {
      expect(bounds!.y, 'Native playfield must not start above the viewport').toBeGreaterThanOrEqual(0);
      expect(
        bounds!.y + bounds!.height,
        'Native playfield bottom must fit in the browser viewport',
      ).toBeLessThanOrEqual(size.height + 1);
    }
    if (size.name === 'mobile') {
      // Confirm the full logical playfield is actually inside the visible window.
      // The CSS bounds assertions above catch overflow; this checks both axes
      // against the viewport after layout has settled.
      await expect.poll(async () => canvas.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.top >= 0 &&
          rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1;
      })).toBe(true);
    }
    mkdirSync('artifacts/visual', { recursive: true });
    await page.screenshot({
      path: `artifacts/visual/vis-05-arena-${size.name}.png`,
      fullPage: true,
    });
  });
}
