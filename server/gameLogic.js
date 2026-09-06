import crypto from 'crypto';
import { randomInt } from './random.js';
import {
  MARKET_FEE_RATE,
  MARKET_INSTRUMENTS,
  advanceMarket as stepMarketQuotes,
  applyMarketBuy as marketBuyLeg,
  applyMarketSell as marketSellLeg,
  freshMarketQuotes,
  marketOrderRejection as rejectMarketOrder
} from './marketLogic.js';
import {
  bankruptcyRefusal,
  clearQuitObligations,
  outstandingDebtFor
} from './bankruptcyLogic.js';
import {
  playerContractSummary,
  processContracts,
  proposeContract,
  repayContract,
  respondContract,
  settleEquityShares
} from './contractLogic.js';
import {
  LOAN_OUTSTANDING_STATUSES,
  bankLoanOffer,
  bankLoanTerms,
  defaultBankLoan,
  hasLoanBackedCash,
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
import {
  DEFAULT_ROOM_SETTINGS,
  LEGACY_SCALED_SETTINGS,
  ROOM_FLAG_TRUE_VALUES,
  ROOM_SETTING_NORMALIZERS,
  SETTING_REJECTED
} from './roomSettings.js';
import {
  JAIL_FINE,
  JAIL_MAX_TURNS,
  PROPERTY_HOUSE_COST_BY_GROUP,
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

const AUCTION_DURATION_MS = 5000;
const AUCTION_BID_COOLDOWN_MS = 300;
const CASINO_MAX_BET = 500;
const CASINO_BET_COLORS = ['red', 'black', 'green'];
const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
// Market vocabularies, the fee rate, the instruments, and the order gates now
// live in marketLogic.js; server/contracts-market.test.js pins every string.
// Roulette mapping: pocket 0 is green, the rest split on the classic red set.
function roulettePocketColor(pocket) {
  if (pocket === 0) return 'green';
  return ROULETTE_RED.has(pocket) ? 'red' : 'black';
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet.charAt(randomInt(0, alphabet.length - 1));
  }
  return code;
}

// The four default appearance presets, in server assignment order.
const APPEARANCE_PRESET_COLORS = ['#d74438', '#286ea1', '#d9a62f', '#35a653'];

// Resolves a requested seat color against colors taken by connected
// non-bankrupt players (the player's own seat excluded). A collision becomes
// the first free preset; if no preset is free the requested color is kept.
function resolveFreeAppearanceColor(players, requestedColor, self = null) {
  if (typeof requestedColor !== 'string' || !requestedColor) return requestedColor;
  const taken = new Set(
    players
      .filter(player => player !== self && !player.disconnected && !player.bankrupt && typeof player.color === 'string')
      .map(player => player.color.toLowerCase())
  );
  if (!taken.has(requestedColor.toLowerCase())) return requestedColor;
  const free = APPEARANCE_PRESET_COLORS.find(color => !taken.has(color.toLowerCase()));
  return free || requestedColor;
}


class Player {
  constructor({ clientId, socketId, nickname, color, avatarGrid = null, accountId = null, isHost = false, isBot = false, personality = 'survivor' }) {
    this.id = crypto.randomUUID();
    this.clientId = clientId || this.id;
    this.socketId = socketId;
    const safeNickname = typeof nickname === 'string' ? nickname.trim().slice(0, 24) : '';
    const safeColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#35a653';
    this.nickname = safeNickname || 'Player';
    this.color = safeColor;
    this.avatarGrid = Array.isArray(avatarGrid) ? avatarGrid : null;
    this.accountId = accountId || null;
    this.isHost = isHost;
    this.isBot = isBot;
    this.personality = ['builder', 'shark', 'survivor', 'speculator', 'diplomat', 'chaos'].includes(personality) ? personality : 'survivor';
    this.cash = DEFAULT_ROOM_SETTINGS.startingCash;
    this.position = START_TILE_INDEX;
    this.properties = [];
    this.inJail = false;
    this.jailTurns = 0;
    this.jailFreeCards = 0;
    this.bankLoan = null;
    this.casinoNet = 0;
    this.casinoLedger = [];
    this.casinoMaxStake = 0;
    this.casinoTotalStaked = 0;
    this.casinoAllIn = false;
    this.casinoOneDollar = false;
    this.casinoBetsThisRound = 0;
    this.marketPositions = {};
    this.marketTrades = 0;
    this.marketActionsThisTurn = 0;
    this.crisisMarketBuys = {};
    this.crisisMarketProfit = false;
    this.playerContractIds = [];
    this.auctionWins = 0;
    this.rentCollected = 0;
    this.globalEventsExperienced = 0;
    this.globalEventsSurvived = 0;
    this.fullGroups = new Set();
    this.airportVisits = new Set();
    this.taxTilesVisited = new Set();
    this.rentPayerIds = new Set();
    this.rentPayersThisRound = new Set();
    this.maxRentPayersInRound = 0;
    this.auctionUnderListWins = 0;
    this.loanWarningSeen = false;
    this.badIdeaLoan = false;
    this.prisonBreak = false;
    this.bankLoanCount = 0;
    this.boughtDuringHousingBubble = false;
    this.soldBuildingsDuringHousingBubble = 0;
    this.bubbleSurvivor = false;
    this.rebuiltAfterHousingBubble = false;
    this.foreclosureNoSecondLoan = false;
    this.housingBubbleEnded = false;
    this.airportOwnedDuringStrike = false;
    this.nonAirportRentDuringStrike = false;
    this.tradesDuringCombo = 0;
    this.groupTherapyTrade = false;
    this.unanimousVote = false;
    this.publicEnemy = false;
    this.compromisedCouncil = false;
    this.coalitionTrade = false;
    this.lastVoteChoice = null;
    this.bailoutReceived = false;
    this.moralHazard = false;
    this.zeroCashReached = false;
    this.collateralLost = false;
    this.comboExperienced = false;
    this.buildActionsThisTurn = 0;
    this.evenBuilds = 0;
    this.councilWins = 0;
    this.publicWorksBuilds = 0;
    this.cardDraws = { surprise: 0, treasure: 0 };
    this.treasureCardsSeen = new Set();
    this.underdogAtHalfway = false;
    this.oneMoreTurn = false;
    this.taxAuditCount = 0;
    this.moveCount = 0;
    this.hiddenMovementSequence = false;
    this.bankrupt = false;
    this.disconnected = false;
    this.ready = false;
  }
}

class AuctionState {
  constructor(propertyTile, startingPlayerId) {
    this.propertyTile = propertyTile;
    this.active = true;
    this.highestBid = 0;
    this.highestBidderId = null;
    this.participants = [];
    this.startingPlayerId = startingPlayerId;
    this.startedAt = Date.now();
    this.endsAt = Date.now() + AUCTION_DURATION_MS;
    this.cooldownUntil = 0;
    this.lastBidAt = 0;
    this.passedPlayerIds = [];
  }
}

// Property action dispatch: the four manageProperty verbs mapped to their
// handler method names on GameState, replacing the original if/else ladder.
const PROPERTY_ACTION_HANDLERS = {
  'build-house': 'buildHousePropertyAction',
  'sell-house': 'sellHousePropertyAction',
  mortgage: 'mortgagePropertyAction',
  unmortgage: 'unmortgagePropertyAction'
};

const buildingLabel = (houseCount) => (houseCount >= 5 ? 'hotel' : 'house');

const TRADE_PROPOSAL_GUARDS = [
  {
    error: 'Choose a valid trade partner.',
    rejects: (game, ctx) => !ctx.fromPlayer || !ctx.toPlayer || ctx.fromPlayer.id === ctx.toPlayer.id
  },
  {
    error: 'Both players must be active to trade.',
    rejects: (game, ctx) => ctx.fromPlayer.bankrupt || ctx.fromPlayer.disconnected || ctx.toPlayer.bankrupt || ctx.toPlayer.disconnected
  },
  {
    error: 'Another trade is already pending.',
    rejects: game => Boolean(game.pendingTrade || game.pendingPlayerContract)
  },
  {
    error: 'Cash values must be valid numbers.',
    rejects: (game, ctx) => !Number.isFinite(ctx.giveCash) || !Number.isFinite(ctx.requestCash)
  },
  {
    error: 'Choose at least one cash or property item to include in the trade.',
    rejects: (game, ctx) => !ctx.giveCash && !ctx.requestCash && !ctx.givePropertyIndexes.length && !ctx.requestPropertyIndexes.length
  },
  {
    error: 'You can only offer properties that you own and that have no houses, hotels, or mortgage.',
    rejects: (game, ctx) => ctx.giveTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.fromPlayer.id))
  },
  {
    error: 'The requested properties are not available for trade.',
    rejects: (game, ctx) => ctx.requestTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.toPlayer.id))
  },
  {
    error: 'You do not have enough cash for this offer.',
    rejects: (game, ctx) => ctx.fromPlayer.cash < ctx.giveCash
  }
];

