import { freshMarketQuotes, MARKET_INSTRUMENTS } from './marketLogic.js';
import {
  equityShareContractLive,
  playerContractSummary,
  processContracts,
  proposeContract,
  counterContract,
  adjustContract,
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
import { DEFAULT_ROOM_SETTINGS } from './roomSettings.js';
import {
  JAIL_FINE,
  JAIL_MAX_TURNS,
  START_TILE_INDEX,
  rollDice,
  shuffleArray
} from './gameData.js';
import { globalEventsApi } from './globalEventsApi.js';
import { rentApi } from './rentApi.js';
import { tileApi } from './tileApi.js';
import { cardApi } from './cardApi.js';
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

const PLAYER_STATE_DEFAULTS = [
  ['cash', (player, settings) => settings.startingCash],
  ['position', () => START_TILE_INDEX],
  ['properties', () => []],
  ['inJail', false],
  ['jailTurns', 0],
  ['jailFreeCards', 0],
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
    this.settings = { ...DEFAULT_ROOM_SETTINGS, ...settings };
    this.boardVariant = this.settings.boardVariant || 'standard-40';
    this.ruleset = null;
    this.rulesetDigest = null;
    this.reset();
  }

  reset() {
    this.tiles = tilesForVariant(this.boardVariant);
    this.players = [];
    this.turnOrder = [];
    this.currentPlayerId = null;
    this.lastDice = [0, 0];
    this.hasRolled = false;
    this.consecutiveDoubles = 0;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.turnDeadline = 0;
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
    this.lastWinner = null;
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
    this.marketOptionReserve = 100_000;
    this.marketShortInventory = {};
    this.marketInstruments = MARKET_INSTRUMENTS;
    this.marketRound = 0;
    this.marketModifierEventKey = null;
    this.botDecisionSequence = 0;
    this.botDecisionTrace = [];
    this.humanActionCount = 0;
    this.afkTurnCount = 0;
    this.telemetryLog = [];
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

  resetForNewGame() {
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
    this.turnDeadline = 0;
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
    this.defaultClaims = [];
    this.lastWinner = null;
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
    this.economyTransactions = new BoundedReplayMap();
    this.marketQuotes = freshMarketQuotes();
    this.marketOptionReserve = 100_000;
    this.marketShortInventory = Object.fromEntries(Object.keys(this.marketQuotes).map(id => [id, 50]));
    this.marketInstruments = MARKET_INSTRUMENTS;
    this.marketRound = 0;
    this.marketModifierEventKey = null;
    this.botDecisionSequence = 0;
    this.botDecisionTrace = [];
    this.humanActionCount = 0;
    this.afkTurnCount = 0;
    this.telemetryLog = [];
    const decks = decksForVariant(this.boardVariant);
    this.surpriseDeck = decks.surprise.map(card => ({ ...card }));
    this.treasureDeck = decks.treasure.map(card => ({ ...card }));
    this.players.forEach(player => this.resetPlayerState(player));
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

  counterPlayerContract(socketId, offer = {}) {
    return counterContract(this, socketId, offer);
  }

  adjustPlayerContract(socketId, offer = {}) {
    return adjustContract(this, socketId, offer);
  }

  respondPlayerContract(socketId, accept, requestId = null, contractId = null) {
    return respondContract(this, socketId, accept, requestId, contractId);
  }

  repayPlayerContract(socketId, payload = {}) {
    return repayContract(this, socketId, payload);
  }

  processPlayerContracts() {
    processContracts(this);
  }

  settleEquityShares(tile, owner, amountPaid) {
    settleEquityShares(this, tile, owner, amountPaid);
  }

  isLoanCollateral(player, tile) {
    return Boolean(player?.bankLoan?.status === 'active' || player?.bankLoan?.status === 'due')
      && Number(player.bankLoan.collateralTileIndex) === Number(tile?.index);
  }

  isPlayerContractCollateral(player, tile) {
    return Boolean(player && tile && this.playerContracts?.some(contract =>
      ['loan', 'hybrid'].includes(contract.kind)
      && ['active', 'due'].includes(contract.status)
      && contract.toPlayerId === player.id
      && Number(contract.kind === 'hybrid' ? contract.propertyIndex : contract.collateralTileIndex) === Number(tile.index)
    ));
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

  applyPropertyOwnershipChange(fromPlayer, toPlayer, tile) {
    this.terminateTileEquityShares(tile);
    this.resetDeedTile(tile, toPlayer);
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

  resetDeedTile(tile, toPlayer) {
    tile.ownerId = toPlayer ? toPlayer.id : null;
    tile.mortgaged = false;
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
    // Every retained seat consumes capacity, including bots. A room that
    // counts only active humans can exceed its advertised seat limit after a
    // round ends or when bots are retained for a rematch.
    return this.players.filter(player => !player.bankrupt).length < this.settings.maxPlayers;
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
    const active = [...this.players].filter(p => !p.bankrupt && !p.disconnected);
    if (this.settings.randomizePlayerOrder) {
      shuffleArray(active);
    }
    this.turnOrder = active.map(p => p.id);
    this.currentPlayerId = this.turnOrder[0] || null;
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

  rollDice(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const rejection = this.rollTurnRejection(player);
    if (rejection) return rejection;
    if (player.inJail) {
      return this.handleJailRoll(player);
    }
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    const dice = rollDice();
    this.setTurnDice(dice);
    if (this.consecutiveDoubles >= 3) {
      return this.sendRollerToJail(player);
    }
    const move = dice[0] + dice[1];
    this.feedMessage(`${player.nickname} rolled ${dice[0]} and ${dice[1]} (${move}).`);
    return this.movePlayer(player, move);
  }

  rollTurnRejection(player) {
    const playerId = player?.id;
    const blocker = [
      [!playerId, 'Player not found.'],
      [!this.started, 'Game has not started.'],
      [playerId !== this.currentPlayerId, 'It is not your turn.'],
      [this.pendingPayment?.playerId === playerId, 'Settle your debt before rolling.'],
      [this.pendingPurchaseOffer?.playerId === playerId, 'Resolve the property offer before rolling.'],
      [this.pendingSponsoredPurchase?.buyerId === playerId, 'Resolve the sponsorship before rolling.'],
      [Boolean(this.auction?.active), 'Finish the active auction before rolling.'],
    ].find(([blocked]) => blocked);
    return blocker ? { success: false, error: blocker[1] } : null;
  }

  setTurnDice(dice) {
    this.lastDice = dice;
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
    if (player.cash < JAIL_FINE) {
      return { success: false, error: `You need $${JAIL_FINE} to pay the jail fine.` };
    }
    player.cash -= JAIL_FINE;
    player.inJail = false;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} paid $${JAIL_FINE} to leave jail.`);
    return { success: true, message: 'You left jail. Roll the dice to move.' };
  }

  useJailFree(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const rejection = this.jailFreeRejection(player);
    if (rejection) return rejection;
    player.jailFreeCards -= 1;
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

  advanceRound() {
    if (this._advancingRound) return;
    this._advancingRound = true;
    try {
      this.roundNumber += 1;
      if (this.globalEventCooldown > 0) this.globalEventCooldown -= 1;
      this.markMidpointFacts();
      this.advanceGlobalEventPhase();
      this.processBankLoans();
      this.processPlayerContracts();
      this.maybeTriggerGlobalEvent();
      this.advanceMarket();
      this.players.forEach(player => {
        player.rentPayersThisRound = new Set();
        player.casinoBetsThisRound = 0;
      });
    } finally {
      this._advancingRound = false;
    }
  }

  resetTurnState() {
    if (this.pendingSponsoredPurchase) this.cancelSponsoredPurchase();
    this.pendingPurchaseOffer = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
  }

  finishIfNoConnectedPlayers(connected) {
    if (connected.length > 1) return false;
    const waiting = this.players.find(player => player.disconnected
      && Number(player.disconnectDeadline) > Date.now()
      && !player.bankrupt);
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

  nextTurn() {
    this.resetTurnState();
    const connected = this.connectedNonBankruptPlayers();
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
      this.pendingPaymentQueue.push({ payment: pending, hooks, turnOptions });
      this.feedMessage(`${player.nickname} owes $${remaining}; the payment is queued behind the current debt.`);
      return;
    }
    this.pendingPayment = pending;
    this.pendingPaymentHooks = hooks;
    this.pendingPaymentTurnOptions = turnOptions;
    this.feedMessage(`${player.nickname} owes $${remaining}. Mortgage or sell buildings to raise funds, or declare bankruptcy.`);
  }

  tenderPartialDebt(player, creditor, partial, hooks) {
    player.cash = 0;
    player.zeroCashReached = true;
    this.creditRentTo(creditor, player, partial);
    this.feedMessage(`${player.nickname} paid $${partial} toward the debt.`);
    if (hooks.onPaid) hooks.onPaid(partial);
  }

  // Every fact a rent credit touches: cash, the collection total, the payer
  // sets and their running per-round max. Bank debts (null creditor) skip it
  // entirely, as do bankrupt creditors: tile rent treats a bankrupt owner as
  // vacant, so an in-flight debt never enriches a bankrupt seat either. The
  // payer still settles; the money simply has nowhere to go.
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
  }

  trySettlePendingPayment() {
    if (!this.pendingPayment) return false;
    const player = this.getPlayerById(this.pendingPayment.playerId);
    if (!this.pendingPayerCanSettle(player)) {
      // Debts never evaporate: a present-but-unsettleable debtor goes
      // through bankruptcy (assets to creditor); a removed seat simply
      // clears like before, its deeds already forfeited on the way out.
      const creditor = this.pendingPayment.creditorId ? this.getPlayerById(this.pendingPayment.creditorId) : null;
      const debtor = player;
      this.clearPendingPayment();
      if (debtor && !debtor.bankrupt) this.handleBankruptcy(debtor, creditor);
      return false;
    }
    if (player.cash < this.pendingPayment.amountRemaining) {
      return false;
    }
    const amount = this.pendingPayment.amountRemaining;
    player.cash -= amount;
    this.creditSettledDebt(amount, player);
    this.settlePendingEquityShares(amount);
    this.settlePendingHooks(amount);
    this.feedMessage(`${player.nickname} paid the remaining $${amount}.`);
    const turnOptions = this.pendingPaymentTurnOptions || {};
    this.clearPendingPayment();
    this.resolveTurnAfterAction(turnOptions);
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
    if (!next) return false;
    this.pendingPayment = next.payment;
    this.pendingPaymentHooks = next.hooks;
    this.pendingPaymentTurnOptions = next.turnOptions;
    return true;
  }

  removeQueuedPaymentsForPlayer(playerId) {
    if (!playerId || !Array.isArray(this.pendingPaymentQueue)) return;
    this.pendingPaymentQueue = this.pendingPaymentQueue.filter(entry => {
      const payment = entry?.payment;
      return payment?.playerId !== playerId && payment?.creditorId !== playerId;
    });
  }

  // Remainder path replays the debt hooks exactly once. Equity debts replay
  // through their stored indexes in settlePendingEquityShares, so the generic
  // hook only runs for non-equity debts (today: vacation-pool tax). Partial
  // payments already ran the hook for their share via tenderPartialDebt.
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
    this.settleEquityShares(equityTile, equityOwner, amount);
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
    if (!player) return notActive;
    if (player.id !== this.currentPlayerId) return notActive;
    if (this.extraRollPending) return { success: false, error: 'You must roll again after doubles before ending your turn.' };
    if (this.turnAllowsExtraRoll) return { success: false, error: 'You must roll again after doubles before ending your turn.' };
    if (!this.awaitingEndTurn) return { success: false, error: 'Resolve your roll before ending the turn.' };
    const flowRejection = this.pendingFlowRejection(player);
    if (flowRejection) return flowRejection;
    if (!player.bankrupt && !(Number(player.cash) > 0)) {
      return { success: false, error: 'Raise cash or declare bankruptcy before ending the turn.' };
    }
    return null;
  }

  pendingTradeBlocksEndTurn(player) {
    const trade = this.pendingTrade;
    if (!trade) return false;
    if (trade.fromPlayerId === player.id) return true;
    return trade.toPlayerId === player.id;
  }

  pendingContractBlocksEndTurn(player) {
    const contract = this.pendingPlayerContract;
    if (!contract) return false;
    if (contract.fromPlayerId === player.id) return true;
    return contract.toPlayerId === player.id;
  }

  pendingDealBlockReason(player) {
    if (this.pendingTradeBlocksEndTurn(player)) return 'Resolve the pending trade before ending the turn.';
    if (this.pendingContractBlocksEndTurn(player)) return 'Resolve the pending contract before ending the turn.';
    return null;
  }

  pendingFlowRejection(player) {
    const error = this.pendingFlowError(player);
    return error ? { success: false, error } : null;
  }

  pendingFlowError(player) {
    const blockers = [
      [Boolean(this.auction?.active), 'Finish the active auction before ending the turn.'],
      [this.pendingPurchaseOffer?.playerId === player.id, 'Resolve the property offer before ending the turn.'],
      [this.pendingPayment?.playerId === player.id, 'Settle your debt before ending the turn.'],
      [Boolean(this.pendingSponsoredPurchase), 'Resolve the open sponsorship before ending the turn.']
    ];
    const blocker = blockers.find(([active]) => active);
    return blocker?.[1] || this.pendingDealBlockReason(player);
  }

  skipDisconnectedCurrentPlayer() {
    const current = this.getCurrentPlayer();
    if (!current) return;
    if (!current.disconnected) return;
    if (current.bankrupt) return;
    this.pendingPurchaseOffer = null;
    // A parked debt travels with the seat: route it through bankruptcy
    // instead of orphaning the creditor's claim until reconnect.
    if (this.pendingPayment?.playerId === current.id && !current.bankrupt) {
      const creditor = this.pendingPayment.creditorId ? this.getPlayerById(this.pendingPayment.creditorId) : null;
      this.clearPendingPayment();
      this.handleBankruptcy(current, creditor);
      return;
    }
    this.feedMessage(`${current.nickname} was skipped due to disconnect.`);
    this.nextTurn();
  }

  endGame() {
    // A disconnected seat is not an eligible winner. If every solvent seat
    // has gone offline, finish without crowning a ghost; a supervisor can
    // still retain the match record for diagnostics.
    const winner = this.connectedNonBankruptPlayers().find(player => !player.inDebt) || null;
    if (this.globalEvent) {
      const event = this.globalEvent;
      if (!this.globalEventHistory.some(entry => entry.id === event.id && entry.startedRound === event.startedRound)) {
        this.globalEventHistory.unshift({ id: event.id, title: event.title, comboId: event.comboId || null, startedRound: event.startedRound, endedRound: this.roundNumber });
      }
    }
    this.lastWinner = winner ? { id: winner.id, nickname: winner.nickname } : null;
    if (winner) {
      this.feedMessage(`${winner.nickname} is the last player remaining and wins the game!`);
    } else {
      this.feedMessage('The game has ended.');
    }
    this.started = false;
    this.currentPlayerId = null;
    this.hasRolled = false;
    this.pendingPurchaseOffer = null;
    this.cancelSponsoredPurchase();
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPlayerContract = null;
    this.clearPendingPayment();
    this.pendingPaymentQueue = [];
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.consecutiveDoubles = 0;
  }

}

Object.assign(GameState.prototype, globalEventsApi, rentApi, tileApi, cardApi, propertyApi, auctionApi, economyApi, tradeApi, sponsorshipApi, bankruptcyApi, appearanceApi, botApi, summaryApi);

export { GameState, Room, RoomManager, APPEARANCE_PRESET_COLORS, AUCTION_DURATION_MS };

