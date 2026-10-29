/* global document, getComputedStyle */
import { test, expect } from '@playwright/test';

const SESSION = { sessionToken: 'qa-admin-session', account: { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin' } };
const ISO = '2026-09-15T12:00:00.000Z';
const SURFACES = ['analytics', 'rooms', 'bots', 'release'];
const TABS = ['status', 'rooms', 'matches', 'bots', 'economy', 'release'];

const BALANCE = {
  success: true, schemaVersion: 1, generatedAt: ISO, filters: { range: 'day', tab: 'overview' }, suppression: { minimumCohort: 5, suppressedPanels: 0 },
  overview: { kpis: [
    { id: 'online-now', label: 'Online now', value: 42, unit: 'players', definition: 'Active human seats.' },
    { id: 'error-rate', label: 'Error rate', value: 0.004, unit: 'percent', denominator: 10000, definition: 'Failed requests.' },
    { id: 'p95-action-latency', label: 'P95 action latency', value: 1.8, unit: 'seconds', definition: 'Latency.' },
    { id: 'completion-rate', label: 'Completion rate', value: 0.874, unit: 'percent', numerator: 720, denominator: 824, definition: 'Completed divided by started.' },
    { id: 'started', label: 'Games started', value: 824, unit: 'matches', definition: 'Starts.' },
    { id: 'peak-24h', label: '24h peak', value: 183, unit: 'players', definition: 'Peak.' }] },
  series: Array.from({ length: 24 }, (_, index) => ({ label: `${String(index).padStart(2, '0')}:00`, value: 20 + ((index * 7) % 40) })),
  breakdowns: [{ starts: 12, completions: 9, stalls: 1, reconnectRate: { value: 0.08, numerator: 1, sampleSize: 12, denominator: 12 }, afkRate: { value: 0.02, denominator: 12 }, adoption: { loans: { value: 0.42, denominator: 20 }, auctions: { value: 0.28, denominator: 20 } } }],
  dataQuality: { fresh: true },
};

const STATUS = (mode = 'normal', activeRounds = 3, release = {}) => ({
  success: true, generatedAt: ISO,
  health: { state: 'healthy', checks: [{ id: 'backup', label: 'Backup', state: 'ok', detail: 'Last run 11:40 UTC' }], uptimeSeconds: 7200, sockets: 12, rooms: 4, activeRounds, backup: { configured: true, fresh: true, lastRunAt: ISO, failures: 0 }, errorCount: 0, restoreFailures: 0, latencyP95Ms: 410 },
  maintenance: { mode, message: mode === 'normal' ? '' : 'Back at nine', releaseId: 'rel-7', drainDeadline: null, activeRounds, ...release },
});

const hex = value => value.toString(16).padStart(6, '0');
const roomList = (count, offset = 0) => Array.from({ length: count }, (_, index) => ({ id: `r-${hex(0xa00000 + offset + index)}`, phase: index % 2 ? 'playing' : 'lobby', visibility: index % 3 ? 'public' : 'private', humans: 1 + (index % 4), bots: index % 2, round: index % 2 ? 3 : null, ageSeconds: 60 * (index + 1), idleSeconds: index, stalled: index === 2 }));
const ROOMS = (count = 3, offset = 0) => ({ success: true, generatedAt: ISO, totals: { rooms: count, lobby: 1, playing: 2, humans: 5, bots: 2 }, rooms: roomList(count, offset) });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Mock every admin endpoint with mutable state, so a spec can change what the "server" says between reads.
async function mockConsole(page, overrides = {}) {
  const server = { mode: 'normal', rooms: ROOMS(), posts: [], reads: { status: 0, rooms: 0, audit: 0, balance: 0 }, audit: [], maintenanceStatus: 200, ...overrides };
  await page.route('**/admin/analytics/balance**', route => { server.reads.balance += 1; return json(route, BALANCE); });
  await page.route('**/admin/ops/status', route => { server.reads.status += 1; return json(route, STATUS(server.mode, 3, server.release)); });
  await page.route('**/admin/ops/rooms', route => { server.reads.rooms += 1; return json(route, server.rooms); });
  await page.route('**/admin/ops/bots**', route => json(route, { success: true, range: 'day', generatedAt: ISO, totals: { botMatches: 0, decisions: null, fallbacks: null, fallbackRate: null, sampleSize: 0 }, providers: [], provider: { state: 'healthy', activeLabel: null, capPerBot: null } }));
  await page.route('**/admin/ops/audit', route => { server.reads.audit += 1; return json(route, { success: true, entries: server.audit }); });
  await page.route('**/admin/ai/providers**', route => json(route, { success: true, active: null, providers: [] }));
  await page.route('**/admin/ops/maintenance', route => {
    const body = JSON.parse(route.request().postData() || '{}');
    server.posts.push(body);
    if (server.maintenanceStatus !== 200) return json(route, { success: false, error: 'The change was refused by the server.' }, server.maintenanceStatus);
    server.mode = body.mode;
    server.release = body.mode === 'normal' ? {} : { releaseId: body.releaseId ?? 'rel-7', drainDeadline: body.deadline ?? null };
    server.audit = [{ at: ISO, area: 'release', action: 'mode', target: body.mode, actor: 'admin-1a2b3c4d', outcome: 'ok' }, ...server.audit];
    return json(route, { success: true, maintenance: { mode: server.mode } });
  });
  return server;
}

async function openConsole(page, tab = 'status', overrides = {}) {
  const server = await mockConsole(page, overrides);
  await page.goto(`/admin/analytics?tab=${tab}`);
  await expect(page.locator('#admin-analytics-main')).toBeVisible();
  await page.evaluate(async session => {
    const { state } = await import('/clientState.js');
    state.account = session;
  }, SESSION);
  return server;
}

const overflowOf = page => page.evaluate(() => ({
  vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight || document.body.scrollHeight > document.body.clientHeight,
  horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.body.clientWidth,
}));

test.describe('surface tabs', () => {
  test('are a full-width row of four tabs with roving tabindex; arrows, Home and End move and select', async ({ page }) => {
    await openConsole(page);
    const strip = page.getByRole('tablist', { name: 'Operator surfaces' });
    await expect(strip).toBeVisible();
    const tabs = strip.getByRole('tab');
    await expect(tabs).toHaveCount(4);
    const [stripBox, workspace] = await Promise.all([strip.boundingBox(), page.locator('.admin-workspace').boundingBox()]);
    expect(stripBox.width).toBeGreaterThanOrEqual(workspace.width);
    expect(await tabs.evaluateAll(items => items.map(item => item.getAttribute('tabindex')))).toEqual(['0', '-1', '-1', '-1']);
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('tabindex', '0');
    await expect(tabs.first()).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('h1:visible')).toHaveText('ROOMS');
    await expect(page.locator('#admin-section-rooms')).toBeVisible();
    await expect(page.locator('#admin-section-analytics')).toBeHidden();
    await page.keyboard.press('End');
    await expect(tabs.last()).toBeFocused();
    await expect(page.locator('h1:visible')).toHaveText('RELEASE');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.first()).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.first()).toBeFocused();
    await expect(page.locator('h1:visible')).toHaveText('ANALYTICS');
    await expect(page.locator(':focus-visible')).toBeVisible();
  });

  test('Tab leaves each strip after one stop', async ({ page }) => {
    await openConsole(page);
    await page.locator('[data-admin-section="analytics"]').focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-admin-sections]')))).toBe(false);
  });

  test('every surface names itself with its tab, the title follows, and the URL follows the selection', async ({ page }) => {
    await openConsole(page);
    const titles = { analytics: 'ANALYTICS', rooms: 'ROOMS', bots: 'BOTS & AI', release: 'RELEASE' };
    for (const surface of SURFACES) {
      await page.locator(`[data-admin-section="${surface}"]`).click();
      await expect(page.locator(`#admin-section-${surface}`)).toBeVisible();
      await expect(page.locator(`#admin-section-${surface}`)).toHaveAttribute('aria-labelledby', `admin-section-tab-${surface}`);
      await expect(page.locator('h1:visible')).toHaveText(titles[surface]);
      await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe(surface === 'analytics' ? 'status' : surface);
    }
  });

  test('Analytics reopens the view that was last open', async ({ page }) => {
    await openConsole(page);
    await page.locator('[data-analytics-tab="economy"]').click();
    await page.locator('[data-admin-section="rooms"]').click();
    await page.locator('[data-admin-section="analytics"]').click();
    await expect(page.locator('[data-analytics-tab="economy"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#analytics-panel-economy')).toBeVisible();
  });

  test('the window control is shown only where it means something', async ({ page }) => {
    await openConsole(page);
    const control = page.locator('[data-analytics-window]');
    for (const [surface, visible] of [['analytics', true], ['rooms', false], ['bots', true], ['release', false]]) {
      await page.locator(`[data-admin-section="${surface}"]`).click();
      if (visible) await expect(control).toBeVisible(); else await expect(control).toBeHidden();
    }
  });
});

