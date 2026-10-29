/* global document, getComputedStyle, localStorage, process, URL, window */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

const SESSION = {
  sessionToken: 'qa-admin-session',
  account: { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin' }
};

const ISO = '2026-09-15T12:00:00.000Z';
const FIXTURE = {
  success: true,
  schemaVersion: 1,
  generatedAt: ISO,
  filters: { range: 'day', tab: 'overview', boardVariant: 'all', rulesetPreset: 'all', marketComplexity: 'all', botMode: 'all' },
  suppression: { minimumCohort: 5, suppressedPanels: 0 },
  overview: { kpis: [
    { id: 'online-now', label: 'Online now', value: 42, unit: 'players', definition: 'Active human seats.', generatedAt: ISO },
    { id: 'error-rate', label: 'Error rate', value: 0.004, unit: 'percent', numerator: 40, denominator: 10000, definition: 'Failed requests in the selected window.', generatedAt: ISO },
    { id: 'p95-action-latency', label: 'P95 action latency', value: 1.8, unit: 'seconds', definition: 'Successful action latency.', generatedAt: ISO },
    { id: 'completion-rate', label: 'Completion rate', value: 0.874, unit: 'percent', numerator: 720, denominator: 824, comparison: { period: 'previous-day', delta: 0.013 }, definition: 'Completed divided by started.', generatedAt: ISO },
    { id: 'started', label: 'Games started', value: 824, unit: 'matches', denominator: 824, definition: 'Verified server starts.', generatedAt: ISO },
    { id: 'peak-24h', label: '24h peak', value: 183, unit: 'players', definition: 'Maximum human-player minute bucket.', generatedAt: ISO }
  ] },
  series: [{ label: '12:00', value: 42 }, { label: '13:00', value: 58 }, { label: '14:00', value: 51 }],
  breakdowns: [],
  dataQuality: { fresh: true, lagSeconds: 4 }
};

const SPECIALIZED_MODELS = {
  matches: { starts: 12, completions: 9, stalls: 1, durationMedian: { value: 14.2, sampleSize: 9 }, durationP95: { value: 28.4, sampleSize: 9 }, reconnectRate: { value: 0.08, numerator: 1, sampleSize: 12, denominator: 12 }, afkRate: { value: 0.02, denominator: 12 }, bankruptcies: { value: 2, denominator: 12 }, comebacks: { value: 1, denominator: 12 } },
  economy: { adoption: { loans: { value: 0.42, denominator: 20 }, auctions: { value: 0.28, denominator: 20 } }, volatility: { value: 0.17, sampleSize: 20 }, liquidationRate: { value: 0.06, denominator: 20 }, shortDefaultRate: { value: 0.02, denominator: 10 }, optionExerciseRate: { value: 0, denominator: 8 }, negativeCashPrevention: { value: 3, denominator: 20 } },
};

const OPS_STATUS = (state = 'healthy') => ({ success: true, generatedAt: ISO, health: { state, checks: state === 'healthy' ? [{ id: 'backup', label: 'Backup', state: 'ok', detail: 'Last run 11:40 UTC' }] : [{ id: 'backup', label: 'Backup', state: 'ok', detail: 'fine' }, { id: 'errors', label: 'Errors', state: 'warn', detail: '14 in the last hour' }], uptimeSeconds: 7200, sockets: 12, rooms: 4, activeRounds: 2, backup: { configured: true, fresh: true, lastRunAt: ISO, failures: 0 }, errorCount: 0, restoreFailures: 0, latencyP95Ms: 410 }, maintenance: { mode: 'normal', message: '', releaseId: '', drainDeadline: null, activeRounds: 2 } });
const OPS_ROOMS = { success: true, generatedAt: ISO, totals: { rooms: 2, lobby: 1, playing: 1, humans: 3, bots: 1 }, rooms: [
  { id: 'r-0a1b2c', phase: 'playing', visibility: 'public', humans: 2, bots: 1, round: 5, ageSeconds: 600, idleSeconds: 4, stalled: false },
  { id: 'r-3d4e5f', phase: 'lobby', visibility: 'private', humans: 1, bots: 0, round: null, ageSeconds: 60, idleSeconds: 60, stalled: false }] };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// The balance rollup answers with the fixture; every other admin endpoint is mocked so these specs never depend on the server's own data.
async function mockAdmin(page, response = FIXTURE, status = 200, health = 'healthy') {
  await page.route('**/admin/analytics/balance**', route => json(route, response, status));
  await page.route('**/admin/ops/status', route => json(route, OPS_STATUS(health)));
  await page.route('**/admin/ops/rooms', route => json(route, OPS_ROOMS));
  await page.route('**/admin/ops/bots**', route => json(route, { success: true, range: 'day', generatedAt: ISO, totals: { botMatches: 0, decisions: null, fallbacks: null, fallbackRate: null, sampleSize: 0 }, providers: [], provider: { state: 'healthy', activeLabel: null, capPerBot: null } }));
  await page.route('**/admin/ops/audit', route => json(route, { success: true, entries: [] }));
  await page.route('**/admin/ai/providers**', route => json(route, { success: true, active: null, providers: [] }));
}

async function openFixture(page, response = FIXTURE, status = 200, tab = 'status', health = 'healthy') {
  await page.unroute('**/admin/analytics/balance**').catch(() => {});
  await page.unroute('**/admin/ops/status').catch(() => {});
  await mockAdmin(page, response, status, health);
  await page.goto(`/admin/analytics?tab=${tab}`);
  await expect(page.locator('#admin-analytics-main')).toBeVisible();
  await page.evaluate(async session => {
    const { state } = await import('/clientState.js');
    state.account = session;
  }, SESSION);
  await page.locator('[data-analytics-refresh]').click();
}

const pageOverflow = page => page.evaluate(() => ({
  vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight || document.body.scrollHeight > document.body.clientHeight,
  horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.body.clientWidth,
}));

test.describe('admin analytics visual contract', () => {
  test('keeps analytics unavailable without a cookie session and clears unauthorized data', async ({ page }) => {
    const responses = [];
    await page.addInitScript(() => localStorage.removeItem('poorup.account.session.v1'));
    page.on('response', response => { if (response.url().includes('/admin/analytics/balance')) responses.push(response.status()); });
    await page.goto('/admin/analytics');
    await expect(page.locator('#admin-analytics-main')).toBeVisible();
    await expect.poll(() => responses.length).toBeGreaterThan(0);
    expect([401, 403]).toContain(responses[0]);
    await expect(page.locator('#admin-analytics-status')).toContainText(/ADMIN (ACCOUNT|ACCESS) REQUIRED/);
    await expect(page.locator('#admin-analytics-grid')).toBeEmpty();
    await expect(page.locator('[data-section="report-status"]')).toHaveAttribute('data-section-kind', 'unauthorized');

    await openFixture(page, { success: false, status: 403 }, 403);
    await expect(page.locator('#admin-analytics-status')).toContainText('ADMIN ACCESS REQUIRED');
    await expect(page.locator('#admin-analytics-grid')).toBeEmpty();
    await expect(page.locator('[data-section="report-status"] [data-section-state]')).toContainText('ADMIN ACCESS REQUIRED');
    // One message, not three: the tile row and the health line stay quiet.
    await expect(page.locator('[data-section="kpis"]')).toBeHidden();
  });

  test('is a tab row of four surfaces, a strip of three views, six compact tiles, and one chart', async ({ page }) => {
    await openFixture(page);
    await expect(page.locator('[data-admin-section]')).toHaveText(['Analytics', 'Rooms', 'Bots & AI', 'Release']);
    await expect(page.locator('[data-analytics-tab]')).toHaveText(['Overview', 'Match health', 'Economy']);
    await expect(page.locator('h1:visible')).toHaveCount(1);
    await expect(page.locator('h1:visible')).toHaveText('ANALYTICS');
    await expect(page.locator('#admin-analytics-grid .analytics-metric')).toHaveCount(6);
    await expect(page.locator('#admin-analytics-grid .analytics-metric').first()).toContainText('Online now');
    await expect(page.locator('#admin-analytics-grid .analytics-metric').last()).toContainText('24h peak');
    await expect(page.locator('#analytics-panel-status .analytics-chart-engine svg.pc-svg')).toHaveCount(1);
    expect(await pageOverflow(page)).toEqual({ vertical: false, horizontal: false });
    // Gone: CSV, filters, reset, pager, season, left rail, drawer, the visible data table and its button.
    for (const gone of ['[data-analytics-export]', '[data-analytics-reset]', '[data-analytics-more-filters]', '[data-analytics-page-next]', '.analytics-chart-table-toggle', '[data-analytics-quality-strip]', '[data-admin-rail]', '[data-admin-provider-drawer]', '.admin-drawer']) await expect(page.locator(gone)).toHaveCount(0);
    await expect(page.getByText('Season', { exact: false })).toHaveCount(0);
    await expect(page.getByText('EXPORT', { exact: false })).toHaveCount(0);
  });

  test('has no visible data table anywhere, but keeps an accessible one for screen readers', async ({ page }) => {
    await openFixture(page);
    const table = page.locator('#analytics-panel-status .analytics-chart-table');
    await expect(table).toHaveCount(1);
    await expect(table).toBeAttached();
    // Visually hidden (sr-only): one pixel, clipped, and not a keyboard stop.
    const box = await table.locator('xpath=..').evaluate(element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return { width: rect.width, height: rect.height, position: style.position, tabindex: element.getAttribute('tabindex'), role: element.getAttribute('role') }; });
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
    expect(box.position).toBe('absolute');
    expect(box.tabindex).toBeNull();
    expect(box.role).toBeNull();
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table.locator('caption')).toHaveText('Verified activity data table');
    await expect(table.locator('thead th')).toHaveText(['Label', 'Value (observations)']);
    // Screen-reader view of the chart: named, described by its summary.
    const engine = page.locator('#analytics-panel-status .analytics-chart-engine');
    await expect(engine).toHaveAttribute('aria-label', /Verified activity/);
    const describedBy = await engine.getAttribute('aria-describedby');
    await expect(page.locator(`#${describedBy}`)).toContainText('POINTS 3');
    // The chart views retain their accessible source tables. Economy uses visible semantic rows.
    for (const tab of ['status', 'matches', 'economy']) {
      await openFixture(page, { ...FIXTURE, breakdowns: [{ ...SPECIALIZED_MODELS.matches, ...SPECIALIZED_MODELS.economy }] }, 200, tab);
      const panel = page.locator(`#analytics-panel-${tab}`);
      if (tab === 'economy') {
        await expect(panel.locator('.economy-adoption-row[role="listitem"]')).toHaveCount(2);
        await expect(panel.getByRole('progressbar', { name: 'Player loans adoption' })).toHaveAttribute('aria-valuenow', '42');
        await expect(panel.getByRole('progressbar', { name: 'Auctions adoption' })).toHaveAttribute('aria-valuenow', '28');
      } else {
        await expect(panel.locator('.analytics-chart-table')).toBeAttached();
        await expect(page.locator('.analytics-chart-data:not(.sr-only)')).toHaveCount(0);
        await expect(panel.locator('.analytics-chart-data.sr-only')).toHaveCount(1);
      }
    }
  });

  test('the chart uses the full width and the height that is left, below the strip, with the tiles above', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1280, 'the fill-the-window layout is checked at desktop widths');
    await openFixture(page);
    const viewport = page.viewportSize();
    const engine = page.locator('#analytics-panel-status .analytics-chart-engine');
    const tiles = page.locator('#admin-analytics-grid');
    const strip = page.locator('.admin-views');
    const [engineBox, tilesBox, stripBox, workspace] = await Promise.all([engine.boundingBox(), tiles.boundingBox(), strip.boundingBox(), page.locator('.admin-workspace').boundingBox()]);
    expect(tilesBox.y + tilesBox.height).toBeLessThanOrEqual(stripBox.y + 1);
    expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(engineBox.y + 1);
    expect(engineBox.width).toBeGreaterThan(workspace.width * 0.9);
    expect(engineBox.y + engineBox.height).toBeGreaterThan(viewport.height * 0.8);
    expect(engineBox.height).toBeGreaterThan(viewport.height * 0.35);
    // The six tiles share one compact row.
    const tileBoxes = await page.locator('#admin-analytics-grid .analytics-metric').evaluateAll(items => items.map(item => { const rect = item.getBoundingClientRect(); return { y: Math.round(rect.y), height: Math.round(rect.height) }; }));
    expect(new Set(tileBoxes.map(box => box.y)).size).toBe(1);
    expect(tileBoxes[0].height).toBeLessThan(110);
  });

  test('at 1920x1080 nothing needs scrolling on Analytics and the document stays fixed', async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 1920 || page.viewportSize()?.height !== 1080);
    await openFixture(page);
    const surface = page.locator('#admin-section-analytics');
    const size = await surface.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(size.scrollHeight).toBeLessThanOrEqual(size.clientHeight + 1);
    expect(await pageOverflow(page)).toEqual({ vertical: false, horizontal: false });
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#view-admin-analytics')).overflowY)).toBe('hidden');
  });

  test('the health line is the verdict pill, plus only the checks that need attention', async ({ page }) => {
    await openFixture(page, FIXTURE, 200, 'status', 'healthy');
    const line = page.locator('.admin-health-line');
    await expect(line.locator('[data-health-badge]')).toHaveText('HEALTHY');
    await expect(line.locator('.admin-issue')).toHaveCount(0);
    await expect(page.locator('[data-section="health"]')).not.toContainText(/uptime|sockets|backup/i);
    await openFixture(page, FIXTURE, 200, 'status', 'degraded');
    await expect(line.locator('[data-health-badge]')).toHaveText('DEGRADED');
    await expect(line.locator('.admin-issue')).toHaveCount(1);
    await expect(line.locator('.admin-issue')).toContainText('Errors');
    await expect(line.locator('.admin-issue')).toContainText('WARN');
    await expect(line).not.toContainText('Backup');
  });

  async function expectMatchesReport(panel) {
    const chartEngine = panel.locator('.analytics-chart-engine');
    await expect(chartEngine.first().locator('svg.pc-svg')).toHaveCount(1);
    await expect.poll(() => chartEngine.locator('svg .pc-bar').count()).toBeGreaterThan(0);
    await expect(chartEngine).toHaveCount(2);
    await expect(panel.locator('.analytics-chart-group')).toHaveText(['UNIT matches', 'UNIT percent']);
    // The accessible table keeps the real numerator and denominator.
    const reconnect = panel.locator('.analytics-chart-table tbody tr').filter({ hasText: /reconnect rate/i });
    await expect(reconnect.locator('td')).toHaveText(['8%', 'percent', '12', '1', '12']);
  }

  async function expectEconomyAdoption(panel) {
    await expect(panel.locator('.economy-adoption-zone .economy-report-head strong')).toHaveText('Feature adoption');
    await expect(panel.locator('.economy-adoption-zone .economy-report-head p')).toContainText('Share of eligible matches');
    await expect(panel.locator('.economy-adoption-row')).toHaveCount(2);
    await expect(panel.locator('.economy-adoption-row').nth(0)).toContainText('Player loans');
    await expect(panel.locator('.economy-adoption-row').nth(0)).toContainText('42%');
    await expect(panel.locator('.economy-adoption-row').nth(0)).toContainText('20 eligible matches');
    await expect(panel.locator('.economy-adoption-row').nth(1)).toContainText('Auctions');
    await expect(panel.locator('.economy-adoption-row').nth(1)).toContainText('28%');
    await expect(panel.locator('.economy-adoption-row').nth(1)).toContainText('20 eligible matches');
    await expect(panel.getByRole('progressbar')).toHaveCount(2);
    await expect(panel.getByRole('region', { name: 'Economy report' })).toHaveAttribute('tabindex', '0');
  }

  async function expectEconomyOutcomes(panel) {
    await expect(panel.locator('.economy-outcome-row')).toHaveCount(5);
    await expect(panel.locator('.economy-outcome-row').nth(0)).toContainText('0.17');
    await expect(panel.locator('.economy-outcome-row').nth(1)).toContainText('6%');
    await expect(panel.locator('.economy-outcome-row').nth(1)).toContainText('20 margin positions');
    await expect(panel.locator('.economy-outcome-row').nth(2)).toContainText('2%');
    await expect(panel.locator('.economy-outcome-row').nth(3)).toContainText('0%');
    await expect(panel.locator('.economy-outcome-row').nth(4)).toContainText('3');
  }

  // Scrolls the report to its last outcome when the viewport is too short to show it all.
  async function expectEconomyScrollFit(page, panel, layout) {
    if (page.viewportSize().height >= 1000) {
      expect(layout.scrollHeight - layout.clientHeight).toBeLessThanOrEqual(2);
      return;
    }
    const report = panel.getByRole('region', { name: 'Economy report' });
    await report.focus();
    await page.keyboard.press('End');
    await expect.poll(() => panel.evaluate(element =>
      element.querySelector('.economy-outcome-row:last-child').getBoundingClientRect().bottom
        - element.querySelector('.economy-report').getBoundingClientRect().bottom,
    )).toBeLessThanOrEqual(1);
  }

  async function expectEconomyLayout(page, panel) {
    const layout = await panel.evaluate(element => {
      const adoption = element.querySelector('.economy-adoption-zone').getBoundingClientRect();
      const outcomes = element.querySelector('.economy-outcomes-zone').getBoundingClientRect();
      const features = [...element.querySelectorAll('.economy-adoption-row')].map(row => row.getBoundingClientRect());
      const report = element.querySelector('.economy-report');
      const rows = [...element.querySelectorAll('.economy-outcome-row')].map(row => row.getBoundingClientRect());
      return { adoptionBottom: adoption.bottom, outcomesTop: outcomes.top, featureY: features.map(rect => rect.y), outcomeHeights: rows.map(rect => rect.height), scrollHeight: report.scrollHeight, clientHeight: report.clientHeight };
    });
    expect(layout.outcomesTop).toBeGreaterThan(layout.adoptionBottom);
    expect(Math.abs(layout.featureY[0] - layout.featureY[1])).toBeLessThan(4);
    expect(layout.outcomeHeights.every(height => height >= 64)).toBe(true);
    await expectEconomyScrollFit(page, panel, layout);
    expect(await pageOverflow(page)).toEqual({ vertical: false, horizontal: false });
  }

  async function expectEconomyReport(page, panel) {
    await expectEconomyAdoption(panel);
    await expectEconomyOutcomes(panel);
    const workspaceBox = await page.locator('.admin-workspace').boundingBox();
    expect(workspaceBox.height).toBeGreaterThan(page.viewportSize().height * 0.65);
    const reportBox = await panel.locator('.economy-report').boundingBox();
    expect(reportBox.height).toBeGreaterThan(page.viewportSize().height * 0.5);
    if (page.viewportSize().width > 760) await expectEconomyLayout(page, panel);
  }

  test('renders matches as small multiples and Economy as a balanced adoption and market report', async ({ page }) => {
    for (const tab of ['matches', 'economy']) {
      await openFixture(page, { ...FIXTURE, overview: { kpis: [] }, series: [], breakdowns: [SPECIALIZED_MODELS[tab]] }, 200, tab);
      const panel = page.locator(`#analytics-panel-${tab}`);
      await expect(panel).toBeVisible();
      await expect(panel.locator('[data-analytics-chart]')).toHaveCount(1);
      if (tab === 'matches') await expectMatchesReport(panel);
      else await expectEconomyReport(page, panel);
      await expect(panel).not.toContainText('WAITING FOR');
    }
  });

  test('Economy shows zero rates and labels unavailable sample sizes without inventing data', async ({ page }) => {
    const response = { ...FIXTURE, overview: { kpis: [] }, series: [], breakdowns: [{ adoption: { loans: { value: 0, denominator: 0 }, auctions: { value: 0.28 } }, liquidationRate: { value: 0, denominator: 0 } }] };
    await openFixture(page, response, 200, 'economy');
    const panel = page.locator('#analytics-panel-economy');
    await expect(panel.locator('.economy-adoption-row')).toHaveCount(2);
    await expect(panel.getByRole('progressbar', { name: 'Player loans adoption' })).toHaveAttribute('aria-valuenow', '0');
    await expect(panel.locator('.economy-adoption-row').nth(0)).toContainText('0%');
    await expect(panel.locator('.economy-adoption-row').nth(0)).toContainText('0 eligible matches');
    await expect(panel.locator('.economy-adoption-row').nth(1)).toContainText('28%');
    await expect(panel.locator('.economy-adoption-row').nth(1)).toContainText('Sample size unavailable');
    await expect(panel.locator('.economy-adoption-row').nth(1)).not.toContainText(/eligible matches/);
    await expect(panel.locator('.economy-outcome-row').nth(0)).toContainText('Not recorded');
    await expect(panel.locator('.economy-outcome-row').nth(1)).toContainText('0%');
    await expect(panel.locator('.economy-outcome-row').nth(1)).toContainText('0 margin positions');
  });

  test('keeps the tiles above every view, and switching views keeps them', async ({ page }) => {
    await openFixture(page);
    await page.locator('[data-analytics-tab="economy"]').click();
    await expect(page.locator('#analytics-panel-economy')).toBeVisible();
    await expect(page.locator('#analytics-panel-status')).toBeHidden();
    await expect(page.locator('#admin-analytics-grid .analytics-metric')).toHaveCount(6);
    await expect(page.locator('[data-analytics-tab="economy"]')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('economy');
  });

  test('keeps the chart drawn and the marker attribute in step when forced colors change', async ({ page }) => {
    await openFixture(page);
    const figure = page.locator('figure.analytics-chart').first();
    const chartSvg = figure.locator('.analytics-chart-engine .pc-svg');
    await expect(chartSvg).toHaveCount(1);
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(figure).toHaveAttribute('data-forced-colors', 'active');
    await expect(chartSvg).toBeVisible();
    await page.emulateMedia({ forcedColors: 'none' });
    await expect(figure).toHaveAttribute('data-forced-colors', 'off');
    await expect(chartSvg).toHaveCount(1);
  });

  test('says so plainly when a view has nothing to draw, and does not leave a blank panel', async ({ page }) => {
    for (const tab of ['status', 'matches', 'economy']) {
      await openFixture(page, { ...FIXTURE, overview: { kpis: [] }, series: [], breakdowns: [] }, 200, tab);
      const panel = page.locator(`#analytics-panel-${tab}`);
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('NO VERIFIED OBSERVATIONS FOR THIS PANEL');
      await expect(panel).not.toContainText('WAITING FOR');
      await expect(page.locator('[data-section="kpis"]')).toBeHidden();
      const workspace = await page.locator('.admin-workspace').boundingBox();
      expect(workspace.height, `${tab} workspace hugs its content`).toBeLessThan(page.viewportSize().height * 0.6);
    }
  });

  test('renders each tile as number, unit and change, with the definition and denominator only in the title', async ({ page }) => {
    await openFixture(page);
    const completion = page.locator('.analytics-metric').filter({ hasText: 'Completion rate' });
    await expect(completion).toContainText(/87[.,]4%/);
    await expect(completion).toContainText(/\+1[.,]3pp vs previous day/);
    await expect(completion).toHaveAttribute('title', 'Completed divided by started. · 720 of 824');
    const visible = await completion.evaluate(element => { const copy = element.cloneNode(true); copy.querySelectorAll('.sr-only').forEach(node => node.remove()); return copy.textContent.replace(/\s+/g, ' '); });
    expect(visible).not.toMatch(/720|824|NUMERATOR|DENOMINATOR|BASELINE|VERIFIED \d{4}|COMPARISON UNAVAILABLE|DEFINITION/i);
    const error = page.locator('.analytics-metric').filter({ hasText: 'Error rate' });
    await expect(error).toHaveAttribute('title', /Failed requests in the selected window\. · of 10[.,]?000|40 of 10[.,]?000/);
    await expect(error).toHaveAttribute('data-kpi-state', 'none');
    await expect(page.locator('#admin-analytics-grid time')).toHaveCount(0);
    const latency = page.locator('.analytics-metric').filter({ hasText: 'P95 action latency' });
    await expect(latency).toContainText('seconds');
  });

  test('colours a tile only when the server sends a state', async ({ page }) => {
    const kpis = FIXTURE.overview.kpis.map(item => (item.id === 'error-rate' ? { ...item, state: 'warn' } : item));
    await openFixture(page, { ...FIXTURE, overview: { kpis } });
    await expect(page.locator('[data-kpi-id="error-rate"]')).toHaveAttribute('data-kpi-state', 'warn');
    await expect(page.locator('[data-kpi-id="error-rate"]')).toContainText('WATCH');
    await expect(page.locator('[data-kpi-id="p95-action-latency"]')).toHaveAttribute('data-kpi-state', 'none');
  });

  test('keeps the SVG chart engine visible and keyboard readable', async ({ page }) => {
    await openFixture(page);
    const engine = page.locator('.analytics-chart-engine').first();
    const chart = await engine.evaluate(element => { const rect = element.getBoundingClientRect(); return { engine: element.dataset.chartEngine, role: element.getAttribute('role'), width: rect.width, height: rect.height }; });
    expect(chart.engine).toBe('svg');
    expect(chart.role).toBe('group');
    expect(chart.width).toBeGreaterThan(0);
    expect(chart.height).toBeGreaterThan(0);
    await engine.focus();
    await expect(engine).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(engine.locator('.pc-readout')).toBeVisible();
    const first = await engine.locator('.pc-live').textContent();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => engine.locator('.pc-live').textContent()).not.toBe(first);
    await page.keyboard.press('Escape');
    await expect(engine.locator('.pc-readout')).toHaveCount(0);
  });

  test('keeps the window control a labelled group of toggle buttons that is URL-safe', async ({ page }) => {
    await openFixture(page);
    const segments = page.locator('[data-analytics-range]');
    await expect(segments).toHaveText(['1H', '24H', '7D', '30D']);
    await expect(page.getByRole('group', { name: 'Time window' })).toBeVisible();
    await expect(page.locator('[data-analytics-range="hour"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-analytics-range="week"]').click();
    await expect(page.locator('[data-analytics-range="week"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-analytics-range="hour"]')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBe('week');
    expect(page.url()).not.toMatch(/account|session|roomCode|season|provider/i);
    await page.locator('[data-analytics-range="month"]').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBe('month');
  });

  test('restores a surface, a view and the window from a copied URL, and maps the old tab names', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/admin/analytics?tab=economy&range=week');
    await expect(page.locator('[data-admin-section="analytics"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-analytics-tab="economy"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-analytics-range="week"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await pageOverflow(page)).toEqual({ vertical: false, horizontal: false });
    const cases = [
      ['?tab=overview&seasonId=S1&provider=openai', 'analytics', 'status'],
      ['?tab=match-health', 'analytics', 'matches'],
      ['?tab=status', 'analytics', 'status'],
      ['?tab=rooms', 'rooms', null],
      ['?tab=bots', 'bots', null],
      ['?tab=release', 'release', null],
      ['?admin=provider', 'bots', null],
      ['?tab=__proto__', 'analytics', 'status'],
    ];
    for (const [search, surface, view] of cases) {
      await page.goto(`/admin/analytics${search}`);
      await expect(page.locator(`[data-admin-section="${surface}"]`), search).toHaveAttribute('aria-selected', 'true');
      if (view) await expect(page.locator(`[data-analytics-tab="${view}"]`), search).toHaveAttribute('aria-selected', 'true');
    }
  });

  test('keeps identity and raw network fields outside the admin surface', async ({ page }) => {
    const responseBodies = [];
    page.on('response', async response => {
      if (!response.url().includes('/admin/')) return;
      responseBodies.push(await response.text().catch(() => ''));
    });
    await openFixture(page);
    const privateFixtureValues = /qa-admin-session|qa-admin/i;
    const privateJsonFields = /"(?:displayName|username|accountId|roomCode|chatMessages|hiddenCards|privateLoanTerms|sessionToken|rawPayload|rawEvent|ipAddress|rawIp|userAgent|rawUserAgent)"\s*:/i;
    await expect(page.locator('#view-admin-analytics')).not.toContainText(privateFixtureValues);
    expect(page.url()).not.toMatch(privateFixtureValues);
    await expect.poll(() => responseBodies.length).toBeGreaterThan(0);
    expect(responseBodies.every(body => !privateJsonFields.test(body))).toBe(true);
  });

  test('a hostile snapshot cannot put identity fields on the page', async ({ page }) => {
    const hostile = { ...FIXTURE, series: [{ label: '12:00', value: 4, displayName: 'LEAKY-NAME', roomCode: 'LEAKY1' }], overview: { kpis: [{ id: 'online-now', label: 'Online now', value: 3, unit: 'players', username: 'LEAKY-USER', accountId: 'LEAKY-ACCOUNT' }] }, breakdowns: [{ pseudonymId: 'P-1', displayName: 'LEAKY-NAME', roomCode: 'LEAKY1' }] };
    await openFixture(page, hostile);
    await expect(page.locator('#admin-analytics-grid .analytics-metric')).toHaveCount(1);
    expect(await page.locator('#view-admin-analytics').evaluate(element => element.innerHTML)).not.toMatch(/LEAKY/);
  });

  test('covers stale, empty, suppressed, rate-limited, and unavailable states with a retry', async ({ page }) => {
    await openFixture(page, { ...FIXTURE, dataQuality: { fresh: false, stale: true } });
    await expect(page.locator('#admin-analytics-status')).toContainText('STALE');
    await openFixture(page, { ...FIXTURE, overview: { kpis: [] }, series: [], breakdowns: [], metrics: {} });
    await expect(page.locator('[data-section="report-status"] [data-section-state]')).toContainText('NO VERIFIED OBSERVATIONS');
    await openFixture(page, { ...FIXTURE, suppression: { minimumCohort: 5, suppressedPanels: 1 } });
    await expect(page.locator('#admin-analytics-status')).toContainText('MIN COHORT 5');
    await openFixture(page, { success: false, status: 429 }, 429);
    await expect(page.locator('#admin-analytics-status')).toContainText('RATE LIMITED');
    await expect(page.locator('[data-section="report-status"] [data-section-state]')).toContainText('RATE LIMITED');
    await openFixture(page, { success: false, status: 503 }, 503);
    await expect(page.locator('#admin-analytics-status')).toContainText('ROLLUP UNAVAILABLE');
    await page.unroute('**/admin/analytics/balance**');
    await page.route('**/admin/analytics/balance**', route => json(route, FIXTURE));
    await page.locator('[data-section="report-status"] [data-section-retry]').click();
    await expect(page.locator('#admin-analytics-grid .analytics-metric')).toHaveCount(6);
    await expect(page.locator('#admin-analytics-status')).toContainText('SYNCED');
  });

  test('keeps keyboard focus visible and tab switching predictable in both strips', async ({ page }) => {
    await openFixture(page);
    const surfaces = page.locator('[data-admin-section]');
    await surfaces.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(surfaces.nth(1)).toBeFocused();
    await expect(surfaces.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#admin-section-rooms')).toBeVisible();
    await page.keyboard.press('Home');
    await expect(surfaces.first()).toBeFocused();
    const views = page.locator('[data-analytics-tab]');
    await views.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(views.nth(1)).toBeFocused();
    await expect(views.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(views.last()).toBeFocused();
    await expect(page.locator(':focus-visible')).toBeVisible();
  });

  test('keeps 200 percent zoom free of page overflow', async ({ page }) => {
    await openFixture(page);
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: Math.max(160, Math.floor((viewport?.width || 390) / 2)), height: Math.max(320, Math.floor((viewport?.height || 844) / 2)) });
    expect(await pageOverflow(page)).toEqual({ vertical: false, horizontal: false });
    await expect(page.locator('#analytics-panel-status')).toBeVisible();
  });
});

test.describe('admin analytics visual evidence at native desktop', () => {
  test('captures every surface and the major data states for native inspection', async ({ page }, testInfo) => {
    test.skip(!process.env.POORUP_VISUAL_CAPTURE_DIR && testInfo.project.name !== 'desktop-1920x1080', 'Evidence is captured only at 1920x1080 outside the visual capture matrix.');
    const artifactRoot = path.resolve(process.env.POORUP_VISUAL_CAPTURE_DIR ? 'qa-artifacts/admin-analytics-1920' : path.join(testInfo.outputDir, 'admin-analytics-1920'));
    const merged = { ...FIXTURE, breakdowns: [{ ...SPECIALIZED_MODELS.matches, ...SPECIALIZED_MODELS.economy }] };
    for (const tab of ['status', 'matches', 'economy', 'rooms', 'bots', 'release']) {
      await openFixture(page, merged, 200, tab, 'degraded');
      if (['status', 'matches'].includes(tab)) await expect.poll(() => page.locator(`#analytics-panel-${tab} .analytics-chart-engine svg`).count()).toBeGreaterThan(0);
      if (tab === 'economy') await expect(page.locator('#analytics-panel-economy .economy-adoption-row')).toHaveCount(2);
      await captureScreenshot(page, testInfo, { group: 'admin', surfaceId: `admin-${tab}`, label: `Admin ${tab}`, fallbackPath: path.join(artifactRoot, `${tab}-verified.png`) });
    }
    await openFixture(page, { ...FIXTURE, dataQuality: { fresh: false, stale: true } });
    await captureScreenshot(page, testInfo, { group: 'admin', surfaceId: 'admin-state-stale', label: 'Admin stale state', fallbackPath: path.join(artifactRoot, 'state-stale.png') });
    await openFixture(page, { ...FIXTURE, overview: { kpis: [] }, series: [], breakdowns: [], metrics: {} });
    await captureScreenshot(page, testInfo, { group: 'admin', surfaceId: 'admin-state-empty', label: 'Admin empty state', fallbackPath: path.join(artifactRoot, 'state-empty.png') });
    await openFixture(page, { success: false, status: 503 }, 503);
    await captureScreenshot(page, testInfo, { group: 'admin', surfaceId: 'admin-state-error', label: 'Admin error state', fallbackPath: path.join(artifactRoot, 'state-error.png') });
    testInfo.annotations.push({ type: 'screenshots', description: artifactRoot });
  });
});

test.describe('admin analytics forced colors and reduced motion', () => {
  test.use({ forcedColors: 'active', reducedMotion: 'reduce' });

  test('shows semantic controls and a drawn chart under forced colors', async ({ page }) => {
    await openFixture(page);
    await expect.poll(() => page.evaluate(() => window.matchMedia('(forced-colors: active)').matches)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expect(page.locator('[data-admin-section]').first()).toBeVisible();
    await expect(page.locator('[data-analytics-range="hour"]')).toBeVisible();
    await expect(page.locator('#analytics-panel-status .analytics-chart-engine svg.pc-svg')).toBeVisible();
    // The accessible table is still there for assistive technology.
    await expect(page.locator('#analytics-panel-status .analytics-chart-table')).toBeAttached();
    // The selected tab stays distinguishable without colour.
    const selected = await page.locator('[data-admin-section][aria-selected="true"]').evaluate(element => getComputedStyle(element).borderTopWidth);
    const other = await page.locator('[data-admin-section][aria-selected="false"]').first().evaluate(element => getComputedStyle(element).borderTopWidth);
    expect(parseFloat(selected)).toBeGreaterThan(parseFloat(other));
  });
});

test.describe('admin analytics view switching', () => {
  test('a view draws its own chart when it is selected, not only the one loaded first', async ({ page }) => {
    const merged = { ...FIXTURE, breakdowns: [{ ...SPECIALIZED_MODELS.matches, ...SPECIALIZED_MODELS.economy }] };
    await openFixture(page, merged);
    await page.locator('[data-analytics-tab="matches"]').click();
    await expect(page.locator('#analytics-panel-matches svg rect')).not.toHaveCount(0);
    await page.locator('[data-analytics-tab="economy"]').click();
    await expect(page.locator('#analytics-panel-economy .economy-adoption-row')).toHaveCount(2);
    await expect(page.locator('#analytics-panel-economy .economy-adoption-row')).toContainText(['42%', '28%']);
  });
});
