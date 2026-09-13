import { test, expect } from '@playwright/test';

test.describe('Poorup ruleset and social surfaces', () => {
  test('home keeps the global navigation and audio controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#home-nav')).toBeVisible();
    await expect(page.locator('#sound-toggle-btn')).toHaveAttribute('aria-label', /sound effects/i);
    await expect(page.locator('#music-toggle-btn')).toHaveAttribute('aria-label', /parlor music/i);
  });

  test('game rail keeps one history surface and three intent tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tab-holdings')).toHaveCount(1);
    await expect(page.locator('#tab-deals')).toHaveCount(1);
    await expect(page.locator('#tab-activity')).toHaveCount(1);
    await expect(page.locator('#tab-log')).toHaveCount(0);
    await expect(page.locator('#hud-cash-action')).toHaveAttribute('aria-controls', 'wallet-modal');
    await expect(page.locator('#panels-btn')).toHaveAttribute('aria-controls', 'panel-menu');
    await expect(page.locator('#focus-btn')).toHaveCount(0);
    await expect(page.locator('#panel-menu')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#market-modal')).toHaveClass(/is-hidden/);
    await expect(page.locator('#casino-modal')).toHaveClass(/is-hidden/);
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

  test('create table keeps board selection in the host lobby', async ({ page }) => {
    await page.goto('/');
    await page.locator('#open-create-btn').click();
    await expect(page.locator('#rc-ruleset-preset')).toHaveValue('classic');
    await expect(page.locator('#rc-board-variant')).toHaveCount(0);
    await page.locator('#rc-ruleset-preset').selectOption('after-hours');
    await expect(page.locator('#rc-ruleset-preset')).toHaveValue('after-hours');
    await page.keyboard.press('Escape');
    await expect(page.locator('#rooms-modal')).toHaveClass(/is-hidden/);
  });

  test('rules book is internally scrollable and names active systems', async ({ page }) => {
    await page.goto('/?rules=book');
    await expect(page.locator('#view-rules')).toBeVisible();
    if (await page.locator('#home-rules-tab').isVisible()) await page.locator('#home-rules-tab').click();
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
    await expect(page.locator('#profile-panel-designs .profile-editor-actions')).toHaveCount(0);
    await expect(page.locator('#profile-panel-designs #pl-save-btn')).toHaveCount(1);
    await expect(page.locator('#profile-panel-designs #profile-cancel-btn')).toBeVisible();
    await page.locator('#profile-tab-collection').click();
    await expect(page.locator('#profile-panel-collection')).toBeVisible();
  });

  test('rankings uses one readable stage with keyboard metric navigation', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.locator('#home-rankings-tab').click();
    const stage = page.locator('#rankings-page-content [data-ranking-stage]');
    await expect(stage).toBeVisible();
    await expect(stage.locator('[data-ranking-step="-1"]')).toHaveAttribute('aria-label', /previous/i);
    await expect(stage.locator('[data-ranking-step="1"]')).toHaveAttribute('aria-label', /next/i);
    await expect(page.locator('#rankings-page-content .rankings-context-reading')).toHaveCount(0);
    const inputBox = await page.locator('#rankings-page-content [data-ranking-search-input]').boundingBox();
    const findBox = await page.locator('#rankings-page-content .rankings-search-submit').boundingBox();
    expect(inputBox).not.toBeNull();
    expect(findBox).not.toBeNull();
    expect(Math.abs(inputBox.height - findBox.height)).toBeLessThan(1);
    if (testInfo.project.name === 'desktop-1920') {
      const stageBox = await stage.boundingBox();
      const seasonBox = await page.locator('#rankings-page-content .rankings-context').boundingBox();
      expect(stageBox).not.toBeNull();
      expect(seasonBox).not.toBeNull();
      expect(Math.abs(stageBox.height - seasonBox.height)).toBeLessThan(1);
    }
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

  test('guest social surface is clearly gated and underlying content is inert', async ({ page }) => {
    await page.goto('/');
    await page.locator('#home-social-tab').click();
    await expect(page.locator('[data-social-guest-gate]')).toBeVisible();
    await expect(page.locator('[data-social-guest-gate]')).toContainText('YOU DO NOT HAVE AN ACCOUNT');
    await expect(page.locator('[data-social-guest-gate] [data-social-action="account"]')).toBeVisible();
    await expect(page.locator('[data-social-guest-content]')).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => page.locator('[data-social-guest-content]').evaluate(el => el.inert)).toBe(true);
  });

  test('1920 geometry keeps social search aligned and public lobby authoritative', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920', 'desktop geometry contract');
    await page.goto('/');
    await page.locator('#home-alias').fill('DESKTOPHOST');
    await page.locator('#home-social-tab').click();
    const searchGeometry = await page.evaluate(() => {
      const input = document.querySelector('#social-page-search-input');
      const button = document.querySelector('#social-page-search-form .social-search-submit');
      if (!input || !button) return null;
      const a = input.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      return { inputHeight: a.height, buttonHeight: b.height, topDelta: Math.abs(a.top - b.top), scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth };
    });
    expect(searchGeometry).not.toBeNull();
    expect(searchGeometry.inputHeight).toBe(44);
    expect(searchGeometry.buttonHeight).toBe(44);
    expect(searchGeometry.topDelta).toBeLessThanOrEqual(1);
    expect(searchGeometry.scrollWidth).toBe(searchGeometry.viewport);

    await page.locator('#view-social [data-home-tab="play"]').click();
    await page.locator('#open-create-btn').click();
    await page.locator('#rc-create-btn').click();
    await page.locator('#su-start').click();
    await expect(page.locator('#lobby-settings-body .lobby-player-row')).toHaveCount(1);
    await expect(page.locator('#lobby-settings-body .lobby-host-badge')).toHaveCount(1);
    await expect(page.locator('#lobby-settings-body [data-setting="boardVariant"]')).toHaveValue('standard-40');
    await expect(page.locator('#lobby-settings-body .lobby-player-row')).not.toContainText('BOT');
    await expect(page.locator('#focus-btn')).toHaveCount(0);
    const shell = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, width: window.innerWidth, height: window.innerHeight }));
    expect(shell).toEqual({ scrollWidth: shell.width, scrollHeight: shell.height, width: 1920, height: 1080 });
  });

  test('mobile keeps the primary social, rules, and achievement content reachable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'This geometry contract targets the mobile layout.');
    await page.goto('/');
    await page.locator('#home-rankings-tab').click();
    await expect.poll(() => page.locator('#rankings-page-content .rankings-stage').evaluate(el => el.clientHeight)).toBeGreaterThan(400);
    await expect.poll(() => page.locator('#rankings-page-content .ranking-list').evaluate(el => el.clientHeight)).toBeGreaterThan(180);
    await page.locator('#view-rankings [data-top-surface="social"]').click();
    await expect.poll(() => page.locator('#social-page-content .social-feed').evaluate(el => el.clientHeight)).toBeGreaterThan(240);
    await page.locator('#view-social [data-top-surface="rules"]').click();
    await expect.poll(() => page.locator('#rules-page-content .rules-book-page').evaluate(el => el.clientHeight)).toBeGreaterThan(380);
    await page.locator('#view-rules [data-home-tab="profile"]').click();
    await page.locator('#profile-tab-achievements').click();
    await expect.poll(() => page.locator('#profile-panel-achievements .achievements-grid').evaluate(el => el.clientHeight)).toBeGreaterThan(180);
  });

  test('Metro 52 and advanced Market keep the Activity rail contract', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920', 'The full two-seat integration evidence is captured on the 1920px project.');
    const guest = await context.newPage();
    await page.goto('/');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#home-alias').fill('ALPHA');
    await page.locator('#open-create-btn').click();
    await page.locator('#rc-vis-selector [data-vis="private"]').click();
    await page.locator('#rc-room-code').fill('METRO1');
    await page.locator('#rc-ruleset-preset').selectOption('after-hours');
    await page.locator('#rc-create-btn').click();
    await page.locator('#su-start').click();
    await page.locator('#lobby-settings-body [data-setting="boardVariant"]').selectOption('metro-52');
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
    await page.locator('#hud-cash-action').click();
    await expect(page.locator('#wallet-modal')).not.toHaveClass(/is-hidden/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#wallet-modal')).toHaveClass(/is-hidden/);
    await page.locator('#log-toggle-btn').click();
    await expect(page.locator('#log-drawer')).toHaveClass(/is-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#log-drawer')).not.toHaveClass(/is-open/);
    await page.locator('#tab-activity').click();
    await expect(page.locator('#rr-body')).toContainText('FICTIONAL EXCHANGE');
    await expect(page.locator('#rr-body')).toContainText('DERIVATIVES');
    await page.locator('#rr-body [data-market-desk]').click();
    await expect(page.locator('#market-modal')).not.toHaveClass(/is-hidden/);
    await expect(page.locator('#market-card [data-market-advanced="open-option"]')).toHaveCount(11);
    await page.locator('#market-modal-close').click();
    await page.locator('#rr-body #activity-mode-casino').click();
    await page.locator('#rr-body [data-casino-desk]').click();
    await page.locator('#casino-card [name="casino-desk-stake"]').fill('1');
    await page.locator('#casino-card [data-casino-desk-form] button[type="submit"]').click();
    await expect(page.locator('#casino-card [data-casino-reel]')).toHaveCount(1);
    await expect(page.locator('#casino-card [data-casino-skip]')).toBeVisible();
    await expect(page.locator('#casino-card [data-casino-reel-result]')).toContainText(/Result committed|SETTLED/);
    await page.locator('#casino-card [data-casino-skip]').click();
    await expect(page.locator('#casino-card [data-casino-reel]')).toHaveAttribute('data-reel-state', 'skipped');
    const pointerBox = await page.locator('#casino-card .casino-reel-pointer').boundingBox();
    const targetBox = await page.locator('#casino-card .casino-reel-card.is-target').boundingBox();
    expect(pointerBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    expect(Math.abs((pointerBox.x + pointerBox.width / 2) - (targetBox.x + targetBox.width / 2))).toBeLessThan(3);
    if (process.env.POORUP_CAPTURE_VISUALS) {
      await page.screenshot({ path: 'qa-artifacts/casino-reel-1920.png', fullPage: true });
    }
    await guest.close();
  });
});

