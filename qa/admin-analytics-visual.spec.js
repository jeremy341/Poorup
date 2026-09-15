/* global document, localStorage, URL, window */
import { test, expect } from '@playwright/test';
import path from 'node:path';

const SESSION = {
  sessionToken: 'qa-admin-session',
  account: { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin' }
};

const FIXTURE = {
  success: true,
  schemaVersion: 1,
  generatedAt: '2026-09-15T12:00:00.000Z',
  filters: { range: 'day', tab: 'overview', boardVariant: 'all', rulesetPreset: 'all', marketComplexity: 'all', botMode: 'all', provider: 'all' },
  suppression: { minimumCohort: 5, suppressedPanels: 0 },
  overview: { kpis: [
    { id: 'online-now', label: 'Online now', value: 42, unit: 'players', definition: 'Active human seats.', generatedAt: '2026-09-15T12:00:00.000Z' },
    { id: 'peak-24h', label: '24h peak', value: 183, unit: 'players', definition: 'Maximum human-player minute bucket.', generatedAt: '2026-09-15T12:00:00.000Z' },
    { id: 'started', label: 'Games started', value: 824, unit: 'matches', denominator: 824, definition: 'Verified server starts.', generatedAt: '2026-09-15T12:00:00.000Z' },
    { id: 'completion-rate', label: 'Completion rate', value: 0.874, unit: 'percent', numerator: 720, denominator: 824, comparison: { period: 'previous-day', delta: 0.013 }, definition: 'Completed divided by started.', generatedAt: '2026-09-15T12:00:00.000Z' },
    { id: 'p95-action-latency', label: 'P95 action latency', value: 1.8, unit: 'seconds', definition: 'Successful action latency.', generatedAt: '2026-09-15T12:00:00.000Z' },
    { id: 'error-rate', label: 'Error rate', value: 0.004, unit: 'percent', denominator: 10000, definition: 'Failed requests in the selected window.', generatedAt: '2026-09-15T12:00:00.000Z' }
  ] },
  series: [{ label: '12:00', value: 42 }, { label: '13:00', value: 58 }],
  breakdowns: [],
  dataQuality: { fresh: true, lagSeconds: 4 }
};

async function openFixture(page, response = FIXTURE, status = 200) {
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: 'poorup.account.session.v1', session: SESSION });
  await page.route('**/admin/analytics/balance**', route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) }));
  await page.goto('/admin/analytics');
  await expect(page.locator('#admin-analytics-main')).toBeVisible();
}