// Accept-side revalidation for respondToTrade: same order and strings as the
// original accept branch. A fired guard also clears the pending trade, which
// the responder does uniformly. The first entry covers the original combined
// "players still exist, active" condition verbatim.
const TRADE_SETTLEMENT_GUARDS = [
  {
    error: 'The trade is no longer valid.',
    rejects: (game, ctx) => !ctx.fromPlayer || !ctx.toPlayer || ctx.fromPlayer.bankrupt || ctx.toPlayer.bankrupt || ctx.fromPlayer.disconnected || ctx.toPlayer.disconnected
  },
  {
    error: 'One of the players no longer has enough cash.',
    rejects: (game, ctx) => ctx.fromPlayer.cash < ctx.trade.giveCash || ctx.toPlayer.cash < ctx.trade.requestCash
  },
  {
    error: 'One of the offered properties is no longer tradable.',
    rejects: (game, ctx) => ctx.giveTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.trade.fromPlayerId))
  },
  {
    error: 'One of the requested properties is no longer tradable.',
    rejects: (game, ctx) => ctx.requestTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.trade.toPlayerId))
  }
];

// Pre-roll bot candidate sources as data: the array order IS the original
// push order inside getBotCandidates, and the final sort is stable, so ties
// keep this sequence. Each collector returns a (possibly empty) array of
// candidates shaped exactly as before; kind values are the contract consumed
// by botLogic's CANDIDATE_MAPPERS/CANDIDATE_RUNNERS tables.
const BOT_CANDIDATE_SOURCES = [
  { collect: (game, player) => game.botBuildCandidates(player) },
  { collect: (game, player) => game.botMortgageCandidates(player) },
  { collect: (game, player) => game.botLoanCandidate(player) },
  { collect: (game, player) => game.botGroupTradeCandidate(player) },
  { collect: (game, player) => game.botMarketCandidate(player) },
  { collect: (game, player) => game.botCasinoCandidate(player) }
];

// Personality-driven candidate values as data tables so the collectors stay
// branch-light while reproducing the original ternary ladders verbatim. The
// casino spec is only read after the collector's guard confirms the
// personality, so that entry is always defined there.
const BOT_CASINO_SPECS = {
  chaos: { color: 'green', stakeRate: 0.08, score: 18 },
  shark: { color: 'red', stakeRate: 0.03, score: 11 }
};

