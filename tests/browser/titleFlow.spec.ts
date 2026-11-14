import { expect, test } from '@playwright/test';
import { enterLocalGame } from './titleFlow';

async function expectTitleOnly(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('#onboarding')).toHaveAttribute('data-screen', 'title');
  await expect(page.locator('#title-start')).toBeVisible();
  await expect(page.locator('.onboarding-menu')).toBeHidden();
  await expect(page.locator('#game canvas')).toHaveCount(0);
  await expect(page.locator('#lobby-actions')).toBeHidden();
}

test('fresh load remains title-only until a route is selected', async ({ page }) => {
  await page.goto('/');
  await expectTitleOnly(page);

  await page.locator('#title-start').click();
  await expect(page.locator('#onboarding')).toHaveAttribute('data-screen', 'menu');
  await expect(page.locator('[data-route]')).toHaveCount(3);
  await expect(page.locator('[data-route="local"]')).toBeVisible();
  await expect(page.locator('[data-route="create"]')).toBeVisible();
  await expect(page.locator('[data-route="join"]')).toBeVisible();
  await expect(page.locator('#game canvas')).toHaveCount(0);
  await expect(page.locator('#lobby-actions')).toBeHidden();
});

for (const activation of ['keyboard', 'pointer'] as const) {
  test(`${activation} activation advances title exactly once without starting a match`, async ({ page }) => {
    await page.goto('/');
    await expectTitleOnly(page);

    if (activation === 'keyboard') {
      await page.locator('#title-start').focus();
      await page.keyboard.press('Enter');
    } else {
      await page.locator('#onboarding').click({ position: { x: 8, y: 8 } });
    }

    await expect(page.locator('#onboarding')).toHaveAttribute('data-screen', 'menu');
    await expect(page.locator('.onboarding-menu [data-route]')).toHaveCount(3);
    await expect(page.locator('#game canvas')).toHaveCount(0);
    await expect(page.locator('#lobby-actions')).toBeHidden();
  });
}

test('gamepad activation advances title once and waits for explicit route selection', async ({ page }) => {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { index: 0, id: 'QA virtual pad', connected: true, mapping: 'standard', axes: [], buttons, timestamp: 0 };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    (window as typeof window & { __qaTitlePad?: typeof pad }).__qaTitlePad = pad;
  });
  await page.goto('/');
  await expectTitleOnly(page);

  await page.evaluate(() => {
    const pad = (window as typeof window & { __qaTitlePad: { buttons: { pressed: boolean }[] } }).__qaTitlePad;
    pad.buttons[0].pressed = true;
  });
  await expect(page.locator('#onboarding')).toHaveAttribute('data-screen', 'menu');
  await page.evaluate(() => {
    const pad = (window as typeof window & { __qaTitlePad: { buttons: { pressed: boolean }[] } }).__qaTitlePad;
    pad.buttons[0].pressed = false;
  });
  await expect(page.locator('.onboarding-menu [data-route]')).toHaveCount(3);
  await expect(page.locator('#game canvas')).toHaveCount(0);
  await expect(page.locator('#lobby-actions')).toBeHidden();
});

for (const route of ['local', 'create', 'join'] as const) {
  test(`menu routes ${route} to its intended destination`, async ({ page }) => {
    await page.goto('/');
    await expectTitleOnly(page);
    await page.locator('#title-start').click();
    await expect(page.locator('#onboarding')).toHaveAttribute('data-screen', 'menu');
    await page.locator(`[data-route="${route}"]`).click();

    if (route === 'local') {
      await expect(page.locator('#game canvas')).toBeVisible();
      await expect(page.locator('#lobby-actions')).toBeVisible();
    } else {
      await expect(page).toHaveURL(new RegExp(`/online\\.html\\?action=${route}$`));
      await expect(page.locator('#room-action')).toHaveValue(route);
      await expect(page.locator('#online-connect-form')).toBeVisible();
    }
  });
}

test('shared helper retains the eager-canvas path when onboarding is absent', async ({ page }) => {
  await page.route('**/', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body><main><div id="game"><canvas></canvas></div></main></body></html>',
  }));
  await enterLocalGame(page, '/');
  await expect(page.locator('#game canvas')).toBeVisible();
});
