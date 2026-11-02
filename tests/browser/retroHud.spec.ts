import { test, expect } from '@playwright/test';

test('VIS-04 retro HUD preserves readable timer and eight-slot layout', async ({ page }) => {
  test.skip(process.env.VITE_VISUAL_STYLE !== 'retro', 'Retro HUD only');
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await expect(page.locator('#game canvas')).toBeVisible();

  const hud = page.locator('#fight-hud');
  const timer = page.locator('#match-timer');
  await expect(hud).toBeVisible();
  await expect(timer).toBeVisible();
  await expect(timer).toHaveText(/^\d{2}:\d{2}$/);

  const data = await page.evaluate(() => {
    const timerElement = document.getElementById('match-timer')!;
    const hudRect = document.getElementById('fight-hud')!.getBoundingClientRect();
    const canvasRect = document.querySelector('#game canvas')!.getBoundingClientRect();
    return {
      timerFontSize: Number.parseFloat(getComputedStyle(timerElement).fontSize),
      timerText: timerElement.textContent,
      hudBottom: hudRect.bottom,
      scoreboardBottom: canvasRect.top + canvasRect.height * 35 / 216,
      players: Array.from(document.querySelectorAll<HTMLElement>('#player-hud .hud-player')).map(card => ({
        id: card.dataset.player,
        name: card.querySelector('.hud-name')?.textContent,
        score: card.querySelector('.hud-score')?.textContent,
        health: card.querySelector('.hud-health')?.textContent,
        ariaLabel: card.getAttribute('aria-label'),
        visible: card.getBoundingClientRect().width > 0 && card.getBoundingClientRect().height > 0,
      })),
    };
  });

  expect(data.timerText).toMatch(/^\d{2}:\d{2}$/);
  expect(data.timerFontSize).toBeGreaterThanOrEqual(14);
  expect(data.players).toHaveLength(8);
  expect(data.players.map(player => player.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  expect(data.players.every(player => player.visible && player.name && player.score !== null && player.health !== null)).toBe(true);
  expect(data.players[0]).toMatchObject({ name: 'P1 HOST', score: '0', health: 'H100', ariaLabel: 'P1, score 0, health 100' });
  expect(data.players.slice(4).every(player => player.name?.includes('PAD/BOT'))).toBe(true);
  expect(data.hudBottom).toBeLessThanOrEqual(data.scoreboardBottom + 1);
});
