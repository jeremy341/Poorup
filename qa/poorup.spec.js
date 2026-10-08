/* global process, document, window, innerWidth, innerHeight, getComputedStyle */
import { test, expect } from '@playwright/test';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

test.describe('Poorup ruleset and social surfaces', () => {
  test('home keeps the global navigation and audio controls @ui-smoke', async ({ page }) => {
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

  test('create table keeps board selection in the host lobby @ui-smoke', async ({ page }) => {
    await page.goto('/');
    await page.locator('#home-alias').fill('ALPHA');
    await page.locator('#open-create-btn').click();
    await expect(page.locator('#rc-ruleset-preset')).toHaveCount(0);
    await expect(page.locator('#rc-board-variant')).toHaveCount(0);
    await page.locator('#rc-create-btn').click();
    await page.locator('#su-start').click();
    const boardVariant = page.locator('#lobby-settings-body [data-setting="boardVariant"]');
    await expect(boardVariant).toHaveValue('standard-40');
    await boardVariant.selectOption('metro-52');
    await expect(boardVariant).toHaveValue('metro-52');
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

  test('rankings, social, and profile designs stay in their independent pages', async ({ page }) => {
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
    await expect(page.locator('#profile-tab-collection, #profile-panel-collection')).toHaveCount(0);
    await page.locator('#profile-tab-designs').click();
    await expect(page.locator('#profile-panel-designs')).toBeVisible();
  });

  test('rankings uses one readable stage with keyboard metric navigation', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.locator('#home-rankings-tab').click();
    const stage = page.locator('#rankings-page-content [data-ranking-stage]');
    await expect(stage).toBeVisible();
    await expect(stage.locator('[data-ranking-step="-1"]')).toHaveAttribute('aria-label', /previous/i);
    await expect(stage.locator('[data-ranking-step="1"]')).toHaveAttribute('aria-label', /next/i);
    await expect(page.locator('#rankings-page-content .rankings-context-reading')).toHaveCount(0);
    const searchToggle = page.locator('#rankings-page-content [data-ranking-search-toggle]');
    const isTablet = testInfo.project.name.startsWith('ipad-');
    if (isTablet) {
      await expect(searchToggle).toBeVisible();
      await expect(page.locator('#rankings-page-content [data-ranking-search-input]')).toBeHidden();
      await searchToggle.click();
    } else {
      await expect(searchToggle).toBeHidden();
    }
    const inputBox = await page.locator('#rankings-page-content [data-ranking-search-input]').boundingBox();
    const findBox = await page.locator('#rankings-page-content .rankings-search-submit').boundingBox();
    expect(inputBox).not.toBeNull();
    expect(findBox).not.toBeNull();
    expect(Math.abs(inputBox.height - findBox.height)).toBeLessThan(1);
    await expect(page.locator('#rankings-page-content .rankings-context')).toHaveCount(0);
    if (testInfo.project.name === 'desktop-1920x1080') {
      const stageBox = await stage.boundingBox();
      expect(stageBox).not.toBeNull();
    }
    const heading = stage.locator('h3');
    await expect(heading).toContainText('WINS');
    await stage.locator('[data-ranking-step="1"]').click();
    await expect(heading).toContainText(/GAMES|WIN RATE/);
    await stage.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(heading).toContainText('WINS');
  });

  test('current turn is named accessibly and social page is not a modal', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      const [{ state }, { renderHud }] = await Promise.all([import('/clientState.js'), import('/clientHudRender.js')]);
      state.phase = 'playing';
      state.turnIndex = 0;
      state.turnStage = 'roll';
      state.players = [{ id: 'p1', clientId: state.clientId, name: 'TURN PLAYER', cash: 500, textColor: '#e8d3ab', online: true }];
      state.jail = {};
      state.dice = [1, 2];
      state.busy = false;
      state.presentationBusy = false;
      state.pendingBuyTile = null;
      state.auction = null;
      state.sponsorship = null;
      renderHud();
    });
    await expect(page.locator('#hud-name')).toHaveText('TURN PLAYER');
    await expect(page.locator('#hud-turn-label')).toHaveAttribute('aria-label', 'Current turn: TURN PLAYER');
    await expect(page.locator('#hud-stage, #hud-bot-status, #hud-note')).toHaveCount(0);
    await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      state.phase = 'home';
    });
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
    test.skip(testInfo.project.name !== 'desktop-1920x1080', 'desktop geometry contract');
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
    test.skip(testInfo.project.name !== 'desktop-1920x1080', 'The full two-seat integration evidence is captured on the 1920px project.');
    const guest = await context.newPage();
    await page.goto('/');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#home-alias').fill('ALPHA');
    await page.locator('#open-create-btn').click();
    await page.locator('#rc-vis-selector [data-vis="private"]').click();
    await page.locator('#rc-room-code').fill('METRO1');
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
    const casinoToggle = page.locator('#lobby-settings-body [data-setting="casino"]');
    if (!await casinoToggle.evaluate((node) => node.classList.contains('is-on'))) await casinoToggle.click();
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
    await expect(page.locator('#market-card .market-derivatives-unavailable')).toHaveCount(1);
    await page.locator('#market-card .market-advanced-settings > summary').click();
    await expect(page.locator('#market-card .market-derivatives-unavailable')).toBeVisible();
    await expect(page.locator('#market-card .market-derivatives-unavailable')).toContainText('SERVER PRICING POLICY NOT CONFIGURED');
    await expect(page.locator('#market-card [data-market-advanced="open-option"]')).toHaveCount(0);
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
    const iPadProfiles = ['ipad-944x656', 'ipad-1024x768', 'ipad-1080x810', 'ipad-1180x820', 'ipad-1194x834', 'ipad-1366x1024'];
    test.skip(!process.env.POORUP_VISUAL_CAPTURE_DIR && !iPadProfiles.includes(testInfo.project.name), 'Landscape iPad contract only outside the visual capture matrix.');
  }

  function assertHeaderHeight(geometry, surfaceId, isIpad) {
    if (isIpad) {
      expect(Math.abs(geometry.header.height - 64), `${surfaceId} iPad header height`).toBeLessThanOrEqual(1);
      return;
    }
    expect(geometry.header.height, `${surfaceId} wide landscape header minimum`).toBeGreaterThanOrEqual(56);
    expect(geometry.header.height, `${surfaceId} wide landscape header maximum`).toBeLessThanOrEqual(80);
  }

  function internalScrollSelector(surfaceId) {
    if (surfaceId === 'rules') return '#rules-page-content .rules-book-page-scroll';
    if (surfaceId === 'profile') return '#profile-main';
    return null;
  }

  async function assertInternalScroll(page, surfaceId) {
    const selector = internalScrollSelector(surfaceId);
    if (!selector) return;

    const scroll = await page.locator(selector).evaluate(element => {
      const maxScroll = element.scrollHeight - element.clientHeight;
      element.scrollTop = maxScroll;
      return { maxScroll, scrollTop: element.scrollTop };
    });
    if (scroll.maxScroll > 0) {
      expect(scroll.scrollTop, `${surfaceId} scrolls internally when content overflows`).toBeGreaterThan(0);
    } else {
      expect(scroll.scrollTop, `${surfaceId} stays at rest when content fits`).toBe(0);
    }
    expect(await page.evaluate(() => window.scrollY), `${surfaceId} page stays at top`).toBe(0);
    const rootScroll = await page.evaluate(() => ({
      documentHeight: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      bodyHeight: document.body.scrollHeight - document.body.clientHeight,
    }));
    expect(rootScroll.documentHeight, `${surfaceId} document remains fixed`).toBeLessThanOrEqual(1);
    expect(rootScroll.bodyHeight, `${surfaceId} body remains fixed`).toBeLessThanOrEqual(1);
  }

  test('shared header and first content stay fixed and in view across top-level pages @ui-smoke', async ({ page }, testInfo) => {
    skipNonTablet(testInfo);
    await page.goto('/');

    const surfaces = [
      { id: 'home', header: '#view-home .hdr', brand: '#view-home .hdr-brand', nav: '#view-home .home-nav', first: '#view-home .wm-hero' },
      { id: 'rankings', header: '#view-rankings .hdr', brand: '#view-rankings .hdr-brand', nav: '#view-rankings .home-nav', first: '#rankings-page-content .rankings-hero' },
      { id: 'social', header: '#view-social .hdr', brand: '#view-social .hdr-brand', nav: '#view-social .home-nav', first: '#social-page-content .social-hero' },
      { id: 'rules', header: '#view-rules .hdr', brand: '#view-rules .hdr-brand', nav: '#view-rules .home-nav', first: '#rules-page-content .rules-intro' },
      { id: 'profile', header: '#view-profile .hdr', brand: '#view-profile .hdr-brand', nav: '#view-profile .home-nav', first: '#profile-hero-name' },
    ];

    const snapshots = [];
    for (let index = 0; index < surfaces.length; index += 1) {
      const surface = surfaces[index];
      if (index > 0) {
        const previous = surfaces[index - 1];
        const route = surface.id === 'rankings'
          ? '#home-rankings-tab'
          : surface.id === 'profile'
            ? `#view-${previous.id} [data-home-tab="profile"]`
            : `#view-${previous.id} [data-top-surface="${surface.id}"]`;
        await page.locator(route).click();
      }
      const geometry = await page.evaluate(({ headerSelector, brandSelector, navSelector, firstSelector }) => {
        const rect = selector => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        return {
          header: rect(headerSelector),
          brand: rect(brandSelector),
          nav: rect(navSelector),
          first: rect(firstSelector),
          viewport: { width: innerWidth, height: innerHeight },
          document: {
            xOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            yOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
            bodyXOverflow: document.body.scrollWidth - document.body.clientWidth,
            bodyYOverflow: document.body.scrollHeight - document.body.clientHeight,
          },
          scrollY: window.scrollY,
        };
      }, { headerSelector: surface.header, brandSelector: surface.brand, navSelector: surface.nav, firstSelector: surface.first });

      expect(geometry.header, `${surface.id} header`).not.toBeNull();
      expect(geometry.nav, `${surface.id} nav`).not.toBeNull();
      expect(geometry.first, `${surface.id} first content`).not.toBeNull();
      expect(geometry.header.y, `${surface.id} header top`).toBeLessThanOrEqual(1);
      const isIpad = testInfo.project.name.startsWith('ipad-') && geometry.viewport.width < 1280;
      assertHeaderHeight(geometry, surface.id, isIpad);
      expect(geometry.first.top ?? geometry.first.y, `${surface.id} content starts below header`).toBeGreaterThanOrEqual(geometry.header.bottom - 1);
      expect(geometry.first.y, `${surface.id} first content begins in viewport`).toBeLessThan(geometry.viewport.height);
      expect(geometry.first.bottom, `${surface.id} first content bottom`).toBeLessThanOrEqual(geometry.viewport.height + 1);
      expect(geometry.document.xOverflow, `${surface.id} document horizontal overflow`).toBeLessThanOrEqual(1);
      expect(geometry.document.yOverflow, `${surface.id} document vertical overflow`).toBeLessThanOrEqual(1);
      expect(geometry.document.bodyXOverflow, `${surface.id} body horizontal overflow`).toBeLessThanOrEqual(1);
      expect(geometry.document.bodyYOverflow, `${surface.id} body vertical overflow`).toBeLessThanOrEqual(1);
      expect(geometry.scrollY, `${surface.id} window scroll position`).toBe(0);
      snapshots.push({ id: surface.id, header: geometry.header, brand: geometry.brand, nav: geometry.nav });
      if (process.env.POORUP_VISUAL_CAPTURE_DIR || process.env.POORUP_CAPTURE_VISUALS) {
        await captureScreenshot(page, testInfo, {
          group: 'pages',
          surfaceId: surface.id,
          label: `${surface.id} top-level page`,
          fallbackPath: testInfo.outputPath(`ipad-${surface.id}.png`),
        });
      }
      await assertInternalScroll(page, surface.id);
    }

    const baseline = snapshots[0];
    for (const snapshot of snapshots.slice(1)) {
      expect(Math.abs(snapshot.header.x - baseline.header.x), `${snapshot.id} header x`).toBeLessThanOrEqual(1);
      expect(Math.abs(snapshot.header.y - baseline.header.y), `${snapshot.id} header y`).toBeLessThanOrEqual(1);
      expect(Math.abs(snapshot.header.width - baseline.header.width), `${snapshot.id} header width`).toBeLessThanOrEqual(1);
      expect(Math.abs(snapshot.header.height - baseline.header.height), `${snapshot.id} header height`).toBeLessThanOrEqual(1);
      expect(Math.abs(snapshot.nav.x - baseline.nav.x), `${snapshot.id} nav x (${JSON.stringify({ baseline: baseline.brand, current: snapshot.brand })})`).toBeLessThanOrEqual(1);
      expect(Math.abs(snapshot.nav.y - baseline.nav.y), `${snapshot.id} nav y`).toBeLessThanOrEqual(1);
      expect(Math.abs(snapshot.nav.height - baseline.nav.height), `${snapshot.id} nav height`).toBeLessThanOrEqual(1);
    }
  });

  test('home, rankings, and social keep readable horizontal panels', async ({ page }, testInfo) => {
    skipNonTablet(testInfo);
    const viewport = page.viewportSize();
    const minimumPanelHeight = Math.min(240, Math.floor(viewport.height * 0.30));
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => ({ width: document.body.clientWidth, scrollWidth: document.body.scrollWidth, height: document.body.clientHeight, scrollHeight: document.body.scrollHeight }))).toEqual({ width: viewport.width, scrollWidth: viewport.width, height: viewport.height, scrollHeight: viewport.height });

    await page.locator('#home-rankings-tab').click();
    await expect(page.locator('#rankings-page-content [data-ranking-stage]')).toBeVisible();
    await expect.poll(() => page.locator('#rankings-page-content .rankings-stage').evaluate(el => el.clientHeight)).toBeGreaterThan(minimumPanelHeight);
    await expect.poll(() => page.locator('#rankings-page-content .ranking-list').evaluate(el => el.clientHeight)).toBeGreaterThan(24);
    await expect(page.locator('#rankings-page-content .rankings-context')).toHaveCount(0);

    await page.locator('#view-rankings [data-top-surface="social"]').click();
    await expect(page.locator('#social-page-content .social-feed')).toBeVisible();
    await expect.poll(() => page.locator('#social-page-content .social-feed').evaluate(el => el.clientHeight)).toBeGreaterThan(minimumPanelHeight);
    await expect.poll(() => page.locator('#social-page-content .social-surface-body').evaluate(el => el.clientHeight)).toBeGreaterThan(120);
    await expect.poll(() => page.locator('#social-page-content .social-context').evaluate(el => el.clientHeight)).toBeGreaterThan(Math.min(180, Math.floor(viewport.height * 0.27)));
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

  test('live game uses a board-first desk without page scrolling @ui-smoke', async ({ page, context }, testInfo) => {
    skipNonTablet(testInfo);
    const guest = await context.newPage();
    const code = `IP${String(page.viewportSize().width).padStart(4, '0')}`;
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
      const hudCells = [...document.querySelectorAll('#hud > .hud-cell')];
      const turnBox = hudCells[0]?.getBoundingClientRect();
      const moneyBox = hudCells[1]?.getBoundingClientRect();
      const vacationBox = hudCells[3]?.getBoundingClientRect();
      const cashAction = document.querySelector('#hud-cash-action')?.getBoundingClientRect();
      const cashValue = document.querySelector('#hud-cash')?.getBoundingClientRect();
      const cashIcon = document.querySelector('#hud-cash-action [data-sprite="note"]');
      const tileName = document.querySelector('#board-grid .tile:not(.is-corner) .tile-name');
      const tilePrice = document.querySelector('#board-grid .tile:not(.is-corner) .tile-price');
      const tileSvg = document.querySelector('#board-grid .tile-icon svg');
      const airportIcon = document.querySelector('#board-grid .airport-mark');
      const piece = document.querySelector('#token-layer .piece');
      const pieceSvg = piece?.querySelector('svg');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        body: { clientWidth: document.body.clientWidth, clientHeight: document.body.clientHeight, scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight },
        board: box('#board-frame'),
        boardArea: box('#view-game .board-area'),
        boardHolder: box('#view-game .board-holder'),
        hud: box('#hud'),
        turnBox: turnBox ? { width: turnBox.width } : null,
        moneyBox: moneyBox ? { width: moneyBox.width } : null,
        vacationBox: vacationBox ? { width: vacationBox.width } : null,
        cashContents: cashAction && cashValue && cashIcon ? {
          iconHidden: getComputedStyle(cashIcon).display === 'none',
          valueInside: cashValue.right <= cashAction.right,
          valueWidth: cashValue.width,
          actionWidth: cashAction.width
        } : null,
        tileNameFontSize: tileName ? Number.parseFloat(getComputedStyle(tileName).fontSize) : null,
        tilePriceFontSize: tilePrice ? Number.parseFloat(getComputedStyle(tilePrice).fontSize) : null,
        tileSvgWidth: tileSvg?.getBoundingClientRect().width ?? null,
        airportIconWidth: airportIcon?.getBoundingClientRect().width ?? null,
        playerPieceWidth: piece?.getBoundingClientRect().width ?? null,
        playerPieceSvgWidth: pieceSvg?.getBoundingClientRect().width ?? null,
        roll: box('#roll-btn'),
        rightRail: box('#right-rail-game')
      };
    });
    expect(geometry.body.scrollWidth - geometry.body.clientWidth).toBeLessThanOrEqual(2);
    expect(geometry.body.scrollHeight - geometry.body.clientHeight).toBeLessThanOrEqual(2);
    for (const key of ['board', 'hud', 'roll', 'rightRail']) {
      expect(geometry[key]).not.toBeNull();
      expect(geometry[key].y).toBeGreaterThanOrEqual(0);
      expect(geometry[key].bottom).toBeLessThanOrEqual(geometry.viewport.height + 2);
    }
    expect(geometry.moneyBox.width / geometry.turnBox.width).toBeGreaterThanOrEqual(0.85);
    expect(geometry.vacationBox.width / geometry.moneyBox.width).toBeGreaterThanOrEqual(1.1);
    expect(geometry.cashContents.iconHidden).toBe(true);
    expect(geometry.cashContents.valueInside, JSON.stringify(geometry.cashContents)).toBe(true);
    expect(Math.abs(geometry.boardHolder.width - geometry.boardHolder.height)).toBeLessThanOrEqual(2);
    expect(geometry.boardHolder.width).toBeLessThanOrEqual(geometry.boardArea.width + 2);
    expect(geometry.boardHolder.height).toBeLessThanOrEqual(geometry.boardArea.height + 2);
    expect(geometry.boardHolder.width / geometry.boardArea.width).toBeGreaterThanOrEqual(0.75);
    const largerProType = geometry.viewport.width >= 1100;
    expect(geometry.tileNameFontSize).toBeGreaterThanOrEqual(largerProType ? 8.5 : 7);
    expect(geometry.tileNameFontSize).toBeLessThanOrEqual(12);
    expect(geometry.tilePriceFontSize).toBeGreaterThanOrEqual(largerProType ? 9.5 : 8);
    expect(geometry.tilePriceFontSize).toBeLessThanOrEqual(12);
    expect(geometry.tileSvgWidth).toBeLessThanOrEqual(28);
    expect(geometry.airportIconWidth).toBeLessThanOrEqual(30);
    expect(geometry.playerPieceWidth).toBeLessThanOrEqual(22);
    expect(geometry.playerPieceSvgWidth).toBeLessThanOrEqual(18);
    if (process.env.POORUP_CAPTURE_VISUALS) {
      await page.screenshot({ path: testInfo.outputPath('ipad-live-game.png'), fullPage: true });
    }

    await page.locator('#panels-btn').click();
    const checkboxSizes = await page.locator('#panel-menu [data-panel-toggle]').evaluateAll(nodes => nodes.map(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; }));
    expect(checkboxSizes.every(size => size.width >= 24 && size.height >= 24)).toBe(true);
    await guest.close();
  });
});
