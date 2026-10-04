/* global window, document, getComputedStyle, process */
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { visualRoomCode } from './visual-capture/fixtures.mjs';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

const targetProjects = new Set([
  'ipad-1024x768',
  'ipad-1194x834',
  'desktop-1440x900',
]);

async function createTwoPlayerGame(page, context, code) {
  const guest = await context.newPage();
  await page.goto('/');
  await page.locator('#home-alias').fill('UXHOST');
  await page.locator('#open-create-btn').click();
  await page.locator('#rc-vis-selector [data-vis="private"]').click();
  await page.locator('#rc-room-code').fill(code);
  await page.locator('#rc-create-btn').click();
  await page.locator('#su-start').click();

  await guest.goto('/');
  await guest.locator('#home-alias').fill('UXGUEST');
  await guest.locator('#open-join-btn').click();
  await guest.locator('#room-join').fill(code);
  await guest.locator('#join-nickname').fill('UXGUEST');
  await guest.locator('#join-room-submit').click();
  await guest.locator('#su-start').click();
  await expect(page.locator('#lobby-settings-body')).toContainText('UXGUEST');
  await page.locator('#lobby-start-btn').click();
  await expect(page.locator('#view-game')).toBeVisible();
  return guest;
}

async function installUxFixture(page) {
  await page.evaluate(async () => {
    const [stateModule, board, popup, deeds, bank, modals, surfaces, rail, deal, socket] = await Promise.all([
      import('/clientState.js'), import('/clientBoardData.js'), import('/clientPopupUi.js'),
      import('/clientDeedDetailUi.js'), import('/clientBankLoanUi.js'), import('/clientGameModalsUi.js'),
      import('/clientSurfaces.js'), import('/clientRailRender.js'), import('/clientDealUi.js'),
      import('/clientSocketListeners.js'),
    ]);
    const state = stateModule.state;
    state.boardVariant = 'standard-40';
    window.__poorupUxFixture = {
      state, board, popup, deeds, bank, modals, surfaces, rail, deal, socket,
      openInspector(tileIndex) { popup.openPopup(board.STANDARD_TILES[tileIndex]); },
      closeInspector() { popup.closePopup(); },
      openManager(tileIndex) { state.owners[tileIndex] = 'p1'; deeds.openDeedDetail(tileIndex); },
      closeManager() { deeds.closeDeedDetail(); },
      openBank() {
        bank.configureBankLoanUi({
          getOffer: () => ({ available: true, principal: 300, premium: 45, totalDue: 345, dueRound: 2, cureRound: 3, collateralName: 'NONE', severity: 'standard' }),
          openSurface: (...args) => surfaces.openSurface(...args),
        });
        bank.openBankLoanOffer(document.activeElement);
      },
      closeBank() { surfaces.closeSurface('#bank-loan-modal'); },
      makeOffer(id) {
        const local = state.players[0];
        const other = state.players.find(player => player.serverId !== local.serverId);
        const offer = {
          id, from: other.serverId, to: local.serverId,
          fromPlayerId: other.serverId, toPlayerId: local.serverId,
          fromPlayerName: other.name, toPlayerName: local.name,
          giveCash: 300, wantCash: 100, requestCash: 100, wantDeeds: [12],
          requestPropertyIndexes: [12], givePropertyIndexes: [], counterDepth: 0,
        };
        state.pendingTrade = offer;
        state.offers = [{ ...offer, receivedAt: Date.now() }];
        modals.openOfferModal(offer);
        return offer.id;
      },
      closeOffer() { modals.closeOfferWithoutResponse(); },
      reopenOffer(id) {
        const offer = { ...state.offers[0], id };
        state.pendingTrade = offer;
        state.offers = [offer];
        modals.openOfferModal(offer);
      },
      renderTradeRail() { document.querySelector('#rr-body').innerHTML = rail.playerContractRailHTML('needs-you'); },
      renderSocketOnlyOffer(id) {
        const local = state.players[0];
        const other = state.players.find(player => player.serverId !== local.serverId);
        state.pendingTrade = null;
        state.offers = [socket.normalizeTradeOffer({
          id, from: other.serverId, to: local.serverId,
          fromPlayerName: other.name, toPlayerName: local.name,
          giveCash: 200, requestCash: 100, requestPropertyIndexes: [12], givePropertyIndexes: [],
        })];
        document.querySelector('#rr-body').innerHTML = rail.playerContractRailHTML('needs-you');
      },
      openTradeDetails(id) { deal.openDealDetails('trade', id); },
      closeTradeDetails() { deal.closeDealDetails(); },
    };
  });
}

