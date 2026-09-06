import { freshMarketQuotes } from './marketLogic.js';
import {
  playerContractSummary,
  processContracts,
  proposeContract,
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
  SURPRISE_DECK,
  TREASURE_DECK,
  cloneTiles,
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
import { bankruptcyApi } from './bankruptcyApi.js';
import { APPEARANCE_PRESET_COLORS, appearanceApi } from './appearanceApi.js';
import { botApi } from './botApi.js';
import { Room, RoomManager } from './rooms.js';
import { summaryApi } from './summaryApi.js';

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
  ['marketTrades', 0],
  ['marketActionsThisTurn', 0],
  ['crisisMarketBuys', () => ({})],
  ['crisisMarketProfit', false],
  ['playerContractIds', () => []],
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
  ['inDebt', false],
  ['ready', false],
  ['disconnected', false],
];

class GameState {
  constructor(settings) {
    this.settings = { ...DEFAULT_ROOM_SETTINGS, ...settings };
    this.reset();
  }

  reset() {
    this.tiles = cloneTiles();
    this.players = [];
    this.currentPlayerId = null;
    this.lastDice = [0, 0];
    this.hasRolled = false;
    this.consecutiveDoubles = 0;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.pendingPurchaseOffer = null;
    this.started = false;
    this.startedAt = null;
    this.feed = [];
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPlayerContract = null;
    this.playerContracts = [];
    this.contractTransactions = new Map();
    this.tradesCompleted = 0;
    this.auctionsCompleted = 0;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.lastWinner = null;
    this.vacationPool = 0;
    this.roundNumber = 0;
    this.globalEvent = null;
    this.globalEventHistory = [];
    this.globalEventCooldown = 0;
    this.globalEventsTriggered = 0;
    this.midpointMarked = false;
    this.casinoLastResult = null;
    this.casinoLedger = [];
    this.marketLedger = [];
    this.economyTransactions = new Map();
    this.marketQuotes = freshMarketQuotes();
    this.marketRound = 0;
    this.surpriseDeck = [...SURPRISE_DECK];
    this.treasureDeck = [...TREASURE_DECK];
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

  resetForNewGame() {
    this.tiles = cloneTiles();
    this.currentPlayerId = null;
    this.turnOrder = [];
    this.lastDice = [0, 0];
    this.hasRolled = false;
    this.consecutiveDoubles = 0;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.pendingPurchaseOffer = null;
    this.started = false;
    this.startedAt = Date.now();
    this.feed = [];
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPlayerContract = null;
    this.playerContracts = [];
    this.contractTransactions = new Map();
    this.tradesCompleted = 0;
    this.auctionsCompleted = 0;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.lastWinner = null;
    this.vacationPool = 0;
    this.roundNumber = 1;
    this.globalEvent = null;
    this.globalEventHistory = [];
    this.globalEventCooldown = 0;
    this.globalEventsTriggered = 0;
    this.midpointMarked = false;
    this.casinoLastResult = null;
    this.casinoLedger = [];
    this.marketLedger = [];
    this.economyTransactions = new Map();
    this.marketQuotes = freshMarketQuotes();
    this.marketRound = 0;
    this.surpriseDeck = [...SURPRISE_DECK];
    this.treasureDeck = [...TREASURE_DECK];
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

  respondPlayerContract(socketId, accept, requestId = null) {
    return respondContract(this, socketId, accept, requestId);
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
      contract.kind === 'loan'
      && ['active', 'due'].includes(contract.status)
      && contract.toPlayerId === player.id
      && Number(contract.collateralTileIndex) === Number(tile.index)
    ));
  }

