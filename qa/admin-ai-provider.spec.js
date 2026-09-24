import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SESSION = { sessionToken: 'qa-admin-session', account: { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin' } };
const PROFILE = {
  id: 'openai-main', label: 'OpenAI main', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', protocol: 'auto', detectedProtocol: null,
  timeoutMs: 4000, maxDecisionsPerGame: 120, enabled: true, keyConfigured: true, source: 'profile', readOnly: false,
  lastTest: null,
};
const TESTED_PROFILE = { ...PROFILE, detectedProtocol: 'chat', lastTest: { ok: true, protocol: 'chat', latencyMs: 12, testedAt: '2026-09-16T12:00:00.000Z', reason: null } };

async function seedAdmin(page, active = TESTED_PROFILE) {
  await page.route('**/admin/analytics/balance**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, schemaVersion: 1, generatedAt: '2026-09-16T12:00:00.000Z', filters: { range: 'hour', tab: 'overview' }, overview: { kpis: [] }, series: [], breakdowns: [], dataQuality: { fresh: true } }) }));
  await page.route('**/admin/ai/providers**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, active, providers: [TESTED_PROFILE], storage: { persistent: false, encrypted: false } }) });
    }
    if (url.pathname.endsWith('/test')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, test: TESTED_PROFILE.lastTest, profile: TESTED_PROFILE }) });
    }
    if (url.pathname.endsWith('/activate')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, active: TESTED_PROFILE, status: { active: TESTED_PROFILE, provider: { state: 'healthy' } } }) });
    }
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, profile: PROFILE }) });
  });
  await page.goto('/admin/analytics');
  await expect(page.locator('#admin-analytics-main')).toBeVisible();
  await page.evaluate(async session => {
    const { state } = await import('/clientState.js');
    state.account = session;
  }, SESSION);
  await page.locator('[data-admin-console-tab="provider"]').click();
  await expect(page.locator('[data-admin-provider-workspace]')).toBeVisible();
}

test.describe('admin AI provider control', () => {
  test('renders a redacted provider roster and keeps the key out of the DOM', async ({ page }, testInfo) => {
    await seedAdmin(page);
    await expect(page.locator('[data-admin-provider-list]')).toContainText('OpenAI main');
    await expect(page.locator('[data-admin-provider-active-model]')).toContainText('gpt-test');
    await expect(page.locator('[data-admin-provider-active-format]')).toContainText('CHAT COMPLETIONS');
    const pageText = await page.locator('#admin-provider-workspace').innerText();
    expect(pageText).not.toContain('secret-key');
    expect(await page.locator('[data-admin-provider-field="apiKey"]').inputValue()).toBe('');
    if (testInfo.project.name === 'desktop-1920') {
      const artifactRoot = path.resolve('qa-artifacts/admin-ai-provider-1920');
      await fs.promises.mkdir(artifactRoot, { recursive: true });
      await page.screenshot({ path: path.join(artifactRoot, 'provider-roster.png'), animations: 'disabled' });
    }
  });

  test('supports edit, test, and activation without exposing credentials', async ({ page }) => {
    await seedAdmin(page, null);
    await page.locator('[data-admin-provider-action="edit"]').click();
    await expect(page.locator('[data-admin-provider-field="model"]')).toHaveValue('gpt-test');
    await page.locator('[data-admin-provider-action="test"]').click();
    await expect(page.locator('[data-admin-provider-test-status]')).toContainText('CHAT COMPLETIONS READY');
    await page.locator('[data-admin-provider-action="activate"]').click();
    await expect(page.locator('[data-admin-provider-test-status]')).toContainText('PROVIDER ACTIVE');
  });

  test('keeps the provider surface keyboard navigable and page-contained', async ({ page }) => {
    await seedAdmin(page);
    const tabs = page.locator('[data-admin-console-tab]');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-admin-provider-workspace]')).toBeVisible();
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth > document.documentElement.clientWidth, height: document.documentElement.scrollHeight > document.documentElement.clientHeight }));
    expect(overflow.width).toBe(false);
  });
});
