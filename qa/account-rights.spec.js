import { test, expect } from '@playwright/test';

test.describe('account rights surface', () => {
  test('keeps deletion controls inside Profile and out of Home', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-account-delete]')).toHaveCount(0);
    await page.getByRole('button', { name: 'PROFILE', exact: true }).first().click();
    await page.locator('[data-profile-tab="account"]').click();
    await expect(page.locator('#account-rights-content')).toHaveCount(1);
    await expect(page.locator('[data-account-delete]')).toHaveCount(0);
  });
});