test.describe('rooms', () => {
  test('lists live rooms by hashed id, totals on one line, stalled rooms flagged in words, never a code or a name', async ({ page }) => {
    const hostile = { ...ROOMS(3), rooms: [...roomList(3), { id: 'ABCDEF', phase: 'lobby', visibility: 'private', humans: 1, bots: 0, round: null, ageSeconds: 1, idleSeconds: 1, stalled: false, roomCode: 'ZZTOP9', hostName: 'Ada Lovelace', nickname: 'Bee' }] };
    await openConsole(page, 'rooms', { rooms: hostile });
    const rows = page.locator('[data-rooms-table] tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.first().locator('th')).toHaveText(/^r-[0-9a-f]{6}$/);
    const totals = page.locator('[data-rooms-totals] .admin-totals-line');
    await expect(totals).toHaveCount(1);
    await expect(totals).toContainText('3 rooms');
    await expect(totals).toContainText('2 playing');
    expect(await totals.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(60);
    await expect(page.locator('[data-rooms-table] .admin-flag')).toHaveText('STALLED');
    await expect(page.locator('[data-rooms-note]')).toContainText('REFRESHES EVERY 15S');
    await expect(page.locator('#admin-analytics-status')).toContainText('LIVE · 12:00:00 UTC');
    const text = await page.locator('#view-admin-analytics').innerText();
    for (const leak of ['ABCDEF', 'ZZTOP9', 'Ada Lovelace', 'Bee']) expect(text).not.toContain(leak);
    expect(await page.content()).not.toMatch(/ZZTOP9|Ada Lovelace/);
    const table = page.locator('[data-rooms-table] table');
    await expect(table.locator('caption')).toContainText('one-way hashes');
    await expect(table.locator('thead th')).toHaveText(['Room', 'Phase', 'Visibility', 'Humans', 'Bots', 'Round', 'Age', 'Idle', 'State']);
    // No sidebar, no export.
    await expect(page.locator('.admin-side')).toHaveCount(0);
    await expect(page.locator('[data-analytics-export]')).toHaveCount(0);
  });

  test('an empty install is one short line, not a blank panel', async ({ page }) => {
    await openConsole(page, 'rooms', { rooms: ROOMS(0) });
    await expect(page.locator('[data-rooms-empty]')).toBeVisible();
    await expect(page.locator('[data-rooms-totals]')).toContainText('0 rooms');
    const height = await page.locator('.admin-workspace').evaluate(element => element.getBoundingClientRect().height);
    expect(height).toBeLessThan(page.viewportSize().height * 0.6);
  });

  test('shows an error with retry, and clears on unauthorized', async ({ page }) => {
    await openConsole(page, 'rooms', { rooms: ROOMS(0) });
    await page.unroute('**/admin/ops/rooms');
    await page.route('**/admin/ops/rooms', route => json(route, { success: false }, 503));
    await page.locator('[data-analytics-refresh]').click();
    await expect(page.locator('[data-section="rooms"] [data-section-state]')).toContainText('UNAVAILABLE');
    await expect(page.locator('#admin-analytics-status')).toContainText('UNAVAILABLE');
    await page.unroute('**/admin/ops/rooms');
    await page.route('**/admin/ops/rooms', route => json(route, ROOMS(2)));
    await page.locator('[data-section="rooms"] [data-section-retry]').click();
    await expect(page.locator('[data-rooms-table] tbody tr')).toHaveCount(2);
    await page.unroute('**/admin/ops/rooms');
    await page.route('**/admin/ops/rooms', route => json(route, { success: false }, 403));
    await page.locator('[data-analytics-refresh]').click();
    await expect(page.locator('[data-section="rooms"] [data-section-state]')).toContainText('ADMIN ACCESS REQUIRED');
    await expect(page.locator('[data-rooms-table]')).toBeEmpty();
    await expect(page.locator('[data-rooms-totals]')).toBeEmpty();
  });

  test('refreshes every 15 seconds, pauses while the tab is hidden or the surface is not shown, and stops on teardown', async ({ page }) => {
    await page.clock.install({ time: new Date(ISO) });
    const server = await openConsole(page, 'rooms');
    await expect(page.locator('[data-rooms-table] tbody tr')).toHaveCount(3);
    const base = server.reads.rooms;
    await page.clock.runFor(15_100);
    await expect.poll(() => server.reads.rooms).toBe(base + 1);
    await page.clock.runFor(15_100);
    await expect.poll(() => server.reads.rooms).toBe(base + 2);
    server.rooms = ROOMS(5, 100);
    await page.clock.runFor(15_100);
    await expect(page.locator('[data-rooms-table] tbody tr')).toHaveCount(5);

    const afterRooms = server.reads.rooms;
    await page.locator('[data-admin-section="analytics"]').click();
    await page.clock.runFor(60_000);
    expect(server.reads.rooms).toBe(afterRooms);

    await page.locator('[data-admin-section="rooms"]').click();
    await expect.poll(() => server.reads.rooms).toBe(afterRooms + 1);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const whileHidden = server.reads.rooms;
    await page.clock.runFor(60_000);
    expect(server.reads.rooms).toBe(whileHidden);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => server.reads.rooms).toBe(whileHidden + 1);

    await page.evaluate(() => document.querySelector('#view-admin-analytics').classList.add('is-hidden'));
    const whileGone = server.reads.rooms;
    await page.clock.runFor(60_000);
    expect(server.reads.rooms).toBe(whileGone);
  });
});

test.describe('release', () => {
  test('is one compact card: mode, active rounds, and only the actions that make sense', async ({ page }) => {
    await openConsole(page, 'release');
    await expect(page.locator('[data-release-badge]')).toHaveText('OPEN');
    await expect(page.locator('[data-release-summary]')).toContainText('3 active rounds');
    await expect(page.locator('[data-release-action="draining"]')).toBeEnabled();
    await expect(page.locator('[data-release-action="maintenance"]')).toBeEnabled();
    await expect(page.locator('[data-release-action="normal"]')).toBeDisabled();
    await expect(page.locator('[data-release-message]')).toBeVisible();
    const card = await page.locator('.admin-release-body').boundingBox();
    // The card also holds the public maintenance panel switch (one short row), hence 0.7 rather than 0.6.
    expect(card.height).toBeLessThan(page.viewportSize().height * 0.7);
  });

  test('cancel changes nothing; confirm posts once and the page shows what the server then reports', async ({ page }) => {
    const server = await openConsole(page, 'release');
    await expect(page.locator('[data-release-badge]')).toHaveText('OPEN');
    const dialog = page.locator('#confirm-modal');

    await page.locator('[data-release-action="draining"]').click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Start draining?');
    await page.locator('#confirm-cancel').click();
    await expect(dialog).toBeHidden();
    await page.locator('[data-release-action="draining"]').click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-release-action="draining"]')).toBeFocused();
    expect(server.posts).toEqual([]);
    await expect(page.locator('[data-release-badge]')).toHaveText('OPEN');

    await page.locator('[data-release-message]').fill('Back at nine');
    await page.locator('[data-release-action="draining"]').click();
    const reads = { status: server.reads.status, audit: server.reads.audit };
    await page.locator('#confirm-accept').click();
    await expect(page.locator('[data-release-badge]')).toHaveText('DRAINING');
    expect(server.posts).toEqual([{ mode: 'draining', message: 'Back at nine' }]);
    expect(server.reads.status).toBeGreaterThan(reads.status);
    expect(server.reads.audit).toBeGreaterThan(reads.audit);
    await expect(page.locator('[data-release-status]')).toContainText('DRAIN APPLIED');
    await expect(page.locator('[data-release-action="draining"]')).toBeDisabled();
    await expect(page.locator('[data-release-action="normal"]')).toBeEnabled();
    await expect(page.locator('[data-section="log-release"] .admin-log-entry')).toHaveCount(1);
    await expect(page.locator('[data-section="log-release"]')).toContainText('MODE · draining');

    await page.locator('[data-release-action="normal"]').click();
    await expect(page.locator('#confirm-modal')).toContainText('Resume normal service?');
    await page.locator('#confirm-accept').click();
    await expect(page.locator('[data-release-badge]')).toHaveText('OPEN');
    expect(server.posts.map(post => post.mode)).toEqual(['draining', 'normal']);
  });

  test('the release id and a drain deadline are validated, confirmed, sent, and read back with a live countdown', async ({ page }) => {
    const server = await openConsole(page, 'release');
    const dialog = page.locator('#confirm-modal');
    await expect(page.locator('[data-release-id]')).toBeVisible();
    await expect(page.locator('[data-release-minutes]')).toBeVisible();
    await expect(page.locator('[data-release-at]')).toBeVisible();

    // A bad id is refused on the spot: no dialog, no request, the field is flagged and focused.
    await page.locator('[data-release-id]').fill('rel 9');
    await page.locator('[data-release-action="draining"]').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-release-status]')).toContainText('NOT APPLIED · The release ID may use');
    await expect(page.locator('[data-release-id]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-release-id]')).toBeFocused();
    await page.locator('[data-release-id]').fill('rel-2026.10_a');
    await page.locator('[data-release-minutes]').fill('0');
    await page.locator('[data-release-action="draining"]').click();
    await expect(page.locator('[data-release-minutes]')).toHaveAttribute('aria-invalid', 'true');
    expect(server.posts).toEqual([]);

    await page.locator('[data-release-minutes]').fill('45');
    await page.locator('[data-release-action="draining"]').click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Release rel-2026.10_a.');
    await expect(dialog).toContainText('Maintenance starts by itself at');
    const before = Date.now();
    await page.locator('#confirm-accept').click();
    await expect(page.locator('[data-release-badge]')).toHaveText('DRAINING');
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]).toMatchObject({ mode: 'draining', releaseId: 'rel-2026.10_a' });
    const sentDeadline = Date.parse(server.posts[0].deadline);
    expect(sentDeadline).toBeGreaterThan(before + 44 * 60_000);
    expect(sentDeadline).toBeLessThan(before + 46 * 60_000);
    await expect(page.locator('[data-release-summary]')).toContainText('rel-2026.10_a');
    const countdown = page.locator('[data-release-countdown]');
    await expect(countdown).toBeVisible();
    await expect(countdown).toHaveText(/^4[45]m \d{2}s$/);
    const first = await countdown.textContent();
    await expect.poll(async () => countdown.textContent(), { timeout: 5000 }).not.toBe(first);

    // The audit log keeps the mode only.
    const log = await page.locator('[data-section="log-release"]').innerText();
    expect(log).not.toContain('rel-2026.10_a');
  });

  test('a refused change is surfaced, nothing is assumed, and the page still shows the server state', async ({ page }) => {
    const server = await openConsole(page, 'release', { maintenanceStatus: 400 });
    await page.locator('[data-release-action]').filter({ hasText: 'MAINTENANCE' }).click();
    await page.locator('#confirm-accept').click();
    await expect(page.locator('[data-release-status]')).toContainText('NOT APPLIED · The change was refused by the server.');
    await expect(page.locator('[data-release-status]')).toHaveAttribute('role', 'alert');
    await expect(page.locator('[data-release-badge]')).toHaveText('OPEN');
    expect(server.mode).toBe('normal');
    await expect(page.locator('[data-release-action="maintenance"]')).toBeEnabled();
  });

  test('shows the unauthorized and error states, and the empty change log', async ({ page }) => {
    await mockConsole(page);
    await page.unroute('**/admin/ops/status');
    await page.route('**/admin/ops/status', route => json(route, { success: false }, 403));
    await page.goto('/admin/analytics?tab=release');
    await expect(page.locator('[data-section="control"] [data-section-state]')).toContainText('ADMIN ACCESS REQUIRED');
    await expect(page.locator('[data-release-summary]')).toBeEmpty();
    await expect(page.locator('[data-section="log-release"] [data-section-state]')).toContainText('NO RELEASE CHANGES RECORDED');
    await page.unroute('**/admin/ops/status');
    await page.route('**/admin/ops/status', route => json(route, { success: false }, 500));
    await page.locator('[data-section="control"] [data-section-retry]').click();
    await expect(page.locator('[data-section="control"] [data-section-state]')).toContainText('UNAVAILABLE');
  });
});

