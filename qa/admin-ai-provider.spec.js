import { test, expect } from '@playwright/test';

const SESSION = { sessionToken: 'qa-admin-session', account: { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin' } };
const ISO = '2026-09-16T12:00:00.000Z';
const PROFILE = {
  id: 'openai-main', label: 'OpenAI main', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', protocol: 'auto', detectedProtocol: null,
  timeoutMs: 4000, maxDecisionsPerGame: 120, enabled: true, keyConfigured: true, source: 'profile', readOnly: false,
  lastTest: null,
};
const TESTED_PROFILE = { ...PROFILE, detectedProtocol: 'chat', lastTest: { ok: true, protocol: 'chat', latencyMs: 12, testedAt: ISO, reason: null } };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function seedAdmin(page, active = TESTED_PROFILE, { providersStatus = 200, audit = [], provider, noSocket = false } = {}) {
  const writes = [];
  // The badge reads live pushes from the page's own socket; a test that scripts them cuts the real one off.
  if (noSocket) await page.route('**/socket.io/**', route => route.abort());
  await page.route('**/admin/analytics/balance**', route => json(route, { success: true, schemaVersion: 1, generatedAt: ISO, filters: { range: 'hour', tab: 'overview' }, overview: { kpis: [] }, series: [], breakdowns: [], dataQuality: { fresh: true } }));
  await page.route('**/admin/ops/status', route => json(route, { success: true, generatedAt: ISO, health: { state: 'healthy', checks: [] }, maintenance: { mode: 'normal' } }));
  await page.route('**/admin/ops/bots**', route => json(route, { success: true, range: 'hour', generatedAt: ISO, totals: { botMatches: 3, decisions: null, fallbacks: null, fallbackRate: null, sampleSize: 3 }, providers: [{ provider: 'openai', botMode: 'ai', matches: 3, decisions: 40, fallbacks: 2, fallbackRate: 0.05, sampleSize: 3 }], provider: { state: 'healthy', activeLabel: 'OpenAI main', capPerBot: 120 } }));
  await page.route('**/admin/ops/audit', route => json(route, { success: true, entries: audit }));
  await page.route('**/admin/ai/providers**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      if (providersStatus !== 200) return json(route, { success: false, error: 'nope' }, providersStatus);
      return json(route, { success: true, active, providers: [TESTED_PROFILE], ...(provider ? { provider } : {}), storage: { persistent: false, encrypted: false } });
    }
    writes.push({ method: request.method(), path: url.pathname, body: request.postData() });
    if (url.pathname.endsWith('/test')) return json(route, { success: true, test: TESTED_PROFILE.lastTest, profile: TESTED_PROFILE });
    if (url.pathname.endsWith('/activate')) return json(route, { success: true, active: TESTED_PROFILE, status: { active: TESTED_PROFILE, provider: { state: 'healthy' } } });
    return json(route, { success: true, profile: PROFILE }, 201);
  });
  await page.goto('/admin/analytics');
  await expect(page.locator('#admin-analytics-main')).toBeVisible();
  await page.evaluate(async session => {
    const { state } = await import('/clientState.js');
    state.account = session;
  }, SESSION);
  await page.locator('[data-admin-section="bots"]').click();
  await expect(page.locator('#admin-section-bots')).toBeVisible();
  return writes;
}

