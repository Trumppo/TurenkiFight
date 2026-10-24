import { test, expect } from '@playwright/test';

test('lobby requires explicit joining, P1 host and two players', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      index: 0, connected: true, id: 'Unassigned gamepad', mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
      timestamp: 0,
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    (window as typeof window & { __testPad?: typeof pad }).__testPad = pad;
  });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const state = () => page.evaluate(() => {
    const game = (window as typeof window & {
      __turenkiGame?: { scene: { getScene: (key: string) => { state: { phase: string; fighters: unknown[] } } } }
    }).__turenkiGame!;
    const s = game.scene.getScene('StationScene').state;
    return { phase: s.phase, count: s.fighters.length };
  });
  await expect.poll(state).toEqual({ phase: 'lobby', count: 1 });
  await page.keyboard.down('Enter');
  await expect.poll(state).toEqual({ phase: 'lobby', count: 1 });
  await page.keyboard.up('Enter');
  await page.evaluate(() => {
    (window as typeof window & { __testPad?: { buttons: { pressed: boolean }[] } }).__testPad!.buttons[9].pressed = true;
  });
  await expect.poll(state).toEqual({ phase: 'lobby', count: 1 });
  await page.evaluate(() => {
    const buttons = (window as typeof window & { __testPad?: { buttons: { pressed: boolean }[] } }).__testPad!.buttons;
    buttons[9].pressed = false;
    buttons[8].pressed = true;
  });
  await expect.poll(state).toEqual({ phase: 'lobby', count: 2 });
  await page.evaluate(() => {
    const buttons = (window as typeof window & { __testPad?: { buttons: { pressed: boolean }[] } }).__testPad!.buttons;
    buttons[8].pressed = false;
    buttons[9].pressed = true;
  });
  await expect.poll(state).toEqual({ phase: 'lobby', count: 2 });
  await page.keyboard.down('Enter');
  await expect.poll(state).toEqual({ phase: 'countdown', count: 2 });
  await page.keyboard.up('Enter');
});
