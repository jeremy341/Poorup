const moduleUrls = {
  state: '/clientState.js',
  board: '/clientBoardData.js',
  boardRender: '/clientBoardRender.js',
  topNav: '/clientTopNavRender.js',
  popup: '/clientPopupUi.js',
  game: '/clientGameModalsUi.js',
  auction: '/clientAuctionUi.js',
  surfaces: '/clientSurfaces.js',
  trade: '/clientTradeUi.js',
  deal: '/clientDealUi.js',
  deed: '/clientDeedDetailUi.js',
  bank: '/clientBankLoanUi.js',
  wallet: '/clientWalletUi.js',
  market: '/clientMarketUi.js',
  casino: '/clientCasinoUi.js',
  sponsorship: '/clientSponsorshipUi.js',
  social: '/clientSocialSurfaces.js',
  log: '/clientLogDrawer.js',
  identity: '/clientAccountIdentity.js',
};

async function loadCaptureModules() {
  const entries = await Promise.all(Object.entries(moduleUrls).map(async ([key, url]) => [key, await import(url)]));
  return Object.fromEntries(entries);
}

function seedCaptureState(modules) {
  const state = modules.state.state;
  const local = state.players[0];
  const other = state.players.find(player => player.serverId !== local.serverId);
  const owned = [1, 5, 12, 28];
  state.phase = 'playing';
  state.boardVariant = 'standard-40';
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
    enabled: true, complexity: 'derivatives', round: 7, feeRate: 0.02,
    quotes: { brazil: 92, ghana: 107, thailand: 83, netherlands: 116, switzerland: 124, canada: 98, japan: 111, korea: 103, southafrica: 88, world: 100, bonds: 101 },
    quoteHistory: [
      { round: 5, quotes: { brazil: 80 } },
      { round: 6, quotes: { brazil: 86 } },
      { round: 7, quotes: { brazil: 92 }, eventId: 'tourism-boom' },
    ],
    positions: { brazil: { quantity: 3, averageCost: 84, realizedPnl: 12 } },
    personalTrades: [], shorts: { positions: {} },
  };
  state.economy.casino = { enabled: true, maxBet: 500, entryFee: 0, lastResult: null, net: 0 };
  state.log = [
    'UXGUEST bought ACC AIRPORT for $200.', 'UXHOST paid $75 premium tax.',
    'A trade offer is waiting for review.', 'Auction opened for TORONTO.',
    'UXHOST collected $200 passing START.',
  ];
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
  return { state, local, other, owned };
}

function configureCaptureModules(modules) {
  const noAction = () => {};
  modules.trade.configureTradeUi({ emitServer: noAction, announceActionStatus: noAction, captureActionStatusNode: () => null, renderRightRail: noAction, recordActivity: noAction });
  modules.game.configureGameModals({ emitServer: noAction, announceActionStatus: noAction, captureActionStatusNode: () => null, renderAll: noAction, buyTile: noAction, startGame: noAction, openHoldings: noAction, openTradeNegotiation: noAction, recordActivity: noAction });
  modules.auction.configureAuctionUi({ emitServer: noAction, announceActionStatus: noAction, captureActionStatusNode: () => null });
  modules.deal.configureDealUi({ emitServer: noAction, announceActionStatus: noAction, captureActionStatusNode: () => null, renderRightRail: noAction, openTradeNegotiation: noAction, openConfirmModal: noAction });
  modules.bank.configureBankLoanUi({
    getOffer: () => ({ available: true, principal: 300, premium: 45, totalDue: 345, dueRound: 2, cureRound: 3, collateralName: 'NONE', severity: 'standard' }),
    openSurface: (...args) => modules.surfaces.openSurface(...args),
    closeSurface: (...args) => modules.surfaces.closeSurface(...args),
    emitServer: noAction,
  });
  modules.market.configureMarketUi({ emitServer: noAction, createRequestId: () => 'visual-market', renderRightRail: noAction, announceActionStatus: noAction });
  modules.casino.configureCasinoUi({ emitServer: noAction, createRequestId: () => 'visual-casino', renderRightRail: noAction, announceActionStatus: noAction });
  modules.sponsorship.configureSponsorshipUi({ emitServer: noAction, announceActionStatus: noAction, captureActionStatusNode: () => null });
}