test.describe('Landscape iPad desk contract', () => {
  function skipNonTablet(testInfo) {
    test.skip(!['ipad-mini-landscape', 'ipad-pro-11-landscape'].includes(testInfo.project.name), 'Landscape iPad contract only.');
  }

  test('home, rankings, and social keep readable horizontal panels', async ({ page }, testInfo) => {
    skipNonTablet(testInfo);
    const viewport = page.viewportSize();
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => ({ width: document.body.clientWidth, scrollWidth: document.body.scrollWidth, height: document.body.clientHeight, scrollHeight: document.body.scrollHeight }))).toEqual({ width: viewport.width, scrollWidth: viewport.width, height: viewport.height, scrollHeight: viewport.height });

    await page.locator('#home-rankings-tab').click();
    await expect(page.locator('#rankings-page-content [data-ranking-stage]')).toBeVisible();
    await expect.poll(() => page.locator('#rankings-page-content .rankings-stage').evaluate(el => el.clientHeight)).toBeGreaterThan(240);
    await expect.poll(() => page.locator('#rankings-page-content .ranking-list').evaluate(el => el.clientHeight)).toBeGreaterThan(100);
    await expect.poll(() => page.locator('#rankings-page-content .rankings-context').evaluate(el => el.clientHeight)).toBeGreaterThan(240);

    await page.locator('#view-rankings [data-top-surface="social"]').click();
    await expect(page.locator('#social-page-content .social-feed')).toBeVisible();
    await expect.poll(() => page.locator('#social-page-content .social-feed').evaluate(el => el.clientHeight)).toBeGreaterThan(240);
    await expect.poll(() => page.locator('#social-page-content .social-surface-body').evaluate(el => el.clientHeight)).toBeGreaterThan(120);
    await expect.poll(() => page.locator('#social-page-content .social-context').evaluate(el => el.clientHeight)).toBeGreaterThan(180);
  });

  test('destination focus and touch targets remain intentional', async ({ page }, testInfo) => {
    skipNonTablet(testInfo);
    await page.goto('/');
    await page.locator('#home-profile-tab').click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('profile-hero-name');
    await page.locator('#view-profile [data-top-surface="rankings"]').click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches('[data-ranking-stage]'))).toBe(true);
    await page.locator('#view-rankings [data-top-surface="social"]').click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.matches('.social-feed, [data-social-guest-gate]'))).toBe(true);

    await page.locator('#view-social [data-home-tab="play"]').click();
    await page.locator('#open-create-btn').click();
    const closeSize = await page.locator('#rooms-close').evaluate(el => { const box = el.getBoundingClientRect(); return { width: box.width, height: box.height }; });
    expect(closeSize.width).toBeGreaterThanOrEqual(24);
    expect(closeSize.height).toBeGreaterThanOrEqual(24);
    await page.keyboard.press('Escape');
  });

  test('live game uses a board-first desk without page scrolling', async ({ page, context }, testInfo) => {
    skipNonTablet(testInfo);
    const guest = await context.newPage();
    const code = testInfo.project.name === 'ipad-mini-landscape' ? 'IPADM2' : 'IPADP2';
    await page.goto('/');
    await page.locator('#home-alias').fill('ALPHA');
    await page.locator('#open-create-btn').click();
    await page.locator('#rc-vis-selector [data-vis="private"]').click();
    await page.locator('#rc-room-code').fill(code);
    await page.locator('#rc-create-btn').click();
    await page.locator('#su-start').click();

    await guest.goto('/');
    await guest.locator('#home-alias').fill('BETA');
    await guest.locator('#open-join-btn').click();
    await guest.locator('#room-join').fill(code);
    await guest.locator('#join-nickname').fill('BETA');
    await guest.locator('#join-room-submit').click();
    await guest.locator('#su-start').click();
    await page.locator('#lobby-start-btn').click();
    await expect(page.locator('#view-game')).toBeVisible();

    const geometry = await page.evaluate(() => {
      const box = selector => { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      return { viewport: { width: innerWidth, height: innerHeight }, body: { clientWidth: document.body.clientWidth, clientHeight: document.body.clientHeight, scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight }, board: box('#board-frame'), hud: box('#hud'), roll: box('#roll-btn'), rightRail: box('#right-rail-game') };
    });
    expect(geometry.body.scrollWidth - geometry.body.clientWidth).toBeLessThanOrEqual(2);
    expect(geometry.body.scrollHeight - geometry.body.clientHeight).toBeLessThanOrEqual(2);
    for (const key of ['board', 'hud', 'roll', 'rightRail']) {
      expect(geometry[key]).not.toBeNull();
      expect(geometry[key].y).toBeGreaterThanOrEqual(0);
      expect(geometry[key].bottom).toBeLessThanOrEqual(geometry.viewport.height + 2);
    }

    await page.locator('#panels-btn').click();
    const checkboxSizes = await page.locator('#panel-menu [data-panel-toggle]').evaluateAll(nodes => nodes.map(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; }));
    expect(checkboxSizes.every(size => size.width >= 24 && size.height >= 24)).toBe(true);
    await guest.close();
  });
});
