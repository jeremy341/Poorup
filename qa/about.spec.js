import { test, expect } from '@playwright/test';

test.describe('About in the parlor shell', () => {
  test('opens in the current document with shared identity, audio, navigation and history', async ({ page }) => {
    await page.goto('/');
    await page.locator('#home-alias').fill('ABOUTGUEST');
    await page.evaluate(() => { window.__aboutDocument = 'same-document'; });
    await page.locator('#view-home .ticker a[href="/about"]').click();
    await expect(page.locator('#view-about')).toBeVisible();
    await expect(page).toHaveURL(/\/about$/);
    expect(await page.evaluate(() => window.__aboutDocument)).toBe('same-document');
    await expect(page.locator('#view-about [data-global-you-name]')).toContainText('ABOUTGUEST');
    await expect(page.locator('#view-about [data-global-nav] button')).toHaveCount(6);
    const sound = page.locator('#sound-toggle-btn');
    const initialSound = await sound.getAttribute('aria-pressed');
    await page.locator('#about-sound-toggle-btn').click();
    await expect(sound).not.toHaveAttribute('aria-pressed', initialSound);
    await expect(page.locator('#about-sound-toggle-btn')).toHaveAttribute('aria-pressed', await sound.getAttribute('aria-pressed'));
    const music = page.locator('#music-toggle-btn');
    const initialMusic = await music.getAttribute('aria-pressed');
    await page.locator('#about-music-toggle-btn').click();
    await expect(music).not.toHaveAttribute('aria-pressed', initialMusic);
    await expect(page.locator('#about-music-toggle-btn')).toHaveAttribute('aria-pressed', await music.getAttribute('aria-pressed'));
    await page.goBack();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#view-home .ticker a[href="/about"]')).toBeFocused();
    await page.goForward();
    await expect(page.locator('#view-about')).toBeVisible();
    await page.locator('[data-about-back]').click();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#home-alias')).toHaveValue('ABOUTGUEST');
  });

  test('loads the public route in the saved theme and keeps information internally scrollable', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('poorup.theme.id.v2', 'winter'));
    await page.goto('/about');
    await expect(page.locator('#view-about')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-theme-id', 'winter');
    await expect(page.getByRole('heading', { name: 'About Poorup', exact: true })).toBeVisible();
    await page.locator('#view-about a[href="#about-faq"]').click();
    const question = page.locator('#about-page-content details').filter({ has: page.locator('summary', { hasText: 'Do I need an account to play?' }) });
    await question.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(question.locator('p')).toBeVisible();
    await expect(question.locator('p')).toContainText('An account is optional');
    const geometry = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight, page: scrollY, content: document.querySelector('#about-page-content').scrollTop }));
    expect(geometry.x).toBeLessThanOrEqual(1);
    expect(geometry.y).toBeLessThanOrEqual(1);
    expect(geometry.page).toBe(0);
    expect(geometry.content).toBeGreaterThan(0);
  });

  test('preserves the previously open profile view when returning from About', async ({ page }) => {
    await page.goto('/');
    await page.locator('#home-profile-tab').click();
    await expect(page.locator('#view-profile')).toBeVisible();
    await page.locator('#view-profile [data-settings-toggle]').click();
    await page.locator('#view-profile [data-about-link]').click();
    await expect(page.locator('#view-about')).toBeVisible();
    await page.locator('[data-about-back]').click();
    await expect(page.locator('#view-profile')).toBeVisible();
  });

  test('public information and native FAQ remain readable without JavaScript', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${baseURL}/about`);
    await expect(page.locator('#view-about')).toBeVisible();
    await page.locator('#view-about a[href="#about-faq"]').click();
    const question = page.locator('#about-page-content details').filter({ has: page.locator('summary', { hasText: 'Is Poorup free to play?' }) });
    await question.locator('summary').click();
    await expect(question.locator('p')).toContainText('nothing to download');
    await expect(page.locator('#about-page-content a[href="/"]').first()).toHaveText('Play now');
    await expect(page.locator('#about-page-content a[href="/rules"]').first()).toBeAttached();
    await context.close();
  });

  test('follows all six themes through the canonical profile preferences', async ({ page }) => {
    await page.goto('/about');
    for (const id of ['spring', 'summer', 'autumn', 'winter', 'light', 'original']) {
      await page.locator('#view-about [data-global-profile-trigger]').click();
      await page.locator('#profile-tab-account').click();
      await page.locator(`[data-theme-choice-label="${id}"]`).click();
      await page.locator('#view-profile [data-settings-toggle]').click();
      await page.locator('#view-profile [data-about-link]').click();
      await expect(page.locator('#view-about')).toBeVisible();
      await expect(page.locator('#view-about')).toHaveAttribute('data-theme-id', id);
      await expect(page.locator('body')).toHaveAttribute('data-theme-id', id);
      await expect(page.locator('#about-page-content .about-question')).toHaveCount(8);
    }
  });

  test('keeps a real lobby connection and seat when opening and closing About', async ({ page }) => {
    await page.addInitScript(() => {
      let wrapped;
      Object.defineProperty(window, 'io', { configurable: true, get: () => wrapped, set: value => {
        wrapped = (...args) => { const socket = value(...args); window.__aboutSocket = socket; return socket; };
        Object.assign(wrapped, value);
      } });
    });
    await page.goto('/');
    await page.locator('#home-alias').fill('ABOUTSEAT');
    await page.locator('#open-create-btn').click();
    await page.locator('#rc-create-btn').click();
    await page.locator('#su-start').click();
    await expect.poll(() => page.evaluate(async () => (await import('/clientState.js')).state.phase)).toBe('lobby');
    const before = await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      return { roomCode: state.roomCode, clientId: state.clientId, phase: state.phase, seat: state.roomPlayerId, socket: window.__aboutSocket.id };
    });
    await page.locator('#panels-btn').click();
    await page.locator('#panel-menu [data-about-link]').click();
    await expect(page.locator('#view-about')).toBeVisible();
    const after = await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      return { roomCode: state.roomCode, clientId: state.clientId, phase: state.phase, seat: state.roomPlayerId, socket: window.__aboutSocket.id };
    });
    expect(after).toEqual(before);
    expect(await page.evaluate(() => window.__aboutSocket.connected)).toBe(true);
    await expect(page.locator('#view-about [data-global-connection-label]')).toHaveText('ONLINE');
    await page.locator('[data-about-back]').click();
    await expect(page.locator('#view-game')).toBeVisible();
    expect(await page.evaluate(async () => (await import('/clientState.js')).state.roomCode)).toBe(before.roomCode);
    await page.locator('#view-game').getByRole('button', { name: 'Back to home', exact: true }).click();
    await page.locator('#confirm-modal').getByRole('button', { name: 'LEAVE ROOM', exact: true }).click();
    await expect(page.locator('#view-home')).toBeVisible();
  });
});