function visualOutput(context) {
  return path.resolve('test-results', 'in-game-ux', `${context.size}-${context.name}.png`);
}

async function documentScroll(page) {
  return page.evaluate(() => ({
    widthFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
    heightFits: document.documentElement.scrollHeight <= window.innerHeight + 1,
  }));
}

async function captureSurface(context, surface) {
  const { page, testInfo, viewport } = context;
  await page.evaluate(({ method, args }) => window.__poorupUxFixture[method](...args), {
    method: surface.openMethod,
    args: surface.args || [],
  });
  await expect(page.locator(surface.modal)).not.toHaveClass(/is-hidden/);
  if (surface.focusSelector) {
    await expect.poll(() => page.evaluate(selector => document.activeElement?.matches(selector), surface.focusSelector)).toBe(true);
  }
  const geometry = await page.locator(`${surface.modal} > .popup-card`).boundingBox();
  expect(geometry, `${surface.name} card has bounds`).not.toBeNull();
  expect(geometry.x).toBeGreaterThanOrEqual(0);
  expect(geometry.y).toBeGreaterThanOrEqual(0);
  expect(geometry.x + geometry.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(geometry.y + geometry.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(await documentScroll(page), `${surface.name} should not scroll the document`).toEqual({ widthFits: true, heightFits: true });
  await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: surface.name, label: surface.name.replaceAll('-', ' '),
    fallbackPath: visualOutput({ ...context, name: surface.name }),
  });
  if (surface.name === 'property-inspector') {
    const titleFont = await page.locator('#popup-card .dd-title').evaluate(element => getComputedStyle(element).fontFamily);
    expect(titleFont).toContain('Pixelify Sans');
  }
  await page.evaluate(method => window.__poorupUxFixture[method](), surface.closeMethod);
}

async function captureSurfaceSet(context, surfaces) {
  for (const surface of surfaces) await captureSurface(context, surface);
}

async function showDiceTotal(context) {
  const { page, testInfo } = context;
  await page.evaluate(async () => (await import('/clientDiceRollEffect.js')).showDiceRollTotal(9));
  const diceTotal = page.locator('#view-game .dice-roll-total');
  await expect(diceTotal).toHaveText('9');
  await expect(diceTotal).toHaveAttribute('role', 'status');
  await expect(diceTotal).toHaveAttribute('aria-label', 'Dice total: 9');
  expect(await diceTotal.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: 'dice-roll-total', label: 'Dice total announcement',
    fallbackPath: visualOutput({ ...context, name: 'dice-roll-total' }),
  });
}

async function verifyCornerIsNotInteractive(page) {
  const corner = page.locator('#board-grid .tile[data-tile="0"]');
  await expect(corner).toHaveAttribute('aria-disabled', 'true');
  await corner.evaluate(element => element.click());
  await expect(page.locator('#popup')).toHaveClass(/is-hidden/);
  await page.locator('#board-grid .tile[data-tile="1"]').focus();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset.tile)).toBe('0');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(page.locator('#popup')).toHaveClass(/is-hidden/);
}