// A rollup that has never recorded a match answers 200 with zeros and dataQuality.empty (not a 503).
const EMPTY_BALANCE = {
  success: true, schemaVersion: 1, generatedAt: ISO, filters: { range: 'day', tab: 'overview' }, suppression: { minimumCohort: 5, suppressedPanels: 0 },
  overview: { kpis: [
    { id: 'online-now', label: 'Online now', value: 0, unit: 'connections', definition: 'Open connections.' },
    { id: 'error-rate', label: 'Error rate', value: null, unit: 'percent', definition: 'Errors.' },
    { id: 'p95-action-latency', label: 'P95 action latency', value: null, unit: 'milliseconds', definition: 'Latency.' },
    { id: 'completion-rate', label: 'Completion rate', value: null, unit: 'percent', numerator: 0, denominator: 0, definition: 'Completed divided by started.' },
    { id: 'started', label: 'Matches started', value: 0, unit: 'matches', definition: 'Starts.' },
    { id: 'peak-24h', label: 'Peak in 24h', value: 0, unit: 'connections', definition: 'Peak.' }] },
  series: [],
  breakdowns: [{ starts: 0, completions: 0, stalls: 0, reconnectRate: { value: null, numerator: 0, denominator: 0 }, afkRate: { value: null, numerator: 0, denominator: 0 }, bankruptcies: { value: 0, denominator: 0 }, comebacks: { value: 0, denominator: 0 }, adoption: {} }],
  dataQuality: { fresh: true, stale: false, empty: true, lagSeconds: 0 },
};