const BOT_TRADE_ASKS = {
  shark: { requestCash: 40, score: 8 },
  diplomat: { requestCash: 0, score: 24 }
};
const BOT_TRADE_ASK_DEFAULT = { requestCash: 0, score: 8 };

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

  setPlayerAppearance(socketId, { color, nickname, avatarGrid } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    const safeColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
    if (safeColor) {
      // Color is the appearance identity: another connected non-bankrupt
      // player using it means the icon is taken at this table. Custom
      // avatarGrids may still differ as long as colors differ.
      const clash = this.players.some(other =>
        other !== player &&
        !other.disconnected &&
        !other.bankrupt &&
        typeof other.color === 'string' &&
        other.color.toLowerCase() === safeColor.toLowerCase()
      );
      if (clash) {
        return { success: false, error: 'That icon is already taken at this table.' };
      }
      player.color = safeColor;
    }
    if (typeof nickname === 'string' && !this.started) {
      const safeNickname = nickname.trim().slice(0, 24);
      if (safeNickname) {
        player.nickname = safeNickname;
      }
    }
    if (avatarGrid === null || Array.isArray(avatarGrid)) {
      player.avatarGrid = avatarGrid;
    }
    return { success: true };
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

  getPropertyHouseCost(tile) {
    const base = PROPERTY_HOUSE_COST_BY_GROUP[tile?.group] || 0;
    if (this.isPublicWorksElection()) {
      return Math.max(1, Math.floor(base * 0.65));
    }
    const multiplier = Number(this.activeEventEffects().buildingCostMultiplier);
    return Number.isFinite(multiplier) && multiplier > 0 ? Math.max(1, Math.ceil(base * multiplier)) : base;
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

  casinoLimits() {
    const effects = this.activeEventEffects();
    const maxBet = Number(effects.casinoMaxBet);
    const entryFee = Number(effects.casinoEntryFee);
    return {
      maxBet: Number.isFinite(maxBet) && maxBet > 0 ? Math.min(CASINO_MAX_BET, Math.floor(maxBet)) : CASINO_MAX_BET,
      entryFee: Number.isFinite(entryFee) && entryFee > 0 ? Math.floor(entryFee) : 0
    };
  }

  transactionKey(playerId, kind, requestId) {
    const value = String(requestId || '').trim().slice(0, 100);
    return value ? `${playerId}:${kind}:${value}` : null;
  }

  cachedTransaction(key) {
    return key ? this.economyTransactions.get(key) || null : null;
  }

  cacheTransaction(key, result) {
    if (key) this.economyTransactions.set(key, result);
    return result;
  }

  economySnapshot(playerId = null) {
    const player = playerId ? this.getPlayerById(playerId) : null;
    const casinoLimits = this.casinoLimits();
    return {
      casino: {
        enabled: Boolean(this.settings.casino),
        maxBet: casinoLimits.maxBet,
        entryFee: casinoLimits.entryFee,
        lastResult: this.casinoLastResult ? { ...this.casinoLastResult } : null,
        net: Number(player?.casinoNet) || 0
      },
      market: {
        enabled: Boolean(this.settings.market),
        round: this.marketRound,
        feeRate: MARKET_FEE_RATE,
        quotes: { ...this.marketQuotes },
        positions: { ...(player?.marketPositions || {}) }
      }
    };
  }

  placeCasinoBet(socketId, color, stake, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const choice = String(color || '').toLowerCase();
    const amount = Math.floor(Number(stake));
    const key = this.transactionKey(player?.id, 'casino', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const rejection = this.casinoBetRejection(player, choice, amount);
    if (rejection) return { success: false, error: rejection };
    return this.settleCasinoBet(player, choice, amount, key);
  }

  // Guard ladder kept in the original precedence order: the session rules
  // first, then the wager itself. Returns the exact client-facing error
  // string, or null when the bet may be settled.
  casinoBetRejection(player, choice, amount) {
    return this.casinoSessionRejection(player) || this.casinoWagerRejection(player, choice, amount);
  }

  casinoSessionRejection(player) {
    if (!this.settings.casino) return 'Casino access is off for this room.';
    if (this.casinoSessionBlocked(player)) return 'Casino access is unavailable right now.';
    if (this.tableObligationPending()) return 'Resolve the table obligation before betting.';
    return null;
  }

  // Casino access needs a live, started table and a seated, solvent,
  // connected player; any of those missing reads as "unavailable".
  casinoSessionBlocked(player) {
    if (!this.started) return true;
    if (!player) return true;
    if (player.bankrupt) return true;
    return Boolean(player.disconnected);
  }

  // A single "is the table busy" question: any of the five pending flows
  // keeps players away from the casino wheel.
  tableObligationPending() {
    return [
      this.pendingPayment,
      this.auction,
      this.pendingPurchaseOffer,
      this.pendingTrade,
      this.pendingPlayerContract
    ].some(Boolean);
  }

  casinoWagerRejection(player, choice, amount) {
    if (!CASINO_BET_COLORS.includes(choice)) return 'Choose red, black, or green.';
    const limits = this.casinoLimits();
    if (this.casinoStakeRejected(amount, limits)) return `Stake must be between $1 and ${limits.maxBet}.`;
    if (this.hasLoanBackedCash(player)) return 'Loan-backed cash cannot enter the casino.';
    if (player.cash < amount + limits.entryFee) return 'You do not have enough available cash for the stake and event fee.';
    return null;
  }

  // Stakes arrive already floored by the caller; whole-dollar stakes inside
  // the event-aware limit are the only ones accepted.
  casinoStakeRejected(amount, limits) {
    if (!Number.isInteger(amount)) return true;
    if (amount < 1) return true;
    return amount > limits.maxBet;
  }

  hasLoanBackedCash(player) {
    return hasLoanBackedCash(player);
  }

  // The spin itself: one pocket draw (randomInt is the only RNG call site on
  // this path), 35:1 on green and 1:1 on the colors, fees taken on both
  // sides of the outcome.
  settleCasinoBet(player, choice, amount, key) {
    const limits = this.casinoLimits();
    const cashBefore = player.cash;
    const pocket = randomInt(0, 36);
    const resultColor = roulettePocketColor(pocket);
    const won = choice === resultColor;
    const payout = choice === 'green' ? 35 : 1;
    const net = won ? amount * payout - limits.entryFee : -amount - limits.entryFee;
    player.cash -= amount + limits.entryFee;
    if (won) player.cash += amount + (amount * payout);
    this.applyCasinoTally(player, { amount, net, entryFee: limits.entryFee, cashBefore });
    const ledgerEntry = { transactionId: key || crypto.randomUUID(), roundNumber: this.roundNumber, color: choice, pocket, resultColor, stake: amount, net, createdAt: new Date().toISOString() };
    this.recordCasinoLedger(player, ledgerEntry);
    this.casinoLastResult = { playerId: player.id, color: choice, pocket, resultColor, net, roundNumber: this.roundNumber };
    this.feedMessage(`${player.nickname} bet $${amount} on ${choice.toUpperCase()} and ${won ? 'won' : 'lost'} $${Math.abs(net)}.`);
    return this.cacheTransaction(key, { success: true, result: { ...ledgerEntry, balanceAfter: player.cash }, economy: this.economySnapshot(player.id) });
  }

  // Bankroll facts: max/total staked, the sticky all-in and one-dollar
  // markers, and the per-round bet counter.
  applyCasinoTally(player, bet) {
    player.casinoNet += bet.net;
    player.casinoMaxStake = Math.max(player.casinoMaxStake || 0, bet.amount);
    player.casinoTotalStaked = (player.casinoTotalStaked || 0) + bet.amount;
    player.casinoAllIn = player.casinoAllIn || bet.amount + bet.entryFee >= bet.cashBefore;
    player.casinoOneDollar = player.casinoOneDollar || bet.amount === 1;
    player.casinoBetsThisRound = (player.casinoBetsThisRound || 0) + 1;
  }

  // Newest-first ledgers: the room keeps a wide copy stamped with the
  // playerId, the player a bare personal history.
  recordCasinoLedger(player, ledgerEntry) {
    this.casinoLedger = [{ ...ledgerEntry, playerId: player.id }, ...this.casinoLedger].slice(0, 200);
    player.casinoLedger = [ledgerEntry, ...(player.casinoLedger || [])].slice(0, 50);
  }

  advanceMarket() {
    stepMarketQuotes(this);
  }

  tradeMarket(socketId, instrumentId, side, quantity, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const id = String(instrumentId || '').toLowerCase();
    const direction = String(side || '').toLowerCase();
    const amount = Math.floor(Number(quantity));
    const key = this.transactionKey(player?.id, 'market', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const instrument = MARKET_INSTRUMENTS.find(entry => entry.id === id);
    const rejection = this.marketOrderRejection(player, instrument, direction, amount);
    if (rejection) return rejection;
    const quote = Number(this.marketQuotes[id]) || instrument.price;
    const gross = quote * amount;
    const fee = Math.max(1, Math.ceil(gross * MARKET_FEE_RATE));
    const position = player.marketPositions[id] || { quantity: 0, averageCost: 0, realizedPnl: 0 };
    const leg = direction === 'buy' ? this.applyMarketBuy : this.applyMarketSell;
    const legRejection = leg.call(this, player, id, position, { quote, gross, fee, amount });
    if (legRejection) return legRejection;
    player.marketPositions[id] = position;
    player.marketTrades = (player.marketTrades || 0) + 1;
    player.marketActionsThisTurn = (player.marketActionsThisTurn || 0) + 1;
    this.marketLedger = [{ transactionId: key || crypto.randomUUID(), roundNumber: this.roundNumber, playerId: player.id, instrumentId: id, side: direction, quantity: amount, quote, fee, createdAt: new Date().toISOString() }, ...this.marketLedger].slice(0, 300);
    this.feedMessage(`${player.nickname} ${direction === 'buy' ? 'bought' : 'sold'} ${amount} ${instrument.name} index unit${amount === 1 ? '' : 's'}.`);
    return this.cacheTransaction(key, { success: true, order: { instrumentId: id, side: direction, quantity: amount, quote, fee, total: direction === 'buy' ? gross + fee : gross - fee }, economy: this.economySnapshot(player.id) });
  }

  marketOrderRejection(player, instrument, direction, amount) {
    return rejectMarketOrder({ game: this, player, instrument, direction, amount });
  }

  applyMarketBuy(player, id, position, order) {
    return marketBuyLeg({ game: this, player, id, position, ...order });
  }

  applyMarketSell(player, id, position, order) {
    return marketSellLeg({ game: this, player, id, position, ...order });
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

  // Bankruptcy is the player's decision, not the server's verdict. With a
  // debt it hands assets to the creditor; without one it is a voluntary
  // retirement whose deeds return to the market unencumbered.
  declareBankruptcy(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const refusal = bankruptcyRefusal(this, player);
    if (refusal) return refusal;
    const { owes, creditor } = outstandingDebtFor(this, player);
    clearQuitObligations(this, player);
    this.handleBankruptcy(player, creditor);
    if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
    return { success: true, voluntary: !owes };
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

  // The bankruptcy pipeline, in the original statement order: table-state
  // resets, market liquidation (its feed line lands before any deed moves),
  // the cash sweep to the creditor, contract settlements, deed transfer or
  // release, the announcement, and the round conclusion.
  handleBankruptcy(player, creditor = null) {
    if (this.settings.bankruptMode === 'debt') {
      return this.handleDebtBankruptcy(player, creditor);
    }
    this.markPlayerBankrupt(player);
    this.liquidateMarketPositions(player);
    this.sweepCashToCreditor(player, creditor);
    this.settleContractsOnBankruptcy(player);
    this.forfeitOrReleaseProperties(player, creditor);
    this.announceBankruptcy(player, creditor);
    this.concludeBankruptRound(player);
  }

  handleDebtBankruptcy(player, creditor) {
    this.sweepCashToCreditor(player, creditor);
    if (!creditor) player.cash = 0;
    this.forfeitOrReleaseProperties(player, creditor);
    this.settleContractsOnBankruptcy(player);
    player.inDebt = true;
    this.feedMessage(creditor
      ? `${player.nickname}'s assets were transferred to ${creditor.nickname}. They stay in the game with debt.`
      : `${player.nickname} lost everything. They stay in the game with debt.`);
    if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
  }

  markPlayerBankrupt(player) {
    player.bankrupt = true;
    player.bubbleSurvivor = false;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.consecutiveDoubles = 0;
    if (this.pendingPayment?.playerId === player.id) {
      this.pendingPayment = null;
      this.pendingPaymentTurnOptions = null;
    }
  }

  // Positions are force-sold at the current quote minus the market fee and
  // floored into cash; zero-proceeding holdings are dropped silently. The
  // per-position realized P&L (net proceeds over average cost) is recorded
  // so post-game stats see the forced exit, not just voluntary sells.
  liquidateMarketPositions(player) {
    const entries = Object.entries(player.marketPositions || {});
    const proceedsOf = (id, quantity) => {
      const quote = Math.max(0, Number(this.marketQuotes[id]) || 0);
      const gross = quote * quantity;
      return Math.max(0, gross - Math.ceil(gross * MARKET_FEE_RATE));
    };
    const marketLiquidation = entries.reduce((sum, [id, position]) => {
      const quantity = Math.max(0, Number(position.quantity) || 0);
      return sum + proceedsOf(id, quantity);
    }, 0);
    if (marketLiquidation <= 0) return;
    entries.forEach(([id, position]) => {
      const quantity = Math.max(0, Number(position.quantity) || 0);
      position.realizedPnl = (Number(position.realizedPnl) || 0)
        + proceedsOf(id, quantity) - (Number(position.averageCost) || 0) * quantity;
      position.quantity = 0;
      position.averageCost = 0;
    });
    player.cash += Math.floor(marketLiquidation);
    this.feedMessage(`${player.nickname}'s market positions were liquidated for $${Math.floor(marketLiquidation)}.`);
  }

  // Whatever cash survives liquidation flows to the creditor before any
  // deed is handed over.
  sweepCashToCreditor(player, creditor) {
    if (!creditor) return;
    if (player.cash <= 0) return;
    creditor.cash += player.cash;
    player.cash = 0;
  }

  settleContractsOnBankruptcy(player) {
    this.playerContracts
      .filter(contract => LOAN_OUTSTANDING_STATUSES.includes(contract.status) && this.contractTouchesPlayer(contract, player))
      .forEach(contract => this.settleBankruptContract(player, contract));
  }

  contractTouchesPlayer(contract, player) {
    if (contract.toPlayerId === player.id) return true;
    return contract.fromPlayerId === player.id;
  }

  // A borrower's loan defaults (with the collateral seized while they still
  // hold it); a lender's loan just terminates; an equity agreement
  // terminates after its shares are stripped off the deed. Anything else is
  // left untouched, exactly as the original if-ladder.
  settleBankruptContract(player, contract) {
    if (contract.kind === 'loan') {
      // The pending-payment filter already guarantees one side is the
      // bankrupt player, so a loan not owed by them is one they issued.
      if (contract.toPlayerId === player.id) {
        this.seizeCollateralForLender(player, contract);
      } else {
        this.terminateContract(contract);
      }
    } else if (contract.kind === 'equity') {
      this.terminateEquityContract(contract);
    }
  }

  seizeCollateralForLender(player, contract) {
    const lender = this.getPlayerById(contract.fromPlayerId);
    const collateral = contract.collateralTileIndex == null ? null : this.getTile(contract.collateralTileIndex);
    if (lender && collateral?.ownerId === player.id) this.applyPropertyOwnershipChange(player, lender, collateral);
    if (contract.collateralTileIndex != null) player.collateralLost = true;
    contract.status = 'defaulted';
    contract.defaultedRound = this.roundNumber;
  }

  terminateContract(contract) {
    contract.status = 'terminated';
    contract.terminatedRound = this.roundNumber;
  }

  terminateEquityContract(contract) {
    const property = this.getTile(contract.propertyIndex);
    if (property) property.equityShares = (property.equityShares || []).filter(entry => entry.contractId !== contract.id);
    this.terminateContract(contract);
  }

  // With a solvent creditor every deed is transferred in holding order; the
  // collateral already seized during contract settling is no longer in the
  // snapshot taken here.
  forfeitOrReleaseProperties(player, creditor) {
    const properties = [...player.properties];
    properties.forEach(propertyIndex => {
      const tile = this.getTile(propertyIndex);
      if (!tile) return;
      if (creditor && !creditor.bankrupt) {
        this.applyPropertyOwnershipChange(player, creditor, tile);
      } else {
        this.releasePropertyTile(player, tile);
      }
    });
    player.properties = [];
  }

  releasePropertyTile(player, tile) {
    tile.ownerId = null;
    tile.houseCount = 0;
    tile.mortgaged = false;
    player.properties = player.properties.filter(index => index !== tile.index);
  }

  // A bankrupt player facing a creditor hands over assets; one owing the
  // bank simply leaves the table.
  announceBankruptcy(player, creditor) {
    if (creditor) {
      this.feedMessage(`${player.nickname} is bankrupt. Assets transferred to ${creditor.nickname}.`);
    } else {
      this.feedMessage(`${player.nickname} is bankrupt and removed from the game.`);
    }
  }

  // The last seat standing wins immediately; otherwise the bankrupt current
  // player forfeits the turn.
  concludeBankruptRound(player) {
    const active = this.nonBankruptPlayers().filter(p => !p.inDebt);
    if (active.length <= 1) {
      this.endGame();
    } else if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
  }

  purchaseProperty(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    if (!player || !tile || tile.ownerId !== null) {
      return { success: false, error: 'Property is no longer available.' };
    }
    if (
      !this.pendingPurchaseOffer ||
      this.pendingPurchaseOffer.playerId !== player.id ||
      this.pendingPurchaseOffer.tileIndex !== tileIndex
    ) {
      return { success: false, error: 'There is no active purchase offer for this property.' };
    }
    if (player.cash < tile.price) {
      return { success: false, error: 'Insufficient cash to purchase this property.' };
    }
    player.cash -= tile.price;
    tile.ownerId = player.id;
    tile.mortgaged = false;
    tile.houseCount = 0;
    player.properties.push(tile.index);
    if (this.globalEventActive('housing-bubble')) player.boughtDuringHousingBubble = true;
    this.refreshPlayerGroups(player);
    this.feedMessage(`${player.nickname} purchased ${tile.name} for $${tile.price}.`);
    this.pendingPurchaseOffer = null;
    this.resolveTurnAfterAction();
    return { success: true };
  }

  declineProperty(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    if (!player || !tile || tile.ownerId !== null) {
      return { success: false, error: 'Property is no longer available.' };
    }
    if (
      !this.pendingPurchaseOffer ||
      this.pendingPurchaseOffer.playerId !== player.id ||
      this.pendingPurchaseOffer.tileIndex !== tileIndex
    ) {
      return { success: false, error: 'There is no active purchase offer for this property.' };
    }
    this.pendingPurchaseOffer = null;
    if (this.settings.auction) {
      const auction = this.startAuction(tile, player.id);
      return auction?.success === false ? auction : { success: true, auctionStarted: true, message: 'Auction started for the declined property.' };
    }
    this.feedMessage(`${player.nickname} declined to buy ${tile.name}.`);
    this.resolveTurnAfterAction();
    return { success: true };
  }

  startAuction(tile, initiatingPlayerId) {
    if (this.globalEventActive('bank-run') || this.activeEventEffects().auctionBlocked) {
      this.feedMessage('The active global event pauses auctions until liquidity returns.');
      this.resolveTurnAfterAction({ allowExtraRoll: false });
      return { success: false, error: 'Auctions are paused by the active Bank Run.' };
    }
    const participants = this.players.filter(player => !player.bankrupt && !player.disconnected).map(player => player.id);
    this.auction = new AuctionState(tile, initiatingPlayerId);
    this.auction.participants = participants;
    this.feedMessage(`Auction started for ${tile.name}. Players may place bids.`);
  }

  placeAuctionBid(socketId, amount) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || !this.auction || !this.auction.active) {
      return { success: false, error: 'No auction is active.' };
    }
    const now = Date.now();
    if (player.bankrupt || player.disconnected) {
      return { success: false, error: 'You cannot bid right now.' };
    }
    if (this.auction.participants.length && !this.auction.participants.includes(player.id)) {
      return { success: false, error: 'You are not part of this auction.' };
    }
    if (this.auction.passedPlayerIds.includes(player.id)) {
      return { success: false, error: 'You have passed on this auction.' };
    }
    if (this.auction.cooldownUntil && now < this.auction.cooldownUntil) {
      return { success: false, error: 'Please wait a moment before bidding again.' };
    }
    if (!Number.isFinite(amount) || amount % 1 !== 0) {
      return { success: false, error: 'Bid must be a whole number.' };
    }
    if (amount <= this.auction.highestBid) {
      return { success: false, error: 'Bid must be higher than the current bid.' };
    }
    if (amount > player.cash) {
      return { success: false, error: 'Insufficient funds for this bid.' };
    }
    if (this.auction.highestBid > 0 && this.auction.highestBidderId === player.id) {
      return { success: false, error: 'Another player must raise the bid first.' };
    }
    this.auction.highestBid = amount;
    this.auction.highestBidderId = player.id;
    this.auction.lastBidAt = now;
    this.auction.cooldownUntil = now + AUCTION_BID_COOLDOWN_MS;
    this.auction.endsAt = now + AUCTION_DURATION_MS;
    this.feedMessage(`${player.nickname} bid $${amount}.`);
    return { success: true };
  }

  passAuction(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || !this.auction || !this.auction.active) {
      return { success: false, error: 'No auction is active.' };
    }
    if (this.auction.participants.length && !this.auction.participants.includes(player.id)) {
      return { success: false, error: 'You are not part of this auction.' };
    }
    if (this.auction.highestBidderId === player.id) {
      return { success: false, error: 'The current high bidder cannot pass.' };
    }
    if (!this.auction.passedPlayerIds.includes(player.id)) {
      this.auction.passedPlayerIds.push(player.id);
      this.feedMessage(`${player.nickname} passed on the auction.`);
    }
    const remaining = this.auction.participants.filter(id => !this.auction.passedPlayerIds.includes(id));
    if (this.auction.highestBidderId && remaining.length <= 1) {
      this.finishAuction();
      return { success: true, finished: true };
    }
    return { success: true };
  }

  finishAuction() {
    if (!this.auction || !this.auction.active) {
      return;
    }
    const auction = this.auction;
    auction.active = false;
    if (!auction.highestBidderId) {
      this.feedMessage(`No bids were placed for ${auction.propertyTile.name}. The property remains unsold.`);
      this.resolveTurnAfterAction();
      this.auction = null;
      return;
    }
    const winner = this.getPlayerById(auction.highestBidderId);
    if (!winner || winner.bankrupt || winner.disconnected) {
      this.feedMessage(`Auction ended without a valid winner.`);
      this.resolveTurnAfterAction();
      this.auction = null;
      return;
    }
    auction.propertyTile.ownerId = winner.id;
    auction.propertyTile.mortgaged = false;
    auction.propertyTile.houseCount = 0;
    winner.properties.push(auction.propertyTile.index);
    winner.auctionWins = (winner.auctionWins || 0) + 1;
    if (auction.highestBid < Number(auction.propertyTile.price || 0)) winner.auctionUnderListWins = (winner.auctionUnderListWins || 0) + 1;
    this.feedMessage(`${winner.nickname} won the auction for ${auction.propertyTile.name} at $${auction.highestBid}.`);
    this.chargePlayer(
      winner,
      null,
      auction.highestBid,
      `${winner.nickname} paid $${auction.highestBid} for ${auction.propertyTile.name}.`,
      {}
    );
    this.auctionsCompleted += 1;
    this.auction = null;
  }

  manageProperty(socketId, payload = {}) {
    const { tileIndex, action } = payload || {};
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    const rejection = this.propertyActionRejection(player, tile, action);
    if (rejection) return rejection;
    const handlerName = PROPERTY_ACTION_HANDLERS[action];
    if (!handlerName) return { success: false, error: 'Unknown property action.' };
    const result = this[handlerName](player, tile);
    if (result?.success && this.pendingPayment?.playerId === player.id) {
      this.trySettlePendingPayment();
    }
    return result;
  }

  // The shared gates of all four actions, in the historical order: existence,
  // ownership, then the build/sell turn window (relaxed while settling debt).
  propertyActionRejection(player, tile, action) {
    if (!player || !tile) {
      return { success: false, error: 'Property not found.' };
    }
    if (tile.ownerId !== player.id) {
      return { success: false, error: 'You do not own this property.' };
    }
    const settlingDebt = this.pendingPayment?.playerId === player.id;
    const buildOrSell = action === 'build-house' || action === 'sell-house';
    if (!buildOrSell) return null;
    if (!settlingDebt) return this.buildWindowRejection(player);
    if (action === 'build-house') {
      return { success: false, error: 'You cannot build while settling a debt.' };
    }
    return null;
  }

  buildWindowRejection(player) {
    if (player.id !== this.currentPlayerId) {
      return { success: false, error: 'You can only build or sell during your turn.' };
    }
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You can only build or sell before rolling the dice.' };
    }
    return null;
  }

  buildingLimitRejection(player) {
    const buildLimit = Number(this.activeEventEffects().buildingLimitPerTurn);
    if (Number.isFinite(buildLimit) && buildLimit > 0 && (player.buildActionsThisTurn || 0) >= buildLimit) {
      return { success: false, error: 'The active event limits building actions this turn.' };
    }
    return null;
  }

  // Side effects a completed build awards, beyond the house itself.
  applyBuildBonuses(player) {
    if (player.housingBubbleEnded && player.soldBuildingsDuringHousingBubble > 0) player.rebuiltAfterHousingBubble = true;
    if (this.settings.evenBuild) player.evenBuilds = (player.evenBuilds || 0) + 1;
    const election = this.globalEvent;
    if (election?.phase === 'active' && election.id === 'city-election' && election.resolvedChoice === 'public-works') {
      player.publicWorksBuilds = (player.publicWorksBuilds || 0) + 1;
    }
  }

  buildHousePropertyAction(player, tile) {
    if (!this.canBuildOnTile(player, tile)) {
      return { success: false, error: 'You cannot build on this property right now.' };
    }
    const limit = this.buildingLimitRejection(player);
    if (limit) return limit;
    const cost = this.getPropertyHouseCost(tile);
    if (player.cash < cost) {
      return { success: false, error: 'Insufficient cash to build a house.' };
    }
    player.cash -= cost;
    tile.houseCount = (tile.houseCount || 0) + 1;
    player.buildActionsThisTurn = (player.buildActionsThisTurn || 0) + 1;
    this.applyBuildBonuses(player);
    this.feedMessage(`${player.nickname} built a ${buildingLabel(tile.houseCount)} on ${tile.name}.`);
    return { success: true };
  }

  sellHousePropertyAction(player, tile) {
    if (!this.canSellFromTile(player, tile)) {
      return { success: false, error: 'You cannot sell a house from this property right now.' };
    }
    const cost = this.getPropertyHouseCost(tile);
    const wasHotel = (tile.houseCount || 0) >= 5;
    tile.houseCount = Math.max(0, (tile.houseCount || 0) - 1);
    player.cash += Math.floor(cost * this.buildingSaleMultiplier());
    if (this.globalEventActive('housing-bubble')) player.soldBuildingsDuringHousingBubble = (player.soldBuildingsDuringHousingBubble || 0) + 1;
    this.feedMessage(`${player.nickname} sold a ${buildingLabel(wasHotel ? 5 : 0)} from ${tile.name}.`);
    return { success: true };
  }

  buildingSaleMultiplier() {
    const eventSaleMultiplier = Number(this.activeEventEffects().buildingSaleMultiplier);
    return Number.isFinite(eventSaleMultiplier) && eventSaleMultiplier >= 0 ? eventSaleMultiplier : 0.5;
  }

  mortgagePropertyAction(player, tile) {
    if (!this.canMortgageTile(player, tile)) {
      return { success: false, error: 'You cannot mortgage this property right now.' };
    }
    tile.mortgaged = true;
    const amount = Math.floor((tile.price || 0) / 2 * this.propertyValueMultiplier());
    player.cash += amount;
    this.feedMessage(`${player.nickname} mortgaged ${tile.name} for $${amount}.`);
    return { success: true };
  }

  propertyValueMultiplier() {
    const valueMultiplier = Number(this.activeEventEffects().propertyValueMultiplier);
    return Number.isFinite(valueMultiplier) && valueMultiplier > 0 ? valueMultiplier : 1;
  }

  unmortgagePropertyAction(player, tile) {
    if (!this.canUnmortgageTile(player, tile)) {
      return { success: false, error: 'You cannot unmortgage this property right now.' };
    }
    const cost = Math.ceil(Math.floor((tile.price || 0) / 2) * 1.1);
    if (player.cash < cost) {
      return { success: false, error: 'Insufficient cash to unmortgage this property.' };
    }
    player.cash -= cost;
    tile.mortgaged = false;
    this.feedMessage(`${player.nickname} unmortgaged ${tile.name}.`);
    return { success: true };
  }

  proposeTrade(socketId, offer = {}) {
    const ctx = this.tradeProposalContext(socketId, offer);
    const guard = TRADE_PROPOSAL_GUARDS.find(entry => entry.rejects(this, ctx));
    if (guard) return { success: false, error: guard.error };
    const trade = {
      id: crypto.randomUUID(),
      fromPlayerId: ctx.fromPlayer.id,
      fromPlayerName: ctx.fromPlayer.nickname,
      toPlayerId: ctx.toPlayer.id,
      toPlayerName: ctx.toPlayer.nickname,
      giveCash: ctx.giveCash,
      requestCash: ctx.requestCash,
      givePropertyIndexes: ctx.givePropertyIndexes,
      requestPropertyIndexes: ctx.requestPropertyIndexes,
      createdAt: Date.now()
    };
    this.pendingTrade = trade;
    this.feedMessage(`${ctx.fromPlayer.nickname} sent a trade offer to ${ctx.toPlayer.nickname}.`);
    return { success: true, trade };
  }

  // One normalization pass for the raw offer: cash clamping, index coercion,
  // and tile resolution all happen exactly as in the original single-body
  // implementation, before any guard reads the context.
  tradeProposalContext(socketId, offer) {
    const fromPlayer = this.getPlayerBySocket(socketId);
    const toPlayer = this.getPlayerById(offer.toPlayerId);
    const giveCash = Math.max(0, Number(offer.giveCash || 0));
    const requestCash = Math.max(0, Number(offer.requestCash || 0));
    const givePropertyIndexes = Array.isArray(offer.givePropertyIndexes) ? offer.givePropertyIndexes.map(Number) : [];
    const requestPropertyIndexes = Array.isArray(offer.requestPropertyIndexes) ? offer.requestPropertyIndexes.map(Number) : [];
    const giveTiles = givePropertyIndexes.map(index => this.getTile(index));
    const requestTiles = requestPropertyIndexes.map(index => this.getTile(index));
    return { fromPlayer, toPlayer, giveCash, requestCash, givePropertyIndexes, requestPropertyIndexes, giveTiles, requestTiles };
  }

  // The original inline per-tile leg check, named: a missing deed, a deed
  // owned by someone else, or an untradeable deed voids the leg.
  tradeLegTileUnavailable(tile, ownerId) {
    if (!tile) return true;
    if (tile.ownerId !== ownerId) return true;
    return !this.isTradeableTile(tile);
  }

  respondToTrade(socketId, { tradeId, accept } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'No matching trade offer was found.' };
    }
    const trade = this.pendingTrade;
    if (!trade || trade.id !== tradeId) {
      return { success: false, error: 'No matching trade offer was found.' };
    }
    if (trade.toPlayerId !== player.id) {
      return { success: false, error: 'Only the receiving player can respond to this trade.' };
    }
    if (!accept) {
      return this.declineTradeOffer(player);
    }
    const ctx = this.tradeSettlementContext(trade);
    const guard = TRADE_SETTLEMENT_GUARDS.find(entry => entry.rejects(this, ctx));
    if (guard) {
      this.pendingTrade = null;
      return { success: false, error: guard.error };
    }
    return this.settleTradeOffer(ctx);
  }

  // Deed re-resolution at accept time; pure tile lookups for the guards and
  // the settlement transfer below.
  tradeSettlementContext(trade) {
    return {
      trade,
      fromPlayer: this.getPlayerById(trade.fromPlayerId),
      toPlayer: this.getPlayerById(trade.toPlayerId),
      giveTiles: trade.givePropertyIndexes.map(index => this.getTile(index)),
      requestTiles: trade.requestPropertyIndexes.map(index => this.getTile(index))
    };
  }

  declineTradeOffer(player) {
    this.feedMessage(`${player.nickname} declined the trade offer.`);
    this.pendingTrade = null;
    return { success: true, accepted: false };
  }

  settleTradeOffer(ctx) {
    const { trade, fromPlayer, toPlayer, giveTiles, requestTiles } = ctx;
    fromPlayer.cash -= trade.giveCash;
    toPlayer.cash += trade.giveCash;
    toPlayer.cash -= trade.requestCash;
    fromPlayer.cash += trade.requestCash;
    giveTiles.forEach(tile => this.applyPropertyOwnershipChange(fromPlayer, toPlayer, tile));
    requestTiles.forEach(tile => this.applyPropertyOwnershipChange(toPlayer, fromPlayer, tile));
    this.pendingTrade = null;
    this.tradesCompleted += 1;
    this.markCompletedTradeFlags(fromPlayer, toPlayer, giveTiles.length + requestTiles.length);
    this.feedMessage(`${fromPlayer.nickname} and ${toPlayer.nickname} completed a trade.`);
    this.settleTradeLinkedPayments(fromPlayer, toPlayer);
    return { success: true, accepted: true };
  }

  markCompletedTradeFlags(fromPlayer, toPlayer, tradedPropertyCount) {
    if (tradedPropertyCount >= 3) {
      fromPlayer.groupTherapyTrade = true;
      toPlayer.groupTherapyTrade = true;
    }
    if (this.globalEventActive('stagflation')) {
      fromPlayer.tradesDuringCombo = (fromPlayer.tradesDuringCombo || 0) + 1;
      toPlayer.tradesDuringCombo = (toPlayer.tradesDuringCombo || 0) + 1;
    }
    if (fromPlayer.lastVoteChoice && toPlayer.lastVoteChoice) {
      if (fromPlayer.lastVoteChoice !== toPlayer.lastVoteChoice) {
        fromPlayer.coalitionTrade = true;
        toPlayer.coalitionTrade = true;
      }
    }
  }

  settleTradeLinkedPayments(fromPlayer, toPlayer) {
    if (this.pendingPayment?.playerId !== fromPlayer.id && this.pendingPayment?.playerId !== toPlayer.id) {
      return;
    }
    this.trySettlePendingPayment();
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

  runBotAction(playerId, action) {
    const bot = this.getPlayerById(playerId);
    if (!bot || !bot.isBot || typeof action !== 'function') return { success: false, error: 'Bot not found.' };
    const previousSocketId = bot.socketId;
    const actorId = `bot:${bot.id}`;
    bot.socketId = actorId;
    try {
      return action(actorId);
    } finally {
      bot.socketId = previousSocketId;
    }
  }

  // Roll is always available; the pre-roll table appends the remaining
  // candidate sources in their historical order, then the stable sort ranks
  // them by score desc, risk asc.
  getBotCandidates(player) {
    if (!player?.isBot) return [];
    const candidates = [{ id: 'roll', kind: 'roll', risk: 0, score: 0 }];
    if (!this.hasRolled) {
      for (const source of BOT_CANDIDATE_SOURCES) {
        candidates.push(...source.collect(this, player));
      }
    }
    return candidates.sort((a, b) => b.score - a.score || a.risk - b.risk);
  }

  botBuildCandidates(player) {
    return this.tiles
      .filter(tile => this.canBuildOnTile(player, tile))
      .map(tile => {
        const cost = this.getPropertyHouseCost(tile);
        return { id: 'build:' + tile.index, kind: 'build', tileIndex: tile.index, cost, risk: cost / Math.max(1, player.cash), score: player.personality === 'builder' ? 30 : 10 };
      });
  }

  botMortgageCandidates(player) {
    if (player.cash >= 180) return [];
    return this.tiles
      .filter(tile => this.canMortgageTile(player, tile))
      .map(tile => ({ id: 'mortgage:' + tile.index, kind: 'mortgage', tileIndex: tile.index, proceeds: Math.floor((tile.price || 0) / 2), risk: 0.25, score: player.personality === 'survivor' ? 24 : 8 }));
  }

  botLoanCandidate(player) {
    const loan = this.getBankLoanOffer(player);
    if (!loan.available) return [];
    return [{ id: 'loan:emergency', kind: 'loan', principal: loan.principal, risk: loan.totalDue / loan.principal, score: player.personality === 'speculator' ? 18 : -20 }];
  }

  botGroupTradeCandidate(player) {
    const partner = this.activePlayers().find(candidate => candidate.id !== player.id && !candidate.isBot);
    if (!partner) return [];
    const giveTile = this.firstTradeableOwnedTile(player);
    const askTile = this.firstTradeableOwnedTile(partner);
    if (!giveTile || !askTile) return [];
    if (!giveTile.group || giveTile.group !== askTile.group) return [];
    const ask = BOT_TRADE_ASKS[player.personality] || BOT_TRADE_ASK_DEFAULT;
    return [{
      id: 'trade:' + partner.id + ':' + askTile.index,
      kind: 'trade',
      toPlayerId: partner.id,
      givePropertyIndexes: [giveTile.index],
      requestPropertyIndexes: [askTile.index],
      giveCash: 0,
      requestCash: ask.requestCash,
      risk: 0.2,
      score: ask.score
    }];
  }

  firstTradeableOwnedTile(player) {
    return player.properties.map(index => this.getTile(index)).find(tile => tile && this.isTradeableTile(tile));
  }

  botMarketCandidate(player) {
    if (!this.settings.market) return [];
    if ((player.marketActionsThisTurn || 0) >= 1) return [];
    const marketId = Object.entries(this.marketQuotes).sort(([, a], [, b]) => a - b)[0]?.[0];
    if (!marketId) return [];
    return [{
      id: 'market:' + marketId,
      kind: 'market',
      instrumentId: marketId,
      side: 'buy',
      quantity: 1,
      risk: (Number(this.marketQuotes[marketId]) || 100) / Math.max(1, player.cash),
      score: player.personality === 'speculator' ? 20 : 4
    }];
  }

  botCasinoCandidate(player) {
    if (!this.settings.casino) return [];
    if ((player.casinoBetsThisRound || 0) >= 1) return [];
    if (!['shark', 'chaos'].includes(player.personality)) return [];
    if (player.cash <= 20) return [];
    const spec = BOT_CASINO_SPECS[player.personality];
    return [{
      id: 'casino:red',
      kind: 'casino',
      color: spec.color,
      stake: Math.min(20, Math.max(1, Math.floor(player.cash * spec.stakeRate))),
      risk: 0.55,
      score: spec.score
    }];
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

  getGameSummary(viewerPlayerId = null) {
    return {
      started: this.started,
      currentPlayerId: this.currentPlayerId,
      turnOrder: this.turnOrder || [],
      hasRolled: this.hasRolled,
      extraRollPending: this.extraRollPending,
      awaitingEndTurn: this.awaitingEndTurn,
      pendingPurchaseOffer: this.pendingPurchaseOffer,
      pendingPayment: this.pendingPayment,
      lastWinner: this.lastWinner,
      lastDice: this.lastDice,
      tiles: this.tiles.map(tile => ({
        index: tile.index,
        name: tile.name,
        type: tile.type,
        group: tile.group,
        ownerId: tile.ownerId,
        price: tile.price,
        rent: tile.rent,
        color: tile.color,
        amount: tile.amount,
        mortgaged: tile.mortgaged,
        houseCount: tile.houseCount || 0,
        houseCost: this.getPropertyHouseCost(tile),
        equityShares: (tile.equityShares || []).map(share => ({
          holderId: share.holderId,
          holderName: this.getPlayerById(share.holderId)?.nickname || 'PLAYER',
          share: Math.max(0, Math.min(100, Number(share.share) || 0)),
          control: share.control || 'passive'
        }))
      })),
      players: this.players.map(player => ({
        id: player.id,
        nickname: player.nickname,
        color: player.color,
        cash: player.cash,
        position: player.position,
        inJail: player.inJail,
        jailTurns: player.jailTurns || 0,
        jailFreeCards: player.jailFreeCards || 0,
        bankLoan: viewerPlayerId && player.id === viewerPlayerId
          ? player.bankLoan
          : (player.bankLoan ? { status: player.bankLoan.status } : null),
        bankLoanOffer: viewerPlayerId && player.id === viewerPlayerId ? this.getBankLoanOffer(player) : null,
        bankrupt: player.bankrupt,
        inDebt: player.inDebt,
        disconnected: player.disconnected,
        isHost: player.isHost,
        properties: player.properties,
        ready: player.ready,
        isBot: player.isBot,
        personality: player.isBot ? player.personality : null,
        clientId: player.clientId,
        accountId: player.accountId || null,
        avatarGrid: player.avatarGrid || null
      })),
      feed: this.feed,
      roundNumber: this.roundNumber,
      globalEvent: this.globalEvent ? {
        ...this.globalEvent,
        votes: { ...this.globalEvent.votes },
        choices: this.globalEvent.choices?.map(choice => ({ ...choice })) || null
      } : null,
      globalEventHistory: this.globalEventHistory,
      auction: this.auction ? {
        active: this.auction.active,
        tileIndex: this.auction.propertyTile.index,
        tileName: this.auction.propertyTile.name,
        highestBid: this.auction.highestBid,
        highestBidderId: this.auction.highestBidderId,
        participants: this.auction.participants,
        startedAt: this.auction.startedAt,
        endsAt: this.auction.endsAt,
        cooldownUntil: this.auction.cooldownUntil,
        lastBidAt: this.auction.lastBidAt,
        passedPlayerIds: this.auction.passedPlayerIds,
        durationMs: AUCTION_DURATION_MS
      } : null,
      pendingTrade: this.pendingTrade,
      vacationPool: this.vacationPool,
      playerContracts: this.playerContractSummary(viewerPlayerId),
      economy: {
        casino: {
          enabled: Boolean(this.settings.casino),
          ...this.casinoLimits(),
          lastResult: this.casinoLastResult ? { ...this.casinoLastResult } : null
        },
        market: {
          enabled: Boolean(this.settings.market),
          round: this.marketRound,
          feeRate: MARKET_FEE_RATE,
          quotes: { ...this.marketQuotes }
        }
      }
    };
  }
}

Object.assign(GameState.prototype, globalEventsApi, rentApi, tileApi, cardApi);

class Room {
  constructor(hostPlayer, { roomName = 'AFTER HOURS', visibility = 'public', roomCode = '' } = {}) {
    this.roomCode = roomCode || createRoomCode();
    this.roomName = roomName;
    this.visibility = visibility;
    this.statsRecorded = false;
    this.hostId = hostPlayer.id;
    this.settings = { ...DEFAULT_ROOM_SETTINGS };
    this.game = new GameState(this.settings);
    this.game.addPlayer(hostPlayer);
  }

  addOrReconnectPlayer(playerInfo) {
    const existing = this.game.getPlayerByClient(playerInfo.clientId);
    if (existing) {
      existing.socketId = playerInfo.socketId;
      existing.disconnected = false;
      if (typeof playerInfo.nickname === 'string') {
        const safeNickname = playerInfo.nickname.trim().slice(0, 24);
        if (safeNickname) {
          existing.nickname = safeNickname;
        }
      }
      if (typeof playerInfo.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(playerInfo.color)) {
        existing.color = resolveFreeAppearanceColor(this.game.players, playerInfo.color, existing);
      }
      if (playerInfo.avatarGrid === null || Array.isArray(playerInfo.avatarGrid)) {
        existing.avatarGrid = playerInfo.avatarGrid;
      }
      if (playerInfo.accountId) existing.accountId = playerInfo.accountId;
      return { success: true, player: existing };
    }
    if (this.game.started) {
      return { success: false, error: 'Game is already in progress.' };
    }
    if (!this.game.canJoin()) {
      return { success: false, error: 'Room is full.' };
    }
    const player = new Player(playerInfo);
    player.color = resolveFreeAppearanceColor(this.game.players, player.color, player);
    this.game.addPlayer(player);
    return { success: true, player };
  }

  // Public browse, disconnect GC, and stale-code reclaim share this single
  // liveness check: bots and ghost seats must not count as humans.
  hasConnectedHumans() {
    return this.game.players.some(player => !player.isBot && !player.disconnected);
  }

  getPlayerBySocket(socketId) {
    return this.game.getPlayerBySocket(socketId);
  }

  getPlayerById(id) {
    return this.game.getPlayerById(id);
  }

  setRoomSetting(key, value) {
    if (this.game.started) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(this.settings, key)) {
      return;
    }
    if (LEGACY_SCALED_SETTINGS.includes(key)) {
      return;
    }
    const normalizer = ROOM_SETTING_NORMALIZERS[key];
    const nextValue = normalizer ? normalizer(value, this) : this.defaultRoomSettingValue(key, value);
    if (nextValue === SETTING_REJECTED) {
      return;
    }
    this.settings[key] = nextValue;
    this.game.settings[key] = nextValue;
    this.applyRoomSettingSideEffect(key, nextValue);
  }

  // Generic fallback for keys the table does not specialise: boolean flags
  // parse the four truthy spellings, strings lose their edges, and other
  // types are stored exactly as received.
  defaultRoomSettingValue(key, value) {
    if (typeof this.settings[key] === 'boolean') {
      return ROOM_FLAG_TRUE_VALUES.includes(value);
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  }

  applyRoomSettingSideEffect(key, value) {
    if (key !== 'startingCash') {
      return;
    }
    this.game.players.forEach(player => {
      player.cash = Number(value);
    });
  }

  startGame() {
    this.ensureBots();
    const result = this.game.startGame();
    if (result?.success) this.statsRecorded = false;
    return result;
  }

  ensureBots() {
    const required = Math.max(0, Math.min(this.settings.maxPlayers - 1, Number(this.settings.bots) || 0));
    const existingBots = this.game.players.filter(player => player.isBot);
    if (existingBots.length > required) {
      existingBots.slice(required).forEach(bot => {
        this.game.removePlayerByClient(bot.clientId);
      });
    }
    const botCount = Math.min(existingBots.length, required);
    const colors = ['#286ea1', '#35a653', '#d9a62f'];
    for (let index = botCount; index < required; index += 1) {
      const bot = new Player({
        clientId: `bot-${this.roomCode}-${index + 1}`,
       nickname: `BOT ${index + 1}`,
       color: colors[index % colors.length],
        isBot: true,
        personality: this.settings.botPersonality
      });
      this.game.addPlayer(bot);
    }
  }

  rollDice(socketId) {
    return this.game.rollDice(socketId);
  }

  purchaseProperty(socketId, tileIndex) {
    return this.game.purchaseProperty(socketId, tileIndex);
  }

  declineProperty(socketId, tileIndex) {
    return this.game.declineProperty(socketId, tileIndex);
  }

  placeAuctionBid(socketId, amount) {
    return this.game.placeAuctionBid(socketId, amount);
  }

  passAuction(socketId) {
    return this.game.passAuction(socketId);
  }

  manageProperty(socketId, payload) {
    return this.game.manageProperty(socketId, payload);
  }

  proposeTrade(socketId, payload) {
    return this.game.proposeTrade(socketId, payload);
  }

  respondToTrade(socketId, payload) {
    return this.game.respondToTrade(socketId, payload);
  }

  proposePlayerContract(socketId, payload) {
    return this.game.proposePlayerContract(socketId, payload);
  }

  respondPlayerContract(socketId, accept, requestId) {
    return this.game.respondPlayerContract(socketId, accept, requestId);
  }

  repayPlayerContract(socketId, payload) {
    return this.game.repayPlayerContract(socketId, payload);
  }

  endTurn(socketId) {
    return this.game.endTurn(socketId);
  }

  payJailFine(socketId) {
    return this.game.payJailFine(socketId);
  }

  useJailFree(socketId) {
    return this.game.useJailFree(socketId);
  }

  getBankLoanOffer(socketId) {
    return this.game.getBankLoanOffer(this.game.getPlayerBySocket(socketId));
  }

  takeBankLoan(socketId, requestId) {
    return this.game.takeBankLoan(socketId, requestId);
  }

  repayBankLoan(socketId, payload) {
    return this.game.repayBankLoan(socketId, payload);
  }

  placeCasinoBet(socketId, color, stake, requestId) {
    return this.game.placeCasinoBet(socketId, color, stake, requestId);
  }

  tradeMarket(socketId, instrumentId, side, quantity, requestId) {
    return this.game.tradeMarket(socketId, instrumentId, side, quantity, requestId);
  }

  runBotAction(playerId, action) {
    return this.game.runBotAction(playerId, action);
  }

  voteGlobalEvent(socketId, choiceId) {
    return this.game.voteGlobalEvent(socketId, choiceId);
  }

  declareBankruptcy(socketId) {
    return this.game.declareBankruptcy(socketId);
  }

  getRoomSummary() {
    // Legacy clients may still send these fields; the server owns scaling now,
    // so they never leave the server side of the wire.
    const publicSettings = { ...this.settings };
    delete publicSettings.globalEventDuration;
    delete publicSettings.globalEventMax;
    return {
      // Public tables are discovered directly; only private tables expose an
      // invite code in the client-facing room projection.
      roomCode: this.visibility === 'private' ? this.roomCode : null,
      roomName: this.roomName,
      visibility: this.visibility,
      capacity: this.settings.maxPlayers,
      hostId: this.hostId,
      settings: publicSettings,
      players: this.game.players.map(player => ({
        id: player.id,
        clientId: player.clientId,
        nickname: player.nickname,
        color: player.color,
        cash: player.cash,
        position: player.position,
        inJail: player.inJail,
        jailTurns: player.jailTurns || 0,
        bankrupt: player.bankrupt,
        disconnected: player.disconnected,
        isHost: player.isHost,
        ready: player.ready,
        isBot: player.isBot,
        accountId: player.accountId || null,
        avatarGrid: player.avatarGrid || null
      })),
      started: this.game.started,
      vacationPool: this.game.vacationPool
    };
  }

  getDirectorySummary() {
    const active = this.game.players.filter(player => !player.disconnected && !player.bankrupt);
    const started = this.game.started;
    return {
      code: this.roomCode,
      name: this.roomName,
      seats: active.length,
      cap: this.settings.maxPlayers,
      bank: `$${Number(this.settings.startingCash).toLocaleString()}`,
      state: started ? 'live' : 'open',
      visibility: this.visibility,
      note: started ? 'round live' : 'waiting for players'
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketRoom = new Map();
  }

  createRoom(hostInfo) {
    const player = new Player({ ...hostInfo, isHost: true });
    // Generated codes must never silently overwrite an existing room entry.
    let roomCode = hostInfo.roomCode;
    if (!roomCode) {
      do {
        roomCode = createRoomCode();
      } while (this.rooms.has(roomCode));
    }
    const room = new Room(player, { roomName: hostInfo.roomName, visibility: hostInfo.visibility, roomCode });
    player.color = resolveFreeAppearanceColor(room.game.players, player.color, player);
    this.rooms.set(room.roomCode, room);
    this.socketRoom.set(hostInfo.socketId, room);
    return room;
  }

  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(String(roomCode).toUpperCase()) || null;
  }

  getRoomBySocket(socketId) {
    return this.socketRoom.get(socketId) || null;
  }

  restoreConnection(clientId, socketId) {
    const room =
      [...this.rooms.values()].find(roomItem => {
        const player = roomItem.game.getPlayerByClient(clientId);
        return player && !player.disconnected;
      }) ||
      [...this.rooms.values()].find(roomItem => roomItem.game.getPlayerByClient(clientId));
    if (!room) return null;
    const player = room.game.getPlayerByClient(clientId);
    if (!player) return null;
    player.socketId = socketId;
    player.disconnected = false;
    this.socketRoom.set(socketId, room);
    return room;
  }

  disconnectPlayer(socketId) {
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;
    this.socketRoom.delete(socketId);
    return room;
  }

  getRoomByClient(clientId) {
    if (!clientId) return null;
    return [...this.rooms.values()].find(roomItem => roomItem.game.getPlayerByClient(clientId)) || null;
  }

  listPublicRooms() {
    return [...this.rooms.values()]
      .filter(room => room.visibility === 'public' && room.hasConnectedHumans())
      .map(room => room.getDirectorySummary());
  }

  leaveRoomByClient(clientId, socketId) {
    const room = this.getRoomByClient(clientId);
    if (!room) return null;
    const player = room.game.getPlayerByClient(clientId);
    if (!player) return null;
    if (socketId) {
      this.socketRoom.delete(socketId);
    }
    const playerId = player.id;
    const game = room.game;
    const wasCurrentTurn = game.started && game.currentPlayerId === playerId;
    // A real leave releases the seat in the lobby AND mid-game, so the room
    // can drain to empty and the GC can reclaim it.
    game.removePlayerByClient(clientId);
    if (game.started) {
      if (Array.isArray(game.turnOrder)) {
        game.turnOrder = game.turnOrder.filter(id => id !== playerId);
      }
      if (game.pendingPurchaseOffer?.playerId === playerId) game.pendingPurchaseOffer = null;
      if (game.pendingPayment?.playerId === playerId) {
        game.pendingPayment = null;
        game.pendingPaymentTurnOptions = null;
      }
      if (game.pendingTrade && (game.pendingTrade.fromPlayerId === playerId || game.pendingTrade.toPlayerId === playerId)) {
        game.pendingTrade = null;
      }
      if (game.pendingPlayerContract && (game.pendingPlayerContract.fromPlayerId === playerId || game.pendingPlayerContract.toPlayerId === playerId)) {
        game.pendingPlayerContract = null;
      }
      if (game.auction?.active && game.auction.highestBidderId === playerId) game.auction.highestBidderId = null;
      if (wasCurrentTurn) {
        // nextTurn() treats an unknown current id as "before the first seat"
        // and hands the dice to the next surviving player in turn order.
        game.currentPlayerId = null;
        game.nextTurn();
      }
    }
    if (game.players.length === 0) {
      this.rooms.delete(room.roomCode);
    }
    return room;
  }
}

export { RoomManager, GameState, Room, APPEARANCE_PRESET_COLORS, AUCTION_DURATION_MS };

