import { expect, test } from '@playwright/test';

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
  await page.evaluate(() => { (window as any).__pads[0].buttons[8].pressed = true; });
  await expect.poll(async () => (await snapshot()).slots).toEqual([[0, 'P2']]);
  await expect.poll(async () => (await snapshot()).players).toEqual(['P1', 'P2']);

  // Disconnect during lobby. The roster is stable, while device bindings are removed.
  await page.evaluate(() => { (window as any).__pads[0] = null; });
  await expect.poll(async () => (await snapshot()).slots).toEqual([]);
  await expect.poll(async () => (await snapshot()).joinEdges).toEqual([]);
  await expect.poll(async () => (await snapshot()).startEdges).toEqual([]);
  expect((await snapshot()).players).toEqual(['P1', 'P2']);

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
