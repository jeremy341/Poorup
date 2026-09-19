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
    tileId: tile.tileId || null,
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

function contractView(contract, bot) {
  const borrower = contract.toPlayerId === bot.id;
  return {
    id: String(contract.id || '').slice(0, 80),
    kind: contract.kind,
    role: borrower ? 'borrower' : 'lender',
    status: contract.status,
    amount: nonNegative(contract.amount),
    remaining: nonNegative(contract.remaining),
    premiumRate: Math.max(0, Number(contract.premiumRate) || 0),
    durationRounds: nonNegative(contract.durationRounds),
    dueRound: contract.dueRound == null ? null : nonNegative(contract.dueRound),
    propertyIndex: contract.propertyIndex ?? null,
    collateralTileIndex: contract.collateralTileIndex ?? null,
    equityShare: Math.max(0, Number(contract.equityShare) || 0),
    conversionShare: Math.max(0, Number(contract.conversionShare) || 0)
  };
}

function ownContractView(game, bot) {
  return (game.playerContracts || [])
    .filter(contract => contract.fromPlayerId === bot.id || contract.toPlayerId === bot.id)
    .slice(0, 20)
    .map(contract => contractView(contract, bot));
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

function marketExpansionPositionView(position, extra = {}) {
  return {
    quantity: nonNegative(position?.quantity),
    averageCost: Math.max(0, Number(position?.averageCost) || 0),
    ...extra
  };
}

function marginPositionsView(bot) {
  return Object.fromEntries(Object.entries(bot.marginPositions || {}).map(([id, position]) => [
    String(id).slice(0, 40),
    marketExpansionPositionView(position)
  ]));
}

function shortPositionsView(bot) {
  return Object.fromEntries(Object.entries(bot.shortPositions || {}).map(([id, position]) => [
    String(id).slice(0, 40),
    {
      quantity: nonNegative(position?.quantity),
      entryQuote: Math.max(0, Number(position?.entryQuote) || 0),
      collateral: nonNegative(position?.collateral)
    }
  ]));
}

function optionPositionView(option) {
  return {
    id: String(option.id || '').slice(0, 80),
    instrumentId: option.instrumentId,
    side: option.side,
    role: option.role,
    quantity: nonNegative(option.quantity),
    strike: nonNegative(option.strike),
    premium: nonNegative(option.premium),
    reserveHeld: nonNegative(option.reserveHeld),
    maxPayout: nonNegative(option.maxPayout),
    expiryRound: nonNegative(option.expiryRound),
    status: option.status,
    exercised: option.exercised === true
  };
}

function ownMarketExpansionView(bot) {
  return {
    margin: {
      balance: nonNegative(bot.marginBalance),
      maintenance: nonNegative(bot.marginMaintenance),
      positions: marginPositionsView(bot)
    },
    shorts: shortPositionsView(bot),
    shortDefaultDebt: nonNegative(bot.shortDefaultDebt),
    options: (bot.optionPositions || []).slice(0, 12).map(optionPositionView)
  };
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
  const deltas = {
    collect: amount => amount,
    collectStart: amount => amount,
    pay: amount => -amount,
    collectFromEach: amount => amount * opponents,
    payEach: amount => -amount * opponents
  };
  const total = deck.reduce((sum, card) => sum + (deltas[card.action]?.(Number(card.amount) || 0) || 0), 0);
  return Math.round((total / deck.length) * 100) / 100;
}

function opponentView(game, bot, player, index) {
  return {
    seat: `opponent-${index + 1}`,
    kind: player.isBot ? 'cpu' : 'player',
    position: nonNegative(player.position),
    cashBand: cashBand(player.cash, game.settings?.startingCash),
    cashExactBucket: Math.floor(Math.max(0, Number(player.cash) || 0) / 25) * 25,
    propertyCount: Array.isArray(player.properties) ? player.properties.length : 0,
    completeGroups: typeof game.hasFullSet === 'function' && typeof game.playerGroups === 'function'
      ? game.playerGroups(player).filter(group => game.hasFullSet(player.id, group)).length
      : 0,
    nearGroups: nearOpponentGroups(game, player).slice(0, 3),
    desire: opponentDesire(game, player),
    stance: typeof player.lastVoteChoice === 'string' ? player.lastVoteChoice.slice(0, 40) : null,
    inJail: player.inJail === true,
    bankrupt: player.bankrupt === true,
    disconnected: player.disconnected === true
  };
}

// Nearest completions for an opponent: owned/total per group, most urgent
// first. Powers the AI's "don't feed the finisher" reasoning.
function nearOpponentGroups(game, player) {
  const groups = [...new Set((game.tiles || []).map(tile => tile?.group).filter(Boolean))];
  const out = [];
  for (const group of groups) {
    const tiles = typeof game.getGroupTiles === 'function' ? game.getGroupTiles(group) : [];
    if (!tiles?.length) continue;
    const owned = tiles.filter(tile => tile?.ownerId === player?.id).length;
    if (!owned || owned >= tiles.length) continue;
    out.push({ group, owned, total: tiles.length });
  }
  return out.sort((a, b) => b.owned / b.total - a.owned / a.total).slice(0, 3);
}

function opponentDesire(game, player) {
  if (!player) return 'drifter';
  const cash = Math.max(0, Math.floor(Number(player.cash) || 0));
  const starting = Math.max(1, Number(game?.settings?.startingCash) || 1500);
  if (game?.pendingPayment?.playerId === player.id || cash < starting * 0.35) return 'survivor';
  return 'contender';
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

function incrementDecisionRate(map, key, identity, success) {
  const row = map.get(key) || { ...identity, attempts: 0, successes: 0 };
  row.attempts += 1;
  row.successes += success ? 1 : 0;
  map.set(key, row);
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
    const success = entry.success !== false;
    incrementDecisionRate(byAction, action, { actionId: action }, success);
    incrementDecisionRate(byPhase, phase, { phase }, success);
  });
  return {
    decisions: entries.length,
    successes: entries.filter(entry => entry.success !== false).length,
    failures: entries.filter(entry => entry.success === false).length,
    actionRates: [...byAction.values()].slice(-8),
    phaseRates: [...byPhase.values()].slice(-8)
  };
}

