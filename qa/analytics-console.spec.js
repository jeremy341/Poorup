import { test, expect } from '@playwright/test';

test.describe('protected analytics console shell', () => {
  test('keeps operator tabs and filters inside the standalone view', async ({ page }) => {
    await page.goto('/admin/analytics');
    await expect(page).toHaveTitle('Poorup | Analytics');
    await expect(page.locator('[data-analytics-tab]')).toHaveCount(7);
    await expect(page.locator('[data-analytics-filter]')).toHaveCount(10);
    await expect(page.locator('[data-analytics-chart]')).toHaveCount(1);
    await expect(page.locator('#admin-analytics-status')).toContainText('ADMIN');
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      body: document.body.scrollWidth > document.body.clientWidth
    }));
    expect(overflow.document).toBe(false);
    expect(overflow.body).toBe(false);
  });

  test('uses roving tab focus and keyboard activation without page navigation', async ({ page }) => {
    await page.goto('/admin/analytics');
    const tabs = page.locator('[data-analytics-tab]');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tabs.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.location.pathname)).toBe('/admin/analytics');
  });
});

test.describe('analytics presentation modes', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('standard motion preference is observable without changing layout', async ({ page }) => {
    await page.goto('/admin/analytics');
    await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.body.clientWidth);
    expect(overflow).toBe(false);
  });

  test('200 percent zoom keeps the operator shell recoverable', async ({ page }) => {
    await page.goto('/admin/analytics');
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: Math.max(160, Math.floor((viewport?.width || 390) / 2)), height: Math.max(320, Math.floor((viewport?.height || 844) / 2)) });
    await expect(page.locator('#admin-analytics-main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.body.clientWidth);
    expect(overflow).toBe(false);
  });
});

test.describe('forced colors analytics shell', () => {
  test.use({ forcedColors: 'active' });

  test('keeps native tabs and filters visible in forced colors', async ({ page }) => {
    await page.goto('/admin/analytics');
    await expect.poll(() => page.evaluate(() => window.matchMedia('(forced-colors: active)').matches)).toBe(true);
    await expect(page.locator('[data-analytics-tab]').first()).toBeVisible();
    await expect(page.locator('[data-analytics-filter="range"]')).toBeVisible();
  });
});
