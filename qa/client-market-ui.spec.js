import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('market desk overrides the generic 440px popup cap on desktop and avoids viewport overflow', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.body.innerHTML = '<div class="popup" id="market-modal"><div class="popup-scrim"></div><div class="popup-card market-desk-card panel noise" id="market-card"></div></div>';
  });
  const viewport = page.viewportSize();
  const desk = await page.locator('.market-desk-card').boundingBox();
  expect(desk.width).toBeLessThanOrEqual(viewport.width - 24);
  if (viewport.width >= 768) expect(desk.width).toBeGreaterThan(700);
});

test('market desk presents a wide instrument watchlist, live shared quote, chart, and order ticket', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div class="popup" id="market-modal" role="dialog" aria-modal="true" aria-labelledby="market-modal-title"><div class="popup-scrim"></div><div class="popup-card market-desk-card panel noise" id="market-card"></div></div>';
    const { state } = await import('/clientState.js');
    const marketUi = await import('/clientMarketUi.js');
    state.players = [{ id: 'p1', name: 'ALPHA', cash: 1500, marketPositions: {} }];
    state.economy = {
      ...state.economy,
      market: {
        enabled: true,
        round: 2,
        complexity: 'basic',
        quotes: { brazil: 113, ghana: 100, thailand: 100, japan: 100, netherlands: 100, canada: 100, switzerland: 100, singapore: 100, airports: 100, utilities: 100, property: 100 },
        quoteHistory: [
          { round: 0, quotes: { brazil: 100, ghana: 100 } },
          { round: 1, quotes: { brazil: 104, ghana: 100 } },
          { round: 2, quotes: { brazil: 113, ghana: 100 }, eventId: 'market-rush' },
        ],
        positions: { brazil: { quantity: 2, averageCost: 106, realizedPnl: 0 }, ghana: { quantity: 3, averageCost: 100, realizedPnl: 0 } },
        personalTrades: [],
      },
    };
    window.__marketOrders = [];
    marketUi.configureMarketUi({
      emitServer(eventName, payload, acknowledge) {
        window.__marketOrders.push({ eventName, payload });
        acknowledge({ success: false, error: 'Fixture acknowledgement.' });
      },
      createRequestId: () => 'market-qa-request',
    });
    marketUi.renderMarketDeskIfOpen();
  });

  await expect(page.locator('.market-watchlist-item')).toHaveCount(11);
  await expect(page.locator('[data-market-select-index="brazil"]')).toContainText('HOUSING MARKET');
  if (page.viewportSize().width > 1200) {
    const longSectorLabel = page.locator('[data-market-select-index="singapore"] .market-watchlist-name');
    await expect(longSectorLabel).toContainText('TOURISM & HOSPITALITY');
    expect(await longSectorLabel.evaluate(element => getComputedStyle(element).whiteSpace)).toBe('normal');
  }
  await expect(page.locator('.market-current-price')).toContainText('$113');
  await expect(page.locator('[data-market-movement]')).toContainText('+$9');
  await expect(page.locator('.market-trade-ticket')).toBeVisible();
  await expect(page.locator('.market-history-table')).toHaveCount(0);
  await expect(page.locator('.market-chart-summary')).toContainText('3 data points');
  const viewport = page.viewportSize();
  const tabletPicker = page.locator('#market-desk-index');
  if (viewport.width > 700 && viewport.width <= 1200) {
    await expect(tabletPicker).toBeVisible();
    await expect(tabletPicker.locator('option[value="brazil"]')).toHaveText('HOUSING MARKET');
    await expect(page.locator('.market-watchlist')).toBeHidden();
    await expect(page.locator('#market-desk-history-range')).toBeVisible();
    await expect(page.locator('#market-desk-history-range')).toHaveValue('all');
  } else {
    await expect(tabletPicker).toBeHidden();
    await expect(page.locator('#market-desk-history-range')).toBeHidden();
    await expect(page.locator('.market-watchlist')).toBeVisible();
    if (viewport.width > 1200) {
      const watchlist = page.locator('.market-watchlist-items');
      await expect(watchlist).toHaveCSS('overflow-y', 'auto');
      expect(await watchlist.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    }
  }

  if (["desktop-1920", "ipad-mini-landscape", "ipad-pro-11-landscape", "mobile-390"].includes(testInfo.project.name)) {
    const evidenceDirectory = path.resolve("qa-artifacts/market-desk-refresh-2026-09-27");
    await mkdir(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDirectory, `market-desk-${testInfo.project.name}.png`) });
  }

  if (viewport.width > 700 && viewport.width <= 1200) {
    await tabletPicker.selectOption('ghana');
    await expect(tabletPicker).toHaveValue('ghana');
    await expect(tabletPicker).toBeFocused();
  } else {
    const ghana = page.locator('[data-market-select-index="ghana"]');
    await ghana.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-market-select-index="ghana"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-market-select-index="ghana"]')).toBeFocused();
  }
  await expect(page.locator('#market-history-title')).toContainText('AGRICULTURE');
  await expect(page.locator('#market-selected-index-name')).toHaveText('AGRICULTURE');
  await expect(page.locator('.market-current-price')).toContainText('$100');
  await expect(page.locator('#market-desk-quantity')).toBeVisible();
  await expect(page.locator('[data-market-preview]')).toContainText('QUOTE $100');
  await page.locator('#market-desk-quantity').fill('2');
  await page.locator('#market-desk-side').selectOption('sell');
  await expect(page.locator('[data-market-preview]')).toContainText('GROSS $200');
  await expect(page.locator('[data-market-preview]')).toContainText('NET PROCEEDS $196');
  await page.locator('[data-market-basic-order]').click();
  expect(await page.evaluate(() => window.__marketOrders)).toEqual([{
    eventName: 'market-order',
    payload: { instrumentId: 'ghana', side: 'sell', quantity: 2, requestId: 'market-qa-request' },
  }]);

  const desk = await page.locator('.market-desk-card').boundingBox();
  expect(desk.width).toBeLessThanOrEqual(viewport.width - 24);
  if (viewport.width >= 768) expect(desk.width).toBeGreaterThan(700);
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight + 1)).toBe(true);
});

