/* global document */
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

// Registers a throwaway account through the account modal and waits until the server session matches it.
async function registerDisposableAccount(page) {
  await page.goto('/');
  await page.evaluate(async () => { (await import('/clientAccountIdentity.js')).openAccountModal('register'); });
  const suffix = Math.random().toString(36).slice(2, 10), username = `pt${suffix}`, password = `Qa-${suffix}A!9`;
  await page.locator('#account-username-input').fill(username);
  await page.locator('#account-password-input').fill(password);
  await page.locator('#account-display-input').fill('PATROL QA').catch(() => {});
  await expect(page.locator('#account-username-status')).toContainText('available', { timeout: 15000 });
  await page.locator('#account-form').evaluate(form => form.requestSubmit());
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const response = await fetch('/account/session', { credentials: 'include' });
    const session = await response.json(); return Boolean(response.ok && session.success && session.account?.id === state.account?.account?.id);
  }), { timeout: 15000 }).toBe(true);
  await expect(page.locator('#account-modal')).toBeHidden();
}

// Taps the helicopter, helicopter, and drone targets in turn; each tap must raise the score and keep all hearts.
async function tagTargets(page) {
  for (const [kind, score] of [['helicopter', '125'], ['helicopter', '250'], ['drone', '335']]) {
    const target = page.locator(`.night-target-${kind}:not([data-hit])`).first();
    await expect(target).toBeVisible({ timeout: 10000 }); await expect(target).toHaveCSS('pointer-events', 'auto', { timeout: 10000 });
    await target.dispatchEvent('pointerdown'); await expect(page.locator('#home-patrol-score')).toHaveText(score, { timeout: 10000 });
    await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
  }
}

async function saveDetailScreenshot(page, info) {
  await captureScreenshot(page, info, { group: 'patrol', surfaceId: 'signed-in-after-drone', label: 'Real signed-in run after tagging a drone' });
  const file = path.join(process.env.POORUP_VISUAL_CAPTURE_DIR, info.project.name, 'patrol', 'signed-in-after-drone.detail.png');
  await mkdir(path.dirname(file), { recursive: true }); await page.locator('#night-shift').screenshot({ path: file, animations: 'disabled' });
}

test('a disposable signed-in player tags real server targets and saves the run on exit', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1920x1080', 'One isolated account exercises the live Socket.IO path');
  await registerDisposableAccount(page);
  await page.locator('#home-night-shift-start').click(); await expect(page.locator('#night-shift')).toBeVisible();
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
  await tagTargets(page);
  if (process.env.POORUP_VISUAL_CAPTURE_DIR) await saveDetailScreenshot(page, info);
  await page.locator('#night-exit').click(); await expect(page.locator('#night-shift')).toBeHidden();
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/clientState.js'); return Number(state.account?.account?.stats?.patrolVerifiedBest || 0);
  }), { timeout: 10000 }).toBe(335);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
});
