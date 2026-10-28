import { createMarketQuotePoint, freshMarketQuotes, MARKET_INSTRUMENTS } from './marketLogic.js';
import {
  equityShareContractLive,
  playerContractSummary,
  processContracts,
  proposeContract,
  proposeEquityShareTransfer,
  counterContract,
  adjustContract,
  expireStaleContract,
  repayContract,
  respondContract,
  settleEquityShares
} from './contractLogic.js';
import {
  bankLoanOffer,
  bankLoanTerms,
  defaultBankLoan,

  processBankLoans,
  repayBankLoan,
  takeBankLoan
} from './loanLogic.js';
import {
  canBuildOnTile,
  canMortgageTile,
  canSellFromTile,
  canUnmortgageTile,
  isTradeableTile
} from './propertyRules.js';
import { DEFAULT_ROOM_SETTINGS, stripRetiredRoomSettings } from './roomSettings.js';
import { resolveRuleset } from './rulesetRegistry.js';
import {
  JAIL_FINE,
  JAIL_MAX_TURNS,
  ROUND_LIMIT,
  START_TILE_INDEX,
  rollDice,
  shuffleArray
} from './gameData.js';
import { netWorth, netWorthBreakdown } from './netWorth.js';
import { globalEventsApi } from './globalEventsApi.js';
import { rentApi } from './rentApi.js';
import { tileApi } from './tileApi.js';
import { airportApi } from './airportApi.js';
import { bankAccountApi } from './bankAccountApi.js';
import { cardApi } from './cardApi.js';
import { itemApi } from './itemApi.js';
import { propertyApi } from './propertyApi.js';
import { AUCTION_DURATION_MS, auctionApi } from './auctionApi.js';
import { economyApi } from './economyApi.js';
import { tradeApi } from './tradeApi.js';
import { sponsorshipApi } from './sponsorshipApi.js';
import { bankruptcyApi } from './bankruptcyApi.js';
import { APPEARANCE_PRESET_COLORS, appearanceApi } from './appearanceApi.js';
import { botApi } from './botApi.js';
import { Room, RoomManager } from './rooms.js';
import { summaryApi } from './summaryApi.js';
import { decksForVariant, tileIndexById, tilesForVariant } from './boardRegistry.js';
import { appendPublicAction } from './publicActionHistory.js';
import { recordPresentationCash } from './gamePresentation.js';
import { gamePresentationApi } from './gamePresentationApi.js';

// Net-worth rows kept per game; the stored match record keeps a downsampled copy of at most 40.
const NET_WORTH_TIMELINE_LIMIT = 400;

const PLAYER_STATE_DEFAULTS = [
  ['cash', (player, settings) => settings.startingCash],
  ['position', () => START_TILE_INDEX],
  ['properties', () => []],
  ['inJail', false],
  ['jailTurns', 0],
  ['jailFreeCards', 0],
  ['jailFreeOrigins', () => []],
  ['items', () => []],
  ['bankLoan', null],
  ['casinoNet', 0],
  ['casinoLedger', () => []],
  ['casinoMaxStake', 0],
  ['casinoTotalStaked', 0],
  ['casinoAllIn', false],
  ['casinoOneDollar', false],
  ['casinoBetsThisRound', 0],
  ['marketPositions', () => ({})],
  ['marginBalance', 0],
  ['marginMaintenance', 0],
  ['marginCollateral', 0],
  ['marginPositions', () => ({})],
  ['shortPositions', () => ({})],
  ['shortDefaultDebt', 0],
  ['optionPositions', () => []],
  ['reservedCash', 0],
  ['bankAccount', () => ({ tier: 1, cashbackEarned: 0, ledger: [], requests: [] })],
  ['marketTrades', 0],
  ['marketActionsThisTurn', 0],
  ['crisisMarketBuys', () => ({})],
  ['crisisMarketProfit', false],
  ['playerContractIds', () => []],
  // Bots get one pre-roll deal window per turn. This prevents a resolved
  // offer from being immediately reopened forever while still allowing the
  // normal human finance flow to remain unrestricted.
  ['botDealActionsThisTurn', 0],
  ['auctionWins', 0],
  ['tradesCompleted', 0],
  ['rentCollected', 0],
  ['globalEventsExperienced', 0],
  ['globalEventsSurvived', 0],
  ['fullGroups', () => new Set()],
  ['airportVisits', () => new Set()],
  ['taxTilesVisited', () => new Set()],
  ['rentPayerIds', () => new Set()],
  ['rentPayersThisRound', () => new Set()],
  ['maxRentPayersInRound', 0],
  ['auctionUnderListWins', 0],
  ['loanWarningSeen', false],
  ['badIdeaLoan', false],
  ['prisonBreak', false],
  ['bankLoanCount', 0],
  ['boughtDuringHousingBubble', false],
  ['soldBuildingsDuringHousingBubble', 0],
  ['bubbleSurvivor', false],
  ['rebuiltAfterHousingBubble', false],
  ['foreclosureNoSecondLoan', false],
  ['housingBubbleEnded', false],
  ['airportOwnedDuringStrike', false],
  ['nonAirportRentDuringStrike', false],
  ['tradesDuringCombo', 0],
  ['groupTherapyTrade', false],
  ['unanimousVote', false],
  ['publicEnemy', false],
  ['compromisedCouncil', false],
  ['coalitionTrade', false],
  ['lastVoteChoice', null],
  ['bailoutReceived', false],
  ['moralHazard', false],
  ['zeroCashReached', false],
  ['collateralLost', false],
  ['comboExperienced', false],
  ['buildActionsThisTurn', 0],
  ['evenBuilds', 0],
  ['councilWins', 0],
  ['publicWorksBuilds', 0],
  ['cardDraws', () => ({ surprise: 0, treasure: 0 })],
  ['treasureCardsSeen', () => new Set()],
  ['underdogAtHalfway', false],
  ['oneMoreTurn', false],
  ['taxAuditCount', 0],
  ['moveCount', 0],
  ['hiddenMovementSequence', false],
  ['bankrupt', false],
  ['spectating', false],
  ['inDebt', false],
  ['ready', false],
  ['disconnected', false],
  ['disconnectDeadline', 0],
];

function isHumanActionSeat(player) {
  if (!player) return false;
  if (player.isBot) return false;
  if (player.bankrupt) return false;
  return !player.disconnected;
}

function isCurrentTurnPlayer(player, currentPlayerId) {
  if (!player) return false;
  return player.id === currentPlayerId;
}

function endTurnRequiresExtraRoll(game) {
  if (game.extraRollPending) return true;
  return Boolean(game.turnAllowsExtraRoll);
}

class BoundedReplayMap extends Map {
  constructor(limit = 1_000, ttlMs = 15 * 60_000) {
    super();
    this.limit = limit;
    this.ttlMs = ttlMs;
    this.timestamps = new Map();
    this.terminal = new Map();
  }

  set(key, value) {
    this.purge();
    if (this.terminal.has(key)) return this;
    super.set(key, value);
    this.timestamps.set(key, Date.now());
    while (this.size > this.limit) super.delete(this.keys().next().value);
    while (this.timestamps.size > this.limit) {
      const oldest = this.timestamps.keys().next().value;
      this.timestamps.delete(oldest);
      this.rememberTerminal(oldest, Date.now() + this.ttlMs);
    }
    return this;
  }

  get(key) {
    this.purge();
    if (this.terminal.has(key)) return { success: false, error: 'REQUEST_ID_EXPIRED' };
    return super.get(key);
  }

  has(key) {
    this.purge();
    return super.has(key) || this.terminal.has(key);
  }

  delete(key) {
    this.timestamps.delete(key);
    this.terminal.delete(key);
    return super.delete(key);
  }