test('configured derivative ticket keeps option side separate from buy or sell action', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div class="popup" id="market-modal" role="dialog" aria-modal="true" aria-labelledby="market-modal-title"><div class="popup-scrim"></div><div class="popup-card market-desk-card panel noise" id="market-card"></div></div>';
    const { state } = await import('/clientState.js');
    const marketUi = await import('/clientMarketUi.js');
    state.players = [{ id: 'p1', name: 'ALPHA', cash: 1500, marketPositions: {} }];
    state.economy = {
      ...state.economy,
      market: {
        enabled: true, round: 1, complexity: 'derivatives', pricingPolicy: { serverOwned: true }, feeRate: 0.02,
        quotes: { brazil: 100 }, quoteHistory: [{ round: 0, quotes: { brazil: 100 } }],
        positions: {}, shorts: { positions: {} }, options: [], personalTrades: [],
      },
    };
    window.__marketActions = [];
    marketUi.configureMarketUi({
      emitServer(eventName, payload, acknowledge) {
        window.__marketActions.push({ eventName, payload });
        acknowledge({ success: false, error: 'Fixture remains open for verification.' });
      },
      createRequestId: () => 'option-side-regression',
    });
    marketUi.renderMarketDeskIfOpen();
  });
  await page.locator('.market-advanced-settings > summary').click();
  await page.locator('#market-desk-option-side').selectOption('put');
  await page.locator('[data-market-advanced="open-option"]').click();
  const requests = await page.evaluate(() => window.__marketActions);
  expect(requests).toHaveLength(1);
  expect(requests[0].eventName).toBe('open-option');
  expect(requests[0].payload).toMatchObject({ instrumentId: 'brazil', side: 'put', role: 'writer' });
});

test('tablet chart-range widget filters the chart summary without rendering a data table', async ({ page }, testInfo) => {
  test.skip(!['tablet-1024', 'ipad-mini-landscape', 'ipad-pro-11-landscape'].includes(testInfo.project.name));
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div class="popup" id="market-modal" role="dialog" aria-modal="true" aria-labelledby="market-modal-title"><div class="popup-scrim"></div><div class="popup-card market-desk-card panel noise" id="market-card"></div></div>';
    const { state } = await import('/clientState.js');
    const marketUi = await import('/clientMarketUi.js');
    state.players = [{ id: 'p1', name: 'ALPHA', cash: 1500, marketPositions: {} }];
    state.economy = {
      ...state.economy,
      market: {
        enabled: true, round: 20, complexity: 'basic', quotes: { brazil: 120 },
        quoteHistory: Array.from({ length: 21 }, (_, round) => ({ round, quotes: { brazil: 100 + round } })),
        positions: {}, personalTrades: [],
      },
    };
    marketUi.configureMarketUi({ emitServer: () => {}, createRequestId: () => 'chart-range-regression' });
    marketUi.renderMarketDeskIfOpen();
  });
  const range = page.locator('#market-desk-history-range');
  await expect(range).toBeVisible();
  await range.selectOption('8');
  await expect(range).toHaveValue('8');
  await expect(range).toBeFocused();
  await expect(page.locator('.market-history-range-note')).toContainText('8 DATA POINTS');
  await expect(page.locator('.market-chart-summary')).toContainText('8 data points');
  await expect(page.locator('.market-chart-summary')).toContainText('round 13');
  await expect(page.locator('.market-history-table')).toHaveCount(0);
});

test('derivatives remain unavailable without server pricing policy across market refreshes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="market-modal" role="dialog"><div id="market-card"></div></div>';

    const [{ state }, marketUi] = await Promise.all([
      import('/clientState.js'),
      import('/clientMarketUi.js'),
    ]);
    state.economy = {
      ...state.economy,
      market: {
        enabled: true,
        round: 1,
        complexity: 'derivatives',
        feeRate: 0.02,
        quotes: { brazil: 104 },
        positions: {},
        shorts: { positions: {} },
        options: [],
      },
    };

    window.__marketActions = [];
    marketUi.configureMarketUi({
      emitServer(eventName, payload, acknowledge) {
        window.__marketActions.push({ eventName, payload });
        acknowledge({ success: false, error: 'Test acknowledgement' });
      },
      createRequestId: () => 'market-option-test',
      renderRightRail: () => {},
      say: () => {},
      renderChat: () => {},
    });
    marketUi.renderMarketDeskIfOpen();
    window.__refreshMarketDesk = () => {
      state.economy = {
        ...state.economy,
        market: { ...state.economy.market, round: 2 },
      };
      marketUi.renderMarketDeskIfOpen();
    };
  });

  const viewport = page.viewportSize();
  const tablet = viewport.width > 700 && viewport.width <= 1200;
  const index = tablet ? page.locator('#market-desk-index') : page.locator('[data-market-select-index="canada"]');
  if (tablet) await index.selectOption('canada');
  else await index.click();
  await page.evaluate(() => window.__refreshMarketDesk());

  if (tablet) await expect(index).toHaveValue('canada');
  else await expect(index).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.market-derivatives-unavailable').first()).toContainText('SERVER PRICING POLICY NOT CONFIGURED');
  await expect(page.locator('#market-desk-role')).toHaveCount(0);
  await expect(page.locator('[data-market-advanced="open-option"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__marketActions)).toEqual([]);
});
