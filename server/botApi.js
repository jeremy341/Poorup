// Bot decision support as a prototype mixin: socket impersonation for bot-driven actions and the pre-roll
// candidate ranking. Collector order is kept and the final sort is stable, so ties keep this sequence.
// kind values are the contract consumed by botLogic's CANDIDATE_MAPPERS and CANDIDATE_RUNNERS tables.
import { settlementDiscount } from './loanLogic.js';
import { marketExpansionCandidatesFor } from './botMarketCandidates.js';
import { JAIL_FINE } from './gameData.js';
import { unmortgageCostFor } from './propertyRules.js';
import { developmentStage, groupGainToThree } from './botDevelopmentForecast.js';
import { coalitionAgainst } from './botTableMind.js';
import { tableBrain } from './botTableBrain.js';
import { seatOf } from './botStrategicContext.js';
import { contractReserve } from './botContractPolicy.js';
import { buildDecisionTraceRecord } from './botDecisionTrace.js';
import { BOT_TRADE_ASK_DEFAULT, canOfferTrade, collectGroupTradeCandidates, richTradeCandidate, tradePartners, tradeTiles } from './botTradeCandidates.js';
import { canProposeContracts, collectContractCandidates, contractTargets } from './botContractOffers.js';
import { engineTableObligationPending, marketBuyCandidates, marketSellCandidates, marketTradingOpen } from './botMarketOrders.js';

// Situation-aware table talk shared by both brains.
function tableTalkFor(game, player) {
  const base = 'I am watching the next rent risk and keeping my options open.';
  try {
    const brain = tableBrain(game, player.id);
    if (brain.kingmaker?.spoiler) return BOT_TABLE_TALK_SPOILER;
    if (brain.rank > 1) return BOT_TABLE_TALK_BEHIND;
  } catch {
    // Thin fixtures retain the neutral line.
  }
  return base;
}

// Jail stay beats exit when the table is developed (mid/late): the bot
// avoids hot rents while still collecting its own. Early boards pay to
// leave and keep buying.
export function jailStayBeatsExit(game, player) {
  if (!game || !player) return false;
  const stage = developmentStage(jailBoard(game, player));
  return stage === 'late' || (stage === 'mid' && Number(player.cash || 0) < 500);
}

function jailBoard(game, player) {
  return (game.tiles || []).map(tile => jailBoardTile(game, player, tile));
}

// Each opponent keeps their own seat label, so two rivals holding one colour
// group between them are not read as a single owner's monopoly.
function jailBoardTile(game, player, tile) {
  return {
    group: tile?.group || null,
    ownerSeat: seatOf(game, player, tile?.ownerId),
    houseCount: tile?.houseCount || 0
  };
}

const BOT_CANDIDATE_SOURCES = [
  { collect: (game, player) => game.botJailCandidates(player) },
  { collect: (game, player) => game.botBuildCandidates(player) },
  { collect: (game, player) => game.botMortgageCandidates(player) },
  { collect: (game, player) => game.botRepaymentCandidates(player) },
  { collect: (game, player) => game.botBankLoanRepaymentCandidates(player) },
  { collect: (game, player) => game.botLoanCandidate(player) },
  { collect: (game, player, options) => options.expanded ? game.botGroupTradeCandidates(player) : game.botGroupTradeCandidate(player) },
  { collect: (game, player) => game.botMarketCandidate(player) },
  { collect: (game, player) => game.botCasinoCandidate(player) }
];

const BOT_TABLE_TALK_BEHIND = 'I am behind; a fair deal could still change the table.';
const BOT_TABLE_TALK_SPOILER = 'I cannot win this one, but I choose who does. Make your case.';

function pendingPurchaseCandidate(game, player, offer) {
  if (offer?.playerId !== player.id) return null;
  const tile = game.getTile(offer.tileIndex);
  return {
    id: 'purchase:' + offer.tileIndex,
    kind: 'purchase',
    tileIndex: offer.tileIndex,
    price: Number(tile?.price) || 0,
    risk: Number(tile?.price || 0) / Math.max(1, Number(player.cash || 0)),
    score: 26
  };
}

