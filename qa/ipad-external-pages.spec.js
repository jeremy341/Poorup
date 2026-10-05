/* global document, window, getComputedStyle */
import { test, expect } from '@playwright/test';
import process from 'node:process';

const ipadProject = (testInfo) => testInfo.project.name.startsWith('ipad-');

async function captureIfRequested(page, testInfo, filename) {
  if (process.env.POORUP_CAPTURE_VISUALS !== '1') return;
  await page.screenshot({ path: testInfo.outputPath(filename), fullPage: false, scale: 'css' });
}

async function expectNoDocumentScroll(page) {
  const dimensions = await page.evaluate(() => ({
    documentX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    documentY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    bodyX: document.body.scrollWidth - document.body.clientWidth,
    bodyY: document.body.scrollHeight - document.body.clientHeight,
    scrollY: window.scrollY,
  }));
  expect(dimensions.documentX).toBeLessThanOrEqual(1);
  expect(dimensions.documentY).toBeLessThanOrEqual(1);
  expect(dimensions.bodyX).toBeLessThanOrEqual(1);
  expect(dimensions.bodyY).toBeLessThanOrEqual(1);
  expect(dimensions.scrollY).toBe(0);
}

test.describe('iPad external pages', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!ipadProject(testInfo), 'iPad responsive contract');
    expect(page.viewportSize()).not.toBeNull();
  });

  test('rankings preserves metric arrows while progressively disclosing exact-player search', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.locator('#home-rankings-tab').click();

    const toggle = page.locator('#rankings-page-content [data-ranking-search-toggle]');
    const input = page.locator('#rankings-page-content [data-ranking-search-input]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(input).toBeHidden();
    expect(await toggle.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await captureIfRequested(page, testInfo, 'rankings-landscape-search-collapsed.png');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(input).toBeVisible();
    await expect(page.locator('#rankings-page-content [data-ranking-step="1"]')).toBeVisible();
    await expectNoDocumentScroll(page);
    await captureIfRequested(page, testInfo, 'rankings-landscape-search-open.png');
  });

  test('populated rankings keep player rows inside the tablet standings panel', async ({ page }) => {
    await page.goto('/');
    await page.locator('#home-rankings-tab').click();
    await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      const { renderRankingsSurface } = await import('/clientSocialSurfaces.js');
      const rows = [
        { accountId: 'ipad-alpha', displayName: 'ALPHA', username: 'alpha', games: 8, wins: 5, value: 5, trend: { direction: 'up', delta: 2 } },
        { accountId: 'ipad-beta', displayName: 'BETA', username: 'beta', games: 6, wins: 3, value: 3, trend: { direction: 'flat', delta: 0 } },
      ];
      state.leaderboard.metric = 'wins';
      state.leaderboard.scope = 'all';
      state.leaderboard.rows = rows;
      state.leaderboard.snapshots = { wins: rows };
      state.leaderboard.loading = false;
      state.leaderboard.error = '';
      renderRankingsSurface('#rankings-page-content');
    });
    await expect(page.locator('#rankings-page-content .ranking-row')).toHaveCount(2);
    await expect(page.locator('#rankings-page-content .rankings-stage')).toBeVisible();
    await expectNoDocumentScroll(page);
  });

  test('portrait rankings switch between standings and season without hiding the metric control', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    await page.locator('#home-rankings-tab').click();

    const standingsTab = page.locator('#rankings-page-content [data-ranking-pane="standings"]');
    const seasonTab = page.locator('#rankings-page-content [data-ranking-pane="season"]');
    await expect(standingsTab).toBeVisible();
    await expect(seasonTab).toBeVisible();
    await expect(standingsTab).toHaveAttribute('aria-pressed', 'true');
    expect(await seasonTab.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#rankings-page-content .rankings-stage')).toBeVisible();
    await expect(page.locator('#rankings-page-content .rankings-context')).toBeHidden();
    const metricHeading = page.locator('#rankings-page-content [data-ranking-stage] h3');
    await expect(metricHeading).toContainText('WINS');
    await page.locator('#rankings-page-content [data-ranking-step="1"]').click();
    await expect(metricHeading).toContainText('WIN RATE');

    await seasonTab.click();
    await expect(seasonTab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#rankings-page-content .rankings-stage')).toBeHidden();
    await expect(page.locator('#rankings-page-content .rankings-context')).toBeVisible();

    await standingsTab.click();
    await expect(page.locator('#rankings-page-content [data-ranking-step="1"]')).toBeVisible();
    await seasonTab.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(standingsTab).toHaveAttribute('aria-pressed', 'true');
    await expectNoDocumentScroll(page);
    await seasonTab.click();
    await captureIfRequested(page, testInfo, 'rankings-portrait-season.png');
  });

  test('portrait rules progressively discloses search and chapter navigation', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    await page.locator('#home-rules-tab').click();

    const searchToggle = page.locator('#rules-page-content [data-rules-search-toggle]');
    const searchInput = page.locator('#rules-page-content #rules-search');
    const chapterToggle = page.locator('#rules-page-content [data-rules-chapters-toggle]');
    const chapterNav = page.locator('#rules-page-content .rules-index-nav');
    await expect(searchToggle).toBeVisible();
    await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(searchInput).toBeHidden();
    expect(await searchToggle.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect(chapterToggle).toBeVisible();
    await expect(chapterToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(chapterNav).toBeHidden();
    expect(await chapterToggle.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

    await searchToggle.click();
    await expect(searchInput).toBeVisible();
    await searchInput.fill('prison');
    await expect(searchToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(searchInput).toHaveValue('prison');

    await chapterToggle.click();
    await expect(chapterNav).toBeVisible();
    await chapterNav.locator('[data-rules-section]').first().click();
    await expect(chapterNav).toBeHidden();
    await expect(page.locator('#rules-page-content .rules-book-page-scroll')).toBeVisible();
    await expectNoDocumentScroll(page);
    await captureIfRequested(page, testInfo, 'rules-portrait-reader.png');
  });

  test('landscape achievements exposes compact filters and at least two complete rows', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto('/');
    await page.locator('#home-profile-tab').click();
    await page.locator('#profile-tab-achievements').click();

    const toggle = page.locator('#profile-panel-achievements [data-achievement-filter-toggle]');
    const controls = page.locator('#profile-panel-achievements #achievement-filter-controls');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(controls).toBeHidden();
    expect(await toggle.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

    const firstViewport = await page.locator('#achievements-grid').evaluate((grid) => {
      const clip = document.querySelector('#profile-main').getBoundingClientRect();
      const tops = new Set();
      for (const card of grid.querySelectorAll('.achievement-card')) {
        const rect = card.getBoundingClientRect();
        if (rect.top >= clip.top && rect.bottom <= clip.bottom) tops.add(Math.round(rect.top));
      }
      return {
        completeRowsVisible: tops.size,
        gridOverflowY: getComputedStyle(grid).overflowY,
      };
    });
    expect(firstViewport.completeRowsVisible).toBeGreaterThanOrEqual(2);
    expect(firstViewport.gridOverflowY).not.toMatch(/auto|scroll/);
    await captureIfRequested(page, testInfo, 'achievements-landscape-compact-filters.png');

    const profileMain = page.locator('#profile-main');
    await profileMain.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const lastCardReachable = await page.locator('#achievements-grid .achievement-card').last().evaluate((card) => {
      const viewport = document.querySelector('#profile-main').getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
    });
    expect(lastCardReachable).toBe(true);
    await profileMain.evaluate((element) => { element.scrollTop = 0; });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(controls).toBeVisible();
    await expectNoDocumentScroll(page);
    await captureIfRequested(page, testInfo, 'achievements-landscape-filters-open.png');
  });

  test('portrait profile sections remain on one tab row and keep the selected tab reachable', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    await page.locator('#home-profile-tab').click();

    const tabs = page.locator('#profile-tabs');
    const rowGeometry = await tabs.locator('[data-profile-tab]').evaluateAll((buttons) => {
      const tops = buttons.map((button) => Math.round(button.getBoundingClientRect().top));
      return {
        rowCount: new Set(tops).size,
        clientHeight: tabs.clientHeight,
        scrollHeight: tabs.scrollHeight,
      };
    });
    expect(rowGeometry.rowCount).toBe(1);
    expect(rowGeometry.scrollHeight).toBeLessThanOrEqual(rowGeometry.clientHeight + 1);
    expect(await page.locator('#profile-tab-account').evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

    const accountTab = page.locator('#profile-tab-account');
    await accountTab.click();
    await expect(accountTab).toHaveAttribute('aria-selected', 'true');
    const visibility = await accountTab.evaluate((button) => {
      const tablist = button.closest('[role="tablist"]').getBoundingClientRect();
      const tab = button.getBoundingClientRect();
      return tab.left >= tablist.left - 1 && tab.right <= tablist.right + 1;
    });
    expect(visibility).toBe(true);
    await expect(page.locator('#profile-panel-account')).toBeVisible();
    await captureIfRequested(page, testInfo, 'profile-account-portrait.png');
    await accountTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#profile-tab-overview')).toHaveAttribute('aria-selected', 'true');
    await expectNoDocumentScroll(page);
  });

  test('short-height shell keeps rankings, rules and profile inside the dynamic viewport', async ({ page }, testInfo) => {
    const viewports = [
      { name: 'ipad-1180x700', width: 1180, height: 700 },
      { name: 'ipad-1024x768', width: 1024, height: 768 },
      { name: 'ipad-944x656', width: 944, height: 656 },
      { name: 'ipad-portrait-820x1060', width: 820, height: 1060 },
      { name: 'ipad-zoom-200-landscape', width: 590, height: 410 },
      { name: 'ipad-zoom-200-portrait', width: 410, height: 590 },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const [route, button, viewId] of [
        ['rankings', '#home-rankings-tab', '#view-rankings'],
        ['rules', '#home-rules-tab', '#view-rules'],
        ['profile', '#home-profile-tab', '#view-profile'],
      ]) {
        await page.goto('/');
        await page.locator(button).click();
        const rect = await page.locator(viewId).evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          viewport: window.visualViewport?.height ?? window.innerHeight,
        }));
        expect(rect.height, `${viewport.name} ${route}`).toBeLessThanOrEqual(rect.viewport + 1);
        await expectNoDocumentScroll(page);
        if (route === 'rankings' && viewport.name === 'ipad-1180x700') {
          const seasonGrid = page.locator('#rankings-page-content .season-panel-grid');
          await expect(seasonGrid).toBeVisible();
          const seasonOverflow = await seasonGrid.evaluate((grid) => grid.scrollHeight > grid.clientHeight + 1);
          if (seasonOverflow) {
            await expect(seasonGrid).toHaveAttribute('tabindex', '0');
            await expect(page.locator('#rankings-page-content [data-season-scroll-cue]')).toBeVisible();
            await expect(page.locator('#rankings-page-content [data-season-scroll-cue]')).toContainText('SCROLL INSIDE');
          }
        }
        if (viewport.name.startsWith('ipad-zoom-200')) {
          const scrollSelector = route === 'rankings'
            ? '#view-rankings .social-page-main'
            : route === 'rules'
              ? '#rules-book-page-scroll'
              : '#view-profile .profile-main';
          const scrollArea = page.locator(scrollSelector);
          const scrollState = await scrollArea.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
            return { top: element.scrollTop, max: element.scrollHeight - element.clientHeight };
          });
          expect(scrollState.top, `${viewport.name} ${route} internal scroll`).toBeGreaterThan(0);
          expect(scrollState.max, `${viewport.name} ${route} internal scroll range`).toBeGreaterThan(0);
          const reachableSelectors = route === 'rankings'
            ? ['#rankings-page-content .rankings-stage', '#rankings-page-content .rankings-context']
            : [route === 'rules'
              ? '#rules-book-page-scroll .rules-article-body'
              : '#view-profile .profile-tab-panel:not(.is-hidden)'];
          for (const selector of reachableSelectors) {
            const reachableContent = page.locator(selector);
            await reachableContent.evaluate((element) => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
            const visibleInViewport = await reachableContent.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return rect.bottom > 0 && rect.top < window.innerHeight;
            });
            expect(visibleInViewport, `${viewport.name} ${route} ${selector} remains reachable`).toBe(true);
          }
        }
        await captureIfRequested(page, testInfo, `${viewport.name}-${route}.png`);
      }
    }
  });
});