  clear() {
    this.timestamps.clear();
    this.terminal.clear();
    return super.clear();
  }

  purgeExpiredTimestamps(now) {
    for (const [key, timestamp] of this.timestamps) {
      if (now - timestamp < this.ttlMs) continue;
      super.delete(key);
      this.timestamps.delete(key);
      this.rememberTerminal(key, now + this.ttlMs);
    }
  }

  purgeExpiredTerminals(now) {
    for (const [key, expiresAt] of this.terminal) {
      if (expiresAt > now) continue;
      this.terminal.delete(key);
    }
  }

  purge(now = Date.now()) {
    this.purgeExpiredTimestamps(now);
    this.purgeExpiredTerminals(now);
  }

  rememberTerminal(key, expiresAt) {
    this.terminal.set(key, expiresAt);
    while (this.terminal.size > this.limit) this.terminal.delete(this.terminal.keys().next().value);
  }
}

function activeCollateralContract(contract) {
  const supportedKind = ['loan', 'hybrid'].includes(contract.kind);
  const activeStatus = ['active', 'due'].includes(contract.status);
  return supportedKind && activeStatus;
}

function contractCollateralIndices(contract) {
  const indices = contract.collateralTileIndices;
  if (Array.isArray(indices) && indices.length) return indices;
  return [contract.collateralTileIndex];
}

export function contractPledgesTile(contract, player, tile) {
  if (!activeCollateralContract(contract)) return false;
  if (contract.toPlayerId !== player.id) return false;
  if (contract.kind === 'hybrid' && Number(contract.propertyIndex) === Number(tile.index)) return true;
  return contractCollateralIndices(contract).some(index => index != null && Number(index) === Number(tile.index));
}

class GameState {
  constructor(settings) {
    const suppliedSettings = stripRetiredRoomSettings(settings);
    // An omitted Advanced finance switch defaults on; the Standard default
    // must not turn an explicitly selected Advanced game off.
    const seed = { ...DEFAULT_ROOM_SETTINGS, ...suppliedSettings };
    if (suppliedSettings.rulesProfile === 'advanced' && suppliedSettings.playerFinance === undefined) delete seed.playerFinance;
    this.ruleset = resolveRuleset({ settings: seed, rulesetOverrides: seed.rulesetOverrides, boardVariant: seed.boardVariant });
    this.settings = { ...seed, ...this.ruleset.effectiveSettings, rulesetOverrides: this.ruleset.rulesetOverrides.map(entry => ({ ...entry })) };
    this.settings.boardVariant = this.ruleset.boardVariant;
    this.settings.rulesetRevision = this.ruleset.rulesetRevision;
    this.boardVariant = this.ruleset.boardVariant;
    this.rulesetDigest = this.ruleset.digest;
    this.reset();
  }

  reset() {
    this.tiles = tilesForVariant(this.boardVariant);
    this.players = [];
    this.turnOrder = [];
    this.currentPlayerId = null;
    this.lastDice = [0, 0];
    this.diceRollSequence = 0;
    this.presentation = null;
    this._activePresentation = null;
    this.hasRolled = false;
    this.consecutiveDoubles = 0;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.pendingPurchaseOffer = null;
    this.pendingSponsoredPurchase = null;
    this.started = false;
    this.startedAt = null;
    this.feed = [];
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPlayerContract = null;
    this.playerContracts = [];
    this.contractTransactions = new BoundedReplayMap();
    this.tradeTransactions = new BoundedReplayMap();
    this.tradesCompleted = 0;
    this.auctionsCompleted = 0;
    this.pendingPayment = null;
    this.pendingPaymentQueue = [];
    this.pendingPaymentTurnOptions = null;
    this.pendingPaymentHooks = null;
    this.defaultClaims = [];
    this.borrowerNotices = [];
    this.lastWinner = null;
    this.lastEndReason = null;
    this.finalNetWorthById = null;
    this.vacationPool = 0;
    this.roundNumber = 0;
    this.globalEvent = null;
    this.globalEventHistory = [];
    this.globalEventCooldown = 0;
    this.globalEventsTriggered = 0;
    this.globalEventTriggerSource = null;
    this.midpointMarked = false;
    this.casinoLastResult = null;
    this.casinoLedger = [];
    this.marketLedger = [];
    this.economyTransactions = new BoundedReplayMap();
    this.marketQuotes = freshMarketQuotes();
    this.marketQuoteHistory = [createMarketQuotePoint(this, 0, null)];
    this.marketOptionReserve = 100_000;
    this.marketShortInventory = {};
    this.marketInstruments = MARKET_INSTRUMENTS;
    this.marketRound = 0;
    this.marketModifierEventKey = null;
    this.botDecisionSequence = 0;
    this.botDecisionTrace = [];
    this.publicActionHistory = [];
    this.netWorthTimeline = [];
    this.humanActionCount = 0;
    this.afkTurnCount = 0;
    this.telemetryLog = [];
    this.itemTransactions = new Map();
    const decks = decksForVariant(this.boardVariant, this.settings);
    this.surpriseDeck = decks.surprise.map(card => ({ ...card }));
    this.treasureDeck = decks.treasure.map(card => ({ ...card }));
  }

  resetPlayerState(player) {
    PLAYER_STATE_DEFAULTS.forEach(([key, value]) => {
      player[key] = typeof value === 'function' ? value(player, this.settings) : value;
    });
  }

  addPlayer(player) {
    this.resetPlayerState(player);
    this.players.push(player);
    this.feedMessage(`${player.nickname} joined the room.`);
    return player;
  }

  recordTelemetryEvent(kind, data = {}) {
    if (!Array.isArray(this.telemetryLog)) this.telemetryLog = [];
    const safeData = data && typeof data === 'object' ? { ...data } : {};
    this.telemetryLog.push({
      kind: String(kind || '').slice(0, 40),
      data: safeData,
      roundNumber: Math.max(0, Number(this.roundNumber) || 0)
    });
    if (this.telemetryLog.length > 200) this.telemetryLog.splice(0, this.telemetryLog.length - 200);
  }

  recordHumanAction(player) {
    if (!isHumanActionSeat(player)) return;
    this.humanActionCount = Math.max(0, Math.floor(Number(this.humanActionCount) || 0)) + 1;
  }

  recordPublicAction(player, actionKind) {
    const seatIndex = this.players.indexOf(player);
    if (seatIndex < 0) return false;
    return appendPublicAction(this.publicActionHistory, actionKind, seatIndex, this.roundNumber);
  }

