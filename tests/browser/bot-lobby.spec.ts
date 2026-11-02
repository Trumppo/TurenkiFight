import { test, expect } from '@playwright/test';

type SceneHook = {
  state: { phase: string; fighters: { id: string; x: number }[] };
};

const state = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const game = (window as typeof window & {
    __turenkiGame?: { scene: { getScene: (key: string) => SceneHook } };
  }).__turenkiGame;
  const scene = game!.scene.getScene('StationScene');
  return { phase: scene.state.phase, ids: scene.state.fighters.map(fighter => fighter.id) };
});

/** One lobby key press; the scene samples edges on rAF, so hold across a frame. */
async function tap(page: import('@playwright/test').Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(80);
  await page.keyboard.up(key);
  await page.waitForTimeout(40);
}

test('a lobby bot joins, is marked in the HUD and moves during the match', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(() => state(page)).toMatchObject({ phase: 'lobby', ids: ['P1'] });

  await tap(page, 'b');
  await expect.poll(() => state(page)).toMatchObject({ phase: 'lobby', ids: ['P1', 'P2'] });
  const botHud = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.hud-player[data-player="P2"]')!;
    return {
      dataBot: card.dataset.bot,
      className: card.className,
      label: card.getAttribute('aria-label'),
      name: card.querySelector('.hud-name')?.textContent,
      health: card.querySelector('.hud-health')?.textContent,
    };
  });
  expect(botHud.dataBot).toBe('true');
  expect(botHud.className).toContain('is-bot');
  expect(botHud.label).toBe('P2, bot, score 0, health 100');
  expect(botHud.name).toBe('P2');
  expect(botHud.health).toBe('H100');
  // A human P2 keyboard slot must not have been created alongside the bot.
  await page.keyboard.down('Shift');
  await page.waitForTimeout(120);
  await page.keyboard.up('Shift');
  expect(await state(page)).toMatchObject({ phase: 'lobby', ids: ['P1', 'P2'] });
  expect(await page.evaluate(() => document.querySelector<HTMLElement>('.hud-player[data-player="P2"]')!.dataset.bot)).toBe('true');

  // Removing the bot frees the slot again and clears the marker.
  await tap(page, 'v');
  await expect.poll(() => state(page)).toMatchObject({ phase: 'lobby', ids: ['P1'] });
  expect(await page.evaluate(() => document.querySelector<HTMLElement>('.hud-player[data-player="P2"]')!.dataset.bot)).toBeUndefined();

  // Fill the remaining slots so the human fights three bots.
  for (const expected of [['P1', 'P2'], ['P1', 'P2', 'P3'], ['P1', 'P2', 'P3', 'P4']]) {
    await tap(page, 'b');
    await expect.poll(() => state(page)).toMatchObject({ phase: 'lobby', ids: expected });
  }

  await page.keyboard.down('Enter');
  await expect.poll(() => state(page)).toMatchObject({ phase: 'countdown' });
  await page.keyboard.up('Enter');
  await expect.poll(async () => (await state(page)).phase, { timeout: 6000 }).toBe('fighting');

  const botX = () => page.evaluate(() => {
    const game = (window as typeof window & {
      __turenkiGame?: { scene: { getScene: (key: string) => SceneHook } };
    }).__turenkiGame;
    return game!.scene.getScene('StationScene').state.fighters.find(fighter => fighter.id === 'P2')!.x;
  });
  const startX = await botX();
  await expect.poll(async () => Math.abs((await botX()) - startX), { timeout: 5000 }).toBeGreaterThan(1);
  expect(await page.evaluate(() => document.querySelector<HTMLElement>('.hud-player[data-player="P2"]')!.dataset.bot)).toBe('true');
  expect(errors).toEqual([]);
});
