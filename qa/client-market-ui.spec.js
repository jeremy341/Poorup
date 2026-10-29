/* global window, document, getComputedStyle, process */
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

test('dice total typography follows the available board stage width', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="view-game"><main class="board-area" style="width:60vw;height:70vh"><div class="dice-roll-total is-visible">10</div></main></div>';
  });
  const metrics = await page.locator('.board-area').evaluate(element => ({
    width: element.getBoundingClientRect().width,
    fontSize: Number.parseFloat(getComputedStyle(element.querySelector('.dice-roll-total')).fontSize),
  }));
  const expected = Math.max(72, Math.min(220, metrics.width * 0.13));
  expect(metrics.fontSize).toBeCloseTo(expected, 0);
});

test('desktop board stage stays square and the supported minimum gets a compact HUD', async ({ page }) => {
  const viewport = page.viewportSize();
  test.skip(viewport.width < 1400);
  await page.goto('/');
  await page.evaluate(() => {
    document.body.innerHTML = `<div class="view" id="view-game">
      <header class="hdr"></header>
      <div class="game-main">
        <aside class="rail-left"><section class="panel"></section><section class="panel chat-panel"></section></aside>
        <main class="rail-center">
          <div class="board-area"><div class="board-holder"><div class="board-frame"><span class="tile-owner"><svg viewBox="0 0 1 1"><rect width="1" height="1" /></svg></span></div></div></div>
          <div class="hud" id="hud">
            <section class="hud-cell"></section><section class="hud-cell"></section><section class="hud-cell"></section><section class="hud-cell"></section><button class="hud-roll"></button>
          </div>
        </main>
        <aside class="right-rail" id="right-rail-game"></aside>
      </div>
    </div>`;
  });

  const board = await page.locator('.board-holder').boundingBox();
  const boardArea = await page.locator('.board-area').boundingBox();
  expect(Math.abs(board.width - board.height) / Math.max(board.width, board.height)).toBeLessThanOrEqual(0.01);
  expect(board.width).toBeLessThanOrEqual(boardArea.width + 1);
  expect(board.height).toBeLessThanOrEqual(boardArea.height + 1);
  const hud = await page.locator('#hud').evaluate(element => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
    bounds: element.getBoundingClientRect().toJSON(),
  }));
  if (viewport.width === 2560 && viewport.height === 1440) {
    const metrics = await page.evaluate(() => Object.fromEntries(['.game-main', '.rail-left', '.board-area', '.board-holder', '#hud', '.right-rail'].map(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
    })));
    expect(metrics['.game-main'].x).toBeCloseTo(0, 0);
    expect(metrics['.game-main'].width).toBeCloseTo(2560, 0);
    expect(metrics['.rail-left'].x).toBeCloseTo(14, 0);
    expect(metrics['.rail-left'].width).toBeCloseTo(604, 0);
    expect(metrics['.right-rail'].x + metrics['.right-rail'].width).toBeCloseTo(2546, 0);
    expect(metrics['.right-rail'].width).toBeCloseTo(604, 0);
    expect(metrics['.board-holder'].x).toBeCloseTo(660, 0);
    expect(metrics['.board-holder'].y).toBeCloseTo(80, 0);
    expect(metrics['.board-holder'].width).toBeCloseTo(1240, 0);
    expect(metrics['.board-holder'].height).toBeCloseTo(1240, 0);
    expect(metrics['#hud'].x).toBeCloseTo(636, 0);
    expect(metrics['#hud'].y).toBeCloseTo(1330, 0);
    expect(metrics['#hud'].width).toBeCloseTo(1288, 0);
    expect(metrics['#hud'].height).toBeCloseTo(96, 0);
  }
  expect(hud.columns).toBe(5);
  if (viewport.width === 1440 && viewport.height === 900) {
    expect(hud.bounds.height).toBeLessThanOrEqual(112);
    expect(board.width).toBeGreaterThanOrEqual(500);
  }
  if (viewport.width >= 2560 && viewport.height >= 1440) {
    expect(board.width).toBeGreaterThanOrEqual(1000);
    const leftRail = await page.locator('.rail-left').boundingBox();
    const rightRail = await page.locator('.right-rail').boundingBox();
    expect(board.x - (leftRail.x + leftRail.width)).toBeLessThanOrEqual(250);
    expect(rightRail.x - (board.x + board.width)).toBeLessThanOrEqual(250);
  }
  if (viewport.width === 3840 && viewport.height === 2160) {
    expect((await page.locator('.rail-left').boundingBox()).width).toBeCloseTo(420, 0);
    expect((await page.locator('.right-rail').boundingBox()).width).toBeCloseTo(420, 0);
  }
});