function makeCaptureOffers({ local, other }) {
  const tradeOffer = {
    id: 'visual-trade-offer', from: other.serverId, to: local.serverId,
    fromPlayerId: other.serverId, toPlayerId: local.serverId,
    fromPlayerName: other.name, toPlayerName: local.name,
    giveCash: 300, requestCash: 100, wantCash: 100,
    givePropertyIndexes: [3], requestPropertyIndexes: [12], wantDeeds: [12], counterDepth: 0,
  };
  const pendingTrade = { ...tradeOffer, id: 'visual-pending-deal' };
  const sponsorshipOffer = {
    id: 'visual-sponsorship', buyerId: local.serverId, buyerName: local.name,
    tileIndex: 5, tileName: 'ACC AIRPORT', price: 200, mode: 'gift',
    totalContributed: 200, amountNeeded: 0,
    contributions: [{ sponsorId: other.serverId, sponsorName: other.name, amount: 200 }],
  };
  return { tradeOffer, pendingTrade, sponsorshipOffer };
}

function createBoardActions({ modules, state, local }) {
  return {
    openTile(index) { modules.popup.openPopup(modules.board.STANDARD_TILES[index]); },
    closeTile() { modules.popup.closePopup(); },
    openChoice() { state.pendingBuyTile = 5; modules.game.openChoiceModal(modules.board.STANDARD_TILES[5]); },
    closeChoice() { modules.surfaces.closeSurface('#choice-modal', { force: true }); },
    openAuction() {
      state.settings.auction = true;
      state.auction = { tileIndex: 5, bid: 140, leaderId: null, deadline: Date.now() + 4500, caps: {}, passed: {} };
      modules.auction.renderAuction();
      modules.surfaces.openSurface('#auction-modal', '#auction-close');
    },
    closeAuction() { modules.auction.stopAuctionTimer(); state.auction = null; modules.surfaces.closeSurface('#auction-modal', { force: true }); },
    openCard(kind) {
      const tile = modules.board.STANDARD_TILES.find(entry => entry.kind === kind);
      const deck = kind === 'chance' ? modules.board.CHANCE_EVENTS : modules.board.CHEST_EVENTS;
      modules.game.openCardReveal(tile, deck.find(entry => entry.action === 'moveTo') || deck[0]);
    },
    closeCard() { state.card = null; modules.surfaces.closeSurface('#card-modal'); },
    openCardGallery() { modules.game.openCardGallery(); },
    closeCardGallery() { modules.game.closeCardGallery(); },
    openDeed(index) { state.owners[index] = local.id; modules.deed.openDeedDetail(index); },
    closeDeed() { modules.deed.closeDeedDetail(); },
    setBoardVariant(variant) {
      state.boardVariant = variant;
      state.settings.boardVariant = variant;
      modules.board.setBoardVariant(variant);
      modules.boardRender.buildBoard(tile => modules.popup.openPopup(tile));
      modules.boardRender.renderBoardState();
      modules.topNav.renderTopNav();
    },
  };
}

function createTradeActions({ modules, state, other, tradeOffer, pendingTrade }) {
  return {
    openTradeOffer() { state.pendingTrade = tradeOffer; state.offers = [tradeOffer]; modules.game.openOfferModal(tradeOffer); },
    closeTradeOffer() { modules.game.closeOfferWithoutResponse(); state.pendingTrade = null; state.offers = []; },
    openTradeBuilder() { modules.trade.openTradeModal(other.id); },
    closeTradeBuilder() { modules.trade.closeTradeModal(); },
    openPendingDeal() { state.pendingTrade = pendingTrade; state.offers = [pendingTrade]; modules.deal.openDealDetails('trade', pendingTrade.id); },
    closePendingDeal() { modules.deal.closeDealDetails(); state.pendingTrade = null; state.offers = []; },
    openFinancing() { modules.trade.openFinancingModal('loan', 5); },
    closeFinancing() { modules.trade.closeFinancingModal(); },
  };
}

function createMarketActions(modules) {
  return {
    openWallet(view) { modules.wallet.openWalletModal(view); },
    closeWallet() { modules.wallet.closeWalletModal(); },
    openMarket() { modules.market.openMarketDesk(); },
    closeMarket() { modules.market.closeMarketDesk(); },
    openCasino() { modules.casino.openCasinoDesk(); },
    closeCasino() { modules.casino.closeCasinoDesk(); },
  };
}

