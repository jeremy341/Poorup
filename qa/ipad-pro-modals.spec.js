/* global window, document, process */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { visualRoomCode } from './visual-capture/fixtures.mjs';
import { captureScreenshot } from './visual-capture/screenshot.mjs';

test('capture every in-game modal on supported landscape profiles', async ({ page, context }, testInfo) => {
  test.skip(!process.env.POORUP_VISUAL_CAPTURE_DIR && testInfo.project.name !== 'ipad-1194x834', 'This capture set targets iPad Pro 11-inch landscape outside the gallery runner.');
  test.setTimeout(120_000);
  const outputDir = path.resolve('qa-artifacts', 'ui-refresh-2026-10-03', 'ipad-pro-modal-gallery');
  await mkdir(outputDir, { recursive: true });
  const roomCode = process.env.POORUP_CAPTURE_SEED
    ? visualRoomCode('V', process.env.POORUP_CAPTURE_SEED, testInfo.project.name)
    : `V${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const guest = await context.newPage();

  await page.goto('/');
  await page.locator('#home-alias').fill('UXHOST');
  await page.locator('#open-join-btn').click();
  await expect(page.locator('#rooms-modal')).not.toHaveClass(/is-hidden/);
  await page.locator('#rm-tab-browse').click();
  await expect(page.locator('#rm-tab-browse')).toHaveAttribute('aria-selected', 'true');
  await captureScreenshot(page, testInfo, {
    group: 'lobby', surfaceId: 'room-browser', label: 'Room browser',
    fallbackPath: path.join(outputDir, 'lobby-room-browser.png'),
  });
  await page.locator('#rm-tab-create').click();
  await captureScreenshot(page, testInfo, {
    group: 'lobby', surfaceId: 'create-room-form', label: 'Create room form',
    fallbackPath: path.join(outputDir, 'lobby-create-room.png'),
  });
  await page.locator('#rm-tab-join').click();
  await captureScreenshot(page, testInfo, {
    group: 'lobby', surfaceId: 'join-room-form', label: 'Join room form',
    fallbackPath: path.join(outputDir, 'lobby-join-room.png'),
  });
  await page.locator('#rooms-close').click();
  await page.locator('#open-create-btn').click();
  await page.locator('#rc-vis-selector [data-vis="private"]').click();
  await page.locator('#rc-room-code').fill(roomCode);
  await page.locator('#rc-create-btn').click();
  await expect(page.locator('#setup-wrap')).not.toHaveAttribute('aria-hidden', 'true');
  await captureScreenshot(page, testInfo, {
    group: 'lobby', surfaceId: 'appearance-setup', label: 'Appearance setup',
    fallbackPath: path.join(outputDir, '00-appearance-setup.png'),
  });
  await page.locator('#su-start').click();

  await guest.goto('/');
  await guest.locator('#home-alias').fill('UXGUEST');
  await guest.locator('#open-join-btn').click();
  await guest.locator('#room-join').fill(roomCode);
  await guest.locator('#join-nickname').fill('UXGUEST');
  await guest.locator('#join-room-submit').click();
  await guest.locator('#su-start').click();
  await expect(page.locator('#lobby-settings-body')).toContainText('UXGUEST');
  await captureScreenshot(page, testInfo, {
    group: 'lobby', surfaceId: 'waiting-lobby', label: 'Two-player waiting lobby',
    fixtureId: 'synthetic-two-player-lobby',
    fallbackPath: path.join(outputDir, 'lobby-waiting-room.png'),
  });
  await page.locator('#lobby-start-btn').click();
  await expect(page.locator('#view-game')).toBeVisible();

  await page.evaluate(async () => {
    const [stateModule, board, boardRender, topNav, popup, game, auction, surfaces, trade, deal, deed, bank, wallet, market, casino, sponsorship, social, log, identity] = await Promise.all([
      import('/clientState.js'), import('/clientBoardData.js'), import('/clientBoardRender.js'), import('/clientTopNavRender.js'),
      import('/clientPopupUi.js'),
      import('/clientGameModalsUi.js'), import('/clientAuctionUi.js'), import('/clientSurfaces.js'),
      import('/clientTradeUi.js'), import('/clientDealUi.js'), import('/clientDeedDetailUi.js'),
      import('/clientBankLoanUi.js'), import('/clientWalletUi.js'), import('/clientMarketUi.js'),
      import('/clientCasinoUi.js'), import('/clientSponsorshipUi.js'), import('/clientSocialSurfaces.js'),
      import('/clientLogDrawer.js'), import('/clientAccountIdentity.js'),
    ]);
    const state = stateModule.state;
    const noAction = () => {};
    const local = state.players[0];
    const other = state.players.find(player => player.serverId !== local.serverId);
    const owned = [1, 5, 12, 28];
    state.phase = 'playing';
    state.settings.auction = false;
    state.settings.trading = true;
    state.settings.market = true;
    state.settings.casino = true;
    state.settings.bankAccountUpgrades = true;
    state.pendingDebt = null;
    state.pendingBuyTile = 5;
    state.owners = { 1: local.id, 5: local.id, 12: local.id, 28: local.id, 3: other.id, 15: other.id, 25: other.id };
    state.houses = { 1: 2 };
    local.cash = 1450;
    local.bankAccountTier = 2;
    local.bankAccount = { enabled: true, tier: 2, cashbackCap: 35, nextTier: { name: 'BLACK', cost: 500 } };
    local.bankAccountUpgrade = null;
    local.items = [{ itemId: 'double-rent-pass', name: 'Double Rent Pass', quantity: 1, description: 'Double rent on one landing.' }];
    state.economy.market = {
      enabled: true,
      complexity: 'derivatives',
      round: 7,
      feeRate: 0.02,
      quotes: { brazil: 92, ghana: 107, thailand: 83, netherlands: 116, switzerland: 124, canada: 98, japan: 111, korea: 103, southafrica: 88, world: 100, bonds: 101 },
      quoteHistory: [
        { round: 5, quotes: { brazil: 80 } },
        { round: 6, quotes: { brazil: 86 } },
        { round: 7, quotes: { brazil: 92 }, eventId: 'tourism-boom' },
      ],
      positions: { brazil: { quantity: 3, averageCost: 84, realizedPnl: 12 } },
      personalTrades: [],
      shorts: { positions: {} },
    };
    state.economy.casino = { enabled: true, maxBet: 500, entryFee: 0, lastResult: null, net: 0 };
    state.log = [
      'UXGUEST bought ACC AIRPORT for $200.',
      'UXHOST paid $75 premium tax.',
      'A trade offer is waiting for review.',
      'Auction opened for TORONTO.',
      'UXHOST collected $200 passing START.',
    ];
    state.settings.auction = false;
    state.offers = [];
    state.pendingTrade = null;
    state.sponsorship = null;
    state.unlockedAchievements ||= new Set();
    state.leaderboard = {
      ...state.leaderboard,
      metric: 'wins', scope: 'all', loading: false, error: '',
      rows: [
        { accountId: 'visual-alpha', displayName: 'UXHOST', username: 'uxhost', games: 8, wins: 5, value: 5, trend: { direction: 'up', delta: 2 } },
        { accountId: 'visual-beta', displayName: 'UXGUEST', username: 'uxguest', games: 6, wins: 3, value: 3, trend: { direction: 'flat', delta: 0 } },
      ],
      snapshots: { wins: [] },
    };

    trade.configureTradeUi({ emitServer: noAction, announceActionStatus: noAction, captureActionStatusNode: () => null, renderRightRail: noAction, recordActivity: noAction });
    game.configureGameModals({ emitServer: noAction, announceActionStatus: noAction, captureActionStatusNode: () => null, renderAll: noAction, buyTile: noAction, startGame: noAction, openHoldings: noAction, openTradeNegotiation: noAction, recordActivity: noAction });
    auction.configureAuctionUi({ emitServer: noAction, announceActionStatus: noAction, captureActionStatusNode: () => null });
    deal.configureDealUi({ emitServer: noAction, announceActionStatus: noAction, captureActionStatusNode: () => null, renderRightRail: noAction, openTradeNegotiation: noAction, openConfirmModal: noAction });
    bank.configureBankLoanUi({
      getOffer: () => ({ available: true, principal: 300, premium: 45, totalDue: 345, dueRound: 2, cureRound: 3, collateralName: 'NONE', severity: 'standard' }),
      openSurface: (...args) => surfaces.openSurface(...args),
      closeSurface: (...args) => surfaces.closeSurface(...args),
      emitServer: noAction,
    });
    market.configureMarketUi({ emitServer: noAction, createRequestId: () => 'visual-market', renderRightRail: noAction, announceActionStatus: noAction });
    casino.configureCasinoUi({ emitServer: noAction, createRequestId: () => 'visual-casino', renderRightRail: noAction, announceActionStatus: noAction });
    sponsorship.configureSponsorshipUi({ emitServer: noAction, announceActionStatus: noAction, captureActionStatusNode: () => null });

    const tradeOffer = {
      id: 'visual-trade-offer', from: other.serverId, to: local.serverId,
      fromPlayerId: other.serverId, toPlayerId: local.serverId,
      fromPlayerName: other.name, toPlayerName: local.name,
      giveCash: 300, requestCash: 100, wantCash: 100,
      givePropertyIndexes: [3], requestPropertyIndexes: [12], wantDeeds: [12],
      counterDepth: 0,
    };
    const pendingTrade = { ...tradeOffer, id: 'visual-pending-deal' };
    const sponsorshipOffer = {
      id: 'visual-sponsorship', buyerId: local.serverId, buyerName: local.name,
      tileIndex: 5, tileName: 'ACC AIRPORT', price: 200, mode: 'gift',
      totalContributed: 200, amountNeeded: 0,
      contributions: [{ sponsorId: other.serverId, sponsorName: other.name, amount: 200 }],
    };
    const marketLabels = market.MARKET_LABELS;
    window.__ipadModalCapture = {
      state, board, boardRender, topNav, popup, game, auction, surfaces, trade, deal, deed, bank, wallet, market, casino, sponsorship, social, log, identity,
      openTile(index) { popup.openPopup(board.STANDARD_TILES[index]); },
      closeTile() { popup.closePopup(); },
      openChoice() { state.pendingBuyTile = 5; game.openChoiceModal(board.STANDARD_TILES[5]); },
      closeChoice() { surfaces.closeSurface('#choice-modal', { force: true }); },
      openAuction() {
        state.settings.auction = true;
        state.auction = { tileIndex: 5, bid: 140, leaderId: null, deadline: Date.now() + 4500, caps: {}, passed: {} };
        auction.renderAuction();
        surfaces.openSurface('#auction-modal', '#auction-close');
      },
      closeAuction() { auction.stopAuctionTimer(); state.auction = null; surfaces.closeSurface('#auction-modal', { force: true }); },
      openCard(kind) {
        const tile = board.STANDARD_TILES.find(entry => entry.kind === kind);
        const deck = kind === 'chance' ? board.CHANCE_EVENTS : board.CHEST_EVENTS;
        game.openCardReveal(tile, deck.find(entry => entry.action === 'moveTo') || deck[0]);
      },
      closeCard() { state.card = null; surfaces.closeSurface('#card-modal'); },
      openCardGallery() { game.openCardGallery(); },
      closeCardGallery() { game.closeCardGallery(); },
      openTradeOffer() { state.pendingTrade = tradeOffer; state.offers = [tradeOffer]; game.openOfferModal(tradeOffer); },
      closeTradeOffer() { game.closeOfferWithoutResponse(); state.pendingTrade = null; state.offers = []; },
      openTradeBuilder() { trade.openTradeModal(other.id); },
      closeTradeBuilder() { trade.closeTradeModal(); },
      openPendingDeal() { state.pendingTrade = pendingTrade; state.offers = [pendingTrade]; deal.openDealDetails('trade', pendingTrade.id); },
      closePendingDeal() { deal.closeDealDetails(); state.pendingTrade = null; state.offers = []; },
      openDeed(index) { state.owners[index] = local.id; deed.openDeedDetail(index); },
      closeDeed() { deed.closeDeedDetail(); },
      openFinancing() { trade.openFinancingModal('loan', 5); },
      closeFinancing() { trade.closeFinancingModal(); },
      openBank() { bank.openBankLoanOffer(document.activeElement); },
      closeBank() { surfaces.closeSurface('#bank-loan-modal'); },
      openWallet(view) { wallet.openWalletModal(view); },
      closeWallet() { wallet.closeWalletModal(); },
      openMarket() { market.openMarketDesk(); },
      closeMarket() { market.closeMarketDesk(); },
      openCasino() { casino.openCasinoDesk(); },
      closeCasino() { casino.closeCasinoDesk(); },
      openPlayer() {
        state.selectedPlayer = { ...other, accountId: null, accountLinked: false, stats: { gamesPlayed: 12, wins: 5 }, achievements: [] };
        state.selectedPlayerRelationship = 'none';
        state.selectedPlayerView = 'profile';
        state.selectedPlayerHistory = null;
        social.renderPlayerSurface();
        surfaces.openSurface('#player-modal', '#player-modal-close');
      },
      closePlayer() { surfaces.closeSurface('#player-modal'); },
      openAccount() { identity.openAccountModal('login'); },
      closeAccount() { identity.closeAccountModal(); },
      openAchievement() { identity.openAchievementModal('first-deed'); },
      closeAchievement() { identity.closeAchievementModal(); },
      openRankingsOverlay() {
        social.renderRankingsSurface('#rankings-card');
        surfaces.openSurface('#rankings-modal', '#rankings-close');
      },
      closeRankingsOverlay() { surfaces.closeSurface('#rankings-modal'); },
      openSocialOverlay() {
        social.renderSocialSurface('#social-card');
        surfaces.openSurface('#social-modal', '#social-close');
      },
      closeSocialOverlay() { surfaces.closeSurface('#social-modal'); },
      openFundingRequest() { sponsorship.requestSponsorship(5); },
      openFundingActive() { state.sponsorship = sponsorshipOffer; sponsorship.openSponsorshipModal(sponsorshipOffer); },
      closeFunding() { state.sponsorship = null; surfaces.closeSurface('#sponsorship-modal', { force: true }); },
      openBankruptcy() { game.openBankruptcyModal(0, 275, other.serverId, 'Airport rent is due'); },
      closeBankruptcy() { surfaces.closeSurface('#bankruptcy-modal', { force: true }); },
      openRetirement() {
        state.phase = 'playing';
        state.pendingDebt = null;
        state.players[0].bankrupt = false;
        state.players[0].spectating = false;
        state.players[0].disconnected = false;
        game.openVoluntaryExitModal();
      },
      openConfirm() { surfaces.openConfirmModal({ title: 'Decline this deal?', message: 'The other player will see that this offer was declined.', confirmLabel: 'DECLINE DEAL', onConfirm: noAction }); },
      closeConfirm() { surfaces.closeConfirmModal(); },
      openLog() { state.log = state.log.slice(); document.querySelector('#log-toggle-btn').click(); },
      closeLog() { log.closeLogDrawer(); },
      openRoundOver() { game.showGameOver(other.name, other.id); },
      closeRoundOver() { surfaces.closeSurface('#gameover-modal'); state.gameOver = null; },
      openSetup() {},
      owned,
      tradeOffer,
      pendingTrade,
      sponsorshipOffer,
      marketLabels,
      setBoardVariant(variant) {
        state.boardVariant = variant;
        state.settings.boardVariant = variant;
        board.setBoardVariant(variant);
        boardRender.buildBoard(tile => popup.openPopup(tile));
        boardRender.renderBoardState();
        topNav.renderTopNav();
      },
    };
  });

  const capturedGameSurfaceIds = [];
  const capture = async (name, selector, openMethod, args = [], closeMethod) => {
    await page.evaluate(({ method, parameters }) => window.__ipadModalCapture[method](...parameters), { method: openMethod, parameters: args });
    if (selector === '#log-drawer') await expect(page.locator(selector)).toHaveClass(/is-open/);
    else await expect(page.locator(selector)).not.toHaveClass(/is-hidden/);
    if (selector === '#player-modal') {
      const playerCard = await page.locator('#player-card').boundingBox();
      expect(playerCard.width).toBeLessThanOrEqual(500);
      expect(playerCard.height).toBeLessThanOrEqual(802);
    }
    const surfaceId = name.replace(/^\d+-/, '').replace(/\.png$/, '');
    const screenshot = await captureScreenshot(page, testInfo, {
      group: 'game',
      surfaceId,
      label: surfaceId.replaceAll('-', ' '),
      fallbackPath: path.join(outputDir, name),
    });
    if (screenshot.status !== 'skipped') capturedGameSurfaceIds.push(surfaceId);
    await page.evaluate(method => window.__ipadModalCapture[method](), closeMethod);
    await expect.poll(() => page.evaluate(() => {
      const modals = [...document.querySelectorAll('.popup')].filter(element => !element.classList.contains('is-hidden')).length;
      return modals + (document.querySelector('#log-drawer')?.classList.contains('is-open') ? 1 : 0)
        + (document.querySelector('#card-gallery')?.classList.contains('is-hidden') ? 0 : 1);
    })).toBe(0);
  };

  const tileInspectors = [
    ['tile-property.png', 1],
    ['tile-airport.png', 5],
    ['tile-electric-company.png', 12],
    ['tile-water-company.png', 28],
    ['tile-earnings-tax.png', 4],
    ['tile-chance.png', 7],
    ['tile-treasure-chest.png', 2],
    ['tile-start.png', 0],
    ['tile-passing-by.png', 10],
    ['tile-vacation.png', 20],
    ['tile-go-to-prison.png', 30],
  ];
  await page.evaluate(() => window.__ipadModalCapture.setBoardVariant('standard-40'));
  const standardBoardCapture = await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: 'board-standard-40', label: 'Standard 40 board at rest',
    fallbackPath: path.join(outputDir, 'board-standard-40.png'),
  });
  if (standardBoardCapture.status !== 'skipped') capturedGameSurfaceIds.push('board-standard-40');

  await page.evaluate(() => window.__ipadModalCapture.setBoardVariant('metro-52'));
  await expect(page.locator('#board-grid')).toHaveAttribute('data-board-variant', 'metro-52');
  await expect(page.locator('#tn-lobby')).toContainText('METRO-52');
  const metroBoardCapture = await captureScreenshot(page, testInfo, {
    group: 'game', surfaceId: 'board-metro-52', label: 'Metro 52 board at rest',
    fallbackPath: path.join(outputDir, 'board-metro-52.png'),
  });
  if (metroBoardCapture.status !== 'skipped') capturedGameSurfaceIds.push('board-metro-52');
  await page.evaluate(() => window.__ipadModalCapture.setBoardVariant('standard-40'));

  for (const [file, index] of tileInspectors) await capture(file, '#popup', 'openTile', [index], 'closeTile');

  const modalCaptures = [
    ['12-purchase-choice-airport.png', '#choice-modal', 'openChoice', [], 'closeChoice'],
    ['13-live-auction.png', '#auction-modal', 'openAuction', [], 'closeAuction'],
    ['30-card-reveal-chance.png', '#card-modal', 'openCard', ['chance'], 'closeCard'],
    ['30-card-reveal-chest.png', '#card-modal', 'openCard', ['chest'], 'closeCard'],
    ['38-card-gallery.png', '#card-gallery', 'openCardGallery', [], 'closeCardGallery'],
    ['14-trade-offer-inbox.png', '#offer-modal', 'openTradeOffer', [], 'closeTradeOffer'],
    ['15-trade-builder.png', '#trade-modal', 'openTradeBuilder', [], 'closeTradeBuilder'],
    ['25-pending-deal-details.png', '#deal-detail-modal', 'openPendingDeal', [], 'closePendingDeal'],
    ['16-deed-manager-property.png', '#deed-modal', 'openDeed', [1], 'closeDeed'],
    ['17-deed-manager-airport.png', '#deed-modal', 'openDeed', [5], 'closeDeed'],
    ['18-deed-manager-electric-company.png', '#deed-modal', 'openDeed', [12], 'closeDeed'],
    ['19-deed-manager-water-company.png', '#deed-modal', 'openDeed', [28], 'closeDeed'],
    ['20-financing-builder-loan.png', '#financing-modal', 'openFinancing', [], 'closeFinancing'],
    ['21-emergency-bank-credit.png', '#bank-loan-modal', 'openBank', [], 'closeBank'],
    ['22-wallet-account.png', '#wallet-modal', 'openWallet', ['account'], 'closeWallet'],
    ['22-wallet-items.png', '#wallet-modal', 'openWallet', ['items'], 'closeWallet'],
    ['23-market-desk.png', '#market-modal', 'openMarket', [], 'closeMarket'],
    ['24-casino-desk.png', '#casino-modal', 'openCasino', [], 'closeCasino'],
    ['24-player-profile-from-table.png', '#player-modal', 'openPlayer', [], 'closePlayer'],
    ['26-purchase-funding-request.png', '#sponsorship-modal', 'openFundingRequest', [], 'closeFunding'],
    ['27-active-purchase-funding.png', '#sponsorship-modal', 'openFundingActive', [], 'closeFunding'],
    ['28-bankruptcy-payment.png', '#bankruptcy-modal', 'openBankruptcy', [], 'closeBankruptcy'],
    ['29-voluntary-retirement.png', '#bankruptcy-modal', 'openRetirement', [], 'closeBankruptcy'],
    ['31-confirm-deal-action.png', '#confirm-modal', 'openConfirm', [], 'closeConfirm'],
    ['32-event-log-drawer.png', '#log-drawer', 'openLog', [], 'closeLog'],
    ['33-round-over.png', '#gameover-modal', 'openRoundOver', [], 'closeRoundOver'],
    ['34-account-sign-in-modal.png', '#account-modal', 'openAccount', [], 'closeAccount'],
    ['35-achievement-detail-modal.png', '#achievement-modal', 'openAchievement', [], 'closeAchievement'],
    ['36-rankings-overlay.png', '#rankings-modal', 'openRankingsOverlay', [], 'closeRankingsOverlay'],
    ['37-social-overlay.png', '#social-modal', 'openSocialOverlay', [], 'closeSocialOverlay'],
  ];
  for (const [file, selector, opener, args, closer] of modalCaptures) await capture(file, selector, opener, args, closer);

  if (!process.env.POORUP_CAPTURE_GROUP || process.env.POORUP_CAPTURE_GROUP === 'all' || process.env.POORUP_CAPTURE_GROUP === 'game') {
    expect(capturedGameSurfaceIds).toHaveLength(43);
  } else {
    expect(capturedGameSurfaceIds).toHaveLength(0);
  }
  await guest.close();
});
