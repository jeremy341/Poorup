import { test, expect } from '@playwright/test';

async function installTurnFixture(page) {
  await page.evaluate(async () => {
    const [{ state }, { renderHud }, rail, deeds] = await Promise.all([
      import('/clientState.js'), import('/clientHudRender.js'), import('/clientRailRender.js'), import('/clientDeedDetailUi.js'),
    ]);
    Object.assign(state, {
      clientId: 'local-client',
      phase: 'playing',
      turnIndex: 1,
      turnStage: 'roll',
      busy: false,
      presentationBusy: false,
      rolling: false,
      players: [
        { id: 'p1', clientId: 'local-client', name: 'LOCAL', cash: 120, visualCash: 95, textColor: '#e8d3ab', online: true },
        { id: 'p2', clientId: 'remote-client', name: 'OTHER', cash: 900, bot: true, textColor: '#e8d3ab', online: true },
      ],
      owners: {},
      houses: {},
      mortgaged: {},
      jail: {},
      dice: [2, 3],
      pool: 0,
      pendingBuyTile: null,
      auction: null,
      sponsorship: null,
      settings: { startingCash: 1500, houseLimit: 32, hotelLimit: 12 },
    });
    window.__turnUi = { state, renderHud, renderRightRail: rail.renderRightRail, tradePlayerRowHTML: rail.tradePlayerRowHTML, openDeedDetail: deeds.openDeedDetail };
    renderHud();
  });
}

test('HUD uses the local player cash, identifies the current turn, and gates presentation-time actions', async ({ page }) => {
  await page.goto('/');
  await installTurnFixture(page);

  await expect(page.locator('#hud-cash')).toHaveText('$95');
  await expect(page.locator('#hud-name')).toHaveText('OTHER');
  await expect(page.locator('#hud-turn-label')).toHaveAttribute('aria-label', 'Current turn: OTHER');
  await expect(page.locator('#hud-stage')).toHaveCount(0);
  await expect(page.locator('#hud-bot-status, #hud-loan-status, #hud-note')).toHaveCount(0);

  await page.evaluate(() => {
    window.__turnUi.state.turnIndex = 0;
    window.__turnUi.state.presentationBusy = true;
    window.__turnUi.renderHud();
  });
  await expect(page.locator('#roll-btn')).toBeDisabled();
});

test('event log is a nonmodal dock and preserves a reader position when new entries arrive', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ state }, drawer, surfaces] = await Promise.all([
      import('/clientState.js'), import('/clientLogDrawer.js'), import('/clientSurfaces.js'),
    ]);
    state.log = Array.from({ length: 30 }, (_, index) => `ENTRY ${index}`);
    document.querySelector('#view-home')?.classList.add('is-hidden');
    document.querySelector('#view-game')?.classList.remove('is-hidden');
    window.__turnUi = { state, drawer, surfaces };
    drawer.toggleLogDrawerFromButton();
  });

  const log = page.locator('#log-drawer');
  await expect(log).not.toHaveAttribute('aria-modal');
  await expect(log).toHaveAttribute('role', 'region');
  await expect.poll(() => page.evaluate(() => window.__turnUi.surfaces.visibleSurfaces().some(surface => surface.id === 'log-drawer'))).toBe(false);
  const body = page.locator('#drawer-body');
  await body.evaluate(element => { element.scrollTop = 0; });
  await page.evaluate(() => {
    window.__turnUi.state.log = [...window.__turnUi.state.log, 'LATEST ENTRY'];
    window.__turnUi.drawer.renderLogDrawer();
  });
  await expect(body).toHaveJSProperty('scrollTop', 0);
  await expect(page.locator('[data-log-new-status]')).toHaveText('NEW ENTRIES AVAILABLE');
});