  resetForNewGame() {
    this.presentation = null;
    this._activePresentation = null;
    this.boardVariant = this.settings.boardVariant || this.boardVariant || 'standard-40';
    this.tiles = tilesForVariant(this.boardVariant);
    this.currentPlayerId = null;
    this.turnOrder = [];
    this.lastDice = [0, 0];
    this.hasRolled = false;
    this.consecutiveDoubles = 0;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.pendingPurchaseOffer = null;
    this.pendingSponsoredPurchase = null;
    this.started = false;
    this.startedAt = Date.now();
    this.feed = [];
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPlayerContract = null;
    this.playerContracts = [];
    this.contractTransactions = new BoundedReplayMap();
    this.tradeTransactions = new BoundedReplayMap();
    this.tradesCompleted = 0;
    this.auctionsCompleted = 0;
    this.pendingPayment = null;
    this.pendingPaymentQueue = [];
    this.pendingPaymentTurnOptions = null;
    this.pendingPaymentHooks = null;
    this.syncDebtFlags();
    this.defaultClaims = [];
    this.borrowerNotices = [];
    this.lastWinner = null;
    this.lastEndReason = null;
    this.finalNetWorthById = null;
    this.vacationPool = 0;
    this.roundNumber = 1;
    this.globalEvent = null;
    this.globalEventHistory = [];
    this.globalEventCooldown = 0;
    this.globalEventsTriggered = 0;
    this.globalEventTriggerSource = null;
    this.midpointMarked = false;
    this.casinoLastResult = null;
    this.casinoLedger = [];
    this.marketLedger = [];
    this.globalEventVoteTransactions = null;
    this.economyTransactions = new BoundedReplayMap();
    this.marketQuotes = freshMarketQuotes();
    this.marketQuoteHistory = [createMarketQuotePoint(this, 0, null)];
    this.marketOptionReserve = 100_000;
    this.marketShortInventory = Object.fromEntries(Object.keys(this.marketQuotes).map(id => [id, 50]));
    this.marketInstruments = MARKET_INSTRUMENTS;
    this.marketRound = 0;
    this.marketModifierEventKey = null;
    this.botDecisionSequence = 0;
    this.botDecisionTrace = [];
    this.publicActionHistory = [];
    this.netWorthTimeline = [];
    this.humanActionCount = 0;
    this.afkTurnCount = 0;
    this.telemetryLog = [];
    this.itemTransactions = new Map();
    const decks = decksForVariant(this.boardVariant, this.settings);
    this.surpriseDeck = decks.surprise.map(card => ({ ...card }));
    this.treasureDeck = decks.treasure.map(card => ({ ...card }));
    this.players.forEach(player => {
      // A seat still inside its reconnect grace stays disconnected across a
      // rematch: its expiry timer is still armed, and clearing the flag here
      // would leave a connected ghost that the timer cannot release.
      const { disconnected, disconnectDeadline } = player;
      this.resetPlayerState(player);
      player.disconnected = disconnected;
      player.disconnectDeadline = disconnectDeadline;
    });
  }

  removePlayerBySocket(socketId) {
    const index = this.players.findIndex(player => player.socketId === socketId);
    if (index !== -1) {
      this.players.splice(index, 1);
    }
  }

  removePlayerByClient(clientId) {
    const index = this.players.findIndex(player => player.clientId === clientId);
    if (index !== -1) {
      this.players.splice(index, 1);
    }
  }

  removePlayerFromTurnOrder(playerId) {
    if (!playerId || !Array.isArray(this.turnOrder)) return false;
    const originalLength = this.turnOrder.length;
    this.turnOrder = this.turnOrder.filter(id => id !== playerId);
    return this.turnOrder.length !== originalLength;
  }

  getPlayerBySocket(socketId) {
    return this.players.find(player => player.socketId === socketId);
  }

  getPlayerByClient(clientId) {
    return this.players.find(player => player.clientId === clientId);
  }

  getPlayerById(id) {
    return this.players.find(player => player.id === id);
  }

  getTile(index) {
    return this.tiles.find(tile => tile.index === index);
  }

  tileIndexForId(tileId) {
    const index = tileIndexById(this.boardVariant, tileId);
    return index == null ? null : index;
  }

  getTileById(tileId) {
    const index = this.tileIndexForId(tileId);
    return index == null ? null : this.getTile(index);
  }

  getGroupTiles(group) {
    return this.tiles.filter(tile => tile.group === group && tile.type === 'property');
  }

  totalBuildings() {
    return this.tiles.reduce((sum, tile) => sum + Math.max(0, Math.min(5, Number(tile.houseCount) || 0)), 0);
  }

  totalCash() {
    return this.activePlayers().reduce((sum, player) => sum + Math.max(0, Number(player.cash) || 0), 0);
  }

  playerGroups(player) {
    if (!player) return [];
    return [...new Set(player.properties.map(index => this.getTile(index)?.group).filter(Boolean))];
  }

  refreshPlayerGroups(player) {
    if (!player) return;
    if (!(player.fullGroups instanceof Set)) player.fullGroups = new Set();
    const complete = this.playerGroups(player).filter(group => this.hasFullSet(player.id, group));
    complete.forEach(group => player.fullGroups.add(group));
  }

  playerContractById(contractId) {
    return this.playerContracts.find(contract => contract.id === contractId) || null;
  }

  playerContractSummary(viewerPlayerId = null) {
    return playerContractSummary(this, viewerPlayerId);
  }

  proposePlayerContract(socketId, offer = {}) {
    return proposeContract(this, socketId, offer);
  }

  proposeEquityShareTransfer(socketId, offer = {}) {
    return proposeEquityShareTransfer(this, socketId, offer);
  }

  counterPlayerContract(socketId, offer = {}) {
    return counterContract(this, socketId, offer);
  }

  adjustPlayerContract(socketId, offer = {}) {
    return adjustContract(this, socketId, offer);
  }

  respondPlayerContract(socketId, accept, requestId = null, contractId = null) {
    return respondContract(this, socketId, accept, requestId, contractId);
  }

  expireStaleContract(nowMs, ttlMs) {
    return expireStaleContract(this, nowMs, ttlMs);
  }

  repayPlayerContract(socketId, payload = {}) {
    return repayContract(this, socketId, payload);
  }

  processPlayerContracts() {
    processContracts(this);
  }

  settleEquityShares(tile, owner, amountPaid, payer = null) {
    settleEquityShares(this, tile, owner, amountPaid, payer);
  }

  isLoanCollateral(player, tile) {
    return Boolean(player?.bankLoan?.status === 'active' || player?.bankLoan?.status === 'due')
      && Number(player.bankLoan.collateralTileIndex) === Number(tile?.index);
  }

  isPlayerContractCollateral(player, tile) {
    if (!player || !tile) return false;
    return this.playerContracts?.some(contract => contractPledgesTile(contract, player, tile)) || false;
  }

  highestCollateralProperty(player) {
    if (!player?.properties) return null;
    const eligible = player.properties
      .map(index => this.getTile(index))
      .filter(tile => this.collateralEligibleTile(player, tile));
    return eligible.sort((a, b) => (b.price || 0) - (a.price || 0))[0] || null;
  }

  collateralEligibleTile(player, tile) {
    if (!tile) return false;
    if (tile.type !== 'property') return false;
    if (tile.mortgaged) return false;
    if (tile.houseCount > 0) return false;
    if (tile.equityShares?.length) return false;
    return !this.isPlayerContractCollateral(player, tile);
  }

  isTradeableTile(tile) {
    return isTradeableTile(this, tile);
  }

  canBuildOnTile(player, tile) {
    return canBuildOnTile(this, player, tile);
  }

  canSellFromTile(player, tile) {
    return canSellFromTile(this, player, tile);
  }

  canMortgageTile(player, tile) {
    return canMortgageTile(this, player, tile);
  }

  canUnmortgageTile(player, tile) {
    return canUnmortgageTile(this, player, tile);
  }

  applyPropertyOwnershipChange(fromPlayer, toPlayer, tile, { preserveMortgage = false } = {}) {
    this.terminateTileEquityShares(tile);
    this.resetDeedTile(tile, toPlayer, { preserveMortgage });
    // A trade or claim has no reliably attributable per-deed cash price, so
    // the last bank/auction acquisition basis follows the deed unchanged.
    // Legacy deeds first transferred without a basis use their printed price.
    if (toPlayer && !(tile.purchasePricePaid != null && Number.isFinite(Number(tile.purchasePricePaid)) && Number(tile.purchasePricePaid) >= 0)) {
      tile.purchasePricePaid = Math.max(0, Math.floor(Number(tile.price) || 0));
    }
    if (!toPlayer) tile.purchasePricePaid = null;
    this.detachDeedFromOwner(fromPlayer, tile);
    this.attachDeedToOwner(toPlayer, tile);
  }