function appendPostRollParityCandidates(game, player, options, candidates) {
  if (!options.parity) return;
  candidates.push(...game.botContractCandidates(player));
  candidates.push(...game.botRichTradeCandidates(player));
  candidates.push(...(options.expanded ? game.botGroupTradeCandidates(player) : game.botGroupTradeCandidate(player)));
  candidates.push(...game.botMarketCandidates(player));
  candidates.push(...game.botMarketExpansionCandidates(player));
  candidates.push(...game.botCasinoCandidate(player));
  candidates.push(...game.botSocialCandidates(player));
}

function appendParityCandidates(game, player, candidates) {
  candidates.push(...game.botSellCandidates(player));
  candidates.push(...game.botUnmortgageCandidates(player));
  candidates.push(...game.botContractCandidates(player));
  candidates.push(...game.botRichTradeCandidates(player));
  candidates.push(...game.botMarketCandidates(player).filter(candidate => candidate.side === 'sell'));
  candidates.push(...game.botMarketExpansionCandidates(player));
  candidates.push(...game.botSocialCandidates(player));
}

function appendPreRollCandidates(game, player, options, candidates) {
  candidates.push(...game.botItemCandidates(player));
  if (player.inJail && options.parity) {
    candidates.push(...game.botJailCandidates(player));
    return;
  }
  for (const source of BOT_CANDIDATE_SOURCES) {
    candidates.push(...source.collect(game, player, options));
  }
  candidates.push(...game.botPendingTradeCancelCandidates(player));
  if (options.parity) appendParityCandidates(game, player, candidates);
}

function postRollCandidates(game, player, options) {
  const candidates = [];
  candidates.push(...game.botItemCandidates(player));
  candidates.push(...game.botRepaymentCandidates(player));
  candidates.push(...game.botBankLoanRepaymentCandidates(player));
  candidates.push(...game.botMortgageCandidates(player));
  candidates.push(...game.botSellCandidates(player));
  candidates.push(...game.botUnmortgageCandidates(player));
  candidates.push(...game.botBuildCandidates(player));
  appendPostRollParityCandidates(game, player, options, candidates);
  candidates.push(...game.botPendingTradeCancelCandidates(player));
  const canEndTurn = player.bankrupt || Number(player.cash) > 0;
  if (!canEndTurn) {
    candidates.push(...game.botItemSaleCandidates(player));
    // Broke with the roll done: a loan on offer keeps the bot in the game, so it is
    // tried before the terminal bankruptcy (score 2).
    candidates.push(...game.botLoanCandidate(player).map(loan => ({ ...loan, score: ZERO_CASH_LOAN_SCORE })));
    candidates.push({ id: 'bankruptcy:zero-cash', kind: 'bankruptcy', risk: 0, score: 2 });
  } else {
    if (game.settings.market) candidates.push({ id: 'end-finance-window', kind: 'end-finance-window', risk: 0, score: -49 });
    candidates.push({ id: 'end-turn', kind: 'end-turn', risk: 0, score: -50 });
  }
  return sortCandidates(candidates, buildValueIndex(game, player, candidates));
}

// Every build candidate shares one score, so a cost-over-cash tie-break would build the cheapest monopoly first.
// Equal-score builds rank by the traffic-weighted rent their monopoly is worth (botDevelopmentForecast.groupGainToThree),
// with cost as the final stable tie-break. Non-build kinds carry no value, so their order is untouched.
function buildValueIndex(game, player, candidates) {
  const index = new Map();
  const seats = new Map((game.players || []).map((entry, position) => [
    entry.id,
    entry.id === player.id ? 'self' : `opponent-${position}`
  ]));
  const groupValue = group => {
    const board = (game.getGroupTiles(group) || []).map(tile => ({ ...tile, ownerSeat: seats.get(tile.ownerId) || 'bank' }));
    return groupGainToThree(board, group)?.gainPerCircuit || 0;
  };
  candidates.forEach(candidate => {
    if (candidate.kind !== 'build' || index.has(candidate.id)) return;
    const group = game.getTile(candidate.tileIndex)?.group;
    index.set(candidate.id, group ? groupValue(group) : 0);
  });
  return index;
}