function participantRole(item, bot) {
  if (item?.toPlayerId === bot.id) return 'recipient';
  if (item?.fromPlayerId === bot.id) return 'sender';
  return 'other';
}

function paymentObligation(game, bot) {
  const item = game.pendingPayment;
  return item ? { ownerSeat: seatOf(game, bot, item.playerId), amountRemaining: nonNegative(item.amountRemaining), creditorSeat: seatOf(game, bot, item.creditorId) } : null;
}

function purchaseObligation(game, bot) {
  const item = game.pendingPurchaseOffer;
  return item ? { ownerSeat: seatOf(game, bot, item.playerId), tileIndex: item.tileIndex ?? null, price: nonNegative(typeof game.getTile === 'function' ? game.getTile(item.tileIndex)?.price : 0) } : null;
}

function sponsorshipObligation(game, bot) {
  const item = game.pendingSponsoredPurchase;
  if (!item) return null;
  return {
    ownerSeat: seatOf(game, bot, item.buyerId),
    tileIndex: item.tileIndex ?? null,
    price: nonNegative(typeof game.getTile === 'function' ? game.getTile(item.tileIndex)?.price : item.price),
    totalContributed: nonNegative(item.contributions?.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)),
    contributionCount: Array.isArray(item.contributions) ? item.contributions.length : 0
  };
}

function auctionObligation(game, bot) {
  const item = game.auction;
  return item ? { tileIndex: item.propertyTile?.index ?? null, highestBid: nonNegative(item.highestBid), highestBidderSeat: seatOf(game, bot, item.highestBidderId), participantCount: Array.isArray(item.participants) ? item.participants.length : 0, passedCount: Array.isArray(item.passedPlayerIds) ? item.passedPlayerIds.length : 0 } : null;
}

function tradeObligation(game, bot) {
  const item = game.pendingTrade;
  if (!item) return null;
  const sender = item.fromPlayerId === bot.id;
  return {
    role: participantRole(item, bot),
    giveCash: nonNegative(sender ? item.giveCash : item.requestCash),
    requestCash: nonNegative(sender ? item.requestCash : item.giveCash),
    givePropertyIndexes: (sender ? item.givePropertyIndexes || [] : item.requestPropertyIndexes || []).slice(0, 12),
    requestPropertyIndexes: (sender ? item.requestPropertyIndexes || [] : item.givePropertyIndexes || []).slice(0, 12)
  };
}