test('event log remains reachable when the right rail is hidden, without changing the saved layout', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('poorup-panel-visibility-v1', JSON.stringify({ players: true, chat: true, rightRail: false, hud: 'full' }));
  });
  for (let visit = 0; visit < 2; visit += 1) {
    await page.goto('/');
    await installTurnFixture(page);
    await page.evaluate(() => {
      document.querySelector('#view-home').classList.add('is-hidden');
      document.querySelector('#view-game').classList.remove('is-hidden');
      window.__turnUi.state.log = ['LOCAL mortgaged a deed.', 'RIVAL rolled 5.'];
    });
    await expect(page.locator('#right-rail-game')).toBeHidden();
    await page.locator('#log-toggle-btn').click();
    await expect(page.locator('#log-drawer')).toBeVisible();
    await expect(page.locator('#log-toggle-btn')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#board-frame')).toHaveJSProperty('inert', false);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('poorup-panel-visibility-v1')).rightRail)).toBe(false);
    if (visit === 0) await page.screenshot({ path: testInfo.outputPath('log-hidden-rail.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(page.locator('#log-toggle-btn')).toBeFocused();
    await expect(page.locator('#log-drawer')).toBeHidden();
    await expect(page.locator('#right-rail-game')).toBeHidden();
  }
});

test('a debtor can reopen a dismissed payment dialog and confirm bankruptcy after trying holdings', async ({ page }, testInfo) => {
  await page.goto('/');
  await installTurnFixture(page);
  await page.evaluate(async () => {
    const [sync, modals, surfaces] = await Promise.all([
      import('/clientStateSync.js'), import('/clientGameModalsUi.js'), import('/clientSurfaces.js'),
    ]);
    const { state, renderHud } = window.__turnUi;
    document.querySelector('#view-home').classList.add('is-hidden');
    document.querySelector('#view-game').classList.remove('is-hidden');
    state.roomCode = 'DEBT1';
    state.gameStarted = true;
    state.debtRescueDismissed = false;
    const snapshot = {
      room: { roomCode: 'DEBT1', visibility: 'private', settings: { boardVariant: 'standard-40' } },
      game: {
        started: true, currentPlayerId: 'server-local', roundNumber: 1, hasRolled: true, awaitingEndTurn: true,
        turnOrder: ['server-local', 'server-other'], tiles: [], feed: [], lastDice: [2, 3],
        players: [
          { id: 'server-local', clientId: 'local-client', nickname: 'LOCAL', cash: 40, position: 0, inDebt: true },
          { id: 'server-other', clientId: 'remote-client', nickname: 'RIVAL', cash: 900, position: 0 },
        ],
        pendingPayment: { playerId: 'server-local', amountRemaining: 200, creditorId: null, reason: 'Tax is due' },
      },
    };
    const host = {
      setConnectionStatus() {}, gameViewVisible: () => true, showView() {}, renderAll: renderHud,
      startPieceWalk: () => Promise.resolve(), openAuctionSurface() {}, closeAuctionSurface() {},
      retireButton: () => document.querySelector('#game-retire-btn'),
      bankruptcyHidden: () => document.querySelector('#bankruptcy-modal').classList.contains('is-hidden'),
      hideBankruptcyModal: () => surfaces.closeSurface('#bankruptcy-modal', { force: true }),
      openBankruptcyModal: modals.openBankruptcyModal, showGameOver() {}, placePiecesSoon() {},
    };
    window.__debtRequests = [];
    modals.configureGameModals({ emitServer(action, payload, callback) {
      window.__debtRequests.push(action);
      callback?.({ success: true });
    } });
    window.__refreshDebt = () => sync.applyServerState(snapshot, host);
    window.__refreshDebt();
  });
  await expect(page.locator('#bankruptcy-modal')).toBeVisible();
  await page.locator('#bank-dismiss').click();
  await page.evaluate(() => window.__refreshDebt());
  await expect(page.locator('#bankruptcy-modal')).toBeHidden();
  await expect(page.locator('#game-retire-btn')).toBeEnabled();
  await page.locator('#game-retire-btn').click();
  await expect(page.locator('#bankruptcy-card-title')).toHaveText('$200 due');
  await page.locator('#bank-liquidate').click();
  await page.evaluate(() => window.__refreshDebt());
  await expect(page.locator('#bankruptcy-modal')).toBeHidden();
  await page.locator('#game-retire-btn').click();
  await page.screenshot({ path: testInfo.outputPath('debt-return.png'), animations: 'disabled' });
  await page.locator('#bank-declare').click();
  await expect.poll(() => page.evaluate(() => window.__debtRequests)).toEqual([]);
  await page.locator('#bank-declare-confirm').click();
  await expect.poll(() => page.evaluate(() => window.__debtRequests)).toEqual(['declare-bankruptcy']);
  await expect(page.locator('#bankruptcy-modal')).toBeHidden();
});

test('holdings list property groups first, then airports, then utilities in board order', async ({ page }) => {
  await page.goto('/');
  await installTurnFixture(page);
  await page.evaluate(() => {
    const { state, renderRightRail } = window.__turnUi;
    state.owners = { 1: 'p1', 3: 'p1', 5: 'p1', 6: 'p1', 8: 'p1', 12: 'p1' };
    renderRightRail();
  });
  await expect.poll(() => page.locator('#rr-body [data-deed-open]').evaluateAll(elements => elements.map(element => element.dataset.deedOpen))).toEqual(['1', '3', '6', '8', '5', '12']);
});

test('sidebar cash follows presentation cash when the local player is not taking a turn', async ({ page }) => {
  await page.goto('/');
  await installTurnFixture(page);
  await page.evaluate(() => {
    const { state, renderRightRail, tradePlayerRowHTML } = window.__turnUi;
    state.players[0].visualCash = 95;
    state.players[1].visualCash = 775;
    state.players[1].bot = false;
    state.tab = 'holdings';
    renderRightRail();
    document.querySelector('#rr-body').insertAdjacentHTML('beforeend', tradePlayerRowHTML(state.players[1], 2));
  });
  await expect(page.locator('.holdings-account strong')).toContainText('$95');
  await expect(page.locator('.trade-player-row .tp-sub')).toContainText('$775');
  await expect(page.locator('#roll-btn')).toBeDisabled();
});

test('deed cash readout is staged while build affordability stays tied to authoritative cash', async ({ page }) => {
  await page.goto('/');
  await installTurnFixture(page);
  await page.evaluate(() => {
    const { state, openDeedDetail } = window.__turnUi;
    state.players[0].cash = 120;
    state.players[0].visualCash = 0;
    state.owners = { 1: 'p1', 3: 'p1' };
    state.houses = {};
    state.mortgaged = {};
    state.deedDetail = null;
    openDeedDetail(1);
  });
  await expect(page.locator('#deed-card-detail')).toContainText('YOUR CASH');
  await expect(page.locator('#deed-card-detail')).toContainText('$0');
  await expect(page.locator('#dd-buy')).toBeEnabled();
});

test('deed manager explains cash reserved for the current auction bid', async ({ page }, testInfo) => {
  await page.goto('/');
  await installTurnFixture(page);
  await page.evaluate(() => {
    const { state, openDeedDetail } = window.__turnUi;
    state.owners = { 3: 'p1' };
    state.mortgaged = { 3: true };
    state.serverTiles = [{ index: 3, propertyActions: { unmortgage: {
      enabled: false, cost: 33, reason: 'Keep enough cash to cover your current auction bid.',
    } } }];
    openDeedDetail(3);
  });
  await expect(page.locator('#dd-mortgage')).toBeDisabled();
  await expect(page.locator('#dd-mortgage-reason')).toHaveText('Keep enough cash to cover your current auction bid.');
  await expect(page.locator('#dd-mortgage')).toHaveAttribute('aria-describedby', 'dd-mortgage-reason');
  await page.locator('#dd-mortgage-reason').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('auction-reserved-cash.png'), animations: 'disabled' });
});