function sortCandidates(candidates, buildValues = new Map()) {
  const developmentValue = candidate => Number(buildValues.get(candidate.id) || 0);
  return candidates.sort((a, b) => b.score - a.score
    || developmentValue(b) - developmentValue(a)
    || a.risk - b.risk);
}

// Candidate risk against a cash floor of 1, so collectors never divide by zero.
function riskAgainstCash(amount, cash) {
  return amount / Math.max(1, cash);
}

const BOT_BUILD_SCORE = 10;
const BOT_MORTGAGE_SCORE = 8;
const BOT_LOAN_SCORE = -12;
const ZERO_CASH_LOAN_SCORE = 3;
// Cash a bot keeps in hand: builds, unmortgages and loan repayments never dip below it, and it mortgages only below it.
const BOT_LIQUIDITY_FLOOR_CASH = 180;

function belowSellThreshold(game, player) {
  return Number(player.cash || 0) < Number(game.settings.startingCash || 1500) * 0.5;
}

function sellableHouseTile(game, player, tile) {
  if (!tile) return false;
  if (!(tile.houseCount > 0)) return false;
  return game.canSellFromTile(player, tile);
}

function houseSellCandidate(game, player, tile, crisis) {
  const proceeds = Math.max(0, Math.floor(game.getPropertyHouseCost(tile) * game.buildingSaleMultiplier()));
  return { id: 'sell:' + tile.index, kind: 'sell', tileIndex: tile.index, proceeds, risk: 0.12, score: crisis ? 15 : 10 };
}

function houseSellCandidates(game, player, crisis) {
  return (player.properties || [])
    .map(index => game.getTile(index))
    .filter(tile => sellableHouseTile(game, player, tile))
    // A deed named by an open trade or contract cannot be managed (the engine
    // refuses it), so it is never offered as a rescue.
    .filter(tile => !game.propertyOpenOfferRejection?.(tile))
    .map(tile => houseSellCandidate(game, player, tile, crisis));
}

function casinoStakesAllowed(game, player) {
  if (!game.settings.casino) return false;
  if ((player.casinoBetsThisRound || 0) >= 1) return false;
  return true;
}

// EV-negative tables are chaos-only flavor, and only when cash-strong:
// broke bots must preserve every dollar for rent survival.
function casinoCashReady(game, player) {
  const startingCash = Number(game.settings.startingCash || 1500);
  if (Number(player.cash || 0) < startingCash * 0.35) return false;
  // Two doubles already: jail looms, keep cash liquid for the missed turn.
  if (Number(game.consecutiveDoubles || 0) >= 2) return false;
  return !game.hasLoanBackedCash?.(player);
}

function casinoEntryFee(game) {
  return Number(game.casinoLimits?.().entryFee) || 0;
}

function payToLeaveJail(game, player) {
  if (Number(player.jailTurns || 0) >= 2) return true;
  return !jailStayBeatsExit(game, player);
}

function jailFineChoice(player) {
  return { id: 'jail:fine', kind: 'jail-fine', risk: JAIL_FINE / Math.max(1, player.cash), score: player.jailTurns >= 2 ? 14 : 8 };
}

function jailFreeChoice(player) {
  return { id: 'jail:free', kind: 'jail-free', risk: 0.05, score: player.jailTurns >= 2 ? 16 : 7 };
}

function repayableContract(player, contract) {
  if (!contract) return false;
  if (!['loan', 'hybrid'].includes(contract.kind)) return false;
  if (!['active', 'due'].includes(contract.status)) return false;
  if (contract.toPlayerId !== player.id) return false;
  return Number(contract.remaining) > 0;
}

// A due debt is cured in full or not at all: a part payment still defaults (the engine seizes the whole basket)
// and only strands the cash. A debt that can be cured is MANDATORY (see repaymentCandidate), because the planner
// books repaying as net-worth neutral and would otherwise always prefer to roll.
function repaymentPlan(contract, player) {
  const remaining = Math.max(0, Math.floor(Number(contract.remaining) || 0));
  const due = contract.status === 'due';
  const cash = Math.max(0, Math.floor(Number(player.cash || 0)));
  if (due) return { remaining, due, amount: cash >= remaining ? remaining : 0 };
  return { remaining, due, amount: Math.min(remaining, Math.max(0, cash - BOT_LIQUIDITY_FLOOR_CASH)) };
}

