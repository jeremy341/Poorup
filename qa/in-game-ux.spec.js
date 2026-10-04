/* global window, document, getComputedStyle, process */
import { mkdir } from 'node:fs/promises';
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

test('in-game tile, deed, trade, and credit surfaces fit landscape viewports', async ({ page, context }, testInfo) => {
  test.skip(!process.env.POORUP_VISUAL_CAPTURE_DIR && !targetProjects.has(testInfo.project.name), 'Run on the legacy landscape regression viewport sizes or the full capture matrix.');
  test.setTimeout(120_000);
  const viewport = page.viewportSize();
  const size = `${viewport.width}x${viewport.height}`;
  const roomCode = process.env.POORUP_CAPTURE_SEED
    ? visualRoomCode('U', process.env.POORUP_CAPTURE_SEED, testInfo.project.name)
    : `U${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const guest = await createTwoPlayerGame(page, context, roomCode);

  await page.evaluate(async () => {
    const effect = await import('/clientDiceRollEffect.js');
    effect.showDiceRollTotal(9);
  });
  const diceTotal = page.locator('#view-game .dice-roll-total');
  await expect(diceTotal).toHaveText('9');
  await expect(diceTotal).toHaveAttribute('role', 'status');
  await expect(diceTotal).toHaveAttribute('aria-label', 'Dice total: 9');
  expect(await diceTotal.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: 'dice-roll-total', label: 'Dice total announcement',
    fallbackPath: path.join('test-results', 'in-game-ux', `${size}-dice-roll-total.png`),
  });

  await page.evaluate(async () => {
    const [stateModule, board, popup, deeds, bank, modals, surfaces, rail, deal, socket] = await Promise.all([
      import('/clientState.js'),
      import('/clientBoardData.js'),
      import('/clientPopupUi.js'),
      import('/clientDeedDetailUi.js'),
      import('/clientBankLoanUi.js'),
      import('/clientGameModalsUi.js'),
      import('/clientSurfaces.js'),
      import('/clientRailRender.js'),
      import('/clientDealUi.js'),
      import('/clientSocketListeners.js'),
    ]);
    const state = stateModule.state;
    state.boardVariant = 'standard-40';
    window.__poorupUxFixture = {
      state,
      board,
      popup,
      deeds,
      bank,
      modals,
      surfaces,
      rail,
      deal,
      socket,
      openInspector(tileIndex) { popup.openPopup(board.STANDARD_TILES[tileIndex]); },
      closeInspector() { popup.closePopup(); },
      openManager(tileIndex) {
        state.owners[tileIndex] = 'p1';
        deeds.openDeedDetail(tileIndex);
      },
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
          id,
          from: other.serverId,
          to: local.serverId,
          fromPlayerId: other.serverId,
          toPlayerId: local.serverId,
          fromPlayerName: other.name,
          toPlayerName: local.name,
          giveCash: 300,
          wantCash: 100,
          requestCash: 100,
          wantDeeds: [12],
          requestPropertyIndexes: [12],
          givePropertyIndexes: [],
          counterDepth: 0,
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
      renderTradeRail() {
        document.querySelector('#rr-body').innerHTML = rail.playerContractRailHTML('needs-you');
      },
      renderSocketOnlyOffer(id) {
        const local = state.players[0];
        const other = state.players.find(player => player.serverId !== local.serverId);
        state.pendingTrade = null;
        state.offers = [socket.normalizeTradeOffer({
          id,
          from: other.serverId,
          to: local.serverId,
          fromPlayerName: other.name,
          toPlayerName: local.name,
          giveCash: 200,
          requestCash: 100,
          requestPropertyIndexes: [12],
          givePropertyIndexes: [],
        })];
        document.querySelector('#rr-body').innerHTML = rail.playerContractRailHTML('needs-you');
      },
      openTradeDetails(id) { deal.openDealDetails('trade', id); },
      closeTradeDetails() { deal.closeDealDetails(); },
    };
  });

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

  const outputDir = path.resolve('test-results', 'in-game-ux');
  await mkdir(outputDir, { recursive: true });
  const docScroll = async () => page.evaluate(() => ({
    widthFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
    heightFits: document.documentElement.scrollHeight <= window.innerHeight + 1,
  }));
  const captureSurface = async (name, modal, action, args, closeAction, focusSelector) => {
    await page.evaluate(({ action: method, args: parameters }) => window.__poorupUxFixture[method](...parameters), { action, args });
    await expect(page.locator(modal)).not.toHaveClass(/is-hidden/);
    if (focusSelector) await expect.poll(() => page.evaluate(selector => document.activeElement?.matches(selector), focusSelector)).toBe(true);
    const geometry = await page.locator(`${modal} > .popup-card`).boundingBox();
    expect(geometry, `${name} card has bounds`).not.toBeNull();
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.y).toBeGreaterThanOrEqual(0);
    expect(geometry.x + geometry.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(geometry.y + geometry.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await docScroll(), `${name} should not scroll the document`).toEqual({ widthFits: true, heightFits: true });
    await captureScreenshot(page, testInfo, {
      group: 'game',
      surfaceId: name,
      label: name.replaceAll('-', ' '),
      fallbackPath: path.join(outputDir, `${size}-${name}.png`),
    });
    if (name === 'property-inspector') {
      const titleFont = await page.locator('#popup-card .dd-title').evaluate(element => getComputedStyle(element).fontFamily);
      expect(titleFont).toContain('Pixelify Sans');
    }
    await page.evaluate(method => window.__poorupUxFixture[method](), closeAction);
  };

  const inspectors = [
    ['property-inspector', 1, '#pop-close'],
    ['airport-inspector', 5, '#pop-close'],
    ['electric-inspector', 12, '#pop-close'],
    ['water-inspector', 28, '#pop-close'],
  ];
  for (const [name, tileIndex, focusId] of inspectors) {
    await captureSurface(name, '#popup', 'openInspector', [tileIndex], 'closeInspector', focusId);
  }

  const managers = [
    ['property-manager', 1, '#dd-close'],
    ['airport-manager', 5, '#dd-close'],
    ['electric-manager', 12, '#dd-close'],
    ['water-manager', 28, '#dd-close'],
  ];
  for (const [name, tileIndex, focusId] of managers) {
    await captureSurface(name, '#deed-modal', 'openManager', [tileIndex], 'closeManager', focusId);
  }

  await captureSurface('emergency-liquidity', '#bank-loan-modal', 'openBank', [], 'closeBank', '[data-bank-offer-cancel]');
  await page.evaluate(() => window.__poorupUxFixture.makeOffer(`visual-offer-${window.innerWidth}`));
  await expect(page.locator('#offer-modal')).not.toHaveClass(/is-hidden/);
  await expect(page.locator('#offer-close')).toHaveText('Close');
  await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: 'trade-offer', label: 'Trade offer inbox',
    fallbackPath: path.join(outputDir, `${size}-trade-offer.png`),
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
  await expect(page.locator('#offer-modal')).not.toHaveClass(/is-hidden/);
  await page.evaluate(() => document.querySelector('#offer-scrim').click());
  await expect(page.locator('#offer-modal')).toHaveClass(/is-hidden/);
  await page.evaluate(() => window.__poorupUxFixture.renderTradeRail());
  await expect(page.locator(`#rr-body [data-deal-view="trade:${scrimId}"]`)).toHaveCount(1);
  await page.locator(`#rr-body [data-deal-view="trade:${scrimId}"]`).click();
  await expect(page.locator('#deal-detail-modal')).not.toHaveClass(/is-hidden/);
  await expect(page.locator('#deal-detail-card')).toContainText('NEEDS YOU');
  await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: 'deals-row-detail', label: 'Pending deal details from Deals row',
    fallbackPath: path.join(outputDir, `${size}-deals-row-detail.png`),
  });
  await page.evaluate(() => window.__poorupUxFixture.closeTradeDetails());

  const socketOnlyId = `${scrimId}-snapshot-race`;
  await page.evaluate(id => window.__poorupUxFixture.renderSocketOnlyOffer(id), socketOnlyId);
  await expect(page.locator(`#rr-body [data-deal-view="trade:${socketOnlyId}"]`)).toHaveCount(1);
  await page.locator(`#rr-body [data-deal-view="trade:${socketOnlyId}"]`).click();
  await expect(page.locator('#deal-detail-card')).toContainText('NEEDS YOU');
  await expect(page.locator('#deal-detail-card [data-deal-action="accept"]')).toBeVisible();
  await expect(page.locator('#deal-detail-card [data-deal-action="adjust"]')).toHaveCount(0);
  await page.evaluate(() => window.__poorupUxFixture.closeTradeDetails());

  await page.setViewportSize({ width: Math.floor(viewport.width / 2), height: Math.floor(viewport.height / 2) });
  await page.evaluate(() => window.__poorupUxFixture.openInspector(12));
  await expect(page.locator('#popup')).not.toHaveClass(/is-hidden/);
  const zoomBounds = await page.locator('#popup-card').boundingBox();
  expect(zoomBounds).not.toBeNull();
  expect(zoomBounds.x).toBeGreaterThanOrEqual(0);
  expect(zoomBounds.y).toBeGreaterThanOrEqual(0);
  expect(zoomBounds.x + zoomBounds.width).toBeLessThanOrEqual(Math.floor(viewport.width / 2) + 1);
  expect(zoomBounds.y + zoomBounds.height).toBeLessThanOrEqual(Math.floor(viewport.height / 2) + 1);
  expect(await docScroll(), '200% effective viewport should not create document scrolling').toEqual({ widthFits: true, heightFits: true });
  await page.evaluate(() => window.__poorupUxFixture.closeInspector());
  await page.evaluate(() => window.__poorupUxFixture.openBank());
  await expect(page.locator('#bank-loan-modal')).not.toHaveClass(/is-hidden/);
  const bankScroll = await page.evaluate(() => {
    const content = document.querySelector('.bank-offer-content');
    const footer = document.querySelector('.bank-offer-actions').getBoundingClientRect();
    return { overflowY: getComputedStyle(content).overflowY, scrollHeight: content.scrollHeight, clientHeight: content.clientHeight, footerBottom: footer.bottom };
  });
  expect(bankScroll.overflowY).toBe('auto');
  expect(bankScroll.footerBottom).toBeLessThanOrEqual(Math.floor(viewport.height / 2) + 1);
  const hasInternalOverflow = bankScroll.scrollHeight > bankScroll.clientHeight + 1;
  if (hasInternalOverflow) {
    await page.evaluate(() => { const content = document.querySelector('.bank-offer-content'); content.scrollTop = content.scrollHeight; });
  }
  const scrollTop = await page.locator('.bank-offer-content').evaluate(element => element.scrollTop);
  const footerBottom = await page.locator('.bank-offer-actions').evaluate(element => element.getBoundingClientRect().bottom);
  if (hasInternalOverflow) expect(scrollTop).toBeGreaterThan(0);
  else expect(scrollTop).toBe(0);
  expect(footerBottom).toBeLessThanOrEqual(Math.floor(viewport.height / 2) + 1);
  expect(await docScroll(), 'bank terms either scroll internally or fit at 200% effective zoom').toEqual({ widthFits: true, heightFits: true });
  await page.evaluate(() => window.__poorupUxFixture.closeBank());
  await guest.close();
});