  highestCollateralProperty(player) {
    return player?.properties
      ?.map(index => this.getTile(index))
      .filter(tile => tile && tile.type === 'property' && !tile.mortgaged && !(tile.houseCount > 0) && !this.isPlayerContractCollateral(player, tile))
      .sort((a, b) => (b.price || 0) - (a.price || 0))[0] || null;
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
    (tile.equityShares || []).forEach(share => {
      const contract = this.playerContractById(share.contractId);
      if (contract && contract.status === 'active') {
        contract.status = 'terminated';
        contract.terminatedRound = this.roundNumber;
      }
    });
    tile.ownerId = toPlayer ? toPlayer.id : null;
    tile.mortgaged = false;
    tile.houseCount = 0;
    tile.equityShares = [];
    if (fromPlayer) {
      fromPlayer.properties = fromPlayer.properties.filter(propertyIndex => propertyIndex !== tile.index);
      // A bubble-survivor deed must remain in the original owner's hands
      // through recovery; transferring it invalidates that achievement fact.
      if (fromPlayer.bubbleSurvivor && fromPlayer.housingBubbleEnded) {
        fromPlayer.bubbleSurvivor = fromPlayer.properties.some(index => (this.getTile(index)?.houseCount || 0) > 0);
      }
    }
    if (toPlayer) {
      toPlayer.properties.push(tile.index);
      this.refreshPlayerGroups(toPlayer);
    }
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
    return this.players.filter(player => !player.isBot && !player.bankrupt && !player.disconnected).length < this.settings.maxPlayers;
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
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    if (!this.started) {
      return { success: false, error: 'Game has not started.' };
    }
    if (player.id !== this.currentPlayerId) {
      return { success: false, error: 'It is not your turn.' };
    }
    if (this.pendingPayment?.playerId === player.id) {
      return { success: false, error: 'Settle your debt before rolling.' };
    }
    if (player.inJail) {
      return this.handleJailRoll(player);
    }
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    const dice = rollDice();
    this.lastDice = dice;
    this.hasRolled = true;
    this.turnAllowsExtraRoll = dice[0] === dice[1];
    this.extraRollPending = this.turnAllowsExtraRoll;
    if (this.turnAllowsExtraRoll) {
      this.consecutiveDoubles += 1;
    } else {
      this.consecutiveDoubles = 0;
    }
    if (this.consecutiveDoubles >= 3) {
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
    const move = dice[0] + dice[1];
    this.feedMessage(`${player.nickname} rolled ${dice[0]} and ${dice[1]} (${move}).`);
    return this.movePlayer(player, move);
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
      this.feedMessage(`${player.nickname} could not pay the jail fine and remains in jail.`);
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
    if (!player || !this.started || player.id !== this.currentPlayerId) return { success: false, error: 'It is not your turn.' };
    if (!player.inJail || !(player.jailFreeCards > 0)) return { success: false, error: 'You do not have a Get Out of Prison card.' };
    if (this.hasRolled) return { success: false, error: 'You have already rolled this turn.' };
    player.jailFreeCards -= 1;
    player.prisonBreak = true;
    player.inJail = false;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} used a Get Out of Prison card.`);
    return { success: true, message: 'You left prison with a Get Out of Prison card.' };
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

  movePlayer(player, steps, options = {}) {
    player.moveCount = (player.moveCount || 0) + 1;
    if (player.moveCount === 41) {
      player.hiddenMovementSequence = true;
      this.feedMessage(`${player.nickname} stepped on the 41st movement. The ledger skipped a line.`);
    }
    const oldPosition = player.position;
    player.position = (player.position + steps) % this.tiles.length;
    const distanceToStart = (START_TILE_INDEX - oldPosition + this.tiles.length) % this.tiles.length || this.tiles.length;
    if (distanceToStart <= steps) {
      player.cash += 200;
      this.feedMessage(`${player.nickname} passed Start and collected $200.`);
    }
    const tile = this.getTile(player.position);
    if (tile?.type === 'railroad') {
      if (!(player.airportVisits instanceof Set)) player.airportVisits = new Set();
      player.airportVisits.add(tile.index);
    }
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

  nextTurn() {
    this.pendingPurchaseOffer = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    const nonBankrupt = this.nonBankruptPlayers();
    if (nonBankrupt.length <= 1) {
      this.endGame();
      return;
    }
    const currentIndex = this.turnOrder.indexOf(this.currentPlayerId);
    let nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % this.turnOrder.length;
    let nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
    let attempts = 0;
    while (nextPlayer && (nextPlayer.bankrupt || nextPlayer.disconnected) && attempts < this.turnOrder.length) {
      nextIndex = (nextIndex + 1) % this.turnOrder.length;
      nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
      attempts += 1;
    }
    if (!nextPlayer || nextPlayer.bankrupt || nextPlayer.disconnected) {
      const waiting = this.getPlayerById(this.currentPlayerId);
      if (waiting && !waiting.bankrupt) {
        this.feedMessage(`Waiting for ${waiting.nickname} to reconnect…`);
      }
      return;
    }
    if (currentIndex >= 0 && nextIndex <= currentIndex) this.advanceRound();
    if (!this.started) return;
    this.currentPlayerId = nextPlayer.id;
    this.hasRolled = false;
    nextPlayer.buildActionsThisTurn = 0;
    nextPlayer.marketActionsThisTurn = 0;
    this.feedMessage(`${nextPlayer.nickname}'s turn.`);
  }

  hasFullSet(ownerId, group) {
    const groupTiles = this.tiles.filter(tile => tile.group === group);
    return groupTiles.every(tile => tile.ownerId === ownerId);
  }

