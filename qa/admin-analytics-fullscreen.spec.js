import { test, expect } from '@playwright/test';

async function openAnalytics(page) {
  await page.goto('/admin/analytics');
  await expect(page.locator('#admin-analytics-main')).toBeVisible();
}

test.describe('admin analytics full-screen report frame', () => {
  test('fills the viewport without document scrolling', async ({ page }) => {
    await openAnalytics(page);
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      body: document.body.scrollHeight > document.body.clientHeight,
      width: document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.body.clientWidth
    }));
    expect(overflow.document || overflow.body || overflow.width).toBe(false);
    await expect(page.locator('[data-analytics-page-prev]')).toBeVisible();
    await expect(page.locator('[data-analytics-page-next]')).toBeVisible();
    await expect(page.locator('[data-analytics-page-position]')).toBeVisible();
  });

  test('keeps only the window filter visible and discloses advanced filters on demand', async ({ page }) => {
    await openAnalytics(page);
    await expect(page.locator('[data-analytics-filter="range"]')).toBeVisible();
    await expect(page.locator('[data-analytics-filter="boardVariant"]')).toBeHidden();
    await expect(page.locator('[data-analytics-more-filters]')).toBeVisible();
    await page.locator('[data-analytics-more-filters]').click();
    await expect(page.locator('[data-analytics-filter-dialog]')).toBeVisible();
    for (const name of ['boardVariant', 'rulesetPreset', 'marketComplexity', 'botMode', 'provider', 'eventId', 'seasonId', 'rulesetRevision', 'balanceRevision']) {
      await expect(page.locator(`[data-analytics-filter="${name}"]`)).toHaveCount(1);
    }
  });

  test('page arrows move the report without changing the global route', async ({ page }) => {
    await openAnalytics(page);
    const position = page.locator('[data-analytics-page-position]');
    await expect(position).toHaveText(/1\s*\/\s*7/);
    await page.locator('[data-analytics-page-next]').click();
    await expect(position).toHaveText(/2\s*\/\s*7/);
    await expect(page).toHaveURL(/\/admin\/analytics/);
    await page.keyboard.press('End');
    await expect(position).toHaveText(/7\s*\/\s*7/);
  });
});