test('desktop rankings keeps its inline lookup, paired ledger and metric arrows', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1920x1080', 'Desktop regression contract');
  await page.goto('/');
  await page.locator('#home-rankings-tab').click();
  await expect(page.locator('#rankings-page-content [data-ranking-search-toggle]')).toBeHidden();
  await expect(page.locator('#rankings-page-content [data-ranking-search-input]')).toBeVisible();
  await expect(page.locator('#rankings-page-content .rankings-stage')).toBeVisible();
  await expect(page.locator('#rankings-page-content .rankings-context')).toBeVisible();
  await expect(page.locator('#rankings-page-content [data-ranking-step="1"]')).toBeVisible();
  await captureIfRequested(page, testInfo, 'rankings-desktop-1920.png');

  await page.goto('/');
  await page.locator('#home-profile-tab').click();
  await page.locator('#profile-tab-achievements').click();
  await expect(page.locator('#profile-panel-achievements [data-achievement-filter-toggle]')).toBeHidden();
  await expect(page.locator('#profile-panel-achievements #achievement-filter-controls')).toBeVisible();
  const profileTabWidths = await page.locator('#profile-tabs').evaluate((tablist) => ({ client: tablist.clientWidth, scroll: tablist.scrollWidth }));
  expect(profileTabWidths.scroll).toBeLessThanOrEqual(profileTabWidths.client + 1);
  await expectNoDocumentScroll(page);
});