  chargePlayer(player, creditor, amount, message, turnOptions = {}, hooks = {}) {
    // Nothing to collect from a missing payer or a non-debt: the turn just
    // resolves normally.
    if (!player || amount <= 0) {
      this.resolveTurnAfterAction(turnOptions);
      return;
    }
    if (player.cash >= amount) {
      this.payDebtInFull({ player, creditor, amount, message, turnOptions, hooks });
      return;
    }
    this.openDebtSettlement({ player, creditor, amount, message, turnOptions, hooks });
  }

  payDebtInFull(debt) {
    const { player, creditor, amount, message, turnOptions, hooks } = debt;
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
    const { player, creditor, amount, message, turnOptions, hooks } = debt;
    const partial = player.cash;
    if (partial > 0) {
      this.tenderPartialDebt(player, creditor, partial, hooks);
    }
    const remaining = amount - partial;
    this.pendingPayment = {
      playerId: player.id,
      creditorId: creditor ? creditor.id : null,
      amountRemaining: remaining,
      reason: message,
      equityTileIndex: hooks.equityTileIndex ?? null,
      equityOwnerId: hooks.equityOwnerId ?? null
    };
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
  // entirely.
  creditRentTo(creditor, payer, amount) {
    if (!creditor) return;
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
    if (!player || player.bankrupt) {
      this.pendingPayment = null;
      this.pendingPaymentTurnOptions = null;
      return false;
    }
    if (player.cash < this.pendingPayment.amountRemaining) {
      return false;
    }
    const creditor = this.pendingPayment.creditorId
      ? this.getPlayerById(this.pendingPayment.creditorId)
      : null;
    const amount = this.pendingPayment.amountRemaining;
    player.cash -= amount;
    if (creditor) {
      creditor.cash += amount;
      creditor.rentCollected = (creditor.rentCollected || 0) + amount;
      creditor.rentPayerIds ||= new Set();
      creditor.rentPayerIds.add(player.id);
      creditor.rentPayersThisRound ||= new Set();
      creditor.rentPayersThisRound.add(player.id);
      creditor.maxRentPayersInRound = Math.max(creditor.maxRentPayersInRound || 0, creditor.rentPayersThisRound.size);
    }
    if (this.pendingPayment.equityTileIndex != null) {
      const equityTile = this.getTile(this.pendingPayment.equityTileIndex);
      const equityOwner = this.getPlayerById(this.pendingPayment.equityOwnerId);
      this.settleEquityShares(equityTile, equityOwner, amount);
    }
    this.feedMessage(`${player.nickname} paid the remaining $${amount}.`);
    const turnOptions = this.pendingPaymentTurnOptions || {};
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.resolveTurnAfterAction(turnOptions);
    return true;
  }

  transferMoney(from, to, amount, message) {
    if (!from || !to || amount <= 0) {
      return;
    }
    from.cash -= amount;
    to.cash += amount;
    this.feedMessage(message);
  }

  deductMoney(player, amount, message) {
    this.chargePlayer(player, null, amount, message, {});
  }

  endTurn(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || player.id !== this.currentPlayerId) {
      return { success: false, error: 'Only the active player can end the turn.' };
    }
    if (this.extraRollPending || this.turnAllowsExtraRoll) {
      return { success: false, error: 'You must roll again after doubles before ending your turn.' };
    }
    if (!this.awaitingEndTurn) {
      return { success: false, error: 'Resolve your roll before ending the turn.' };
    }
    if (this.auction?.active) {
      return { success: false, error: 'Finish the active auction before ending the turn.' };
    }
    if (this.pendingPurchaseOffer?.playerId === player.id) {
      return { success: false, error: 'Resolve the property offer before ending the turn.' };
    }
    if (this.pendingPayment?.playerId === player.id) {
      return { success: false, error: 'Settle your debt before ending the turn.' };
    }
    this.nextTurn();
    return { success: true };
  }

  skipDisconnectedCurrentPlayer() {
    const current = this.getCurrentPlayer();
    if (!current || !current.disconnected || current.bankrupt) {
      return;
    }
    this.pendingPurchaseOffer = null;
    this.feedMessage(`${current.nickname} was skipped due to disconnect.`);
    this.nextTurn();
  }

  endGame() {
    const winner = this.connectedNonBankruptPlayers().filter(p => !p.inDebt)[0] || this.nonBankruptPlayers().filter(p => !p.inDebt)[0];
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
    this.auction = null;
    this.pendingTrade = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.consecutiveDoubles = 0;
  }

}

Object.assign(GameState.prototype, globalEventsApi, rentApi, tileApi, cardApi, propertyApi, auctionApi, economyApi, tradeApi, bankruptcyApi, appearanceApi, botApi, summaryApi);

export { GameState, Room, RoomManager, APPEARANCE_PRESET_COLORS, AUCTION_DURATION_MS };