test.describe('admin AI provider control', () => {
  test('new provider profiles default to a per-bot decision budget of 240', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920x1080', 'One deterministic control-form check is enough across the viewport matrix.');
    await seedAdmin(page, null);
    await page.locator('[data-admin-provider-new]').click();
    const budget = page.locator('[data-admin-provider-field="maxDecisionsPerGame"]');
    await expect(budget).toHaveValue('240');
    await expect(budget.locator('xpath=ancestor::label')).toContainText('BOT / GAME');
    await expect(page.locator('[data-admin-provider-field="label"]')).toBeFocused();
  });

  test('is the old provider layout inline: active provider, editor form, roster, with one usage line above and a log below', async ({ page }) => {
    await seedAdmin(page);
    await expect(page.locator('[data-admin-provider-active-label]')).toHaveText('OpenAI main');
    await expect(page.locator('[data-admin-provider-active-model]')).toContainText('gpt-test');
    await expect(page.locator('[data-admin-provider-active-format]')).toContainText('CHAT COMPLETIONS');
    // The form already shows the active profile: no drawer to open first.
    await expect(page.locator('[data-admin-provider-field="model"]')).toHaveValue('gpt-test');
    await expect(page.locator('[data-admin-provider-field="model"]')).toBeVisible();
    await expect(page.locator('[data-admin-provider-list]')).toContainText('OpenAI main');
    await expect(page.locator('[data-bots-line]')).toContainText('not recorded');
    await expect(page.locator('[data-bots-line] dt')).toHaveText(['BOT MATCHES', 'AI DECISIONS', 'FALLBACKS', 'FALLBACK RATE', 'SAMPLE', 'FALLBACKS SINCE START']);
    await expect(page.locator('.admin-table')).toHaveCount(0);
    for (const gone of ['[data-admin-provider-drawer]', '.admin-drawer', '[data-drawer-close]']) await expect(page.locator(gone)).toHaveCount(0);
    const pageText = await page.locator('#admin-section-bots').innerText();
    expect(pageText).not.toContain('secret-key');
    expect(await page.locator('[data-admin-provider-field="apiKey"]').inputValue()).toBe('');
  });

  test('the state badge follows the server health, not the profile test, and a roster read never erases a live push', async ({ page }) => {
    await seedAdmin(page, null, { noSocket: true });
    const badge = page.locator('[data-admin-provider-state]');
    await expect(badge).toHaveText('UNCONFIGURED');
    await expect(page.locator('[data-admin-provider-active-label]')).toHaveText('NO PROFILE ACTIVE');
    // A live push of a worse state survives the next roster read, which carries no health of its own.
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('poorup-bot-provider-status', { detail: { state: 'quota-exhausted', revision: 9, reason: 'credits-exhausted' } })));
    await expect(badge).toHaveText('CREDITS EXHAUSTED');
    await page.locator('[data-admin-section="rooms"]').click();
    await page.locator('[data-admin-section="bots"]').click();
    await expect(page.locator('[data-admin-provider-list]')).toContainText('OpenAI main');
    await expect(badge).toHaveText('CREDITS EXHAUSTED');
  });

  test('an active profile the server reports as unconfigured says it is not in use', async ({ page }) => {
    await seedAdmin(page, TESTED_PROFILE, { provider: { state: 'unconfigured' }, noSocket: true });
    await expect(page.locator('[data-admin-provider-active-label]')).toHaveText('OpenAI main');
    await expect(page.locator('[data-admin-provider-state]')).toHaveText('UNCONFIGURED');
    await expect(page.locator('[data-admin-provider-active-note]')).toContainText('not using it');
    // Once the server reports it healthy, the same profile reads READY.
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('poorup-bot-provider-status', { detail: { state: 'healthy', revision: 10, reason: null } })));
    await expect(page.locator('[data-admin-provider-state]')).toHaveText('READY');
    await expect(page.locator('[data-admin-provider-active-note]')).not.toContainText('not using it');
  });

  test('supports edit, test, and activation without exposing credentials', async ({ page }) => {
    const writes = await seedAdmin(page, null);
    await page.locator('[data-admin-provider-new]').click();
    await expect(page.locator('[data-admin-provider-field="model"]')).toHaveValue('');
    await page.locator('[data-admin-provider-action="edit"]').click();
    await expect(page.locator('[data-admin-provider-field="model"]')).toHaveValue('gpt-test');
    await expect(page.locator('[data-admin-provider-field="label"]')).toBeFocused();
    await page.locator('[data-admin-provider-action="test"]').click();
    await expect(page.locator('[data-admin-provider-test-status]')).toContainText('CHAT COMPLETIONS READY');
    await page.locator('[data-admin-provider-action="activate"]').click();
    await expect(page.locator('[data-admin-provider-test-status]')).toContainText('PROVIDER ACTIVE');
    expect(writes.map(write => write.path.split('/').pop())).toEqual(['test', 'activate']);
    expect(JSON.stringify(writes)).not.toMatch(/apiKey/);
  });

  test('saving a new profile posts the form once, clears the key field and keeps the key out of the page', async ({ page }) => {
    const writes = await seedAdmin(page, null);
    await page.locator('[data-admin-provider-new]').click();
    await page.locator('[data-admin-provider-field="label"]').fill('Test provider');
    await page.locator('[data-admin-provider-field="model"]').fill('m-1');
    await page.locator('[data-admin-provider-field="baseUrl"]').fill('https://example.test/v1');
    await page.locator('[data-admin-provider-field="apiKey"]').fill('sk-test-secret');
    await page.locator('[data-admin-provider-save]').click();
    await expect(page.locator('[data-admin-provider-test-status]')).toContainText('PROFILE SAVED');
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('POST');
    expect(JSON.parse(writes[0].body)).toMatchObject({ label: 'Test provider', model: 'm-1', apiKey: 'sk-test-secret' });
    expect(await page.locator('[data-admin-provider-field="apiKey"]').inputValue()).toBe('');
    expect(await page.locator('#view-admin-analytics').evaluate(element => element.innerHTML)).not.toContain('sk-test-secret');
  });

  test('a failed roster read shows an error with retry, and 403 shows the unauthorized state', async ({ page }) => {
    await seedAdmin(page, null, { providersStatus: 503 });
    const roster = page.locator('[data-section="roster"]');
    await expect(roster.locator('[data-section-state]')).toContainText('UNAVAILABLE');
    await expect(roster.locator('[data-section-retry]')).toBeVisible();
    await page.unroute('**/admin/ai/providers**');
    await page.route('**/admin/ai/providers**', route => json(route, { success: false, error: 'no' }, 403));
    await roster.locator('[data-section-retry]').click();
    await expect(roster.locator('[data-section-state]')).toContainText('ADMIN ACCESS REQUIRED');
    await expect(page.locator('[data-admin-provider-list]')).toBeEmpty();
  });

  test('the provider change log is a small list of provider actions with pseudonymous actors only, capped at ten', async ({ page }) => {
    const many = Array.from({ length: 14 }, (_, index) => ({ at: ISO, area: 'provider', action: 'test', target: `profile-${index}`, actor: 'admin-1a2b3c4d', outcome: 'ok' }));
    await seedAdmin(page, TESTED_PROFILE, { audit: [
      { at: ISO, area: 'provider', action: 'activate', target: 'OpenAI main', actor: 'admin-1a2b3c4d', outcome: 'ok' },
      { at: ISO, area: 'provider', action: 'test', target: 'OpenAI main', actor: 'someone@example.com', outcome: 'failed' },
      { at: ISO, area: 'release', action: 'mode', target: 'draining', actor: 'admin-1a2b3c4d', outcome: 'ok' },
    ] });
    const log = page.locator('[data-section="log-bots"]');
    await expect(log.locator('.admin-log-entry')).toHaveCount(2);
    await expect(log).toContainText('ACTIVATE · OpenAI main');
    await expect(log).toContainText('admin-1a2b3c4d');
    await expect(log).toContainText('FAILED');
    await expect(log).not.toContainText('example.com');
    await expect(log).not.toContainText('DRAINING');
    await page.unroute('**/admin/ops/audit');
    await page.route('**/admin/ops/audit', route => json(route, { success: true, entries: many }));
    await page.locator('[data-analytics-refresh]').click();
    await expect(log.locator('.admin-log-entry')).toHaveCount(10);
  });

  test('keeps Bots & AI keyboard navigable and page-contained', async ({ page }) => {
    await seedAdmin(page);
    const tabs = page.locator('[data-admin-section]');
    await tabs.nth(2).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(3)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.nth(2)).toBeFocused();
    await expect(page.locator('#admin-section-bots')).toBeVisible();
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth > document.documentElement.clientWidth, height: document.documentElement.scrollHeight > document.documentElement.clientHeight }));
    expect(overflow).toEqual({ width: false, height: false });
  });
});