function repaymentCandidate(contract, plan, player) {
  return {
    id: 'repay:' + contract.id,
    kind: 'repay',
    contractId: contract.id,
    amount: plan.amount,
    remaining: plan.remaining,
    risk: plan.due ? 0.05 : plan.amount / Math.max(1, player.cash),
    score: plan.due ? 32 : 11,
    ...(plan.due ? { mandatory: true } : {})
  };
}

function collectRepaymentCandidate(player, contract, out) {
  if (!repayableContract(player, contract)) return;
  const plan = repaymentPlan(contract, player);
  if (plan.amount <= 0) return;
  out.push(repaymentCandidate(contract, plan, player));
}

function bankLoanRepayment(game, loan, player) {
  const remaining = Math.max(0, Math.floor(Number(loan.remaining) || 0));
  const cash = Math.max(0, Math.floor(Number(player.cash || 0)));
  // Request the full balance to activate amnesty; the engine charges the discounted amount.
  if (remaining > 0 && game.globalEventIncludes?.('debt-amnesty')) {
    const cost = Math.min(remaining, settlementDiscount(game, loan));
    const reserve = loan.status === 'due' ? 0 : BOT_LIQUIDITY_FLOOR_CASH;
    if (cash - reserve >= cost) return { remaining, amount: remaining };
  }
  // Same rule as player contracts: a due loan is paid in full or left alone.
  if (loan.status === 'due') return { remaining, amount: cash >= remaining ? remaining : 0 };
  return { remaining, amount: Math.min(remaining, Math.max(0, cash - BOT_LIQUIDITY_FLOOR_CASH)) };
}

function bankLoanRepayCandidate(player, loan, repayment) {
  const amount = repayment.amount;
  return {
    id: 'bank-repay:' + player.id + ':' + (player.bankLoanCount || loan.issuedRound || 0),
    kind: 'bank-repay',
    amount,
    remaining: repayment.remaining,
    issuedRound: loan.issuedRound || 0,
    dueRound: loan.dueRound || 0,
    loanCount: player.bankLoanCount || 0,
    risk: amount / Math.max(1, player.cash),
    score: loan.status === 'due' ? 34 : 13,
    ...(loan.status === 'due' ? { mandatory: true } : {})
  };
}

function activeBankLoan(loan) {
  if (!loan) return false;
  return ['active', 'due'].includes(loan.status);
}

function buildLimitReached(player, buildLimit) {
  if (!Number.isFinite(buildLimit)) return false;
  if (buildLimit <= 0) return false;
  return (player.buildActionsThisTurn || 0) >= buildLimit;
}

function tradeRoundElapsed(game, trade) {
  const createdRound = Math.max(0, Math.floor(Number(trade.createdRound) || 0));
  return Math.max(1, Math.floor(Number(game.roundNumber) || 1)) > createdRound;
}

function pendingTradeCancelCandidate(trade) {
  return {
    id: `cancel-trade:${trade.id}`,
    kind: 'cancel-trade',
    tradeId: trade.id,
    risk: 0.05,
    score: 4
  };
}

function explicitEndTurn(game, player) {
  if (Number(player.cash) > 0 || player.bankrupt) {
    return [{ id: 'end-turn', kind: 'end-turn', risk: 0, score: -50 }];
  }
  return [{ id: 'bankruptcy:zero-cash', kind: 'bankruptcy', risk: 0, score: 2 }];
}

