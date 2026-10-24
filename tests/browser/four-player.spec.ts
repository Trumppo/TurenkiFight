import { test, expect } from '@playwright/test';

test('four local fighters can join through simulated gamepads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const pads = [0, 1].map(index => ({
      index, connected: true, id: 'Test gamepad ' + index, mapping: 'standard',
      axes: [0, 0, 0, 0], buttons: Array.from({length: 16}, (_, i) => ({pressed: i === 0, touched: i === 0, value: i === 0 ? 1 : 0})),
      timestamp: 0, vibrationActuator: null, hapticActuators: [],
    }));
    Object.defineProperty(navigator, 'getGamepads', {configurable: true, value: () => pads});
  });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  // Phaser text is rendered inside the canvas; inspect the scene state instead.
  await expect.poll(async () => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { state: { fighters: unknown[] } } } } }).__turenkiGame;
    return game?.scene.getScene('StationScene')?.state?.fighters?.length ?? 0;
  }), {timeout: 3000}).toBe(4);
  expect(errors).toEqual([]);
});