  terminateTileEquityShares(tile) {
    const shares = Array.isArray(tile?.equityShares) ? tile.equityShares : [];
    shares.forEach(share => {
      const contract = this.playerContractById(share.contractId);
      if (!equityShareContractLive(contract)) return;
      contract.status = 'terminated';
      contract.terminatedRound = this.roundNumber;
    });
  }

  resetDeedTile(tile, toPlayer, { preserveMortgage = false } = {}) {
    tile.ownerId = toPlayer ? toPlayer.id : null;
    if (!preserveMortgage) tile.mortgaged = false;
    tile.houseCount = 0;
    tile.equityShares = [];
  }

  detachDeedFromOwner(fromPlayer, tile) {
    if (!fromPlayer) return;
    fromPlayer.properties = fromPlayer.properties.filter(propertyIndex => propertyIndex !== tile.index);
    // A bubble-survivor deed must remain in the original owner's hands
    // through recovery; transferring it invalidates that achievement fact.
    if (!fromPlayer.bubbleSurvivor) return;
    if (!fromPlayer.housingBubbleEnded) return;
    fromPlayer.bubbleSurvivor = fromPlayer.properties.some(index => (this.getTile(index)?.houseCount || 0) > 0);
  }

  attachDeedToOwner(toPlayer, tile) {
    if (!toPlayer) return;
    if (!toPlayer.properties.includes(tile.index)) toPlayer.properties.push(tile.index);
    this.refreshPlayerGroups(toPlayer);
  }

  feedMessage(text) {
    this.feed.unshift({ text, timestamp: Date.now() });
    if (this.feed.length > 40) {
      this.feed.length = 40;
    }
  }

  canJoin() {
    if (this.started) {
      return false;
    }
    // Every retained seat consumes capacity, bots included. A room that counts only active humans can exceed its advertised
    // seat limit after a round ends or when bots are kept for a rematch. Eliminated seats are revived by resetForNewGame,
    // so they hold capacity before a match too.
    return this.players.length < this.settings.maxPlayers;
  }

  activePlayers() {
    return this.players.filter(player => !player.bankrupt && !player.disconnected);
  }

  nonBankruptPlayers() {
    return this.players.filter(player => !player.bankrupt);
  }

  connectedNonBankruptPlayers() {
    return this.players.filter(player => !player.bankrupt && !player.disconnected);
  }

  configureStartOrder() {
    // Seats still in reconnect grace keep their turn-order slot: their turns
    // are skipped while they are away, exactly as mid-game, and resume if they
    // reconnect. The first turn goes to a connected seat.
    const active = [...this.players].filter(p => !p.bankrupt);
    if (this.settings.randomizePlayerOrder) {
      shuffleArray(active);
    }
    this.turnOrder = active.map(p => p.id);
    this.currentPlayerId = active.find(p => !p.disconnected)?.id || null;
    this.hasRolled = false;
    this.awaitingEndTurn = false;
  }

  getCurrentPlayer() {
    return this.getPlayerById(this.currentPlayerId);
  }

  startGame() {
    if (this.started) {
      return { success: false, error: 'Game has already started.' };
    }
    if (this.players.filter(player => !player.disconnected).length < 2) {
      return { success: false, error: 'At least two players are required.' };
    }
    this.resetForNewGame();
    this.started = true;
    this.startedAt = Date.now();
    this.configureStartOrder();
    this.feedMessage('The game begins. Players take turns clockwise.');
    return { success: true };
  }

  rollTurnRejection(player) {
    const playerId = player?.id;
    const blocker = [
      [!playerId, 'Player not found.'],
      [!this.started, 'Game has not started.'],
      [playerId !== this.currentPlayerId, 'It is not your turn.'],
      [this.hasPendingDebt(playerId), 'Settle your debt before rolling.'],
      [this.pendingPurchaseOffer?.playerId === playerId, 'Resolve the property offer before rolling.'],
      [this.pendingSponsoredPurchase?.buyerId === playerId, 'Resolve the sponsorship before rolling.'],
      [Boolean(this.auction?.active), 'Finish the active auction before rolling.'],
    ].find(([blocked]) => blocked);
    return blocker ? { success: false, error: blocker[1] } : null;
  }

  setTurnDice(dice) {
    this.lastDice = dice;
    this.diceRollSequence += 1;
    this.hasRolled = true;
    this.turnAllowsExtraRoll = dice[0] === dice[1];
    this.extraRollPending = this.turnAllowsExtraRoll;
    if (this.turnAllowsExtraRoll) {
      this.consecutiveDoubles += 1;
    } else {
      this.consecutiveDoubles = 0;
    }
  }

  sendRollerToJail(player) {
    this.recordPresentationMove(player, this.tiles.find(tile => tile.type === 'jail').index, { cause: 'three-doubles', teleport: true });
    player.position = this.tiles.find(tile => tile.type === 'jail').index;
    player.inJail = true;
    player.jailTurns = 0;
    this.consecutiveDoubles = 0;
    this.turnAllowsExtraRoll = false;
    this.extraRollPending = false;
    this.hasRolled = false;
    this.feedMessage(`${player.nickname} rolled three doubles and was sent to Jail.`);
    this.nextTurn();
    return { success: true };
  }

  handleJailRoll(player) {
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    const dice = rollDice();
    this.lastDice = dice;
    this.diceRollSequence += 1;
    this.hasRolled = true;
    this.turnAllowsExtraRoll = false;
    this.extraRollPending = false;
    this.consecutiveDoubles = 0;
    if (dice[0] === dice[1]) {
      player.inJail = false;
      player.jailTurns = 0;
      this.feedMessage(`${player.nickname} rolled doubles and escaped jail!`);
      return this.movePlayer(player, dice[0] + dice[1], { allowExtraRoll: false });
    }
    player.jailTurns = (player.jailTurns || 0) + 1;
    if (player.jailTurns >= JAIL_MAX_TURNS) {
      if (player.cash >= JAIL_FINE) {
        player.cash -= JAIL_FINE;
        player.inJail = false;
        player.jailTurns = 0;
        this.feedMessage(`${player.nickname} paid $${JAIL_FINE} to leave jail after ${JAIL_MAX_TURNS} turns.`);
        return this.movePlayer(player, dice[0] + dice[1], { allowExtraRoll: false });
      }
      this.feedMessage(`${player.nickname} could not pay the jail fine and remains in jail. Mortgage, sell buildings, or declare bankruptcy to raise the fine.`);
    } else {
      this.feedMessage(`${player.nickname} failed to roll doubles in jail (turn ${player.jailTurns}/${JAIL_MAX_TURNS}).`);
    }
    this.awaitingEndTurn = true;
    return { success: true, message: 'You remain in jail. End your turn when ready.' };
  }

