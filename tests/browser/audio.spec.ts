import { expect, test } from '@playwright/test';

test('audio unlocks on gameplay key press, mute persists, and browser reports no audio errors', async ({ page }) => {
  const audioErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && /audio|audiocontext|resume|webaudio/i.test(message.text())) audioErrors.push(message.text());
  });
  page.on('pageerror', error => {
    if (/audio|audiocontext|resume|webaudio/i.test(error.message)) audioErrors.push(error.message);
  });
  await page.goto('/');
  await expect(page.locator('#audio-mute')).toBeVisible();
  await expect(page.locator('#audio-volume')).toBeVisible();
  expect(Number.parseFloat(await page.locator('#audio-mute').evaluate(element => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    const scene = game?.scene.getScene('StationScene') as { audioDiagnostics?: () => { state: string } } | undefined;
    return scene?.audioDiagnostics?.().state ?? 'not-ready';
  })).toBe('not-created');

  await page.keyboard.press('F');
  await expect.poll(() => page.evaluate(() => {
    const game = (window as typeof window & { __turenkiGame?: { scene: { getScene: (key: string) => unknown } } }).__turenkiGame;
    const scene = game?.scene.getScene('StationScene') as { audioDiagnostics?: () => { state: string } } | undefined;
    return scene?.audioDiagnostics?.().state ?? 'not-ready';
  })).toBe('running');

  await page.locator('#audio-mute').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('turenkifight.audio.v1') ?? '{}').muted)).toBe(true);
  expect(audioErrors).toEqual([]);
});

test('online scene uses the same gesture unlock and audio controls', async ({ page }) => {
  await page.goto('/online.html');
  await expect(page.locator('#audio-mute')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & { __turenkiOnline?: { audioDiagnostics?: () => { state: string } } }).__turenkiOnline;
    return api?.audioDiagnostics?.().state ?? 'not-ready';
  })).toBe('not-created');
  await page.keyboard.press('d');
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & { __turenkiOnline?: { audioDiagnostics?: () => { state: string } } }).__turenkiOnline;
    return api?.audioDiagnostics?.().state ?? 'not-ready';
  })).toBe('running');
  await page.locator('#audio-mute').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('turenkifight.audio.v1') ?? '{}').muted)).toBe(true);
});
