import { test, expect } from '@playwright/test';

const SESSION = { sessionToken: 'qa-admin-session', account: { id: 'qa-admin', username: 'qa-admin', displayName: 'QA admin' } };
const FIXTURE = { success: true, schemaVersion: 1, generatedAt: '2026-09-15T12:00:00.000Z', filters: { range: 'day', tab: 'overview', boardVariant: 'metro-52', rulesetPreset: 'after-hours', marketComplexity: 'all', botMode: 'ai', provider: 'openai' }, suppression: { minimumCohort: 5, suppressedPanels: 0 }, overview: { kpis: [] }, series: [{ label: '12:00', value: 42 }], breakdowns: [], dataQuality: { fresh: true } };

async function openAnalytics(page) {
  await page.route('**/admin/analytics/balance**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) }));
  await page.goto('/admin/analytics');
  await expect(page.locator('#admin-analytics-main')).toBeVisible();
  await page.evaluate(async session => {
    const { state } = await import('/clientState.js');
    state.account = session;
  }, SESSION);
  await page.locator('[data-analytics-refresh]').click();
}

test.describe('admin analytics full-screen report frame', () => {
  test('fills the viewport without document scrolling', async ({ page }) => {
    await openAnalytics(page);
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      body: document.body.scrollHeight > document.body.clientHeight,
      width: document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.body.clientWidth
    }));
    expect(overflow.document || overflow.body || overflow.width).toBe(false);
    await expect(page.locator('[data-analytics-page-prev]')).toBeVisible();
    await expect(page.locator('[data-analytics-page-next]')).toBeVisible();
    await expect(page.locator('[data-analytics-page-position]')).toBeVisible();
  });

  test('keeps only the window filter visible and discloses advanced filters on demand', async ({ page }) => {
    await openAnalytics(page);
    await expect(page.locator('[data-analytics-filter="range"]')).toBeVisible();
    await expect(page.locator('[data-analytics-filter="boardVariant"]')).toBeHidden();
    await expect(page.locator('[data-analytics-more-filters]')).toBeVisible();
    await page.locator('[data-analytics-more-filters]').click();
    await expect(page.locator('[data-analytics-filter-dialog]')).toBeVisible();
    await expect(page.locator('[data-analytics-report-book]')).toHaveAttribute('inert', '');
    for (const name of ['boardVariant', 'rulesetPreset', 'marketComplexity', 'botMode', 'provider', 'eventId', 'seasonId', 'rulesetRevision', 'balanceRevision']) {
      await expect(page.locator(`[data-analytics-filter="${name}"]`)).toHaveCount(1);
    }
    await page.locator('[data-analytics-filter-cancel]').click();
    await expect(page.locator('[data-analytics-report-book]')).not.toHaveAttribute('inert', '');
  });

  test('page arrows move the report without changing the global route', async ({ page }) => {
    await openAnalytics(page);
    const position = page.locator('[data-analytics-page-position]');
    await expect(position).toHaveText(/1\s*\/\s*7/);
    await page.locator('[data-analytics-page-next]').click();
    await expect(position).toHaveText(/2\s*\/\s*7/);
    await expect(page).toHaveURL(/\/admin\/analytics/);
    await page.keyboard.press('End');
    await expect(position).toHaveText(/7\s*\/\s*7/);
  });

  test('keeps the next page arrow reachable at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAnalytics(page);

    const next = page.locator('[data-analytics-page-next]');
    await expect(next).toBeVisible();
    const hitTest = await next.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const targetRect = target?.getBoundingClientRect();
      const box = element => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height),
          top: Math.round(bounds.top), right: Math.round(bounds.right), bottom: Math.round(bounds.bottom), left: Math.round(bounds.left),
          display: style.display, overflowX: style.overflowX, overflowY: style.overflowY,
          clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
          gridTemplateRows: style.gridTemplateRows
        };
      };
      const clips = [];
      for (let ancestor = button.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if ([style.overflowX, style.overflowY].some(value => ['auto', 'hidden', 'clip', 'scroll'].includes(value))) {
          const bounds = ancestor.getBoundingClientRect();
          clips.push({
            id: ancestor.id,
            className: typeof ancestor.className === 'string' ? ancestor.className : ancestor.tagName.toLowerCase(),
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            top: Math.round(bounds.top), right: Math.round(bounds.right), bottom: Math.round(bounds.bottom), left: Math.round(bounds.left),
            clipsButton: rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom
          });
        }
      }
      return {
        inViewport: rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight,
        receivesPointer: target === button || button.contains(target),
        hitTarget: target ? {
          tag: target.tagName.toLowerCase(), id: target.id, className: typeof target.className === 'string' ? target.className : '',
          pointerEvents: getComputedStyle(target).pointerEvents,
          ariaHiddenAncestor: target.closest('[aria-hidden="true"]')?.id || null,
          rect: targetRect ? {
            x: Math.round(targetRect.x), y: Math.round(targetRect.y), width: Math.round(targetRect.width), height: Math.round(targetRect.height),
            top: Math.round(targetRect.top), right: Math.round(targetRect.right), bottom: Math.round(targetRect.bottom), left: Math.round(targetRect.left)
          } : null
        } : null,
        boxes: {
          overview: box(document.querySelector('#analytics-panel-overview')),
          reportBook: box(document.querySelector('[data-analytics-report-book]')),
          reportPage: box(document.querySelector('[data-analytics-report-page]')),
          footer: box(button.closest('.analytics-page-footer')),
          next: box(button),
          workspace: box(document.querySelector('#admin-analytics-workspace')),
          main: box(document.querySelector('#admin-analytics-main'))
        },
        clips,
        documentOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight
          || document.body.scrollHeight > document.body.clientHeight
          || document.documentElement.scrollWidth > document.documentElement.clientWidth
          || document.body.scrollWidth > document.body.clientWidth
      };
    });
    expect(hitTest.inViewport, `Pager layout at 390px: ${JSON.stringify(hitTest)}`).toBe(true);
    expect(hitTest.receivesPointer, `Pager hit test at 390px: ${JSON.stringify(hitTest)}`).toBe(true);
    expect(hitTest.documentOverflow).toBe(false);

    await next.click();
    await expect(page.locator('[data-analytics-page-position]')).toHaveText(/2\s*\/\s*7/);
  });

  test('summarizes applied dimensions as compact chips', async ({ page }) => {
    await openAnalytics(page);
    await page.locator('[data-analytics-more-filters]').click();
    await page.locator('[data-analytics-filter="boardVariant"]').selectOption('metro-52');
    await page.locator('[data-analytics-filter="botMode"]').selectOption('ai');
    await page.locator('[data-analytics-apply]').click();
    await expect(page.locator('[data-analytics-active-filters]')).toContainText('BOARD');
    await expect(page.locator('[data-analytics-active-filters]')).toContainText('metro-52');
    await expect(page.locator('[data-analytics-active-filters]')).toContainText('BOT MODE');
  });

  test('keeps the verified table when the local chart engine fails to load', async ({ page }) => {
    await page.route('**/vendor/echarts.min.js', route => route.abort());
    await openAnalytics(page);
    await expect(page.locator('.analytics-chart-engine-status').first()).toContainText('CHART ENGINE UNAVAILABLE');
    await expect(page.locator('.analytics-chart-table').first()).toBeVisible();
  });
});
