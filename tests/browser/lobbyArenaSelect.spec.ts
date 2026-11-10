import { test, expect } from '@playwright/test';

test('lobby arena selection updates the URL, backdrop and state across reload', async ({ page }) => {
  await page.goto('/');
  const arena = page.locator('#arena-select');
  await expect(arena).toBeVisible();
  await expect(arena).toHaveValue('station');

  const state = () => page.evaluate(() => {
    const game = (window as typeof window & {
      __turenkiGame?: { scene: { getScene: (key: string) => { state: { arena?: string }; textures: { exists: (key: string) => boolean } } } }
    }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    return {
      arena: scene.state.arena,
      stationBackdrop: scene.textures.exists('station-backdrop'),
      kkauppaBackdrop: scene.textures.exists('arena-kkauppa-backdrop'),
    };
  });

  await expect.poll(state).toEqual({ arena: undefined, stationBackdrop: true, kkauppaBackdrop: false });
  await arena.selectOption('kkauppa');
  await expect(page).toHaveURL(/(?:\?|&)arena=kkauppa(?:&|$)/);
  await expect(arena).toHaveValue('kkauppa');
  await expect.poll(state).toEqual({ arena: 'kkauppa', stationBackdrop: false, kkauppaBackdrop: true });

  await page.reload();
  await expect(page.locator('#arena-select')).toHaveValue('kkauppa');
  await expect.poll(state).toEqual({ arena: 'kkauppa', stationBackdrop: false, kkauppaBackdrop: true });
});