  payJailFine(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    if (!this.started) {
      return { success: false, error: 'Game has not started.' };
    }
    if (player.id !== this.currentPlayerId) {
      return { success: false, error: 'It is not your turn.' };
    }
    if (!player.inJail) {
      return { success: false, error: 'You are not in jail.' };
    }
    if (this.hasRolled) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    if (this.hasPendingDebt(player.id)) {
      return { success: false, error: 'Settle your debt before paying the jail fine.' };
    }
    if (player.cash < JAIL_FINE) {
      return { success: false, error: `You need $${JAIL_FINE} to pay the jail fine.` };
    }
    player.cash -= JAIL_FINE;
    player.inJail = false;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} paid $${JAIL_FINE} to leave jail.`);
    return { success: true, message: 'You left jail. Roll the dice to move.' };
  }

  useJailFree(socketId, itemId = null) {
    const player = this.getPlayerBySocket(socketId);
    const rejection = this.jailFreeRejection(player);
    if (rejection) return rejection;
    if (!this.consumePrisonItem(player, itemId)) return { success: false, error: 'You do not own this prison card.' };
    player.prisonBreak = true;
    player.inJail = false;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} used a Get Out of Prison card.`);
    return { success: true, message: 'You left prison with a Get Out of Prison card.' };
  }

  jailFreeRejection(player) {
    const notTurn = { success: false, error: 'It is not your turn.' };
    if (!player) return notTurn;
    if (!this.started) return notTurn;
    if (player.id !== this.currentPlayerId) return notTurn;
    if (!player.inJail) return { success: false, error: 'You do not have a Get Out of Prison card.' };
    if (!(player.jailFreeCards > 0)) return { success: false, error: 'You do not have a Get Out of Prison card.' };
    if (this.hasRolled) return { success: false, error: 'You have already rolled this turn.' };
    return null;
  }

  bankLoanTerms(player) {
    return bankLoanTerms(this, player);
  }

  getBankLoanOffer(player) {
    return bankLoanOffer(this, player);
  }

  takeBankLoan(socketId, requestId = null) {
    return takeBankLoan(this, socketId, requestId);
  }

  repayBankLoan(socketId, payload = {}) {
    return repayBankLoan(this, socketId, payload);
  }

  processBankLoans() {
    processBankLoans(this);
  }

  defaultBankLoan(player) {
    defaultBankLoan(this, player);
  }

  // Catch-up rule: strictly last by cash among 2+ live seats. Ties and
  // solo tables pay no bonus.
  liveContestants() {
    return (this.players || []).filter(entry => entry && !entry.bankrupt && !entry.disconnected);
  }

  cashFor(player) {
    return Number(player.cash) || 0;
  }

  isLastPlaceByCash(player) {
    if (!player) return false;
    const live = this.liveContestants();
    if (live.length < 2) return false;
    const cash = this.cashFor(player);
    return live.every(entry => entry.id === player.id || cash < this.cashFor(entry));
  }

  handleFortyFirstMove(player) {
    player.moveCount = (player.moveCount || 0) + 1;
    if (player.moveCount !== 41) return;
    player.hiddenMovementSequence = true;
    this.feedMessage(`${player.nickname} stepped on the 41st movement. The ledger skipped a line.`);
  }

  startPassReward(exactStart) {
    if (exactStart && this.settings.doubleGo) return 400;
    return 200;
  }

  awardStartPass(player, oldPosition, steps) {
    const distanceToStart = (START_TILE_INDEX - oldPosition + this.tiles.length) % this.tiles.length || this.tiles.length;
    if (distanceToStart > steps) return;
    const exactStart = distanceToStart === steps;
    const reward = this.startPassReward(exactStart);
    const bonus = this.isLastPlaceByCash(player) ? 100 : 0;
    player.cash += reward + bonus;
    recordPresentationCash(this, 'go', distanceToStart - 1);
    this.feedMessage(`${player.nickname} ${exactStart ? 'landed on' : 'passed'} Start and collected $${reward + bonus}.` + (bonus ? ' Last-place catch-up bonus included.' : ''));
  }

  trackRailroadVisit(player, tile) {
    if (tile?.type !== 'railroad') return;
    if (!(player.airportVisits instanceof Set)) player.airportVisits = new Set();
    player.airportVisits.add(tile.index);
  }

  movePlayer(player, steps, options = {}) {
    this.handleFortyFirstMove(player);
    const oldPosition = player.position;
    this.recordPresentationMove(player, (player.position + steps) % this.tiles.length, { cause: 'dice', steps });
    player.position = (player.position + steps) % this.tiles.length;
    this.awardStartPass(player, oldPosition, steps);
    const tile = this.getTile(player.position);
    this.trackRailroadVisit(player, tile);
    return this.applyTile(player, tile, options);
  }

  resolveTurnAfterAction({ allowExtraRoll = true } = {}) {
    if (allowExtraRoll && this.turnAllowsExtraRoll) {
      this.extraRollPending = true;
      this.hasRolled = false;
      return { retainedTurn: true };
    }

    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    // Explicit end-of-turn: the landing resolved, but the dice only pass when
    // the active player ends the turn (endTurn below). Bots and the AFK
    // watchdog reach the same door via room.endTurn()/nextTurn().
    this.awaitingEndTurn = true;
    return { retainedTurn: false };
  }

  // One row per finished round, keyed by player id because seats can leave mid-game. The final row
  // is taken after market positions are liquidated; a repeated round number replaces its row.
  recordNetWorthSnapshot() {
    const worth = {};
    this.players.forEach(player => { worth[player.id] = netWorth(this, player); });
    const timeline = Array.isArray(this.netWorthTimeline) ? this.netWorthTimeline : (this.netWorthTimeline = []);
    if (timeline.length && timeline[timeline.length - 1].round === this.roundNumber) timeline.pop();
    timeline.push({ round: this.roundNumber, worth });
    if (timeline.length > NET_WORTH_TIMELINE_LIMIT) timeline.splice(0, timeline.length - NET_WORTH_TIMELINE_LIMIT);
  }

  advanceRound() {
    if (this._advancingRound) return;
    this._advancingRound = true;
    try {
      // The round that just finished is the one the snapshot is labelled with.
      this.recordNetWorthSnapshot();
      this.roundNumber += 1;
      if (this.globalEventCooldown > 0) this.globalEventCooldown -= 1;
      this.markMidpointFacts();
      this.advanceGlobalEventPhase();
      this.processBankLoans();
      this.processPlayerContracts();
      this.maybeTriggerGlobalEvent();
      this.advanceMarket();
      if (this.settings.market) {
        const activeEventId = this.globalEvent?.phase === 'active' ? this.globalEvent.id : null;
        this.marketQuoteHistory = [...(Array.isArray(this.marketQuoteHistory) ? this.marketQuoteHistory : []), createMarketQuotePoint(this, this.marketRound, activeEventId)].slice(-128);
      }
      this.players.forEach(player => {
        player.rentPayersThisRound = new Set();
        player.casinoBetsThisRound = 0;
      });
      this.warnRoundLimit();
      // Ending here is safe for the turn callers: nextTurn and the seat-exit
      // path both check `started` before they seat the next player.
      this.endForRoundLimit();
    } finally {
      this._advancingRound = false;
    }
  }

  // The round limit is announced twice before it lands.
  warnRoundLimit() {
    if (this.roundNumber !== ROUND_LIMIT - 50 && this.roundNumber !== ROUND_LIMIT - 10) return;
    this.feedMessage(`The game ends after round ${ROUND_LIMIT}; richest player wins.`);
  }

  // Passing ROUND_LIMIT ends a running table through endGame when at least
  // two solvent seats remain. A lone solvent seat is left to the normal
  // bankruptcy path.
  endForRoundLimit() {
    if (!this.started || this.roundNumber <= ROUND_LIMIT) return false;
    const solvent = this.players.filter(player => this.isSolventSeat(player));
    if (solvent.length < 2) return false;
    // Rank on settled worth: endGame liquidates margin and shorts at a haircut,
    // so crowning on the pre-settlement quote could pick a seat that ends behind.
    // The liquidation is idempotent, so the pass inside endGame stays harmless.
    this.players.forEach(player => this.liquidateAllMarketPositions(player));
    this.endGame(this.richestSolventSeat(), { reason: 'round-limit' });
    return true;
  }

  // Every claim a seat still owes: the head plus anything queued behind it.
  // Named apart from propertyApi.pendingDebtFor(player): that helper is mixed
  // onto GameState.prototype and would shadow a same-named method here.
  pendingDebtAmountFor(playerId) {
    if (!playerId) return 0;
    let owed = this.pendingPayment?.playerId === playerId
      ? Math.max(0, Number(this.pendingPayment.amountRemaining) || 0)
      : 0;
    (Array.isArray(this.pendingPaymentQueue) ? this.pendingPaymentQueue : []).forEach(entry => {
      if (entry?.payment?.playerId === playerId) owed += Math.max(0, Number(entry.payment.amountRemaining) || 0);
    });
    return owed;
  }

  hasPendingDebt(playerId) {
    return this.pendingDebtAmountFor(playerId) > 0;
  }

  // inDebt mirrors the head and queued claims so subsystems that read the
  // player flag stay in lockstep with the claim ledger.
  syncDebtFlags() {
    this.players.forEach(player => {
      player.inDebt = !player.bankrupt && this.pendingDebtAmountFor(player.id) > 0;
    });
  }

  isSolventSeat(player) {
    return Boolean(player) && !player.bankrupt && !player.inDebt && !this.hasPendingDebt(player.id);
  }

  // Richest connected solvent seat by netWorth (netWorth.js), marked to the current quote, less open debt.
  // A tie goes to the seat earlier in turn order.
  richestSolventSeat() {
    const orderedIds = [...new Set([...(this.turnOrder || []), ...this.players.map(player => player.id)])];
    let richest = null;
    let richestWorth = -Infinity;
    orderedIds.map(id => this.getPlayerById(id)).forEach(player => {
      if (!this.isSolventSeat(player) || player.disconnected) return;
      // Rank on the unclamped total: two negative seats both clamp to 0 on the
      // display value, which would hand the tie to turn order.
      const worth = netWorthBreakdown(this, player)?.total ?? 0;
      if (worth > richestWorth) {
        richest = player;
        richestWorth = worth;
      }
    });
    return richest;
  }

  resetTurnState() {
    if (this.pendingSponsoredPurchase) this.cancelSponsoredPurchase();
    this.pendingPurchaseOffer = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.lastFlight = null;
  }

  // A non-bankrupt seat still inside its reconnect grace: the table waits on it.
  waitingSeat() {
    return this.players.find(player => player.disconnected
      && Number(player.disconnectDeadline) > Date.now()
      && !player.bankrupt) || null;
  }

  finishIfNoConnectedPlayers(connected) {
    if (connected.length > 1) return false;
    const waiting = this.waitingSeat();
    if (waiting) {
      this.announceWaitingForSeat(waiting);
      return true;
    }
    this.endGame();
    return true;
  }

  advanceWrappedTurn(next) {
    if (this.turnOrderWrapped(next)) this.advanceRound();
  }

  // The first seat after the current one that is inside its reconnect grace; the
  // table waits on it, so it is the seat the clock must rest on.
  nextWaitingSeat() {
    const order = this.turnOrder;
    const start = order.indexOf(this.currentPlayerId);
    for (let step = 1; step <= order.length; step += 1) {
      const player = this.getPlayerById(order[(start + step + order.length) % order.length]);
      if (player && player.disconnected && !player.bankrupt && Number(player.disconnectDeadline) > Date.now()) return player;
    }
    return this.waitingSeat();
  }

  // With nobody else able to play, a turn ending while a seat is in its reconnect grace hands that seat the clock with a fresh turn.
  // Leaving it on the finished seat wedged the table: that seat had already rolled, the returning seat was "not on turn", and nothing
  // re-advanced the clock on return. Moving the clock around the end of the order still completes the round.
  parkTurnOnWaitingSeat(waiting) {
    const currentIndex = this.turnOrder.indexOf(this.currentPlayerId);
    const waitingIndex = this.turnOrder.indexOf(waiting.id);
    const wrapped = waiting.id !== this.currentPlayerId && currentIndex >= 0 && waitingIndex >= 0 && waitingIndex <= currentIndex;
    if (wrapped) this.advanceRound();
    if (!this.started) return;
    this.beginSeatTurn(waiting);
    this.announceWaitingForSeat(waiting);
  }

  nextTurn() {
    this.resetTurnState();
    const connected = this.connectedNonBankruptPlayers();
    const waiting = connected.length <= 1 ? this.nextWaitingSeat() : null;
    if (waiting) {
      this.parkTurnOnWaitingSeat(waiting);
      return;
    }
    if (this.finishIfNoConnectedPlayers(connected)) return;
    const next = this.findNextTurnSeat();
    if (!this.nextSeatIsPlayable(next)) {
      this.announceWaitingForSeat(next.player);
      return;
    }
    this.advanceWrappedTurn(next);
    if (!this.started) return;
    this.beginSeatTurn(next.player);
  }

  findNextTurnSeat() {
    const currentIndex = this.turnOrder.indexOf(this.currentPlayerId);
    let nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % this.turnOrder.length;
    let nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
    let attempts = 0;
    while (this.seatIsIdle(nextPlayer) && attempts < this.turnOrder.length) {
      nextIndex = (nextIndex + 1) % this.turnOrder.length;
      nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
      attempts += 1;
    }
    return { currentIndex, nextIndex, player: nextPlayer };
  }

  seatIsIdle(player) {
    if (!player) return false;
    return Boolean(player.bankrupt || player.disconnected);
  }

  nextSeatIsPlayable(next) {
    if (!next.player) return false;
    if (next.player.bankrupt) return false;
    return !next.player.disconnected;
  }

  announceWaitingForSeat(waiting = null) {
    waiting ||= this.getPlayerById(this.currentPlayerId);
    if (!waiting) return;
    if (waiting.bankrupt) return;
    this.feedMessage(`Waiting for ${waiting.nickname} to reconnect…`);
  }

  turnOrderWrapped(next) {
    if (next.currentIndex < 0) return false;
    return next.nextIndex <= next.currentIndex;
  }

  beginSeatTurn(player) {
    this.currentPlayerId = player.id;
    this.hasRolled = false;
    // The doubles streak belongs to the seated roller. A turn that ended on
    // doubles without an extra roll (Go to Prison, a jail card, a disconnect
    // skip) must not hand its count to the successor.
    this.consecutiveDoubles = 0;
    player.botDealActionsThisTurn = 0;
    player.buildActionsThisTurn = 0;
    player.marketActionsThisTurn = 0;
    this.feedMessage(`${player.nickname}'s turn.`);
  }

  hasFullSet(ownerId, group) {
    const groupTiles = this.tiles.filter(tile => tile.group === group);
    return groupTiles.every(tile => tile.ownerId === ownerId);
  }

  chargePlayer(debt) {
    // Nothing to collect from a missing payer or a non-debt: the turn just
    // resolves normally.
    if (!debt.player) {
      this.resolveTurnAfterAction(debt.turnOptions);
      return;
    }
    if (debt.amount <= 0) {
      this.resolveTurnAfterAction(debt.turnOptions);
      return;
    }
    if (debt.player.cash >= debt.amount) {
      this.payDebtInFull(debt);
      return;
    }
    this.openDebtSettlement(debt);
  }

  payDebtInFull(debt) {
    const { player, creditor, amount, message, turnOptions = {}, hooks = {} } = debt;
    player.cash -= amount;
    if (player.cash === 0) player.zeroCashReached = true;
    this.creditRentTo(creditor, player, amount);
    this.feedMessage(message);
    if (hooks.onPaid) hooks.onPaid(amount);
    this.resolveTurnAfterAction(turnOptions);
  }

  // Shortfall path: whatever cash remains is tendered first, then the rest
  // of the debt parks in pendingPayment for the mortgage/sell/bankruptcy
  // mini-game to resolve.
  openDebtSettlement(debt) {
    const { player, creditor, amount, message, turnOptions = {}, hooks = {} } = debt;
    const partial = player.cash;
    if (partial > 0) {
      this.tenderPartialDebt(player, creditor, partial, hooks);
    }
    const remaining = amount - partial;
    const pending = {
      playerId: player.id,
      creditorId: creditor ? creditor.id : null,
      amountRemaining: remaining,
      reason: message,
      equityTileIndex: hooks.equityTileIndex ?? null,
      equityOwnerId: hooks.equityOwnerId ?? null
    };
    if (this.pendingPayment) {
      // Round processing can mature several independent debts at once. Keep
      // the existing table gate and queue later claims instead of silently
      // overwriting the first debtor.
      this.pendingPaymentQueue ||= [];
      // The active roller must never wait behind another seat's claim: the
      // settle flow reads the head, so promote the roller's claim and requeue
      // the one it displaces.
      if (pending.playerId === this.currentPlayerId && this.pendingPayment.playerId !== pending.playerId) {
        this.pendingPaymentQueue.unshift({
          payment: this.pendingPayment,
          hooks: this.pendingPaymentHooks,
          turnOptions: this.pendingPaymentTurnOptions
        });
        this.pendingPayment = pending;
        this.pendingPaymentHooks = hooks;
        this.pendingPaymentTurnOptions = turnOptions;
        this.syncDebtFlags();
        this.feedMessage(`${player.nickname} owes $${remaining}; the payment takes priority over the queued debt.`);
        return;
      }
      this.pendingPaymentQueue.push({ payment: pending, hooks, turnOptions });
      this.syncDebtFlags();
      this.feedMessage(`${player.nickname} owes $${remaining}; the payment is queued behind the current debt.`);
      return;
    }
    this.pendingPayment = pending;
    this.pendingPaymentHooks = hooks;
    this.pendingPaymentTurnOptions = turnOptions;
    this.syncDebtFlags();
    this.feedMessage(`${player.nickname} owes $${remaining}. Mortgage or sell buildings to raise funds, or declare bankruptcy.`);
  }

  tenderPartialDebt(player, creditor, partial, hooks) {
    player.cash = 0;
    player.zeroCashReached = true;
    this.creditRentTo(creditor, player, partial);
    this.feedMessage(`${player.nickname} paid $${partial} toward the debt.`);
    if (hooks.onPaid) hooks.onPaid(partial);
  }

  // A rent credit touches cash, the collection total, the payer sets and their running per-round max. Bank debts (null creditor)
  // skip it, as do bankrupt creditors: tile rent treats a bankrupt owner as vacant, so an in-flight debt never enriches one.
  // The payer still settles; the money simply has nowhere to go.
  creditRentTo(creditor, payer, amount) {
    if (!creditor) return;
    if (creditor.bankrupt) return;
    creditor.cash += amount;
    creditor.rentCollected = (creditor.rentCollected || 0) + amount;
    creditor.rentPayerIds ||= new Set();
    creditor.rentPayerIds.add(payer.id);
    creditor.rentPayersThisRound ||= new Set();
    creditor.rentPayersThisRound.add(payer.id);
    creditor.maxRentPayersInRound = Math.max(creditor.maxRentPayersInRound || 0, creditor.rentPayersThisRound.size);
    if (this.pendingPayment?.playerId === creditor.id
      && creditor.cash >= this.pendingPayment.amountRemaining
      && !this.collectingPendingPayment
      && !this.collectingOwnedDebts) {
      this.trySettlePendingPayment();
    }
  }

  trySettlePendingPayment() {
    if (this.collectingPendingPayment || this.collectingOwnedDebts) return false;
    if (!this.pendingPayment) return false;
    const player = this.getPlayerById(this.pendingPayment.playerId);
    // A debtor inside its reconnect grace that can cover the debt pays only the
    // debt; another seat's action must not hand over its whole estate.
    if (player?.disconnected && !player.bankrupt && player.cash >= this.pendingPayment.amountRemaining) {
      return this.collectOwnedDebts(player);
    }
    if (!this.pendingPayerCanSettle(player)) {
      // Debts never evaporate: a present-but-unsettleable debtor goes
      // through bankruptcy (assets to creditor); a removed seat simply
      // clears like before, its deeds already forfeited on the way out.
      const creditor = this.pendingPayment.creditorId ? this.getPlayerById(this.pendingPayment.creditorId) : null;
      const debtor = player;
      if (debtor && !debtor.bankrupt) {
        const result = this.handleBankruptcy(debtor, creditor);
        if (result?.success === false) return false;
      } else this.clearPendingPayment();
      return false;
    }
    return this.collectOwnedDebts(player);
  }

  // Pays the head debt, then drains any promoted head already covered by its
  // payer's cash. Each pass removes one claim, so queue order is preserved and
  // the pass terminates. The outer guard keeps credit hooks from re-entering.
  collectOwnedDebts(player) {
    if (this.collectingOwnedDebts) return false;
    this.collectingOwnedDebts = true;
    try {
      if (!this.collectPendingPayment(player)) return false;
      while (this.pendingPayment) {
        const nextPayer = this.getPlayerById(this.pendingPayment.playerId);
        if (!nextPayer || nextPayer.bankrupt || nextPayer.cash < this.pendingPayment.amountRemaining) break;
        if (!this.collectPendingPayment(nextPayer)) break;
      }
      return true;
    } finally {
      this.collectingOwnedDebts = false;
    }
  }

  // Pays the parked debt in full from the debtor's cash. The live settle path reaches it through trySettlePendingPayment;
  // the AFK and expiry path calls it directly, since a seat still in reconnect grace can cover its debt, and that payment
  // must not turn into a whole-estate bankruptcy.
  collectPendingPayment(player) {
    if (!this.pendingPayment || !player || player.bankrupt) return false;
    // Re-entrancy guard: collecting the head claim can credit a recipient (an equity rent share paid to the seat that owes the rent),
    // and that inflow retries the claim being collected right now. The retry must not collect the same rent twice, and it must not
    // clear the claim under the collection still running.
    if (this.collectingPendingPayment) return false;
    if (player.cash < this.pendingPayment.amountRemaining) {
      return false;
    }
    const amount = this.pendingPayment.amountRemaining;
    this.collectingPendingPayment = true;
    try {
      player.cash -= amount;
      this.creditSettledDebt(amount, player);
      this.settlePendingEquityShares(amount);
      this.settlePendingHooks(amount);
    } finally {
      this.collectingPendingPayment = false;
    }
    this.feedMessage(`${player.nickname} paid the remaining $${amount}.`);
    const turnOptions = this.pendingPaymentTurnOptions || {};
    // Only the seat that landed on the debt resolves its roll. An off-turn
    // debtor (a bank-loan default during round processing) or a seat that has
    // not rolled yet settles without marking the current roll as landed.
    const resolvesRoll = this.hasRolled && player.id === this.currentPlayerId;
    this.clearPendingPayment();
    if (resolvesRoll) this.resolveTurnAfterAction(turnOptions);
    return true;
  }

  pendingPayerCanSettle(player) {
    if (!player) return false;
    if (player.bankrupt) return false;
    return !player.disconnected;
  }

  clearPendingPayment(activateNext = true) {
    const shouldActivateNext = activateNext && this.started;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.pendingPaymentHooks = null;
    const next = shouldActivateNext ? this.pendingPaymentQueue?.shift() : null;
    if (next) {
      this.pendingPayment = next.payment;
      this.pendingPaymentHooks = next.hooks;
      this.pendingPaymentTurnOptions = next.turnOptions;
    }
    this.syncDebtFlags();
    if (next && !this.collectingOwnedDebts && this.pendingPayment) {
      const nextPayer = this.getPlayerById(this.pendingPayment.playerId);
      if (nextPayer && !nextPayer.bankrupt && nextPayer.cash >= this.pendingPayment.amountRemaining) {
        this.trySettlePendingPayment();
      }
    }
    return Boolean(next);
  }

  // Forgiveness only: a claim owed TO a departing seat ends with it. The
  // claims the seat owes settle against its estate (settleQueuedDebtsOf), so
  // they are never dropped here.
  removeQueuedPaymentsForPlayer(playerId) {
    if (!playerId || !Array.isArray(this.pendingPaymentQueue)) return;
    this.pendingPaymentQueue = this.pendingPaymentQueue.filter(entry => entry?.payment?.creditorId !== playerId);
    this.syncDebtFlags();
  }

  // The remainder path replays the debt hooks exactly once. Equity debts replay through their stored indexes in
  // settlePendingEquityShares, so the generic hook runs only for non-equity debts (today: vacation-pool tax). Partial payments
  // already ran the hook for their share via tenderPartialDebt.
  settlePendingHooks(amount) {
    if (this.pendingPayment.equityTileIndex != null) return;
    const onPaid = this.pendingPaymentHooks?.onPaid;
    if (typeof onPaid !== 'function') return;
    onPaid(amount);
  }

  // Settling the parked debt credits the creditor through the same rent-fact
  // path as a direct collection.
  creditSettledDebt(amount, player) {
    const creditorId = this.pendingPayment.creditorId;
    if (!creditorId) return;
    const creditor = this.getPlayerById(creditorId);
    this.creditRentTo(creditor, player, amount);
  }

  settlePendingEquityShares(amount) {
    const pending = this.pendingPayment;
    if (pending.equityTileIndex == null) return;
    const equityTile = this.getTile(pending.equityTileIndex);
    const equityOwner = this.getPlayerById(pending.equityOwnerId);
    // pendingPayment.playerId is the seat that owes the rent, so the parked
    // (partial-payment) path books the same rent facts as a direct collection.
    this.settleEquityShares(equityTile, equityOwner, amount, this.getPlayerById(pending.playerId));
  }

  transferMoney(from, to, amount, message) {
    if (!from) return;
    if (!to) return;
    // NaN slips past `<= 0` and poisons both seats; Infinity mints money.
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return;
    from.cash -= amount;
    to.cash += amount;
    this.feedMessage(message);
  }

  deductMoney(player, amount, message) {
    this.chargePlayer({ player, amount, message, turnOptions: {} });
  }

  endTurn(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const rejection = this.endTurnRejection(player);
    if (rejection) return rejection;
    this.nextTurn();
    return { success: true };
  }

  endTurnRejection(player) {
    const notActive = { success: false, error: 'Only the active player can end the turn.' };
    if (!isCurrentTurnPlayer(player, this.currentPlayerId)) return notActive;
    if (endTurnRequiresExtraRoll(this)) return { success: false, error: 'You must roll again after doubles before ending your turn.' };
    if (!this.awaitingEndTurn) return { success: false, error: 'Resolve your roll before ending the turn.' };
    const flowRejection = this.pendingFlowRejection(player);
    if (flowRejection) return flowRejection;
    if (!player.bankrupt && !(Number(player.cash) > 0)) {
      return { success: false, error: 'Raise cash or declare bankruptcy before ending the turn.' };
    }
    return null;
  }

  pendingFlowRejection(player) {
    const error = this.pendingFlowError(player);
    return error ? { success: false, error } : null;
  }

  pendingFlowError(player) {
    const blockers = [
      [Boolean(this.auction?.active), 'Finish the active auction before ending the turn.'],
      [this.pendingPurchaseOffer?.playerId === player?.id, 'Resolve the property offer before ending the turn.'],
      [this.hasPendingDebt(player?.id), 'Settle your debt before ending the turn.'],
      [Boolean(this.pendingSponsoredPurchase), 'Resolve the open sponsorship before ending the turn.']
    ];
    const blocker = blockers.find(([active]) => active);
    return blocker?.[1] || null;
  }

  skipDisconnectedCurrentPlayer() {
    const current = this.getCurrentPlayer();
    if (!current) return;
    if (!current.disconnected) return;
    if (current.bankrupt) return;
    // A parked debt travels with the seat: route it through bankruptcy
    // instead of orphaning the creditor's claim until reconnect.
    if (this.pendingPayment?.playerId === current.id && !current.bankrupt) {
      const creditor = this.pendingPayment.creditorId ? this.getPlayerById(this.pendingPayment.creditorId) : null;
      return this.handleBankruptcy(current, creditor);
    }
    this.pendingPurchaseOffer = null;
    this.feedMessage(`${current.nickname} was skipped due to disconnect.`);
    this.nextTurn();
  }

  endGame(crowned = null, { reason = null } = {}) {
    // A disconnected seat is not an eligible winner. If every solvent seat is offline, finish without crowning a ghost;
    // a supervisor can still retain the match record for diagnostics. The exception is the last solvent seat whose reconnect
    // grace ran out, which the runtime crowns explicitly (socketRuntime crownLoneSolventSeat).
    const winner = crowned || this.connectedNonBankruptPlayers().find(player => this.isSolventSeat(player)) || null;
    // Keep the score basis from the moment the winner is selected. In
    // particular, round-limit winners are chosen on net worth before the
    // end-of-game liquidation settles market positions.
    this.finalNetWorthById = Object.fromEntries(this.players.map(player => [
      player.id,
      netWorthBreakdown(this, player)?.total ?? 0
    ]));
    if (this.globalEvent) {
      const event = this.globalEvent;
      if (!this.globalEventHistory.some(entry => entry.id === event.id && entry.startedRound === event.startedRound)) {
        this.globalEventHistory.unshift({ id: event.id, title: event.title, comboId: event.comboId || null, startedRound: event.startedRound, endedRound: this.roundNumber });
      }
    }
    // Close the table's open obligations before the final snapshot: a cancelled
    // sponsorship refunds cash and a cleared claim does not subtract a debt
    // the ending table will never collect.
    this.cancelSponsoredPurchase();
    this.pendingPaymentQueue = [];
    this.clearPendingPayment(false);
    // Margin, short and option equity is settled here, so no debt or
    // collateral is left open on a table that does not run.
    this.players.forEach(player => {
      this.liquidateAllMarketPositions(player);
      this.liquidateItems(player);
    });
    this.recordNetWorthSnapshot();
    this.lastWinner = winner ? { id: winner.id, nickname: winner.nickname } : null;
    this.lastEndReason = reason;
    if (reason === 'round-limit') {
      this.feedMessage(winner ? 'Round limit reached - the richest player wins.' : 'Round limit reached - the game has ended.');
    } else if (winner) {
      this.feedMessage(`${winner.nickname} is the last player remaining and wins the game!`);
    } else {
      this.feedMessage('The game has ended.');
    }
    this.started = false;
    this.currentPlayerId = null;
    this.hasRolled = false;
    this.pendingPurchaseOffer = null;
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPlayerContract = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.consecutiveDoubles = 0;
    // The room owns the vote-kick, so it learns that the match is over here.
    this.onGameEnded?.();
  }

}

Object.assign(GameState.prototype, globalEventsApi, rentApi, tileApi, airportApi, bankAccountApi, cardApi, itemApi, propertyApi, auctionApi, economyApi, tradeApi, sponsorshipApi, bankruptcyApi, appearanceApi, botApi, summaryApi, gamePresentationApi);

export { GameState, Room, RoomManager, APPEARANCE_PRESET_COLORS, AUCTION_DURATION_MS };