test.describe('empty rollup', () => {
  for (const [tab, label] of [['status', 'Overview'], ['matches', 'Match health'], ['economy', 'Economy']]) {
    test(`${label} says there is nothing to measure yet, not STALE and not an error`, async ({ page }) => {
      await mockConsole(page);
      await page.unroute('**/admin/analytics/balance**');
      await page.route('**/admin/analytics/balance**', route => json(route, EMPTY_BALANCE));
      await page.goto(`/admin/analytics?tab=${tab}`);
      const chip = page.locator('#admin-analytics-status');
      await expect(chip).toContainText('NOTHING TO MEASURE YET');
      await expect(chip).not.toContainText('STALE');
      await expect(chip).toHaveAttribute('data-analytics-state', 'empty');
      await expect(page.locator('[data-kpi-id="started"]')).toContainText('0');
      await expect(page.locator(`[data-section="report-${tab}"] [data-section-state]`)).toContainText(tab === 'status' ? /no matches in this window yet/i : /no completed matches in this window yet/i);
      await expect(page.locator(`[data-section="report-${tab}"] [data-section-retry]`)).toHaveCount(0);
    });
  }

  test('a real storage failure is still an error with a retry', async ({ page }) => {
    await mockConsole(page);
    await page.unroute('**/admin/analytics/balance**');
    await page.route('**/admin/analytics/balance**', route => json(route, { success: false, status: 503, error: 'Rollup unavailable.' }, 503));
    await page.goto('/admin/analytics?tab=matches');
    await expect(page.locator('#admin-analytics-status')).toContainText('ROLLUP UNAVAILABLE');
    await expect(page.locator('[data-section="report-matches"] [data-section-retry]')).toBeVisible();
  });
});

