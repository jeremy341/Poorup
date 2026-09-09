import { test, expect } from '@playwright/test';

test.describe('Poorup ruleset and social surfaces', () => {
  test('home keeps the global navigation and audio controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#home-nav')).toBeVisible();
    await expect(page.locator('#sound-toggle-btn')).toHaveAttribute('aria-label', /sound effects/i);
    await expect(page.locator('#music-toggle-btn')).toHaveAttribute('aria-label', /parlor music/i);
  });

  test('home status signals are interactive and directory-backed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#home-signal-line [data-home-signal]')).toHaveCount(3);
    await expect(page.locator('[data-home-signal=entry]')).toHaveAttribute('aria-label', /profile|account/i);
    await expect(page.locator('[data-home-signal=lobbies] #home-signal-lobbies-value')).toContainText(/LOBBIES|SYNCING/);
    await page.locator('[data-home-signal=lobbies]').click();
    await expect(page.locator('#rooms-modal')).not.toHaveClass(/is-hidden/);
    await page.keyboard.press('Escape');
    await page.locator('[data-home-signal=sync]').click();
    await expect(page.locator('[data-home-signal=sync]')).toHaveAttribute('aria-label', /live room directory/i);
  });

  test('create table exposes preset and board choices', async ({ page }) => {
    await page.goto('/');
    await page.locator('#open-create-btn').click();
    await expect(page.locator('#rc-ruleset-preset')).toHaveValue('classic');
    await expect(page.locator('#rc-board-variant')).toHaveValue('standard-40');
    await page.locator('#rc-ruleset-preset').selectOption('after-hours');
    await page.locator('#rc-board-variant').selectOption('metro-52');
    await expect(page.locator('#rc-ruleset-preset')).toHaveValue('after-hours');
    await expect(page.locator('#rc-board-variant')).toHaveValue('metro-52');
    await page.keyboard.press('Escape');
    await expect(page.locator('#rooms-modal')).toHaveClass(/is-hidden/);
  });

  test('rules book is internally scrollable and names active systems', async ({ page }) => {
    await page.goto('/?rules=book');
    await page.locator('#home-rules-tab').click();
    await expect(page.locator('#rules-page-content')).toContainText('Poorup Rules');
    await expect(page.locator('#rules-book-page-scroll')).toBeVisible();
    await expect(page.locator('#rules-page-content')).toContainText('GLOBAL EVENTS');
  });

  test('rankings and profile collection stay in their independent pages', async ({ page }) => {
    await page.goto('/');
    await page.locator('#home-rankings-tab').click();
    await expect(page.locator('#rankings-page-content')).toBeVisible();
    await page.locator('#view-rankings [data-top-surface="social"]').click();
    await expect(page.locator('#social-page-content')).toBeVisible();
    await page.locator('#view-social [data-home-tab="profile"]').click();
    await expect(page.locator('#view-profile')).toBeVisible();
    await page.locator('#profile-tab-collection').click();
    await expect(page.locator('#profile-panel-collection')).toBeVisible();
  });

  test('rankings uses one readable stage with keyboard metric navigation', async ({ page }) => {
    await page.goto('/');
    await page.locator('#home-rankings-tab').click();
    const stage = page.locator('#rankings-page-content [data-ranking-stage]');
    await expect(stage).toBeVisible();
    await expect(stage.locator('[data-ranking-step="-1"]')).toHaveAttribute('aria-label', /previous/i);
    await expect(stage.locator('[data-ranking-step="1"]')).toHaveAttribute('aria-label', /next/i);
    const heading = stage.locator('h3');
    await expect(heading).toContainText('WINS');
    await stage.locator('[data-ranking-step="1"]').click();
    await expect(heading).toContainText(/GAMES|WIN RATE/);
    await stage.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(heading).toContainText('WINS');
  });

  test('bot status has a live-region anchor and social page is not a modal', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hud-bot-status')).toHaveAttribute('aria-live', 'polite');
    await page.locator('#home-social-tab').click();
    await expect(page.locator('#social-page-content')).toBeVisible();
    await expect(page.locator('#social-modal')).toHaveClass(/is-hidden/);
  });

  test('Metro 52 and advanced Market keep the Finance rail contract', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920', 'The full two-seat integration evidence is captured on the 1920px project.');
    const guest = await context.newPage();
    await page.goto('/');
    await page.locator('#home-alias').fill('ALPHA');
    await page.locator('#open-create-btn').click();
    await page.locator('#rc-vis-selector [data-vis="private"]').click();
    await page.locator('#rc-room-code').fill('METRO1');
    await page.locator('#rc-ruleset-preset').selectOption('after-hours');
    await page.locator('#rc-board-variant').selectOption('metro-52');
    await page.locator('#rc-create-btn').click();
    await page.locator('#su-start').click();
    await expect(page.locator('#lobby-settings-body')).toContainText('METRO 52');

    await guest.goto('/');
    await guest.locator('#home-alias').fill('BETA');
    await guest.locator('#open-join-btn').click();
    await guest.locator('#room-join').fill('METRO1');
    await guest.locator('#join-nickname').fill('BETA');
    await guest.locator('#join-room-submit').click();
    await guest.locator('#su-start').click();
    await expect(page.locator('#lobby-settings-body')).toContainText('BETA');
    const marketToggle = page.locator('#lobby-settings-body [data-setting="market"]');
    if (!await marketToggle.evaluate((node) => node.classList.contains('is-on'))) await marketToggle.click();
    const complexity = page.locator('#lobby-settings-body [data-setting="marketComplexity"]');
    await complexity.selectOption('derivatives');
    await expect(complexity).toHaveValue('derivatives');
    await expect(page.locator('#lobby-settings-body')).toContainText('DERIVATIVES');
    await page.locator('#lobby-start-btn').click();
    await expect(page.locator('#right-rail-game')).toBeVisible();
    await page.locator('#tab-market').click();
    await expect(page.locator('#rr-body')).toContainText('FICTIONAL EXCHANGE');
    await expect(page.locator('#rr-body')).toContainText('DERIVATIVES');
    await expect(page.locator('#rr-body [data-market-advanced="open-option"]')).toHaveCount(11);
    await guest.close();
  });
});
