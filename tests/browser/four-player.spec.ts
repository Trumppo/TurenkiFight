import { test, expect } from '@playwright/test';

test('four local fighters can join through simulated gamepads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const pads = [0, 1].map(index => ({
      index, connected: true, id: 'Test gamepad ' + index, mapping: 'standard',
      axes: [0, 0, 0, 0], buttons: Array.from({length: 16}, (_, i) => ({pressed: false, touched: i === 0, value: i === 0 ? 1 : 0})),
      timestamp: 0, vibrationActuator: null, hapticActuators: [],
    }));
    Object.defineProperty(navigator, 'getGamepads', {configurable: true, value: () => pads});
    (window as typeof window & { __testPads?: typeof pads }).__testPads = pads;
  });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('#game canvas')).toHaveAttribute('width', '640');
  await expect(page.locator('#game canvas')).toHaveAttribute('height', '360');
  // Keyboard P2 must join explicitly before the two controllers can occupy P3/P4.
  await page.keyboard.down('Shift');
  await expect.poll(async () => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { state: { fighters: unknown[] } } } } }).__turenkiGame;
    return game?.scene.getScene('StationScene')?.state?.fighters?.length ?? 0;
  })).toBe(2);
  await page.keyboard.up('Shift');
  await page.evaluate(() => {
    const pads = (window as typeof window & { __testPads?: { buttons: { pressed: boolean }[] }[] }).__testPads!;
    for (const pad of pads) pad.buttons[8].pressed = true;
  });
  // Phaser text is rendered inside the canvas; inspect the scene state instead.
  await expect.poll(async () => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { state: { fighters: unknown[] } } } } }).__turenkiGame;
    return game?.scene.getScene('StationScene')?.state?.fighters?.length ?? 0;
  }), {timeout: 3000}).toBe(4);
  const hud = await page.evaluate(() => {
    const game = (window as typeof window & {
      __turenkiGame?: { scene: { getScene: (key: string) => {
        state: { phase: string; fighters: { id: string }[] };
        playerHud: Map<string, { text: string }>;
        hudTimer: { text: string };
        gamepadSlots: Map<number, string>;
      } } }
    }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    return {
      phase: scene.state.phase,
      timer: scene.hudTimer.text,
      panels: scene.state.fighters.map(f => scene.playerHud.get(f.id)?.text),
      pads: [...scene.gamepadSlots.values()],
    };
  });
  expect(hud.phase).toBe('lobby');
  expect(hud.timer).toBe('02:00');
  expect(hud.panels).toHaveLength(4);
  for (const [i, panel] of hud.panels.entries()) {
    expect(panel).toContain(`P${i + 1} HP 100`);
    expect(panel).toContain('0');
  }
  expect(hud.pads).toEqual(['P3', 'P4']);
  await page.keyboard.down('Enter');
  await expect.poll(async () => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { state: { phase: string } } } } }).__turenkiGame;
    return game?.scene.getScene('StationScene')?.state?.phase;
  })).toBe('countdown');
  await page.keyboard.up('Enter');
  const result = await page.evaluate(async () => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => { state: unknown; drawFighters: () => void } } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    // Import the actual Vite-served simulation for a deterministic accelerated round.
    const moduleUrl = '/src/game/simulation/step.ts';
    const simulation = await import(/* @vite-ignore */ moduleUrl);
    let state = scene.state as ReturnType<typeof simulation.createState>;
    for (let i = 0; i < simulation.COUNTDOWN_TICKS + simulation.MATCH_TICKS; i++) state = simulation.step(state, []);
    scene.state = state;
    scene.drawFighters();
    return { phase: state.phase, remaining: state.remainingTicks, roster: state.fighters.length };
  });
  expect(result).toEqual({ phase: 'results', remaining: 0, roster: 4 });
  expect(errors).toEqual([]);
});