function createFinanceActions({ modules, state, other, sponsorshipOffer }) {
  const noAction = () => {};
  return {
    openBank() { modules.bank.openBankLoanOffer(document.activeElement); },
    closeBank() { modules.surfaces.closeSurface('#bank-loan-modal'); },
    openFundingRequest() { modules.sponsorship.requestSponsorship(5); },
    openFundingActive() { state.sponsorship = sponsorshipOffer; modules.sponsorship.openSponsorshipModal(sponsorshipOffer); },
    closeFunding() { state.sponsorship = null; modules.surfaces.closeSurface('#sponsorship-modal', { force: true }); },
    openBankruptcy() { modules.game.openBankruptcyModal(0, 275, other.serverId, 'Airport rent is due'); },
    closeBankruptcy() { modules.surfaces.closeSurface('#bankruptcy-modal', { force: true }); },
    openRetirement() {
      state.phase = 'playing';
      state.pendingDebt = null;
      Object.assign(state.players[0], { bankrupt: false, spectating: false, disconnected: false });
      modules.game.openVoluntaryExitModal();
    },
    openConfirm() { modules.surfaces.openConfirmModal({ title: 'Decline this deal?', message: 'The other player will see that this offer was declined.', confirmLabel: 'DECLINE DEAL', onConfirm: noAction }); },
    closeConfirm() { modules.surfaces.closeConfirmModal(); },
  };
}

function createSocialActions({ modules, state, other }) {
  return {
    openPlayer() {
      state.selectedPlayer = { ...other, accountId: null, accountLinked: false, stats: { gamesPlayed: 12, wins: 5 }, achievements: [] };
      state.selectedPlayerRelationship = 'none';
      state.selectedPlayerView = 'profile';
      state.selectedPlayerHistory = null;
      modules.social.renderPlayerSurface();
      modules.surfaces.openSurface('#player-modal', '#player-modal-close');
    },
    closePlayer() { modules.surfaces.closeSurface('#player-modal'); },
    openRankingsOverlay() { modules.social.renderRankingsSurface('#rankings-card'); modules.surfaces.openSurface('#rankings-modal', '#rankings-close'); },
    closeRankingsOverlay() { modules.surfaces.closeSurface('#rankings-modal'); },
    openSocialOverlay() { modules.social.renderSocialSurface('#social-card'); modules.surfaces.openSurface('#social-modal', '#social-close'); },
    closeSocialOverlay() { modules.surfaces.closeSurface('#social-modal'); },
  };
}

function createIdentityActions(modules) {
  return {
    openAccount() { modules.identity.openAccountModal('login'); },
    closeAccount() { modules.identity.closeAccountModal(); },
    openAchievement() { modules.identity.openAchievementModal('first-deed'); },
    closeAchievement() { modules.identity.closeAchievementModal(); },
  };
}

function createMiscActions({ modules, state, other }) {
  return {
    openLog() { state.log = state.log.slice(); document.querySelector('#log-toggle-btn').click(); },
    closeLog() { modules.log.closeLogDrawer(); },
    openRoundOver() { modules.game.showGameOver(other.name, other.id); },
    closeRoundOver() { modules.surfaces.closeSurface('#gameover-modal'); state.gameOver = null; },
    openSetup() {},
  };
}

function createCaptureActions(modules, fixture, offers) {
  const { state, local, other, owned } = fixture;
  const { tradeOffer, pendingTrade, sponsorshipOffer } = offers;
  const context = { modules, state, local, other };
  return {
    ...modules, state, owned, tradeOffer, pendingTrade, sponsorshipOffer,
    marketLabels: modules.market.MARKET_LABELS,
    ...createBoardActions(context),
    ...createTradeActions({ ...context, tradeOffer, pendingTrade }),
    ...createMarketActions(modules),
    ...createFinanceActions({ ...context, sponsorshipOffer }),
    ...createSocialActions(context),
    ...createIdentityActions(modules),
    ...createMiscActions(context),
  };
}

async function installCaptureFixture() {
  const modules = await loadCaptureModules();
  const fixture = seedCaptureState(modules);
  const offers = makeCaptureOffers(fixture);
  configureCaptureModules(modules);
  window.__ipadModalCapture = createCaptureActions(modules, fixture, offers);
}

window.__installIpadModalCapture = installCaptureFixture;
