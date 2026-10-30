// Game state for one room: players, turns, the board, and the rules that
// connect them. Domain methods are attached from the mixin modules below.
import { createMarketQuotePoint, freshMarketQuotes, MARKET_INSTRUMENTS } from './marketLogic.js';
import { DEFAULT_ROOM_SETTINGS, stripRetiredRoomSettings } from './roomSettings.js';
import { resolveRuleset } from './rulesetRegistry.js';
import { START_TILE_INDEX } from './gameData.js';
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
import { decksForVariant, tilesForVariant } from './boardRegistry.js';
import { appendPublicAction } from './publicActionHistory.js';
import { gamePresentationApi } from './gamePresentationApi.js';
import { gameDebtApi } from './gameDebt.js';
import { gameContractApi } from './gameContracts.js';
import { gamePropertyApi } from './gameProperty.js';
import { gameTurnApi } from './gameTurns.js';
import { gameRoundApi } from './gameRounds.js';

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
    const decks = decksForVariant(this.boardVariant);
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
    const decks = decksForVariant(this.boardVariant);
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

  feedMessage(text) {
    this.feed.unshift({ text, timestamp: Date.now() });
    if (this.feed.length > 40) {
      this.feed.length = 40;
    }
  }

  getCurrentPlayer() {
    return this.getPlayerById(this.currentPlayerId);
  }
}

Object.assign(GameState.prototype, globalEventsApi, rentApi, tileApi, airportApi, bankAccountApi, cardApi, itemApi, propertyApi, auctionApi, economyApi, tradeApi, sponsorshipApi, bankruptcyApi, appearanceApi, botApi, summaryApi, gamePresentationApi, gameDebtApi, gameContractApi, gamePropertyApi, gameTurnApi, gameRoundApi);

export { GameState, Room, RoomManager, APPEARANCE_PRESET_COLORS, AUCTION_DURATION_MS };
export { contractPledgesTile } from './gameContracts.js';
