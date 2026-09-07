// Versioned, provider-safe bot projection. This module only reshapes the
// authoritative GameState; it never executes an action or exposes stable
// account/socket identifiers. Keep it separate from bot execution so a future
// simulator and the AI adapter can consume the same snapshot contract.
import { JAIL_FINE, JAIL_MAX_TURNS, START_TILE_INDEX, SURPRISE_DECK, TREASURE_DECK } from './gameData.js';
import { MARKET_FEE_RATE } from './marketLogic.js';

export const BOT_CONTEXT_VERSION = 'bot-context-v2';
export const BOT_RULE_VERSION = 'bot-policy-v2';

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function nonNegative(value) {
  return Math.max(0, integer(value));
}

function cashBand(cash, startingCash) {
  const value = Number(cash) || 0;
  const baseline = Math.max(1, Number(startingCash) || 1500);
  if (value <= 0) return 'empty';
  if (value < baseline * 0.35) return 'low';
  if (value < baseline) return 'steady';
  return 'strong';
}

function seatOf(game, bot, playerId) {
  if (!playerId) return 'bank';
  if (playerId === bot.id) return 'self';
  const index = (game.players || []).findIndex(player => player.id === playerId);
  return index < 0 ? 'unknown' : `opponent-${index + 1}`;
}

function tileView(game, bot, tile) {
  if (!tile) return null;
  return {
    index: tile.index,
    name: tile.name,
    type: tile.type,
    group: tile.group || null,
    ownerSeat: seatOf(game, bot, tile.ownerId),
    price: nonNegative(tile.price),
    rent: nonNegative(tile.rent),
    houseCount: Math.max(0, Math.min(5, integer(tile.houseCount))),
    mortgaged: tile.mortgaged === true,
    equityShares: Array.isArray(tile.equityShares) && tile.equityShares.length > 0
  };
}

function ownPropertyView(game, bot) {
  return (bot.properties || [])
    .map(index => tileView(game, bot, game.getTile(index)))
    .filter(Boolean);
}

function ownContractView(game, bot) {
  return (game.playerContracts || [])
    .filter(contract => contract.fromPlayerId === bot.id || contract.toPlayerId === bot.id)
    .slice(0, 20)
    .map(contract => ({
      kind: contract.kind,
      role: contract.toPlayerId === bot.id ? 'borrower' : 'lender',
      status: contract.status,
      amount: nonNegative(contract.amount),
      remaining: nonNegative(contract.remaining),
      premiumRate: Math.max(0, Number(contract.premiumRate) || 0),
      durationRounds: nonNegative(contract.durationRounds),
      dueRound: contract.dueRound == null ? null : nonNegative(contract.dueRound),
      collateralTileIndex: contract.toPlayerId === bot.id ? contract.collateralTileIndex ?? null : null,
      equityShare: contract.toPlayerId === bot.id ? Math.max(0, Number(contract.equityShare) || 0) : null,
      conversionShare: contract.toPlayerId === bot.id ? Math.max(0, Number(contract.conversionShare) || 0) : null
    }));
}

function ownLoanView(bot) {
  if (!bot.bankLoan) return null;
  return {
    status: bot.bankLoan.status,
    principal: nonNegative(bot.bankLoan.principal),
    remaining: nonNegative(bot.bankLoan.remaining),
    dueRound: bot.bankLoan.dueRound == null ? null : nonNegative(bot.bankLoan.dueRound),
    cureRound: bot.bankLoan.cureRound == null ? null : nonNegative(bot.bankLoan.cureRound),
    collateralTileIndex: bot.bankLoan.collateralTileIndex ?? null,
    severity: bot.bankLoan.severity || null
  };
}

function ownMarketView(bot) {
  return Object.fromEntries(Object.entries(bot.marketPositions || {}).map(([id, position]) => [
    String(id).slice(0, 40),
    {
      quantity: nonNegative(position?.quantity),
      averageCost: Math.max(0, Number(position?.averageCost) || 0),
      realizedPnl: Number(position?.realizedPnl) || 0
    }
  ]));
}