const botApi = {
  botItemCandidates(player) {
    return (this.summaryItems?.(player, player.id) || [])
      .filter(item => item.catalogId === 'parlor-bond' && item.canUse)
      .map(item => ({ id: `item-use:${item.itemId}`, itemId: item.itemId, kind: 'item-use', risk: 0, score: 100 }));
  },
  botItemSaleCandidates(player) {
    return (this.summaryItems?.(player, player.id) || [])
      .filter(item => item.canSell && !(item.catalogId === 'parlor-bond' && item.canUse))
      .map(item => ({ id: `item-sell:${item.itemId}`, itemId: item.itemId, kind: 'item-sell', risk: 0, score: 4, mandatory: true }));
  },
  recordBotDecisionTrace(entry = {}) {
    const trace = buildDecisionTraceRecord(entry, this.settings);
    this.botDecisionTrace = Array.isArray(this.botDecisionTrace) ? this.botDecisionTrace : [];
    this.botDecisionTrace.push(trace);
    if (this.botDecisionTrace.length > 200) this.botDecisionTrace.splice(0, this.botDecisionTrace.length - 200);
    return trace;
  },

  runBotAction(playerId, action) {
    const bot = this.getPlayerById(playerId);
    const rejection = this.botActionRejection(bot, action);
    if (rejection) return rejection;
    return this.actAsBotSocket(bot, action);
  },

  botActionRejection(bot, action) {
    if (!bot) return { success: false, error: 'Bot not found.' };
    if (!bot.isBot) return { success: false, error: 'Bot not found.' };
    if (bot.bankrupt || bot.disconnected) return { success: false, error: 'Bot is unavailable.' };
    if (typeof action !== 'function') return { success: false, error: 'Bot not found.' };
    return null;
  },

  // Bots act through the same socket-keyed methods humans do; the seat's
  // socketId is swapped to the bot actor key for the duration of the call.
  actAsBotSocket(bot, action) {
    const previousSocketId = bot.socketId;
    const actorId = `bot:${bot.id}`;
    bot.socketId = actorId;
    try {
      return action(actorId);
    } finally {
      bot.socketId = previousSocketId;
    }
  },

  // Roll is always available; the pre-roll table appends the remaining
  // candidate sources in BOT_CANDIDATE_SOURCES order, then the stable sort ranks
  // them by score desc, development value desc (builds only), risk asc.
  getBotCandidates(player, options = {}) {
    if (!player?.isBot) return [];
    if (options.postRoll) return this.botPostRollCandidates(player, options);
    const candidates = [{ id: 'roll', kind: 'roll', risk: 0, score: 0 }];
    if (!this.hasRolled) appendPreRollCandidates(this, player, options, candidates);
    return sortCandidates(candidates, buildValueIndex(this, player, candidates));
  },

  // Once movement resolves, humans may still use the finance rail before ending their turn. Keep that window
  // open for both bot brains. A pending purchase is the only obligation that takes precedence over finance actions;
  // otherwise candidates are legal post-roll verbs plus a low-priority end-turn sentinel.
  botPostRollCandidates(player, options = {}) {
    if (!player?.isBot) return [];
    if (player.id !== this.currentPlayerId) return [];
    const offer = this.pendingPurchaseOffer;
    const purchase = pendingPurchaseCandidate(this, player, offer);
    if (purchase) return [purchase];
    // Another seat's offer: nothing for me to buy, but the turn still needs
    // an explicit end action, not a no-op stall.
    if (offer) return explicitEndTurn(this, player);
    return postRollCandidates(this, player, options);
  },

  botPendingTradeCancelCandidates(player) {
    const trade = this.pendingTrade;
    if (!player?.isBot) return [];
    if (player.id !== this.currentPlayerId) return [];
    if (!trade || trade.fromPlayerId !== player.id) return [];
    if (!tradeRoundElapsed(this, trade)) return [];
    return [pendingTradeCancelCandidate(trade)];
  },

  botJailCandidates(player) {
    if (!player?.inJail) return [];
    // Late-stage sit-out: a developed board makes jail a rent-free shelter
    // that still collects. Roll for doubles instead of paying to leave.
    if (!payToLeaveJail(this, player)) return [];
    const choices = [];
    if (player.cash >= JAIL_FINE) choices.push(jailFineChoice(player));
    if (player.jailFreeCards > 0) choices.push(jailFreeChoice(player));
    return choices;
  },

  botSocialCandidates(player) {
    const sequence = Math.max(0, Math.floor(Number(this.botDecisionSequence) || 0));
    if (!player) return [];
    if (sequence === 0) return [];
    if (sequence % 6 !== 0) return [];
    return [{ id: 'chat:table-talk', kind: 'chat', text: tableTalkFor(this, player), risk: 0, score: 1 }];
  },

  botBankLoanRepaymentCandidates(player) {
    const loan = player?.bankLoan;
    if (!activeBankLoan(loan)) return [];
    if (player.id !== this.currentPlayerId) return [];
    const repayment = bankLoanRepayment(this, loan, player);
    if (repayment.amount <= 0) return [];
    return [bankLoanRepayCandidate(player, loan, repayment)];
  },

  botBuildCandidates(player) {
    const buildLimit = Number(this.activeEventEffects?.().buildingLimitPerTurn);
    if (buildLimitReached(player, buildLimit)) return [];
    return this.tiles
      .filter(tile => this.canBuildOnTile(player, tile))
      .filter(tile => !this.propertyOpenOfferRejection(tile))
      .filter(tile => Number(player.cash || 0) >= this.getPropertyHouseCost(tile) + BOT_LIQUIDITY_FLOOR_CASH)
      .map(tile => this.botBuildCandidateFor(tile, player));
  },

  botBuildCandidateFor(tile, player) {
    const cost = this.getPropertyHouseCost(tile);
    // Hotel reluctance: the 5th level returns 4 houses to the bank for
    // opponents to buy. Stay at 4 unless finishing (handled by threat
    // pressure in the planner, not here).
    const hotelMalus = Math.max(0, Math.min(5, Number(tile?.houseCount) || 0)) >= 4 ? 6 : 0;
    return {
      id: 'build:' + tile.index,
      kind: 'build',
      tileIndex: tile.index,
      cost,
      risk: riskAgainstCash(cost, player.cash),
      score: BOT_BUILD_SCORE - hotelMalus
    };
  },

  botMortgageCandidates(player) {
    if (player.cash >= BOT_LIQUIDITY_FLOOR_CASH) return [];
    return this.tiles
      .filter(tile => this.canMortgageTile(player, tile))
      // A deed named by an open trade or contract cannot be managed (the
      // engine refuses it), so it is never offered as a rescue.
      .filter(tile => !this.propertyOpenOfferRejection(tile))
      .map(tile => this.botMortgageCandidateFor(tile));
  },

  botSellCandidates(player) {
    if (!player) return [];
    if (player.id !== this.currentPlayerId) return [];
    const crisis = Boolean(this.globalEventActive?.('housing-bubble'));
    if (!crisis && !belowSellThreshold(this, player)) return [];
    return houseSellCandidates(this, player, crisis);
  },

  botUnmortgageCandidates(player) {
    if (!player || player.id !== this.currentPlayerId) return [];
    return (player.properties || [])
      .map(index => this.getTile(index))
      .filter(tile => tile && this.canUnmortgageTile(player, tile))
      .filter(tile => !this.propertyOpenOfferRejection(tile))
      .map(tile => {
        const multiplier = typeof this.propertyValueMultiplier === 'function' ? this.propertyValueMultiplier() : 1;
        const cost = unmortgageCostFor(tile.price, multiplier);
        if (player.cash < cost + BOT_LIQUIDITY_FLOOR_CASH) return null;
        return { id: 'unmortgage:' + tile.index, kind: 'unmortgage', tileIndex: tile.index, cost, risk: cost / Math.max(1, player.cash), score: 9 };
      })
      .filter(Boolean);
  },

  botMortgageCandidateFor(tile) {
    const valueMultiplier = Number(this.activeEventEffects?.().propertyValueMultiplier);
    const multiplier = Number.isFinite(valueMultiplier) && valueMultiplier > 0 ? valueMultiplier : 1;
    return {
      id: 'mortgage:' + tile.index,
      kind: 'mortgage',
      tileIndex: tile.index,
      proceeds: Math.floor((tile.price || 0) / 2 * multiplier),
      risk: 0.25,
      score: BOT_MORTGAGE_SCORE
    };
  },

  botLoanCandidate(player) {
    const loan = this.getBankLoanOffer(player);
    if (!loan.available) return [];
    return [{
      id: 'loan:emergency',
      kind: 'loan',
      principal: loan.principal,
      totalDue: loan.totalDue,
      premium: loan.premium,
      dueRound: loan.dueRound,
      cureRound: loan.cureRound,
      collateralTileIndex: loan.collateralTileIndex,
      risk: loan.totalDue / loan.principal,
      score: BOT_LOAN_SCORE
    }];
  },

  // Repay player loans proactively when the bot can do so without draining
  // its liquidity floor. Due contracts are settled first; active contracts
  // are paid down only when the remaining balance is comfortably affordable.
  botRepaymentCandidates(player) {
    const contracts = Array.isArray(this.playerContracts) ? this.playerContracts : [];
    const candidates = [];
    contracts.forEach(contract => collectRepaymentCandidate(player, contract, candidates));
    return candidates;
  },

  botGroupTradeCandidate(player) {
    return this.botGroupTradeCandidates(player).slice(0, 1);
  },

  botGroupTradeCandidates(player) {
    if (!canOfferTrade(this, player)) return [];
    const ctx = { game: this, player, ask: BOT_TRADE_ASK_DEFAULT };
    const owned = tradeTiles(this, player);
    const table = coalitionAgainst(this, player.id);
    const partners = tradePartners(this, player, table, player.grudge);
    const candidates = [];
    partners.forEach(partner => collectGroupTradeCandidates(ctx, partner, owned, candidates));
    // Set completers first, then the most valuable offer; the sort is stable.
    candidates.sort((a, b) => b.score - a.score || b.strategicValue - a.strategicValue);
    return candidates.slice(0, 12);
  },

  botRichTradeCandidates(player) {
    if (!canOfferTrade(this, player)) return [];
    const owned = tradeTiles(this, player).slice(0, 3);
    if (owned.length < 2) return [];
    const table = coalitionAgainst(this, player.id);
    const partners = tradePartners(this, player, table, player.grudge);
    return partners.flatMap(partner => richTradeCandidate(this, player, partner, owned)).slice(0, 4);
  },

  botContractCandidates(player) {
    // The server rejects loan-backed contract cash (contractLogic.js guard), so a loaned bot proposing contracts
    // burns its deal counter on a sure rejection every turn. The casino and market collectors already apply the same guard.
    if (this.hasLoanBackedCash?.(player)) return [];
    if (!canProposeContracts(this, player)) return [];
    const lenderCash = Number(player.cash || 0);
    const reserve = contractReserve(this);
    if (lenderCash <= reserve + 100) return [];
    const table = coalitionAgainst(this, player.id);
    const targets = contractTargets(this, player, table, player.grudge);
    const ctx = { game: this, lenderCash, reserve };
    const candidates = [];
    targets.forEach(target => collectContractCandidates(ctx, target, candidates));
    return candidates
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0) || Number(left.risk || 0) - Number(right.risk || 0))
      .slice(0, 8);
  },

  botMarketCandidates(player) {
    const buy = this.botMarketCandidate(player);
    if (!this.settings.market) return buy;
    if (engineTableObligationPending(this)) return buy;
    if ((player.marketActionsThisTurn || 0) >= 1) return buy;
    if (!marketTradingOpen(this)) return buy;
    const sells = marketSellCandidates(this, player);
    return [...buy, ...sells].slice(0, 32);
  },

  botMarketExpansionCandidates(player) {
    return marketExpansionCandidatesFor(this, player);
  },

  botMarketCandidate(player) {
    return marketBuyCandidates(this, player);
  },

  botCasinoCandidate(player) {
    if (!casinoStakesAllowed(this, player)) return [];
    if (engineTableObligationPending(this)) return [];
    if (!casinoCashReady(this, player)) return [];
    const entryFee = casinoEntryFee(this);
    const stake = Math.min(20, Math.max(1, Math.floor(player.cash * 0.03)));
    if (player.cash < stake + entryFee) return [];
    return [{
      id: 'casino:red',
      kind: 'casino',
      color: 'red',
      stake,
      risk: 0.55,
      score: -5
    }];
  }
};

export { botApi };
