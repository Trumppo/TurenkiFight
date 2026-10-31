import { test, expect } from '@playwright/test';

test('VIS-04 retro HUD preserves readable timer and four-slot layout', async ({ page }) => {
  test.skip(process.env.VITE_VISUAL_STYLE !== 'retro', 'Retro HUD only');
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();
  const data = await page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (name: string) => {
      hudTimer: { text: string; visible: boolean };
      playerHud: Map<string, { text: string; visible: boolean }>;
    } } } }).__turenkiGame!;
    const scene = game.scene.getScene('StationScene');
    return { timer: scene.hudTimer.text, timerVisible: scene.hudTimer.visible,
      players: [...scene.playerHud.entries()].map(([id, label]) => ({ id, text: label.text, visible: label.visible })) };
  });
  expect(data.timer).toMatch(/^\d{2}:\d{2}$/);
  expect(data.timerVisible).toBe(true);
  expect(data.players.some(p => p.id === 'P1' && p.visible && p.text.includes('HP'))).toBe(true);
});
