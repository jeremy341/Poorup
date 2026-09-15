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

const SPECIALIZED_MODELS = {
  'match-health': { starts: 12, completions: 9, stalls: 1, durationMedian: { value: 14.2, sampleSize: 9 }, durationP95: { value: 28.4, sampleSize: 9 }, reconnectRate: { value: 0.08, denominator: 12 }, afkRate: { value: 0.02, denominator: 12 }, bankruptcies: { value: 2, denominator: 12 }, comebacks: { value: 1, denominator: 12 } },
  rulesets: { rows: [{ rulesetPreset: 'classic', boardVariant: 'standard-40', matches: 18, completionRate: { value: 0.72, denominator: 18 } }, { rulesetPreset: 'after-hours', boardVariant: 'metro-52', matches: 11, completionRate: { value: 0.64, denominator: 11 } }] },
  economy: { adoption: { loans: { value: 0.42, denominator: 20 }, auctions: { value: 0.28, denominator: 20 } }, volatility: { value: 0.17, sampleSize: 20 }, liquidationRate: { value: 0.06, denominator: 20 }, negativeCashPrevention: { value: 3, denominator: 20 } },
  events: { rows: [{ eventId: 'market-rush', eligibility: { value: 22, denominator: 22 }, turnout: { value: 0.41, denominator: 22 }, recoveryRate: { value: 0.76, denominator: 9 } }], unlockRarity: { rare: { value: 0.08, denominator: 50 } }, rewardClaims: { value: 14, denominator: 50 } },
  bots: { rows: [{ botMode: 'ai', provider: 'openai', matches: 16, completed: 12, wins: 4, completionRate: { value: 0.75, denominator: 16 }, fallbackRate: { value: 0.04, denominator: 100 } }], competitiveMetricsExcludeBotOnly: true },
  quality: { fresh: true, stale: false, lagSeconds: 4, queueDepth: 2, pendingWrites: 2, rejectedEvents: 1, suppressionCount: 0, schemaVersion: 1, revisionCoverage: ['2:3'] }
};

async function openFixture(page, response = FIXTURE, status = 200) {
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: 'poorup.account.session.v1', session: SESSION });
  await page.route('**/admin/analytics/balance**', route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(response) }));
  const tab = response?.filters?.tab && response.filters.tab !== 'overview' ? `?tab=${encodeURIComponent(response.filters.tab)}` : '';
  await page.goto(`/admin/analytics${tab}`);
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

  test('renders supplied sanitized fields through each specialized chart and table mount', async ({ page }) => {
    for (const tab of ['match-health', 'rulesets', 'economy', 'events', 'bots', 'quality']) {
      const response = { ...FIXTURE, filters: { ...FIXTURE.filters, tab }, overview: { kpis: [] }, series: [], breakdowns: [SPECIALIZED_MODELS[tab]] };
      await openFixture(page, response);
      const panel = page.locator(`#analytics-panel-${tab}`);
      await expect(panel).toBeVisible();
      await expect(panel.locator('[data-analytics-chart]')).toHaveCount(1);
      await expect(panel.locator('.analytics-chart-table')).toHaveCount(1);
      await expect(panel.locator('.analytics-chart-table')).toContainText({
        'match-health': 'Starts',
        rulesets: 'classic / standard-40',
        economy: 'loans',
        events: 'market-rush',
        bots: 'openai',
        quality: 'Lag seconds'
      }[tab]);
      await expect(panel).not.toContainText('WAITING FOR');
    }
  });

  test('keeps specialized slots honest when their sanitized fields are absent', async ({ page }) => {
    for (const tab of ['match-health', 'rulesets', 'economy', 'events', 'bots', 'quality']) {
      const response = { ...FIXTURE, filters: { ...FIXTURE.filters, tab }, overview: { kpis: [] }, series: [], breakdowns: [], dataQuality: tab === 'quality' ? {} : FIXTURE.dataQuality };
      await openFixture(page, response);
      const panel = page.locator(`#analytics-panel-${tab}`);
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('NO VERIFIED OBSERVATIONS FOR THIS PANEL');
      await expect(panel).not.toContainText('WAITING FOR');
    }
  });

  test('renders KPI units, numerator and denominator, comparison detail, definition, and timestamp', async ({ page }) => {
    await openFixture(page);
    const completion = page.locator('.analytics-metric').filter({ hasText: 'COMPLETION RATE' });
    await expect(completion).toContainText('87.4%');
    await expect(completion).toContainText('NUMERATOR 720 / DENOMINATOR 824');
    await expect(completion).toContainText('BASELINE');
    await expect(completion).toContainText('DELTA');
    await expect(completion).toContainText('PREVIOUS-DAY');
    await expect(completion).toContainText(/completed divided by started\./i);
    await expect(completion).toContainText('VERIFIED 2026-09-15T12:00:00.000Z');
    const latency = page.locator('.analytics-metric').filter({ hasText: 'P95 ACTION LATENCY' });
    await expect(latency).toContainText('1.8');
    await expect(latency).toContainText('seconds');
  });

  test('keeps chart axis and unit labels readable at the rendered viewport size', async ({ page }) => {
    await openFixture(page);
    const labels = await page.locator('.analytics-chart svg text').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? { text: element.textContent, width: rect.width, height: rect.height } : null;
    }).filter(Boolean));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every(label => label.height >= 6 && label.height <= 32 && label.width < 240)).toBe(true);
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
      const tab = await tabs.nth(index).getAttribute('data-analytics-tab');
      if (tab !== 'overview') await openFixture(page, { ...FIXTURE, filters: { ...FIXTURE.filters, tab }, series: [], breakdowns: [SPECIALIZED_MODELS[tab]] });
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
