import { test, expect } from '@playwright/test';

test.describe('privacy page release contract', () => {
  test('keeps the Poorup shell and factual account controls visible', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveTitle(/Privacy & Account Data/);
    await expect(page.getByRole('heading', { name: 'Privacy & Account Data' })).toBeVisible();
    await expect(page.getByText('Your account controls')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Poorup Issues' })).toHaveAttribute('href', 'https://github.com/jeremy341/Poorup/issues');
    await expect(page.locator('body')).not.toContainText('Terms of Service');
    await expect(page.locator('body')).not.toContainText('Acceptable Use Policy');
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'visible');
  });

  test('fits the narrow landscape shell without horizontal page overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/privacy');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