test('2560 desktop scales in-game modal families while keeping the player card compact', async ({ page }) => {
  const viewport = page.viewportSize();
  const is2560Tier = viewport.width === 2560 && viewport.height === 1440;
  const isRegressionTier = (viewport.width === 1440 && viewport.height === 900)
    || (viewport.width === 3840 && viewport.height === 2160);
  test.skip(!is2560Tier && !isRegressionTier);
  await page.goto('/');
  await page.evaluate(() => {
    const families = [
      ['choice', 'choice-modal', 'popup-card choice-card panel'],
      ['account', 'account-modal', 'popup-card account-card panel'],
      ['deed', 'deed-modal', 'popup-card deed-detail-card panel'],
      ['trade', 'trade-modal', 'popup-card trade-card panel'],
      ['bank', 'bank-loan-modal', 'popup-card bank-loan-card panel'],
      ['finance', 'financing-modal', 'popup-card financing-card panel'],
      ['wallet', 'wallet-modal', 'popup-card wallet-card panel'],
      ['casino', 'casino-modal', 'popup-card casino-desk-card panel'],
      ['market', 'market-modal', 'popup-card market-desk-card panel'],
      ['sponsorship', 'sponsorship-modal', 'popup-card sponsorship-card panel'],
      ['player', 'player-modal', 'popup-card social-surface-card panel'],
    ];
    document.body.innerHTML = `<div class="view" id="view-game"></div>${families.map(([id, modalId, classes]) => `<div class="popup" id="${modalId}"><div class="${classes}" id="scale-${id}"><span class="t-micro">DETAIL</span><p class="t-body">Modal content for scale check.</p><button class="btn-dark">CONTINUE</button></div></div>`).join('')}`;
    document.querySelector('#scale-player').id = 'player-card';
  });

  const widths = await page.evaluate(() => Object.fromEntries(
    ['choice', 'account', 'deed', 'trade', 'bank', 'finance', 'wallet', 'casino', 'market', 'sponsorship', 'player']
      .map(id => [id, document.querySelector(`#${id === 'player' ? 'player-card' : `scale-${id}`}`).getBoundingClientRect().width]),
  ));
  if (is2560Tier) {
    expect(widths.choice).toBeGreaterThanOrEqual(480);
    expect(widths.account).toBeGreaterThanOrEqual(560);
    expect(widths.deed).toBeGreaterThanOrEqual(600);
    expect(widths.trade).toBeGreaterThanOrEqual(740);
    expect(widths.bank).toBeGreaterThanOrEqual(600);
    expect(widths.finance).toBeGreaterThanOrEqual(800);
    expect(widths.wallet).toBeGreaterThanOrEqual(760);
    expect(widths.casino).toBeGreaterThanOrEqual(680);
    expect(widths.market).toBeGreaterThanOrEqual(1240);
    expect(widths.market).toBeLessThanOrEqual(1360);
    expect(widths.sponsorship).toBeGreaterThanOrEqual(700);
  } else {
    expect(widths.choice).toBeCloseTo(420, 0);
    expect(widths.account).toBeCloseTo(480, 0);
    expect(widths.deed).toBeCloseTo(440, 0);
    expect(widths.trade).toBeCloseTo(660, 0);
    expect(widths.bank).toBeCloseTo(520, 0);
    expect(widths.market).toBeCloseTo(Math.min(1320, viewport.width - 48), 0);
  }
  expect(widths.player).toBeLessThanOrEqual(480);

  const scale = await page.evaluate(() => ({
    micro: Number.parseFloat(getComputedStyle(document.querySelector('#scale-choice .t-micro')).fontSize),
    body: Number.parseFloat(getComputedStyle(document.querySelector('#scale-choice .t-body')).fontSize),
    action: document.querySelector('#scale-choice button').getBoundingClientRect().height,
  }));
  if (is2560Tier) {
    expect(scale.micro).toBeGreaterThanOrEqual(9.7);
    expect(scale.body).toBeGreaterThanOrEqual(14);
    expect(scale.action).toBeGreaterThanOrEqual(48);
  } else {
    expect(scale.micro).toBe(9);
    expect(scale.body).toBe(13);
  }
});