function ownCasinoView(bot) {
  return {
    net: integer(bot.casinoNet),
    bets: Array.isArray(bot.casinoLedger) ? bot.casinoLedger.length : 0,
    betsThisRound: nonNegative(bot.casinoBetsThisRound),
    allIn: bot.casinoAllIn === true,
    oneDollar: bot.casinoOneDollar === true
  };
}

function cardExpectedCash(deck, playerCount) {
  const opponents = Math.max(0, Number(playerCount || 1) - 1);
  if (!Array.isArray(deck) || !deck.length) return 0;
  const total = deck.reduce((sum, card) => {
    const amount = Number(card.amount) || 0;
    if (card.action === 'collect' || card.action === 'collectStart') return sum + amount;
    if (card.action === 'pay') return sum - amount;
    if (card.action === 'collectFromEach') return sum + amount * opponents;
    if (card.action === 'payEach') return sum - amount * opponents;
    return sum;
  }, 0);
  return Math.round((total / deck.length) * 100) / 100;
}

function opponentView(game, bot, player, index) {
  return {
    seat: `opponent-${index + 1}`,
    kind: player.isBot ? 'cpu' : 'player',
    position: nonNegative(player.position),
    cashBand: cashBand(player.cash, game.settings?.startingCash),
    propertyCount: Array.isArray(player.properties) ? player.properties.length : 0,
    completeGroups: typeof game.playerGroups === 'function' ? game.playerGroups(player).length : 0,
    inJail: player.inJail === true,
    bankrupt: player.bankrupt === true,
    disconnected: player.disconnected === true
  };
}

function turnView(game, bot) {
  const order = Array.isArray(game.turnOrder) ? game.turnOrder : [];
  const botTurnIndex = order.indexOf(bot.id);
  return {
    currentSeat: seatOf(game, bot, game.currentPlayerId),
    selfTurnIndex: botTurnIndex < 0 ? null : botTurnIndex,
    turnCount: order.length,
    hasRolled: game.hasRolled === true,
    awaitingEndTurn: game.awaitingEndTurn === true,
    extraRollPending: game.extraRollPending === true,
    lastDice: Array.isArray(game.lastDice) ? game.lastDice.map(nonNegative).slice(0, 2) : [0, 0]
  };
}

function recentBotDecisions(game, bot) {
  if (!Array.isArray(game?.botDecisionTrace)) return [];
  return game.botDecisionTrace
    .filter(entry => entry?.botId === bot.id)
    .slice(-6)
    .map(entry => ({
      sequence: nonNegative(entry.sequence ?? entry.decisionSequence),
      phase: String(entry.phase || 'unknown').slice(0, 24),
      actionId: typeof entry.actionId === 'string' ? entry.actionId.slice(0, 80) : null,
      fallback: entry.fallback === true,
      success: entry.success !== false,
      strategicScore: Number.isFinite(Number(entry.strategicScore)) ? Number(entry.strategicScore) : null,
      reasonCode: typeof entry.reasonCode === 'string' ? entry.reasonCode.slice(0, 40) : null
    }));
}

function botDecisionMemory(game, bot) {
  const entries = Array.isArray(game?.botDecisionTrace)
    ? game.botDecisionTrace.filter(entry => entry?.botId === bot.id)
    : [];
  const byAction = new Map();
  const byPhase = new Map();
  entries.forEach(entry => {
    const action = String(entry.actionId || 'unknown').slice(0, 80);
    const phase = String(entry.phase || 'unknown').slice(0, 24);
    const actionRow = byAction.get(action) || { actionId: action, attempts: 0, successes: 0 };
    actionRow.attempts += 1;
    if (entry.success !== false) actionRow.successes += 1;
    byAction.set(action, actionRow);
    const phaseRow = byPhase.get(phase) || { phase, attempts: 0, successes: 0 };
    phaseRow.attempts += 1;
    if (entry.success !== false) phaseRow.successes += 1;
    byPhase.set(phase, phaseRow);
  });
  return {
    decisions: entries.length,
    successes: entries.filter(entry => entry.success !== false).length,
    failures: entries.filter(entry => entry.success === false).length,
    actionRates: [...byAction.values()].slice(-8),
    phaseRates: [...byPhase.values()].slice(-8)
  };
}