test.describe('admin analytics visual contract', () => {
  test('blocks analytics requests without a session and clears unauthorized data', async ({ page }) => {
    const requests = [];
    await page.addInitScript(() => localStorage.removeItem('poorup.account.session.v1'));
    page.on('request', request => { if (request.url().includes('/admin/analytics/balance')) requests.push(request.url()); });
    await page.goto('/admin/analytics');
    await expect(page.locator('#admin-analytics-main')).toBeVisible();
    await expect(page.locator('#admin-analytics-status')).toContainText('ADMIN ACCOUNT REQUIRED');
    expect(requests).toHaveLength(0);

    await openFixture(page, { success: false, status: 403 }, 403);
    await expect(page.locator('#admin-analytics-status')).toContainText('ADMIN ACCESS REQUIRED');
    await expect(page.locator('#admin-analytics-grid')).toBeEmpty();
  });

  test('keeps seven question-led panels, stable slots, and capped first-viewport KPIs', async ({ page }) => {
    await openFixture(page);
    await expect(page.locator('[data-analytics-tab]')).toHaveCount(7);
    await expect(page.locator('[data-analytics-panel]')).toHaveCount(7);
    await expect(page.locator('[data-analytics-chart-slot]')).toHaveCount(7);
    await expect(page.locator('[data-analytics-question]')).toHaveCount(14);
    await expect(page.locator('#admin-analytics-grid .analytics-metric')).toHaveCount(6);
    await expect(page.locator('[data-analytics-context]')).toHaveCount(4);
    expect(await page.locator('[data-analytics-context]').evaluateAll(elements => elements.every(element => element.hidden))).toBe(true);
  });

  test('keeps every native filter labeled, keyboard reachable, and URL-safe', async ({ page }) => {
    await openFixture(page);
    const filters = page.locator('[data-analytics-filter]');
    await expect(filters).toHaveCount(10);
    for (let index = 0; index < 10; index += 1) {
      await expect(filters.nth(index)).toHaveAttribute('id', /analytics-filter-/);
      await expect(filters.nth(index)).toHaveAttribute('name');
    }
    await filters.nth(7).fill('season 7');
    await page.locator('[data-analytics-apply]').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('seasonId')).toBe('season 7');
    expect(page.url()).not.toMatch(/account|session|roomCode/i);
  });

  test('restores a tab and filters from a copied URL without page overflow', async ({ page }) => {
    await page.goto('/admin/analytics?tab=economy&range=week&provider=ai');
    await expect(page.locator('[data-analytics-tab="economy"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-analytics-filter="range"]')).toHaveValue('week');
    await expect(page.locator('[data-analytics-filter="provider"]')).toHaveValue('ai');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.body.clientWidth);
    expect(overflow).toBe(false);
  });

  test('keeps identity and raw network fields outside the admin surface', async ({ page }) => {
    const responseBodies = [];
    page.on('response', async response => {
      if (!response.url().includes('/admin/analytics/')) return;
      responseBodies.push(await response.text());
    });
    await openFixture(page);
    const forbidden = /displayName|username|accountId|roomCode|chat|hiddenCards|privateLoanTerms|sessionToken|rawPayload|rawEvent|ipAddress|rawIp|userAgent|rawUserAgent/i;
    await expect(page.locator('#view-admin-analytics')).not.toContainText(forbidden);
    expect(page.url()).not.toMatch(forbidden);
    await expect.poll(() => responseBodies.length).toBeGreaterThan(0);
    expect(responseBodies.every(body => !forbidden.test(body))).toBe(true);
  });

  test('covers stale, empty, suppressed, rate-limited, and unavailable states', async ({ page }) => {
    await openFixture(page, { ...FIXTURE, dataQuality: { fresh: false, stale: true } });
    await expect(page.locator('#admin-analytics-status')).toContainText('STALE');
    await openFixture(page, { ...FIXTURE, overview: { kpis: [] }, series: [], breakdowns: [], metrics: {} });
    await expect(page.locator('#admin-analytics-grid')).toContainText('NO VERIFIED OBSERVATIONS');
    await openFixture(page, { ...FIXTURE, suppression: { minimumCohort: 5, suppressedPanels: 1 } });
    await expect(page.locator('#admin-analytics-status')).toContainText('MIN COHORT 5');
    await openFixture(page, { success: false, status: 429 }, 429);
    await expect(page.locator('#admin-analytics-status')).toContainText('RATE LIMITED');
    await openFixture(page, { success: false, status: 503 }, 503);
    await expect(page.locator('#admin-analytics-status')).toContainText('ROLLUP UNAVAILABLE');
  });

  test('keeps keyboard focus visible and panel switching predictable', async ({ page }) => {
    await openFixture(page);
    const tabs = page.locator('[data-analytics-tab]');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tabs.last()).toBeFocused();
    await expect(page.locator(':focus-visible')).toBeVisible();
  });

  test('keeps 200 percent zoom and mobile stacking free of page overflow', async ({ page }) => {
    await openFixture(page);
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: Math.max(160, Math.floor((viewport?.width || 390) / 2)), height: Math.max(320, Math.floor((viewport?.height || 844) / 2)) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.body.clientWidth);
    expect(overflow).toBe(false);
  });
});

test.describe('admin analytics visual evidence at native desktop', () => {
  test('captures every tab and major data state for native inspection', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920', 'Evidence is captured only at the required 1920x1080 viewport.');
    await openFixture(page);
    const artifactRoot = path.resolve('qa-artifacts/admin-analytics-1920');
    await page.screenshot({ path: path.join(artifactRoot, 'overview-verified.png') });
    const tabs = page.locator('[data-analytics-tab]');
    for (let index = 0; index < 7; index += 1) {
      await tabs.nth(index).click();
      const tab = await tabs.nth(index).getAttribute('data-analytics-tab');
      await page.screenshot({ path: path.join(artifactRoot, `${tab}-verified.png`) });
    }
    await openFixture(page, { ...FIXTURE, dataQuality: { fresh: false, stale: true } });
    await page.screenshot({ path: path.join(artifactRoot, 'state-stale.png') });
    await openFixture(page, { ...FIXTURE, overview: { kpis: [] }, series: [], breakdowns: [], metrics: {} });
    await page.screenshot({ path: path.join(artifactRoot, 'state-empty.png') });
    await openFixture(page, { ...FIXTURE, suppression: { minimumCohort: 5, suppressedPanels: 1 } });
    await page.screenshot({ path: path.join(artifactRoot, 'state-suppressed.png') });
    testInfo.annotations.push({ type: 'screenshots', description: artifactRoot });
  });
});

test.describe('admin analytics forced colors and reduced motion', () => {
  test.use({ forcedColors: 'active', reducedMotion: 'reduce' });

  test('shows semantic controls and table fallback under forced colors', async ({ page }) => {
    await openFixture(page);
    await expect.poll(() => page.evaluate(() => window.matchMedia('(forced-colors: active)').matches)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expect(page.locator('[data-analytics-tab]').first()).toBeVisible();
    await expect(page.locator('[data-analytics-filter="range"]')).toBeVisible();
    await expect(page.locator('.analytics-chart-table').first()).toBeVisible();
  });
});
