/* global document */
import { test, expect } from '@playwright/test';

const SESSION = { sessionToken: 'qa-admin-session', account: { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin' } };
const ISO = '2026-09-15T12:00:00.000Z';
const FIXTURE = { success: true, schemaVersion: 1, generatedAt: ISO, filters: { range: 'day', tab: 'overview', boardVariant: 'metro-52', rulesetPreset: 'after-hours', marketComplexity: 'all', botMode: 'ai', provider: 'openai' }, suppression: { minimumCohort: 5, suppressedPanels: 0 }, overview: { kpis: [] }, series: [{ label: '12:00', value: 42 }, { label: '13:00', value: 50 }], breakdowns: [], dataQuality: { fresh: true } };
const OPS_STATUS = { success: true, generatedAt: ISO, health: { state: 'healthy', checks: [], uptimeSeconds: 10, sockets: 1, rooms: 1, activeRounds: 0, backup: {}, errorCount: 0, restoreFailures: 0, latencyP95Ms: null }, maintenance: { mode: 'normal', message: '', releaseId: '', drainDeadline: null, activeRounds: 0 } };

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function openAnalytics(page) {
  await page.route('**/admin/analytics/balance**', route => json(route, FIXTURE));
  await page.route('**/admin/ops/status', route => json(route, OPS_STATUS));
  await page.goto('/admin/analytics');
  await expect(page.locator('#admin-analytics-main')).toBeVisible();
  await page.evaluate(async session => {
    const { state } = await import('/clientState.js');
    state.account = session;
  }, SESSION);
  await page.locator('[data-analytics-refresh]').click();
}

test.describe('admin analytics window', () => {
  test('the window control is the only filter on the page; no dialog, pager, reset, export or control-room header', async ({ page }) => {
    await openAnalytics(page);
    await expect(page.locator('[data-analytics-window]')).toBeVisible();
    await expect(page.locator('[data-analytics-range]')).toHaveCount(4);
    // The one select left is the provider editor's request format.
    await expect(page.locator('#view-admin-analytics select')).toHaveCount(1);
    for (const gone of ['[data-analytics-more-filters]', '[data-analytics-filter-dialog]', '[data-analytics-page-next]', '[data-analytics-reset]', '[data-analytics-export]', '#admin-analytics-export', '.admin-analytics-hero', '.analytics-filters']) await expect(page.locator(gone)).toHaveCount(0);
  });

  test('refresh sits in the slim toolbar next to one freshness chip', async ({ page }) => {
    await openAnalytics(page);
    await expect(page.locator('[data-analytics-refresh]').first()).toBeVisible();
    await expect(page.locator('.admin-toolbar')).toBeVisible();
    await expect(page.locator('#admin-analytics-status')).toHaveCount(1);
    await expect(page.locator('#admin-analytics-status')).toContainText('SYNCED');
  });

  test('the document never scrolls and the console fits the window', async ({ page }) => {
    await openAnalytics(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight || document.body.scrollHeight > document.body.clientHeight || document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test('choosing a window reloads the report for that window', async ({ page }) => {
    await openAnalytics(page);
    const request = page.waitForRequest(req => req.url().includes('/admin/analytics/balance') && req.url().includes('range=week'));
    await page.locator('[data-analytics-range="week"]').click();
    await request;
  });

  test('requests carry the server view id and none of the retired filters', async ({ page }) => {
    const urls = [];
    page.on('request', request => { if (request.url().includes('/admin/analytics/balance')) urls.push(new URL(request.url()).searchParams); });
    await openAnalytics(page);
    await page.locator('[data-analytics-tab="matches"]').click();
    await expect.poll(() => urls.some(params => params.get('tab') === 'match-health')).toBe(true);
    for (const params of urls) for (const dead of ['seasonId', 'eventId', 'rulesetRevision', 'balanceRevision', 'provider']) expect(params.has(dead)).toBe(false);
  });

  test('draws its charts without downloading any third-party chart engine', async ({ page }) => {
    const vendorRequests = [];
    page.on('request', request => {
      if (/\/vendor\/(uplot|echarts)/.test(request.url())) vendorRequests.push(request.url());
    });
    await openAnalytics(page);
    await expect(page.locator('.analytics-chart-engine .pc-svg').first()).toBeVisible();
    await expect(page.locator('.analytics-chart-table').first()).toBeAttached();
    expect(vendorRequests).toEqual([]);
  });
});
