import { test, expect } from '@playwright/test';

test('station prototype loads without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'TurenkiFight' })).toBeVisible();
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByText('Turengin rautatieasema', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test('station SVG loads and four-player HUD is visible after gamepad joins', async ({ page }) => {
  const errors: string[] = [];
  const missing: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(() => {
    const pads = Array.from({ length: 3 }, (_, index) => ({
      id: `QA Gamepad ${index}`,
      index,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, button) => ({
        pressed: button === 8, touched: button === 8, value: button === 8 ? 1 : 0,
      })),
      timestamp: 0,
    }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
  });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    if (!game) return 0;
    const scene = game.scene.getScene('StationScene') as { playerHud?: Map<string, unknown> };
    return scene.playerHud?.size ?? 0;
  })).toBe(4);
  const state = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene') as {
      state: { fighters: { id: string }[] };
      textures: { exists: (key: string) => boolean };
      playerHud: Map<string, { text: string }>;
    };
    return {
      players: scene.state.fighters.map(f => f.id),
      textures: ['P1', 'P2', 'P3', 'P4'].every(id =>
        ['idle', 'walk', 'punch', 'kick', 'jumpkick', 'hit', 'ko', 'respawn'].every(pose =>
          [0, 1, 2, 3].every(frame => scene.textures.exists(`fighter-${id}-${pose}-${frame}`))),
      hud: [...scene.playerHud.values()].map(label => label.text),
      station: scene.textures.exists('station-backdrop'),
    };
  });
  expect(state.players).toEqual(['P1', 'P2', 'P3', 'P4']);
  expect(state.textures).toBe(true);
  expect(state.station).toBe(true);
  expect(state.hud).toHaveLength(4);
  expect(state.hud.every(text => text.includes('HP 100'))).toBe(true);
  expect(missing).toEqual([]);
  expect(errors).toEqual([]);
});

test('responsive canvas retains 16:9 and logical camera coverage', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  const geometry = await canvas.evaluate((element: HTMLCanvasElement) => ({
    internalWidth: element.width, internalHeight: element.height,
    cssWidth: element.getBoundingClientRect().width,
    cssHeight: element.getBoundingClientRect().height,
  }));
  expect(geometry.internalWidth).toBe(640);
  expect(geometry.internalHeight).toBe(360);
  expect(geometry.cssWidth / geometry.cssHeight).toBeCloseTo(16 / 9, 1);
});
