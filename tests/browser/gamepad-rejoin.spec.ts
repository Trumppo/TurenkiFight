import { expect, test } from '@playwright/test';

test('same browser gamepad index and id reclaim their paired slot on reconnect', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      index: 0, connected: true, id: 'Stable QA controller', mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
      timestamp: 0,
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pad.connected ? [pad] : [] });
    (window as typeof window & { __stablePad?: typeof pad }).__stablePad = pad;
  });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.evaluate(() => { (window as any).__stablePad.buttons[8].pressed = true; });
  await expect(page.locator('.hud-player[data-player="P2"] .hud-name')).toHaveText('P2 PAD 0');
  await page.evaluate(() => {
    const pad = (window as any).__stablePad;
    pad.buttons[8].pressed = false;
    pad.connected = false;
  });
  await expect.poll(() => page.evaluate(() => [...(window as any).__turenkiGame.scene.getScene('StationScene').gamepadSlots.entries()])).toEqual([]);
  await expect(page.locator('.hud-player[data-player="P2"] .hud-name')).toHaveText('P2 KEYBOARD');
  await page.evaluate(() => { (window as any).__stablePad.connected = true; });
  await expect.poll(() => page.evaluate(() => [...(window as any).__turenkiGame.scene.getScene('StationScene').gamepadSlots.entries()])).toEqual([[0, 'P2']]);
  await expect(page.locator('.hud-player[data-player="P2"] .hud-name')).toHaveText('P2 PAD 0');
});

test('disconnected pad releases its slot; replacement joins without a phantom fighter', async ({ page }) => {
  await page.addInitScript(() => {
    type Pad = { index: number; axes: number[]; buttons: { pressed: boolean }[] };
    const makePad = (index: number): Pad => ({
      index, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
    });
    const pads: (Pad | null)[] = [makePad(0), null];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
    (window as typeof window & { __pads?: typeof pads; __makePad?: typeof makePad }).__pads = pads;
    (window as typeof window & { __makePad?: typeof makePad }).__makePad = makePad;
  });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const snapshot = () => page.evaluate(() => {
    const scene = (window as typeof window & {
      __turenkiGame: { scene: { getScene: (name: string) => {
        state: { phase: string; fighters: { id: string }[] };
        gamepadSlots: Map<number, string>;
        lastJoinButtons: Map<number, boolean>;
        lastPadStart: Map<number, boolean>;
      } } };
    }).__turenkiGame.scene.getScene('StationScene');
    return {
      phase: scene.state.phase,
      players: scene.state.fighters.map(f => f.id),
      slots: [...scene.gamepadSlots.entries()],
      joinEdges: [...scene.lastJoinButtons.keys()],
      startEdges: [...scene.lastPadStart.keys()],
    };
  });
  await expect.poll(async () => (await snapshot()).players).toEqual(['P1']);
  await expect(page.locator('#match-status')).toContainText('PAD 0 READY');
  await page.evaluate(() => { (window as any).__pads[0].buttons[8].pressed = true; });
  await expect.poll(async () => (await snapshot()).slots).toEqual([[0, 'P2']]);
  await expect.poll(async () => (await snapshot()).players).toEqual(['P1', 'P2']);
  await expect(page.locator('#match-status')).toContainText('PAD 0 → P2');

  // Disconnect during lobby. The roster is stable, while device bindings are removed.
  await page.evaluate(() => { (window as any).__pads[0] = null; });
  await expect.poll(async () => (await snapshot()).slots).toEqual([]);
  await expect.poll(async () => (await snapshot()).joinEdges).toEqual([]);
  await expect.poll(async () => (await snapshot()).startEdges).toEqual([]);
  expect((await snapshot()).players).toEqual(['P1', 'P2']);
  await expect(page.locator('#match-status')).not.toContainText('PAD 0');

  // A different device claims the existing P2 slot, even with no free roster growth.
  await page.evaluate(() => {
    const w = window as any;
    w.__pads[1] = w.__makePad(1);
    w.__pads[1].buttons[8].pressed = true;
  });
  await expect.poll(async () => (await snapshot()).slots).toEqual([[1, 'P2']]);
  expect((await snapshot()).players).toEqual(['P1', 'P2']);
  await page.waitForTimeout(80);
  expect((await snapshot()).slots).toEqual([[1, 'P2']]);

  // During an active match, disconnect never removes a fighter or adds a new one.
  await page.keyboard.down('Enter');
  await expect.poll(async () => (await snapshot()).phase).toBe('countdown');
  await page.keyboard.up('Enter');
  await page.evaluate(() => { (window as any).__pads[1] = null; });
  await expect.poll(async () => (await snapshot()).slots).toEqual([]);
  expect((await snapshot()).players).toEqual(['P1', 'P2']);
});