test('landscape iPad rails leave room for larger dice and keep the board square', async ({ page }) => {
  const viewport = page.viewportSize();
  test.skip(viewport.width > 1366);
  await page.goto('/');
  await page.evaluate(() => {
    document.body.innerHTML = `<div class="view" id="view-game">
      <header class="hdr"></header>
      <div class="game-main">
        <aside class="rail-left"><section class="panel"></section><section class="panel chat-panel"></section></aside>
        <main class="rail-center">
          <div class="board-area"><div class="board-holder"><div class="board-frame"><span class="tile-owner"><svg viewBox="0 0 1 1"><rect width="1" height="1" /></svg></span></div></div></div>
          <div class="hud"><section class="hud-cell"></section><section class="hud-cell"></section><section class="hud-cell"><div class="hud-body hud-dice"><span class="die"><span class="on"></span></span><span class="die"><span class="on"></span></span></div></section><section class="hud-cell"></section><button class="hud-roll"></button></div>
        </main>
        <aside class="right-rail" id="right-rail-game"></aside>
      </div>
    </div>`;
  });

  const tracks = await page.locator('.game-main').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').map(value => Number.parseFloat(value)));
  const board = await page.locator('.board-holder').boundingBox();
  const dice = await page.locator('.die').first().boundingBox();
  const owner = await page.locator('.tile-owner').boundingBox();
  expect(tracks[0]).toBeLessThanOrEqual(viewport.width < 1100 ? 164 : 184);
  expect(tracks[2]).toBeLessThanOrEqual(viewport.width < 1100 ? 220 : 250);
  expect(dice.width).toBeGreaterThanOrEqual(40);
  expect(dice.height).toBeGreaterThanOrEqual(40);
  expect(owner.width).toBeGreaterThanOrEqual(10);
  expect(owner.height).toBeGreaterThanOrEqual(10);
  expect(Math.abs(board.width - board.height) / Math.max(board.width, board.height)).toBeLessThanOrEqual(0.01);
});

test('market workbench changes composition for wide desktop and landscape iPad', async ({ page }) => {
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
        round: 4,
        complexity: 'basic',
        quotes: { brazil: 113, ghana: 100, thailand: 100, japan: 100, netherlands: 100, canada: 100, switzerland: 100, singapore: 100, airports: 100, utilities: 100, property: 100 },
        quoteHistory: [{ round: 3, quotes: { brazil: 104 } }, { round: 4, quotes: { brazil: 113 } }],
        positions: { brazil: { quantity: 2, averageCost: 106, realizedPnl: 0 } },
        personalTrades: [],
      },
    };
    marketUi.configureMarketUi({ emitServer: () => {}, createRequestId: () => 'market-layout-test' });
    marketUi.renderMarketDeskIfOpen();
  });

  const width = page.viewportSize().width;
  const indexRail = page.locator('.market-index-rail');
  const indexStrip = page.locator('.market-index-strip');
  await expect(indexRail).toHaveCount(0);
  await expect(indexStrip).toBeHidden();
  await expect(page.locator('#market-desk-index')).toBeVisible();
  await expect(page.locator('#market-desk-index option')).toHaveCount(11);
  expect(await page.locator('.market-desk-layout').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(width >= 1400 ? 2 : 1);

  if (width <= 1366) {
    await expect(page.locator('.market-view-tabs')).toBeVisible();
    await expect(page.locator('#market-view-overview')).toHaveAttribute('aria-pressed', 'true');
    const viewport = page.viewportSize();
    const popupInsets = await page.locator('#market-modal').evaluate(element => {
      const style = getComputedStyle(element);
      return { left: Number.parseFloat(style.paddingLeft), right: Number.parseFloat(style.paddingRight) };
    });
    const deskBounds = await page.locator('.market-desk-card').boundingBox();
    const closeBounds = await page.locator('#market-modal-close').boundingBox();
    expect(deskBounds.x).toBeGreaterThanOrEqual(popupInsets.left - 1);
    expect(deskBounds.x + deskBounds.width).toBeLessThanOrEqual(viewport.width - popupInsets.right + 1);
    expect(deskBounds.width).toBeLessThanOrEqual(Math.min(980, viewport.width - 64) + 1);
    expect(closeBounds.height).toBeGreaterThanOrEqual(44);
    await page.locator('#market-view-trade').click();
    await expect(page.locator('#market-card')).toHaveAttribute('data-market-view', 'trade');
    await expect(page.locator('.market-selected-quote')).toBeVisible();
    await expect(page.locator('.market-trade-ticket')).toBeVisible();
    await expect(page.locator('#market-change-index')).toHaveCount(0);
    await expect(page.locator('.market-history')).toBeHidden();
    await page.locator('#market-view-overview').click();
    await expect(page.locator('#market-card')).toHaveAttribute('data-market-view', 'overview');
    await expect(page.locator('.market-history')).toBeVisible();
  } else {
    await expect(page.locator('.market-view-tabs')).toBeHidden();
  }
});

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