test.describe('no page overflow', () => {
  const VIEWPORTS = [
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '1366x768', width: 1366, height: 768 },
    { name: '1024x768', width: 1024, height: 768 },
    { name: 'iPad landscape 1180x820', width: 1180, height: 820 },
    { name: '390x844', width: 390, height: 844 },
  ];

  test('the document never scrolls on any surface at the supported sizes, and scrolling happens inside named, focusable surfaces', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920x1080', 'This test sets its own viewports; run it once.');
    await openConsole(page, 'status', { rooms: ROOMS(60), audit: Array.from({ length: 30 }, (_, index) => ({ at: ISO, area: index % 2 ? 'release' : 'provider', action: 'mode', target: `t-${index}`, actor: 'admin-1a2b3c4d', outcome: 'ok' })) });
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const tab of TABS) {
        const surface = ['status', 'matches', 'economy'].includes(tab) ? 'analytics' : tab;
        await page.locator(`[data-admin-section="${surface}"]`).click();
        if (surface === 'analytics') await page.locator(`[data-analytics-tab="${tab}"]`).click();
        await expect(page.locator(`#admin-section-${surface}`)).toBeVisible();
        await expect(page.locator(`#admin-section-${surface} [data-section-kind="loading"][data-has-data="false"]`)).toHaveCount(0);
        expect(await overflowOf(page), `${viewport.name} ${tab}`).toEqual({ vertical: false, horizontal: false });
        // Whatever scrolls (the console in a very short window, the surface, or a list) is focusable and shows a cue.
        const state = await page.evaluate(id => {
          const main = document.querySelector('#admin-analytics-main');
          const surfaceElement = document.querySelector(`#${id}`);
          const scrolls = element => element.scrollHeight > element.clientHeight + 1 && getComputedStyle(element).overflowY !== 'visible';
          const inner = [...surfaceElement.querySelectorAll('.admin-scroll')].filter(element => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
          return {
            mainScrolls: scrolls(main), mainFocusable: main.tabIndex === 0, mainCue: main.getAttribute('data-overflow'),
            surfaceScrolls: scrolls(surfaceElement), surfaceFocusable: surfaceElement.tabIndex === 0, surfaceCue: surfaceElement.getAttribute('data-overflow'),
            innerOk: inner.every(element => element.tabIndex === 0 && element.getAttribute('data-overflow') === 'true'),
          };
        }, `admin-section-${surface}`);
        expect(state.innerOk, `${viewport.name} ${tab} inner lists`).toBe(true);
        if (state.mainScrolls) { expect(state.mainFocusable, `${viewport.name} ${tab} console`).toBe(true); expect(state.mainCue).toBe('true'); }
        if (state.surfaceScrolls) { expect(state.surfaceFocusable, `${viewport.name} ${tab} surface`).toBe(true); expect(state.surfaceCue).toBe('true'); }
      }
    }
  });

  test('the tab rows stay full-width and reachable on a phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920x1080', 'This test sets its own viewports; run it once.');
    await page.setViewportSize({ width: 390, height: 844 });
    await openConsole(page);
    for (const surface of SURFACES) await expect(page.locator(`[data-admin-section="${surface}"]`)).toBeInViewport();
    for (const view of ['status', 'matches', 'economy']) await expect(page.locator(`[data-analytics-tab="${view}"]`)).toBeInViewport();
    await page.locator('[data-admin-section="release"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#admin-section-release')).toBeVisible();
    expect(await overflowOf(page)).toEqual({ vertical: false, horizontal: false });
  });

  test('a very short window makes the whole console the one scroll surface, reachable by keyboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920x1080', 'This test sets its own viewports; run it once.');
    await page.setViewportSize({ width: 472, height: 328 });
    await openConsole(page, 'status');
    expect(await overflowOf(page)).toEqual({ vertical: false, horizontal: false });
    const main = page.locator('#admin-analytics-main');
    await expect(page.locator('#analytics-panel-status')).toBeVisible();
    await expect.poll(() => main.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(main).toHaveAttribute('data-overflow', 'true');
    await expect(main).toHaveAttribute('tabindex', '0');
    await main.focus();
    await page.keyboard.press('PageDown');
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await overflowOf(page)).toEqual({ vertical: false, horizontal: false });
  });

  test('a 200 percent zoom equivalent keeps the console usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920x1080', 'This test sets its own viewports; run it once.');
    await page.setViewportSize({ width: 960, height: 540 });
    await openConsole(page, 'bots');
    expect(await overflowOf(page)).toEqual({ vertical: false, horizontal: false });
    await expect(page.locator('[data-analytics-refresh]')).toBeVisible();
    const main = page.locator('#admin-analytics-main');
    await expect.poll(() => main.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await main.focus();
    await page.keyboard.press('PageDown');
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  });
});