function obligationView(game, bot) {
  const payment = game.pendingPayment;
  const purchase = game.pendingPurchaseOffer;
  const sponsorship = game.pendingSponsoredPurchase;
  const auction = game.auction;
  const trade = game.pendingTrade;
  const contract = game.pendingPlayerContract;
  return {
    payment: payment ? {
      ownerSeat: seatOf(game, bot, payment.playerId),
      amountRemaining: nonNegative(payment.amountRemaining),
      creditorSeat: seatOf(game, bot, payment.creditorId)
    } : null,
    purchase: purchase ? {
      ownerSeat: seatOf(game, bot, purchase.playerId),
      tileIndex: purchase.tileIndex ?? null,
      price: nonNegative(typeof game.getTile === 'function' ? game.getTile(purchase.tileIndex)?.price : 0)
    } : null,
    sponsorship: sponsorship ? {
      ownerSeat: seatOf(game, bot, sponsorship.buyerId),
      tileIndex: sponsorship.tileIndex ?? null,
      price: nonNegative(typeof game.getTile === 'function' ? game.getTile(sponsorship.tileIndex)?.price : sponsorship.price),
      totalContributed: nonNegative(sponsorship.contributions?.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)),
      contributionCount: Array.isArray(sponsorship.contributions) ? sponsorship.contributions.length : 0
    } : null,
    auction: auction ? {
      tileIndex: auction.propertyTile?.index ?? null,
      highestBid: nonNegative(auction.highestBid),
      highestBidderSeat: seatOf(game, bot, auction.highestBidderId),
      participantCount: Array.isArray(auction.participants) ? auction.participants.length : 0,
      passedCount: Array.isArray(auction.passedPlayerIds) ? auction.passedPlayerIds.length : 0
    } : null,
    trade: trade ? {
      role: trade.toPlayerId === bot.id ? 'recipient' : trade.fromPlayerId === bot.id ? 'sender' : 'other',
      giveCash: trade.fromPlayerId === bot.id ? nonNegative(trade.giveCash) : nonNegative(trade.requestCash),
      requestCash: trade.fromPlayerId === bot.id ? nonNegative(trade.requestCash) : nonNegative(trade.giveCash),
      givePropertyIndexes: (trade.fromPlayerId === bot.id ? trade.givePropertyIndexes || [] : trade.requestPropertyIndexes || []).slice(0, 12),
      requestPropertyIndexes: (trade.fromPlayerId === bot.id ? trade.requestPropertyIndexes || [] : trade.givePropertyIndexes || []).slice(0, 12)
    } : null,
    contract: contract ? {
      role: contract.toPlayerId === bot.id ? 'recipient' : contract.fromPlayerId === bot.id ? 'sender' : 'other',
      kind: contract.kind,
      amount: nonNegative(contract.amount),
      premiumRate: Math.max(0, Number(contract.premiumRate) || 0),
      durationRounds: nonNegative(contract.durationRounds)
    } : null
  };
}