async function verifyTradeOfferLifecycle(context) {
  const { page, testInfo } = context;
  const outputPath = name => visualOutput({ ...context, name });
  await page.evaluate(() => window.__poorupUxFixture.makeOffer(`visual-offer-${window.innerWidth}`));
  await expect(page.locator('#offer-modal')).not.toHaveClass(/is-hidden/);
  await expect(page.locator('#offer-close')).toHaveText('Close');
  await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: 'trade-offer', label: 'Trade offer inbox',
    fallbackPath: outputPath('trade-offer'),
  });

  const pendingId = await page.evaluate(() => window.__poorupUxFixture.state.pendingTrade.id);
  await page.locator('#offer-close').click();
  await expect(page.locator('#offer-modal')).toHaveClass(/is-hidden/);
  expect(await page.evaluate(() => window.__poorupUxFixture.state.pendingTrade.id)).toBe(pendingId);
  await page.evaluate(id => window.__poorupUxFixture.reopenOffer(id), pendingId);
  await expect(page.locator('#offer-modal')).toHaveClass(/is-hidden/);

  const counterId = `${pendingId}-counter`;
  await page.evaluate(id => window.__poorupUxFixture.reopenOffer(id), counterId);
  await expect(page.locator('#offer-modal')).not.toHaveClass(/is-hidden/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#offer-modal')).toHaveClass(/is-hidden/);
  const scrimId = `${counterId}-scrim`;
  await page.evaluate(id => window.__poorupUxFixture.reopenOffer(id), scrimId);
  await page.evaluate(() => document.querySelector('#offer-scrim').click());
  await expect(page.locator('#offer-modal')).toHaveClass(/is-hidden/);

  await verifyPendingDealFromRail(context, scrimId, outputPath);
  await verifySocketSnapshotOffer(page, scrimId);
}

async function verifyPendingDealFromRail(context, offerId, outputPath) {
  const { page, testInfo } = context;
  await page.evaluate(() => window.__poorupUxFixture.renderTradeRail());
  const dealRow = page.locator(`#rr-body [data-deal-view="trade:${offerId}"]`);
  await expect(dealRow).toHaveCount(1);
  await dealRow.click();
  await expect(page.locator('#deal-detail-modal')).not.toHaveClass(/is-hidden/);
  await expect(page.locator('#deal-detail-card')).toContainText('NEEDS YOU');
  await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: 'deals-row-detail', label: 'Pending deal details from Deals row',
    fallbackPath: outputPath('deals-row-detail'),
  });
  await page.evaluate(() => window.__poorupUxFixture.closeTradeDetails());
}

async function verifySocketSnapshotOffer(page, offerId) {
  const socketOnlyId = `${offerId}-snapshot-race`;
  await page.evaluate(id => window.__poorupUxFixture.renderSocketOnlyOffer(id), socketOnlyId);
  const dealRow = page.locator(`#rr-body [data-deal-view="trade:${socketOnlyId}"]`);
  await expect(dealRow).toHaveCount(1);
  await dealRow.click();
  await expect(page.locator('#deal-detail-card')).toContainText('NEEDS YOU');
  await expect(page.locator('#deal-detail-card [data-deal-action="accept"]')).toBeVisible();
  await expect(page.locator('#deal-detail-card [data-deal-action="adjust"]')).toHaveCount(0);
  await page.evaluate(() => window.__poorupUxFixture.closeTradeDetails());
}

