import { test, expect } from '@playwright/test';

test('lobby summary reflects the selected setup and current roster', async ({ page }) => {
  await page.goto('/');
  const summary = page.locator('#lobby-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toHaveText('ARENA TURENKI RAILWAY STATION · MODE SCORE BRAWL · PLAYERS 8 · HUMANS 1 · BOTS 0');

  await page.locator('#player-count').selectOption('4');
  await expect(summary).toHaveText('ARENA TURENKI RAILWAY STATION · MODE SCORE BRAWL · PLAYERS 4 · HUMANS 1 · BOTS 0');

  await page.keyboard.down('Shift');
  await expect(summary).toHaveText('ARENA TURENKI RAILWAY STATION · MODE SCORE BRAWL · PLAYERS 4 · HUMANS 2 · BOTS 0');
  await page.keyboard.up('Shift');

  await page.locator('[data-player="P3"] .hud-slot-action').click();
  await expect(summary).toHaveText('ARENA TURENKI RAILWAY STATION · MODE SCORE BRAWL · PLAYERS 4 · HUMANS 2 · BOTS 1');

  await page.locator('#game-mode').selectOption('wave');
  await expect(summary).toHaveText('ARENA TURENKI RAILWAY STATION · MODE WAVE (ASEMAHALLI) · PLAYERS 4 · HUMANS 2 · BOTS 1');

  await page.locator('#arena-select').selectOption('mesku');
  await expect(summary).toHaveText('ARENA RAVINTOLA MESKU · MODE SCORE BRAWL · PLAYERS 4 · HUMANS 1 · BOTS 0');
});

test('summary is lobby-scoped and reset restores its actual roster counts', async ({ page }) => {
  await page.goto('/');
  await page.locator('#player-count').selectOption('4');
  await page.locator('#all-bots-match').click();
  await expect(page.locator('#lobby-summary')).toBeHidden();
  await expect(page.locator('#reset-match')).toBeEnabled();
  await page.locator('#reset-match').click();
  await expect(page.locator('#lobby-summary')).toBeVisible();
  await expect(page.locator('#lobby-summary')).toHaveText('ARENA TURENKI RAILWAY STATION · MODE SCORE BRAWL · PLAYERS 4 · HUMANS 1 · BOTS 0');
});