function contractObligation(game, bot) {
  const item = game.pendingPlayerContract;
  return item ? { role: participantRole(item, bot), kind: item.kind, amount: nonNegative(item.amount), premiumRate: Math.max(0, Number(item.premiumRate) || 0), durationRounds: nonNegative(item.durationRounds) } : null;
}

function obligationView(game, bot) {
  return {
    payment: paymentObligation(game, bot),
    purchase: purchaseObligation(game, bot),
    sponsorship: sponsorshipObligation(game, bot),
    auction: auctionObligation(game, bot),
    trade: tradeObligation(game, bot),
    contract: contractObligation(game, bot)
  };
}

function firstTruthyOr(values, fallback) {
  return values.find(Boolean) || fallback;
}

function rulesetMetadata(game) {
  const settings = game.settings || {};
  const rules = game.ruleset || {};
  return {
    boardVariant: firstTruthyOr([game.boardVariant, settings.boardVariant], 'standard-40'),
    rulesetPreset: firstTruthyOr([rules.rulesetPreset, settings.rulesetPreset], 'classic'),
    rulesetRevision: firstTruthyOr([rules.rulesetRevision, settings.rulesetRevision], 1),
    rulesetDigest: typeof game.rulesetDigest === 'string' ? game.rulesetDigest.slice(0, 200) : null
  };
}

function marketRulesView(settings) {
  const complexity = settings.marketComplexity || 'basic';
  const rank = { basic: 0, margin: 1, shorting: 2, derivatives: 3 }[complexity] || 0;
  return {
    enabled: settings.market === true,
    feeRate: MARKET_FEE_RATE,
    complexity,
    margin: rank >= 1,
    shorting: rank >= 2,
    derivatives: rank >= 3,
    borrowableUnits: 50,
    maintenanceRate: 0.25
  };
}

function rulesDigest(game) {
  const settings = game.settings || {};
  const effects = typeof game.activeEventEffects === 'function' ? game.activeEventEffects() : {};
  const casinoLimits = typeof game.casinoLimits === 'function' ? game.casinoLimits() : {};
  return {
    version: BOT_RULE_VERSION,
    boardSize: Array.isArray(game.tiles) ? game.tiles.length : 40,
    ...rulesetMetadata(game),
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
    market: marketRulesView(settings),
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
      marketExpansion: ownMarketExpansionView(safeBot),
      casino: ownCasinoView(safeBot)
    },
    turn: turnView(game || {}, safeBot),
    recentDecisions: recentBotDecisions(game || {}, safeBot),
    decisionMemory: botDecisionMemory(game || {}, safeBot),
    board,
    opponents,
    table: tableSummaryView(game || {}, safeBot, opponents),
    obligations: obligationView(game || {}, safeBot),
    activeEvent: eventView(game || {}),
    rulesDigest: rulesDigest(game || {})
  };
}

// Anonymized whole-table brief for the advisor: standings, threats,
// alliances, and the win path — seats only, never stable identifiers.
function tableSummaryView(game, bot, opponents) {
  const seats = ['self', ...(opponents || []).map(entry => entry.seat)];
  const bySeatCash = { self: nonNegative(bot?.cash) };
  (opponents || []).forEach(entry => { bySeatCash[entry.seat] = nonNegative(entry.cashExactBucket); });
  const myStance = typeof bot?.lastVoteChoice === 'string' ? bot.lastVoteChoice.slice(0, 40) : null;
  const ranked = [...seats].sort((a, b) => bySeatCash[b] - bySeatCash[a]);
  const myRank = Math.max(1, ranked.indexOf('self') + 1);
  return {
    rank: myRank,
    seats: seats.length,
    leaderGap: Math.max(0, bySeatCash[ranked[0]] - bySeatCash.self),
    threats: (opponents || []).map(entry => ({
      seat: entry.seat,
      nearGroups: entry.nearGroups || [],
      desire: entry.desire || 'drifter',
    })),
    alliances: (opponents || [])
      .filter(entry => entry.stance && myStance && entry.stance === myStance)
      .map(entry => entry.seat),
    endgame: seats.length <= 2,
  };
}