async function verifyZoomAndBankScroll(context) {
  const { page, viewport } = context;
  const zoomSize = { width: Math.floor(viewport.width / 2), height: Math.floor(viewport.height / 2) };
  await page.setViewportSize(zoomSize);
  await page.evaluate(() => window.__poorupUxFixture.openInspector(12));
  await expect(page.locator('#popup')).not.toHaveClass(/is-hidden/);
  const bounds = await page.locator('#popup-card').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(zoomSize.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(zoomSize.height + 1);
  expect(await documentScroll(page), '200% effective viewport should not create document scrolling').toEqual({ widthFits: true, heightFits: true });
  await page.evaluate(() => window.__poorupUxFixture.closeInspector());
  await verifyBankModalScroll(page, zoomSize);
}

async function verifyBankModalScroll(page, zoomSize) {
  await page.evaluate(() => window.__poorupUxFixture.openBank());
  await expect(page.locator('#bank-loan-modal')).not.toHaveClass(/is-hidden/);
  const bankScroll = await page.evaluate(() => {
    const content = document.querySelector('.bank-offer-content');
    const footer = document.querySelector('.bank-offer-actions').getBoundingClientRect();
    return { overflowY: getComputedStyle(content).overflowY, scrollHeight: content.scrollHeight, clientHeight: content.clientHeight, footerBottom: footer.bottom };
  });
  expect(bankScroll.overflowY).toBe('auto');
  expect(bankScroll.footerBottom).toBeLessThanOrEqual(zoomSize.height + 1);
  const hasInternalOverflow = bankScroll.scrollHeight > bankScroll.clientHeight + 1;
  if (hasInternalOverflow) await page.locator('.bank-offer-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  const scrollTop = await page.locator('.bank-offer-content').evaluate(element => element.scrollTop);
  const footerBottom = await page.locator('.bank-offer-actions').evaluate(element => element.getBoundingClientRect().bottom);
  if (hasInternalOverflow) expect(scrollTop).toBeGreaterThan(0);
  else expect(scrollTop).toBe(0);
  expect(footerBottom).toBeLessThanOrEqual(zoomSize.height + 1);
  expect(await documentScroll(page), 'bank terms either scroll internally or fit at 200% effective zoom').toEqual({ widthFits: true, heightFits: true });
  await page.evaluate(() => window.__poorupUxFixture.closeBank());
}

async function runInGameUxScenario({ page, context, testInfo }) {
  const viewport = page.viewportSize();
  const size = `${viewport.width}x${viewport.height}`;
  const roomCode = process.env.POORUP_CAPTURE_SEED
    ? visualRoomCode('U', process.env.POORUP_CAPTURE_SEED, testInfo.project.name)
    : `U${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const guest = await createTwoPlayerGame(page, context, roomCode);
  const captureContext = { page, testInfo, viewport, size };

  await showDiceTotal(captureContext);
  await installUxFixture(page);
  await verifyCornerIsNotInteractive(page);

  const inspectors = [
    { name: 'property-inspector', index: 1 }, { name: 'airport-inspector', index: 5 },
    { name: 'electric-inspector', index: 12 }, { name: 'water-inspector', index: 28 },
  ].map(tile => ({ ...tile, modal: '#popup', openMethod: 'openInspector', args: [tile.index], closeMethod: 'closeInspector', focusSelector: '#pop-close' }));
  await captureSurfaceSet(captureContext, inspectors);

  const managers = [
    { name: 'property-manager', index: 1 }, { name: 'airport-manager', index: 5 },
    { name: 'electric-manager', index: 12 }, { name: 'water-manager', index: 28 },
  ].map(tile => ({ ...tile, modal: '#deed-modal', openMethod: 'openManager', args: [tile.index], closeMethod: 'closeManager', focusSelector: '#dd-close' }));
  await captureSurfaceSet(captureContext, managers);
  await captureSurface(captureContext, {
    name: 'emergency-liquidity', modal: '#bank-loan-modal', openMethod: 'openBank',
    closeMethod: 'closeBank', focusSelector: '[data-bank-offer-cancel]',
  });
  await verifyTradeOfferLifecycle(captureContext);
  await verifyZoomAndBankScroll(captureContext);
  await guest.close();
}

test('in-game tile, deed, trade, and credit surfaces fit landscape viewports', async ({ page, context }, testInfo) => {
  test.skip(!process.env.POORUP_VISUAL_CAPTURE_DIR && !targetProjects.has(testInfo.project.name), 'Run on the legacy landscape regression viewport sizes or the full capture matrix.');
  test.setTimeout(120_000);
  await runInGameUxScenario({ page, context, testInfo });
});