test('market desk presents sector navigation, live shared quote, chart, and order ticket', async ({ page }, testInfo) => {
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

  const viewport = page.viewportSize();
  const marketIndexControl = page.locator('#market-desk-index');
  await expect(marketIndexControl).toBeVisible();
  await expect(marketIndexControl.locator('option')).toHaveCount(11);
  await expect(marketIndexControl.locator('option[value="brazil"]')).toContainText('HOUSING MARKET');
  await expect(page.locator('.market-current-price')).toContainText('$113');
  await expect(page.locator('[data-market-movement]')).toContainText('+$9');
  await expect(page.locator('.market-history-table')).toHaveCount(0);
  await expect(page.locator('.market-chart-summary')).toContainText('3 data points');
  const tabletIndexStrip = page.locator('.market-index-strip');
  await expect(page.locator('.market-index-rail')).toHaveCount(0);
  await expect(marketIndexControl).toBeVisible();
  await expect(tabletIndexStrip).toBeHidden();
  expect(await page.locator('.market-desk-layout').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(viewport.width >= 1400 ? 2 : 1);
  await expect(page.locator('#market-desk-history-range')).toBeVisible();
  await expect(page.locator('#market-desk-history-range')).toHaveValue('all');
  if (viewport.width >= 768 && viewport.width <= 1399) {
    await expect(page.locator('.market-view-tabs')).toBeVisible();
    await expect(page.locator('#market-view-overview')).toHaveAttribute('aria-pressed', 'true');
  } else {
    await expect(page.locator('.market-view-tabs')).toBeHidden();
  }

  if (process.env.POORUP_VISUAL_CAPTURE_DIR || ["desktop-1920x1080", "ipad-1024x768", "ipad-1194x834"].includes(testInfo.project.name)) {
    const evidenceDirectory = path.resolve("qa-artifacts/ui-refresh-2026-10-03/market-desk");
    await mkdir(evidenceDirectory, { recursive: true });
    await captureScreenshot(page, testInfo, {
      group: 'market',
      surfaceId: 'market-desk-responsive',
      label: 'Market Desk responsive layout',
      fallbackPath: path.join(evidenceDirectory, `market-desk-${testInfo.project.name}.png`),
    });
  }

  await marketIndexControl.selectOption('ghana');
  await expect(marketIndexControl).toBeFocused();
  await expect(page.locator('#market-history-title')).toContainText('AGRICULTURE');
  await expect(page.locator('#market-selected-index-name')).toHaveText('AGRICULTURE');
  await expect(page.locator('.market-current-price')).toContainText('$100');
  if (viewport.width >= 768 && viewport.width <= 1399) await page.locator('#market-view-trade').click();
  await expect(page.locator('.market-trade-ticket')).toBeVisible();
  if (process.env.POORUP_VISUAL_CAPTURE_DIR || ["desktop-1920x1080", "ipad-1024x768", "ipad-1194x834"].includes(testInfo.project.name)) {
    await captureScreenshot(page, testInfo, {
      group: 'market', surfaceId: 'market-desk-trade-ticket', label: 'Market Desk order ticket',
      fallbackPath: path.join('qa-artifacts/ui-refresh-2026-10-03/market-desk', `market-trade-ticket-${testInfo.project.name}.png`),
    });
  }
  await expect(page.locator('#market-desk-quantity')).toBeVisible();
  await expect(page.locator('[data-market-preview]')).toContainText('QUOTE $100');
  await expect(page.locator('[data-market-order-side="buy"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-market-order-side="sell"]')).toHaveAttribute('aria-pressed', 'false');
  const chartAndTicket = await page.evaluate(() => {
    const chart = document.querySelector('.market-quote-chart').getBoundingClientRect();
    const ticket = document.querySelector('.market-trade-ticket').getBoundingClientRect();
    return { chartBottom: chart.bottom, ticketBottom: ticket.bottom };
  });
  if (viewport.width >= 1400) expect(Math.abs(chartAndTicket.chartBottom - chartAndTicket.ticketBottom)).toBeLessThanOrEqual(2);
  await page.locator('#market-desk-quantity').fill('2');
  await page.locator('[data-market-order-side="sell"]').click();
  await expect(page.locator('[data-market-preview]')).toContainText('GROSS $200');
  await expect(page.locator('[data-market-preview]')).toContainText('NET PROCEEDS $196');
  await expect(page.locator('#market-order-submit .t-label')).toHaveText('SELL AGRICULTURE');
  await page.locator('[data-market-basic-order]').click();
  expect(await page.evaluate(() => window.__marketOrders)).toEqual([{
    eventName: 'market-order',
    payload: { instrumentId: 'ghana', side: 'sell', quantity: 2, requestId: 'market-qa-request' },
  }]);

  const desk = await page.locator('.market-desk-card').boundingBox();
  expect(desk.width).toBeLessThanOrEqual(viewport.width - 24);
  if (viewport.width >= 768) expect(desk.width).toBeGreaterThan(700);
  expect(await page.evaluate(() => document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight + 1)).toBe(true);

  const zoomedViewport = { width: Math.floor(viewport.width / 2), height: Math.floor(viewport.height / 2) };
  await page.setViewportSize(zoomedViewport);
  const zoomedDesk = await page.locator('.market-desk-card').boundingBox();
  expect(zoomedDesk.x).toBeGreaterThanOrEqual(0);
  expect(zoomedDesk.y).toBeGreaterThanOrEqual(0);
  expect(zoomedDesk.x + zoomedDesk.width).toBeLessThanOrEqual(zoomedViewport.width + 1);
  expect(zoomedDesk.y + zoomedDesk.height).toBeLessThanOrEqual(zoomedViewport.height + 1);
  expect(await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth + 1
    && document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight + 1)).toBe(true);
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
  const viewport = page.viewportSize();
  if (viewport.width >= 768 && viewport.width <= 1399) await page.locator('#market-view-trade').click();
  await page.locator('.market-advanced-settings > summary').click();
  await page.locator('#market-desk-option-side').selectOption('put');
  await page.locator('[data-market-advanced="open-option"]').click();
  const requests = await page.evaluate(() => window.__marketActions);
  expect(requests).toHaveLength(1);
  expect(requests[0].eventName).toBe('open-option');
  expect(requests[0].payload).toMatchObject({ instrumentId: 'brazil', side: 'put', role: 'writer' });
});

test('landscape iPad chart-range widget filters the chart summary without rendering a data table', async ({ page }) => {
  test.skip(page.viewportSize().width < 768 || page.viewportSize().width > 1399);
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

  const index = page.locator('#market-desk-index');
  await index.selectOption('canada');
  await page.evaluate(() => window.__refreshMarketDesk());

  await expect(index).toHaveValue('canada');
  await expect(page.locator('.market-derivatives-unavailable').first()).toContainText('SERVER PRICING POLICY NOT CONFIGURED');
  await expect(page.locator('#market-desk-role')).toHaveCount(0);
  await expect(page.locator('[data-market-advanced="open-option"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__marketActions)).toEqual([]);
});
