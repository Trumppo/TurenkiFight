import { test, expect } from '@playwright/test';

test('P1 explicitly binds an unassigned gamepad Start; nonhost cannot start; reconnect retains host', async ({ page }) => {
  await page.addInitScript(() => {
    const pads = Array.from({ length: 4 }, (_, index) => ({
      index, connected: true, id: 'QA pad ' + index, mapping: 'standard',
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
      timestamp: 0,
    }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads.map(p => p.connected ? p : null) });
    (window as typeof window & { __qaPads?: typeof pads }).__qaPads = pads;
  });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const inspect = () => page.evaluate(() => {
    const scene = (window as typeof window & {
      __turenkiGame?: { scene: { getScene: (name: string) => {
        state: { phase: string; fighters: { id: string }[] };
        gamepadSlots: Map<number, string>;
      } } };
    }).__turenkiGame!.scene.getScene('StationScene');
    return { phase: scene.state.phase, roster: scene.state.fighters.map(f => f.id), slots: [...scene.gamepadSlots.entries()] };
  });
  const button = async (index: number, buttonIndex: number, pressed: boolean) =>
    page.evaluate(({ index, buttonIndex, pressed }) => {
      (window as typeof window & { __qaPads?: { buttons: { pressed: boolean }[] }[] }).__qaPads![index].buttons[buttonIndex].pressed = pressed;
    }, { index, buttonIndex, pressed });

  expect((await inspect()).roster).toEqual(['P1']);
  await button(0, 9, true);
  await expect.poll(async () => (await inspect()).phase).toBe('lobby');
  expect((await inspect()).slots).toEqual([]);
  await button(0, 9, false);

  // The keyboard explicitly joins P2; pads 1 and 2 join P3/P4.
  await page.keyboard.down('Shift');
  await expect.poll(async () => (await inspect()).roster).toEqual(['P1', 'P2']);
  await page.keyboard.up('Shift');
  await button(1, 8, true);
  await expect.poll(async () => (await inspect()).roster).toEqual(['P1', 'P2', 'P3']);
  await button(1, 8, false);
  await button(2, 8, true);
  await expect.poll(async () => (await inspect()).roster).toEqual(['P1', 'P2', 'P3', 'P4']);
  await button(2, 8, false);

  await button(1, 9, true); // P3 is not the host.
  await expect.poll(async () => (await inspect()).phase).toBe('lobby');
  await button(1, 9, false);
  await button(0, 9, true); // Unassigned pad explicitly claims P1 and starts.
  await expect.poll(async () => (await inspect()).phase).toBe('countdown');
  expect((await inspect()).slots).toEqual([[1, 'P3'], [2, 'P4'], [0, 'P1']]);
  await button(0, 9, false);

  // Disconnect must preserve ownership; reconnecting the same index restores the binding.
  await page.evaluate(() => {
    (window as typeof window & { __qaPads?: { connected: boolean }[] }).__qaPads![0].connected = false;
  });
  await expect.poll(async () => (await inspect()).slots).toContainEqual([0, 'P1']);
  await page.evaluate(() => {
    (window as typeof window & { __qaPads?: { connected: boolean }[] }).__qaPads![0].connected = true;
  });
  const result = await page.evaluate(async () => {
    const scene = (window as typeof window & {
      __turenkiGame?: { scene: { getScene: (name: string) => { state: unknown } } };
    }).__turenkiGame!.scene.getScene('StationScene');
    const moduleUrl = '/src/game/simulation/step.ts';
    const sim = await import(/* @vite-ignore */ moduleUrl);
    let state = scene.state as ReturnType<typeof sim.createState>;
    for (let i = 0; i < sim.COUNTDOWN_TICKS + sim.MATCH_TICKS; i++) state = sim.step(state, []);
    scene.state = state;
    return state.phase;
  });
  expect(result).toBe('results');
  await button(0, 9, true);
  await expect.poll(async () => (await inspect()).phase).toBe('countdown');
  expect((await inspect()).roster).toEqual(['P1', 'P2', 'P3', 'P4']);
  await button(0, 9, false);
});
