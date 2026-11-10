import { test, expect } from '@playwright/test';

type LobbyState = {
  phase: string;
  ids: string[];
  bots: string[];
  playerCount: number;
};

test('player count limits the local roster and persists across reload', async ({ page }) => {
  await page.goto('/');
  const count = page.locator('#player-count');
  await expect(count).toBeVisible();
  await expect(count).toHaveValue('8');

  await count.selectOption('1');
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => any } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    return { count: scene.selectedPlayerCount, ids: scene.state.fighters.map((fighter: { id: string }) => fighter.id) };
  })).toEqual({ count: 1, ids: ['P1'] });
  await expect(page.locator('.hud-player[data-player="P2"]')).toBeHidden();
  await expect(page.locator('#start-match')).toBeEnabled();

  await page.locator('#start-match').click();
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => any } } }).__turenkiGame!;
    return game.scene.getScene('StationScene').state.phase;
  })).toBe('countdown');
  await page.reload();
  await expect(page.locator('#player-count')).toHaveValue('1');
});

test('all bots fills exactly the selected active slots and Wave rejects one slot', async ({ page }) => {
  await page.goto('/');
  await page.locator('#player-count').selectOption('4');
  await page.locator('#all-bots-match').click();
  await expect.poll(() => page.evaluate<LobbyState>(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => any } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    return {
      phase: scene.state.phase,
      ids: scene.state.fighters.map((fighter: { id: string }) => fighter.id),
      bots: [...scene.botSlots],
      playerCount: scene.selectedPlayerCount,
    };
  })).toEqual({ phase: 'countdown', ids: ['P1', 'P2', 'P3', 'P4'], bots: ['P1', 'P2', 'P3', 'P4'], playerCount: 4 });

  await page.reload();
  await page.locator('#player-count').selectOption('1');
  await page.locator('#game-mode').selectOption('wave');
  await expect(page.locator('#wave-lobby-help')).toContainText('at least 2 active slots');
  await expect(page.locator('#start-match')).toBeDisabled();
});
