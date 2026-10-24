import { test, expect } from '@playwright/test';

test('station prototype loads without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'TurenkiFight' })).toBeVisible();
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.getByText('Turengin rautatieasema', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});
