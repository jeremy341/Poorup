import { test, expect } from '@playwright/test';

const SESSION = { sessionToken: 'qa-admin-session', account: { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin' } };
const FIXTURE = { success: true, schemaVersion: 1, generatedAt: '2026-09-15T12:00:00.000Z', filters: { range: 'day', tab: 'overview', boardVariant: 'metro-52', rulesetPreset: 'after-hours', marketComplexity: 'all', botMode: 'ai', provider: 'openai' }, suppression: { minimumCohort: 5, suppressedPanels: 0 }, overview: { kpis: [] }, series: [{ label: '12:00', value: 42 }], breakdowns: [], dataQuality: { fresh: true } };

async function openAnalytics(page) {
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: 'poorup.account.session.v1', session: SESSION });
  await page.route('**/admin/analytics/balance**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) }));
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
    await expect(page.locator('[data-analytics-report-book]')).toHaveAttribute('inert', '');
    for (const name of ['boardVariant', 'rulesetPreset', 'marketComplexity', 'botMode', 'provider', 'eventId', 'seasonId', 'rulesetRevision', 'balanceRevision']) {
      await expect(page.locator(`[data-analytics-filter="${name}"]`)).toHaveCount(1);
    }
    await page.locator('[data-analytics-filter-cancel]').click();
    await expect(page.locator('[data-analytics-report-book]')).not.toHaveAttribute('inert', '');
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

  test('summarizes applied dimensions as compact chips', async ({ page }) => {
    await openAnalytics(page);
    await page.locator('[data-analytics-more-filters]').click();
    await page.locator('[data-analytics-filter="boardVariant"]').selectOption('metro-52');
    await page.locator('[data-analytics-filter="botMode"]').selectOption('ai');
    await page.locator('[data-analytics-apply]').click();
    await expect(page.locator('[data-analytics-active-filters]')).toContainText('BOARD');
    await expect(page.locator('[data-analytics-active-filters]')).toContainText('metro-52');
    await expect(page.locator('[data-analytics-active-filters]')).toContainText('BOT MODE');
  });

  test('keeps the verified table when the local chart engine fails to load', async ({ page }) => {
    await page.route('**/vendor/echarts.min.js', route => route.abort());
    await openAnalytics(page);
    await expect(page.locator('.analytics-chart-engine-status').first()).toContainText('CHART ENGINE UNAVAILABLE');
    await expect(page.locator('.analytics-chart-table').first()).toBeVisible();
  });
});