function rulesDigest(game) {
  const settings = game.settings || {};
  const effects = typeof game.activeEventEffects === 'function' ? game.activeEventEffects() : {};
  const casinoLimits = typeof game.casinoLimits === 'function' ? game.casinoLimits() : {};
  return {
    version: BOT_RULE_VERSION,
    boardSize: Array.isArray(game.tiles) ? game.tiles.length : 40,
    startTileIndex: START_TILE_INDEX,
    passStartCash: 200,
    doubleGo: settings.doubleGo === true,
    jailFine: JAIL_FINE,
    jailMaxTurns: JAIL_MAX_TURNS,
    purchaseReserve: 120,
    evenBuild: settings.evenBuild !== false,
    houseLimit: nonNegative(settings.houseLimit),
    hotelLimit: nonNegative(settings.hotelLimit),
    noRentWhileInPrison: settings.noRentWhileInPrison === true,
    auction: settings.auction === true,
    trading: settings.trading !== false && effects.tradingEnabled !== false,
    bankLoans: settings.bankLoans !== false,
    bankLoanSeverity: settings.bankLoanSeverity || 'predatory',
    sponsorship: { enabled: true, giftsOnly: true, forcedPurchase: true, loanOrEquity: false },
    casino: { enabled: settings.casino === true, ...casinoLimits, loanBackedCashAllowed: false },
    market: { enabled: settings.market === true, feeRate: MARKET_FEE_RATE, margin: false, shorting: false },
    cards: {
      surpriseCount: SURPRISE_DECK.length,
      treasureCount: TREASURE_DECK.length,
      surpriseExpectedCash: cardExpectedCash(SURPRISE_DECK, game.players?.length),
      treasureExpectedCash: cardExpectedCash(TREASURE_DECK, game.players?.length)
    },
    globalEvents: { enabled: Boolean(settings.globalEvents), activeEffects: { ...effects } }
  };
}

function eventView(game) {
  const event = game.globalEvent;
  if (!event) return null;
  return {
    id: event.id,
    title: event.title,
    category: event.category,
    phase: event.phase,
    roundsRemaining: nonNegative(event.roundsRemaining),
    durationRounds: nonNegative(event.durationRounds),
    effects: { ...(event.effects || {}) },
    choices: Array.isArray(event.choices) ? event.choices.slice(0, 6).map(choice => ({
      id: choice.id,
      label: choice.label,
      description: choice.description
    })) : null
  };
}

export function buildBotStrategicContext(game, bot, phase = 'pre-roll', decisionSequence = 0) {
  const players = Array.isArray(game?.players) ? game.players : [];
  const safeBot = bot || {};
  const board = Array.isArray(game?.tiles) && typeof game?.getTile === 'function'
    ? game.tiles.map(tile => tileView(game, safeBot, tile)).filter(Boolean)
    : [];
  const currentTile = typeof game?.getTile === 'function' ? tileView(game, safeBot, game.getTile(safeBot.position)) : null;
  const opponents = players
    .filter(player => player.id !== safeBot.id)
    .slice(0, 6)
    .map((player, index) => opponentView(game, safeBot, player, index));
  const ownProperties = typeof game?.getTile === 'function' ? ownPropertyView(game, safeBot) : [];
  return {
    contextVersion: BOT_CONTEXT_VERSION,
    phase,
    roundNumber: nonNegative(game?.roundNumber),
    decisionSequence: nonNegative(decisionSequence),
    botState: {
      position: nonNegative(safeBot.position),
      currentTile,
      cash: nonNegative(safeBot.cash),
      properties: ownProperties,
      propertyCount: ownProperties.length,
      completeGroups: typeof game?.playerGroups === 'function' && typeof game?.hasFullSet === 'function'
        ? game.playerGroups(safeBot).filter(group => game.hasFullSet(safeBot.id, group))
        : [],
      buildingCount: typeof game?.buildingsForMaintenance === 'function' ? game.buildingsForMaintenance(safeBot) : 0,
      buildActionsThisTurn: nonNegative(safeBot.buildActionsThisTurn),
      inJail: safeBot.inJail === true,
      jailTurns: nonNegative(safeBot.jailTurns),
      bankLoan: ownLoanView(safeBot),
      contracts: typeof game?.playerContracts !== 'undefined' ? ownContractView(game, safeBot) : [],
      marketPositions: ownMarketView(safeBot),
      casino: ownCasinoView(safeBot)
    },
    turn: turnView(game || {}, safeBot),
    recentDecisions: recentBotDecisions(game || {}, safeBot),
    decisionMemory: botDecisionMemory(game || {}, safeBot),
    board,
    opponents,
    obligations: obligationView(game || {}, safeBot),
    activeEvent: eventView(game || {}),
    rulesDigest: rulesDigest(game || {})
  };
}
