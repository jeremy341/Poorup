// Bounded, side-effect-free future evaluation for bot candidates. The planner
// consumes the provider-safe strategic snapshot and never receives or mutates
// a live GameState. It is deliberately small: a deterministic horizon is a
// better first step than an unbounded tree in a real-time table.
import { MARKET_FEE_RATE } from './marketLogic.js';
import { forecastMarketOrder } from './botMarketForecast.js';
import { bestGainGroup, forecastMaxHit } from './botDevelopmentForecast.js';
import { calculateRentFromFacts, rentFactsFromSnapshot } from './botRentForecast.js';

export const PLANNING_HORIZONS = { house: 0, table: 1, expert: 3 };
export const NO_AI_POLICY_VERSION = 'no-ai-outcome-v1';
export const OPPONENT_PROFILE_POLICY_ENABLED = false;
export const NO_AI_OUTCOME_WEIGHTS = Object.freeze({
  survival: 1,
  netWorth: 1,
  liquidity: 1,
  rentRisk: -0.5,
  cardCash: 0.35,
  passStartCash: 0.25,
  rentIncome: 0.5,
  groupPotential: 1,
  setCompletion: 90,
  concentration: 1,
  eventExposure: 1,
  debtRisk: -1,
  opportunityCost: -0.05
});
const MAX_HORIZON = 3;
const DICE_TOTALS = [
  [2, 1 / 36], [3, 2 / 36], [4, 3 / 36], [5, 4 / 36], [6, 5 / 36],
  [7, 6 / 36], [8, 5 / 36], [9, 4 / 36], [10, 3 / 36], [11, 2 / 36], [12, 1 / 36]
];
const DICE_PAIRS = Array.from({ length: 36 }, (_, index) => ({ first: Math.floor(index / 6) + 1, second: index % 6 + 1 }));
const ALLOWED_ROLLOUT_BUDGETS = new Set([16, 64, 256]);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value) {
  return Math.max(0, Math.floor(number(value)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeRolloutBudget(value, fallback = 0) {
  const parsed = Number(value);
  if (ALLOWED_ROLLOUT_BUDGETS.has(parsed)) return parsed;
  return ALLOWED_ROLLOUT_BUDGETS.has(Number(fallback)) ? Number(fallback) : 0;
}

function tileFor(snapshot, index) {
  const numeric = Number(index);
  return (snapshot.board || []).find(tile => tile.index === numeric) || null;
}

function tileOwner(tile) {
  return tile?.ownerSeat || 'bank';
}

function boardClone(snapshot) {
  return (snapshot.board || []).map(tile => ({ ...tile }));
}

function stateClone(snapshot) {
  const bot = snapshot.botState || {};
  return {
    cash: nonNegative(bot.cash),
    position: nonNegative(bot.position),
    properties: (bot.properties || []).map(tile => ({ ...tile })),
    board: boardClone(snapshot),
    marketPositions: JSON.parse(JSON.stringify(bot.marketPositions || {})),
    marketQuotes: { ...(snapshot.marketQuotes || {}) },
    marketExpansion: JSON.parse(JSON.stringify(bot.marketExpansion || {})),
    shortDefaultDebt: nonNegative(bot.marketExpansion?.shortDefaultDebt),
    bankLoan: bot.bankLoan ? { ...bot.bankLoan } : null,
    contracts: (bot.contracts || []).map(contract => ({ ...contract })),
    casinoNet: number(bot.casino?.net),
    inJail: bot.inJail === true,
    jailTurns: nonNegative(bot.jailTurns),
    jailFreeCards: nonNegative(bot.jailFreeCards),
    expectedRent: 0,
    expectedRisk: 0,
    expectedCashFlow: 0
  };
}

function propertyGroupCount(state, group) {
  return state.board.filter(tile => tile.group === group && tile.ownerSeat === 'self').length;
}

function groupTarget(snapshot, group) {
  return (snapshot.board || []).filter(tile => tile.group === group).length;
}

function completeGroupCount(snapshot, state) {
  const groups = new Set(state.board.map(tile => tile.group).filter(Boolean));
  return [...groups].filter(group => propertyGroupCount(state, group) >= groupTarget(snapshot, group)).length;
}

function currentReserve(snapshot) {
  // Static floor plus half the forecasted max opponent hit (capped): the
  // liquidity target now follows board development instead of sitting at
  // 120 while hotels go up. Bounded so bare-board fixtures are unaffected.
  const staticReserve = Math.max(120, number(snapshot.rulesDigest?.purchaseReserve, 120));
  const forecastFloor = Math.min(400, Math.floor(forecastMaxHit(snapshot.board) / 2));
  return Math.max(staticReserve, forecastFloor);
}

function applyPropertyTransfer(state, indexes, fromSeat, toSeat) {
  (indexes || []).forEach(index => {
    const tile = state.board.find(entry => entry.index === Number(index));
    if (!tile || tile.ownerSeat !== fromSeat) return;
    tile.ownerSeat = toSeat;
    tile.houseCount = 0;
    tile.mortgaged = false;
  });
  state.properties = state.board.filter(tile => tile.ownerSeat === 'self' && tile.group).map(tile => ({ ...tile }));
}

function applyBuyCandidate(state, candidate, tile) {
  if (!tile) return false;
  state.cash = Math.max(0, state.cash - nonNegative(candidate.price || tile.price));
  const target = state.board.find(entry => entry.index === tile.index);
  if (target) Object.assign(target, { ownerSeat: 'self', mortgaged: false, houseCount: 0 });
  state.properties = state.board.filter(entry => entry.ownerSeat === 'self' && entry.group).map(entry => ({ ...entry }));
  return true;
}

function applyBuildCandidate(state, candidate, tile) {
  if (!tile) return false;
  state.cash = Math.max(0, state.cash - nonNegative(candidate.cost));
  const target = state.board.find(entry => entry.index === tile.index);
  if (target) target.houseCount = Math.min(5, nonNegative(target.houseCount) + 1);
  return Boolean(target);
}

function applyMortgageCandidate(state, candidate, tile) {
  if (!tile) return false;
  state.cash += nonNegative(candidate.proceeds);
  const target = state.board.find(entry => entry.index === tile.index);
  if (target) target.mortgaged = true;
  return Boolean(target);
}

function applyLoanCandidate(state, candidate) {
  if (nonNegative(candidate.principal) <= 0) return false;
  state.cash += nonNegative(candidate.principal);
  state.bankLoan = { status: 'active', remaining: nonNegative(candidate.totalDue || candidate.principal), dueRound: candidate.dueRound || null };
  return true;
}

function marketQuote(snapshot, instrumentId) {
  const quote = Number(snapshot.marketQuotes?.[instrumentId]);
  return Number.isFinite(quote) && quote > 0 ? quote : null;
}

function marketOrderContext(snapshot, candidate) {
  if (!['buy', 'sell'].includes(candidate.side)) return null;
  if (!candidate.instrumentId) return null;
  const quote = marketQuote(snapshot, candidate.instrumentId);
  if (quote === null) return null;
  const quantity = nonNegative(candidate.quantity || 1);
  const fee = Math.max(1, Math.ceil(quote * quantity * MARKET_FEE_RATE));
  return { quote, quantity, fee, instrumentId: candidate.instrumentId };
}

function applyMarketSell(state, context) {
  const position = state.marketPositions[context.instrumentId];
  if (!position || position.quantity < context.quantity) return false;
  state.cash += Math.max(0, context.quote * context.quantity - context.fee);
  position.realizedPnl = number(position.realizedPnl) + (context.quote - number(position.averageCost)) * context.quantity - context.fee;
  position.quantity -= context.quantity;
  if (position.quantity <= 0) delete state.marketPositions[context.instrumentId];
  return true;
}

function applyMarketBuy(state, context) {
  state.cash = Math.max(0, state.cash - context.quote * context.quantity - context.fee);
  const position = state.marketPositions[context.instrumentId] || { quantity: 0, averageCost: 0, realizedPnl: 0 };
  const existingQuantity = nonNegative(position.quantity);
  const existingCost = number(position.averageCost) * existingQuantity;
  position.quantity += context.quantity;
  position.averageCost = (existingCost + context.quote * context.quantity + context.fee) / Math.max(1, existingQuantity + context.quantity);
  state.marketPositions[context.instrumentId] = position;
  return true;
}

function applyMarketCandidate(snapshot, state, candidate) {
  const context = marketOrderContext(snapshot, candidate);
  if (!context) return false;
  if (candidate.side === 'sell') return applyMarketSell(state, context);
  return applyMarketBuy(state, context);
}

function applyCasinoCandidate(snapshot, state, candidate) {
  const fee = nonNegative(snapshot.rulesDigest?.casino?.entryFee);
  const stake = nonNegative(candidate.stake);
  state.cash = Math.max(0, state.cash - stake - fee);
  // Conservative expectation: account for the house edge, never a lucky spin.
  state.casinoNet -= Math.ceil(stake / 37) + fee;
  return true;
}

function applyTradeCandidate(state, candidate) {
  state.cash = Math.max(0, state.cash - nonNegative(candidate.giveCash) + nonNegative(candidate.requestCash));
  const partnerSeat = candidate.toPlayerSeat || 'opponent-1';
  applyPropertyTransfer(state, candidate.givePropertyIndexes, 'self', partnerSeat);
  applyPropertyTransfer(state, candidate.requestPropertyIndexes, partnerSeat, 'self');
  return true;
}

function marketExpansionNeedsQuote(kind) {
  return ['open-margin', 'open-short', 'cover-short'].includes(kind);
}

function marketExpansionQuoteMissing(kind, quote) {
  if (!marketExpansionNeedsQuote(kind)) return false;
  return quote === null;
}

function marketExpansionState(state) {
  const expansion = state.marketExpansion || (state.marketExpansion = {});
  const margin = expansion.margin || (expansion.margin = { balance: 0, maintenance: 0, positions: {} });
  margin.positions ||= {};
  const shorts = expansion.shorts || (expansion.shorts = {});
  shorts.positions ||= {};
  return { margin, shorts, shortPositions: shorts.positions };
}

function expansionOrderFee(quote, candidate) {
  const quantity = nonNegative(candidate.quantity || 1);
  return Math.max(1, Math.ceil(quote * quantity * MARKET_FEE_RATE));
}

function marketExpansionContext(snapshot, state, candidate) {
  const quote = marketQuote(snapshot, candidate.instrumentId);
  if (marketExpansionQuoteMissing(candidate.kind, quote)) return null;
  const positionState = marketExpansionState(state);
  return {
    quote,
    projectionQuote: quote ?? 0,
    quantity: nonNegative(candidate.quantity || 1),
    fee: expansionOrderFee(quote, candidate),
    ...positionState,
  };
}

function openMarginCandidate(state, candidate, context) {
  if (!candidate.instrumentId) return false;
  state.cash = Math.max(0, state.cash - context.fee);
  const position = context.margin.positions[candidate.instrumentId] || { quantity: 0, averageCost: 0 };
  const oldQuantity = nonNegative(position.quantity);
  position.averageCost = ((number(position.averageCost) * oldQuantity) + context.projectionQuote * context.quantity) / Math.max(1, oldQuantity + context.quantity);
  position.quantity = oldQuantity + context.quantity;
  context.margin.positions[candidate.instrumentId] = position;
  context.margin.balance = number(context.margin.balance) + context.projectionQuote * context.quantity;
  context.margin.maintenance = number(context.margin.maintenance) + context.projectionQuote * context.quantity * 0.25;
  return true;
}

function reduceMarginCandidate(state, candidate, context) {
  if (number(context.margin.balance) <= 0) return false;
  const repayment = Math.min(number(context.margin.balance), nonNegative(candidate.amount));
  state.cash = Math.max(0, state.cash - repayment);
  context.margin.balance = Math.max(0, number(context.margin.balance) - repayment);
  return repayment > 0;
}

function openShortCandidate(state, candidate, context) {
  if (!candidate.instrumentId) return false;
  const gross = context.projectionQuote * context.quantity;
  const collateral = Math.ceil(gross * 0.5);
  state.cash = Math.max(0, state.cash + gross - context.fee - collateral);
  context.shorts.reservedCash = number(context.shorts.reservedCash) + collateral;
  const position = context.shortPositions[candidate.instrumentId] || { quantity: 0, entryQuote: 0, collateral: 0 };
  const oldQuantity = nonNegative(position.quantity);
  position.entryQuote = ((number(position.entryQuote) * oldQuantity) + gross) / Math.max(1, oldQuantity + context.quantity);
  position.quantity = oldQuantity + context.quantity;
  position.collateral = number(position.collateral) + collateral;
  context.shortPositions[candidate.instrumentId] = position;
  return true;
}

function coverShortCandidate(state, candidate, context) {
  const position = context.shortPositions[candidate.instrumentId];
  if (!position) return false;
  if (!candidate.instrumentId) return false;
  const collateral = Math.min(number(position.collateral), number(context.shorts.reservedCash));
  state.cash = Math.max(0, state.cash - Math.max(0, context.projectionQuote * context.quantity + context.fee - collateral));
  context.shorts.reservedCash = Math.max(0, number(context.shorts.reservedCash) - collateral);
  position.quantity = Math.max(0, nonNegative(position.quantity) - context.quantity);
  if (!position.quantity) delete context.shortPositions[candidate.instrumentId];
  return true;
}

function openOptionCandidate(state, candidate, context) {
  if (!candidate.instrumentId) return false;
  state.cash = Math.max(0, state.cash - nonNegative(candidate.premium || 10) * context.quantity);
  return true;
}

const MARKET_EXPANSION_APPLIERS = {
  'open-margin': openMarginCandidate,
  'reduce-margin': reduceMarginCandidate,
  'open-short': openShortCandidate,
  'cover-short': coverShortCandidate,
  'open-option': openOptionCandidate,
};

function applyMarketExpansionCandidate(snapshot, state, candidate) {
  const apply = MARKET_EXPANSION_APPLIERS[candidate.kind];
  if (!apply) return false;
  const context = marketExpansionContext(snapshot, state, candidate);
  if (!context) return false;
  return apply(state, candidate, context);
}

const CANDIDATE_APPLIERS = {
  buy: (snapshot, state, candidate, tile) => tile && applyBuyCandidate(state, candidate, tile),
  // Real purchase offers arrive as kind 'purchase' with the same shape;
  // without this alias they evaluated as free (cash untouched).
  purchase: (snapshot, state, candidate, tile) => tile && applyBuyCandidate(state, candidate, tile),
  build: (snapshot, state, candidate, tile) => tile && applyBuildCandidate(state, candidate, tile),
  mortgage: (snapshot, state, candidate, tile) => tile && applyMortgageCandidate(state, candidate, tile),
  loan: (_snapshot, state, candidate) => applyLoanCandidate(state, candidate),
  repay: (_snapshot, state, candidate) => applyRepayCandidate(state, candidate),
  sell: (_snapshot, state, candidate, tile) => applySellCandidate(state, candidate, tile),
  unmortgage: (_snapshot, state, candidate, tile) => applyUnmortgageCandidate(state, candidate, tile),
  'bank-repay': (_snapshot, state, candidate) => applyBankRepayment(state, candidate),
  'contract-propose': (_snapshot, state, candidate) => applyContractProposal(state, candidate),
  'exercise-option': (snapshot, state, candidate) => applyOptionCandidate(snapshot, state, candidate),
  market: applyMarketCandidate,
  'open-margin': applyMarketExpansionCandidate,
  'reduce-margin': applyMarketExpansionCandidate,
  'open-short': applyMarketExpansionCandidate,
  'cover-short': applyMarketExpansionCandidate,
  'open-option': applyMarketExpansionCandidate,
  'close-position': (snapshot, state, candidate) => applyOptionCandidate(snapshot, state, candidate, true),
  'jail-fine': (_snapshot, state, candidate) => applyJailCandidate(state, candidate),
  'jail-free': (_snapshot, state, candidate) => applyJailCandidate(state, candidate),
  'end-finance-window': () => true,
  'end-turn': () => true,
  chat: () => true,
  casino: applyCasinoCandidate,
  trade: (_snapshot, state, candidate) => applyTradeCandidate(state, candidate),
  roll: () => true
};

function applyCandidate(snapshot, state, candidate) {
  if (['end-turn', 'end-finance-window', 'chat'].includes(candidate?.kind)) return 'neutral';
  const handler = CANDIDATE_APPLIERS[candidate?.kind];
  if (!handler) return 'unsupported';
  const tile = tileFor(snapshot, candidate?.tileIndex);
  const applied = handler(snapshot, state, candidate, tile);
  return applied === false || applied == null ? 'unsupported' : 'projected';
}

function expectedCardDelta(snapshot, tile) {
  if (tile.type === 'chance') return number(snapshot.rulesDigest?.cards?.surpriseExpectedCash);
  if (tile.type === 'chest') return number(snapshot.rulesDigest?.cards?.treasureExpectedCash);
  return 0;
}

function applyRepayCandidate(state, candidate) {
  const contract = state.contracts.find(entry => entry.id === candidate.contractId);
  const amount = Math.min(state.cash, nonNegative(candidate.amount));
  if (!contract || amount <= 0) return false;
  state.cash -= amount;
  contract.remaining = Math.max(0, nonNegative(contract.remaining) - amount);
  if (contract.remaining === 0) contract.status = 'paid';
  return true;
}

function passStartValue(snapshot, position, move, boardLength) {
  if (position + move < boardLength) return 0;
  const base = number(snapshot.rulesDigest?.passStartCash, 200);
  const exactBonus = position + move === boardLength && snapshot.rulesDigest?.doubleGo ? base : 0;
  return base + exactBonus;
}

function landingRent(snapshot, board, tile, diceTotal, ownerSeat = tileOwner(tile)) {
  const facts = rentFactsFromSnapshot({ ...snapshot, board }, { ...tile, ownerSeat }, diceTotal);
  return calculateRentFromFacts(facts);
}

function applySellCandidate(state, candidate, tile) {
  if (!tile || nonNegative(tile.houseCount) <= 0) return false;
  state.cash += nonNegative(candidate.proceeds);
  tile.houseCount -= 1;
  state.properties = state.board.filter(entry => entry.ownerSeat === 'self' && entry.group).map(entry => ({ ...entry }));
  return true;
}

function applyUnmortgageCandidate(state, candidate, tile) {
  if (!tile || !tile.mortgaged) return false;
  state.cash = Math.max(0, state.cash - nonNegative(candidate.cost));
  tile.mortgaged = false;
  return true;
}

function applyBankRepayment(state, candidate) {
  if (!state.bankLoan || !['active', 'due'].includes(state.bankLoan.status)) return false;
  const amount = Math.min(state.cash, nonNegative(candidate.amount), nonNegative(state.bankLoan.remaining));
  if (amount <= 0) return false;
  state.cash -= amount;
  state.bankLoan.remaining -= amount;
  if (state.bankLoan.remaining === 0) state.bankLoan.status = 'paid';
  return true;
}

function applyContractProposal(state, candidate) {
  const offer = candidate.offer;
  if (!validContractProposal(offer)) return false;
  const amount = nonNegative(offer.amount);
  state.cash = Math.max(0, state.cash - amount);
  state.contracts.push({ kind: offer.kind, status: 'pending', role: 'lender', amount, premiumRate: number(offer.premiumRate), durationRounds: nonNegative(offer.durationRounds) });
  return true;
}

function validContractProposal(offer) {
  if (!offer) return false;
  if (!Number.isFinite(Number(offer.amount))) return false;
  return Number(offer.amount) > 0;
}

function currentOption(state, candidate) {
  return (state.marketExpansion?.options || []).find(entry => entry.id === candidate.optionId && entry.status === 'open');
}

function optionStillAvailable(snapshot, option) {
  if (!option) return false;
  if (snapshot.roundNumber != null && Number(snapshot.roundNumber) > Number(option.expiryRound)) return false;
  return option.role !== 'writer';
}

function optionIntrinsicValue(option, quote) {
  if (option.side === 'call') return Math.max(0, quote - nonNegative(option.strike));
  return Math.max(0, nonNegative(option.strike) - quote);
}

function optionPayout(option, intrinsic, close) {
  const quantity = nonNegative(option.quantity);
  const gross = intrinsic * quantity;
  const closeValue = Math.floor(gross * 0.8);
  return Math.min(close ? closeValue : gross, nonNegative(option.reserveHeld));
}

function applyOptionCandidate(snapshot, state, candidate, close = false) {
  const option = currentOption(state, candidate);
  if (!optionStillAvailable(snapshot, option)) return false;
  const quote = marketQuote(snapshot, option.instrumentId);
  if (quote === null) return false;
  const intrinsic = optionIntrinsicValue(option, quote);
  state.cash += optionPayout(option, intrinsic, close);
  option.reserveHeld = 0;
  option.status = close ? 'closed' : 'exercised';
  option.exercised = !close;
  return true;
}

function applyJailCandidate(state, candidate) {
  if (!state.inJail) return false;
  const paysFine = candidate.kind === 'jail-fine';
  const fine = nonNegative(candidate.fine || 50);
  if (paysFine && state.cash < fine) return false;
  if (!paysFine && state.jailFreeCards <= 0) return false;
  if (paysFine) state.cash -= fine;
  else state.jailFreeCards -= 1;
  state.inJail = false;
  state.jailTurns = 0;
  return true;
}

function landingRentRisk({ snapshot, board, tile, diceTotal, ownerInJail = false }) {
  const rent = landingRent(snapshot, board, tile, diceTotal);
  const owner = tileOwner(tile);
  const canCollectRent = !tile.mortgaged;
  const selfCollects = owner === 'self' && canCollectRent && !selfRentBlocked(snapshot, ownerInJail);
  const opponentCollects = owner.startsWith('opponent') && canCollectRent && !opponentIsJailed(snapshot, owner);
  return {
    rent: selfCollects ? rent : 0,
    risk: opponentCollects ? rent : 0
  };
}

function selfRentBlocked(snapshot, ownerInJail) {
  return Boolean(ownerInJail && snapshot.rulesDigest?.noRentWhileInPrison);
}

function opponentIsJailed(snapshot, ownerSeat) {
  return Boolean(snapshot.rulesDigest?.noRentWhileInPrison
    && snapshot.opponents?.find(opponent => opponent.seat === ownerSeat)?.inJail);
}

function landingTaxRisk(snapshot, tile) {
  if (tile.type !== 'tax') return 0;
  return number(tile.price || tile.amount) * number(snapshot.rulesDigest?.globalEvents?.activeEffects?.taxMultiplier, 1);
}

function nearestCardDestination(board, position, type) {
  for (let offset = 1; offset <= board.length; offset += 1) {
    const tile = board.find(entry => entry.index === (position + offset) % board.length);
    if (tile?.type === type) return tile.index;
  }
  return null;
}

function movementCardKey(tile) {
  if (tile?.type === 'chance') return 'surprise';
  if (tile?.type === 'chest') return 'treasure';
  return null;
}

function moveToCardDestination({ snapshot, card }) {
  if (card.tileId) return snapshot.board.find(entry => entry.tileId === card.tileId)?.index ?? null;
  return Number(card.tileIndex);
}

function startCardDestination({ snapshot, card }) {
  if (card.tileIndex != null) return card.tileIndex;
  if (card.action === 'goToJail') return snapshot.rulesDigest?.jailTileIndex;
  return snapshot.rulesDigest?.startTileIndex;
}

function moveBackCardDestination({ landing, boardLength, card }) {
  return (landing - nonNegative(card.steps) + boardLength) % boardLength;
}

function railroadCardsGrounded(snapshot) {
  if (snapshot.activeEvent?.phase === 'active' && snapshot.activeEvent?.id === 'airport-strike') return true;
  const effects = snapshot.rulesDigest?.globalEvents?.activeEffects || {};
  return Boolean(effects.airportCardsBlocked);
}

function nearestRailroadCard(context) {
  const grounded = railroadCardsGrounded(context.snapshot);
  const landing = grounded
    ? context.landing
    : nearestCardDestination(context.snapshot.board, context.landing, 'railroad');
  const card = grounded ? { ...context.card, grounded: true } : context.card;
  return { landing, card };
}

function nearestUtilityCard(context) {
  return { landing: nearestCardDestination(context.snapshot.board, context.landing, 'utility'), card: context.card };
}

const MOVEMENT_CARD_RESOLVERS = {
  moveTo: context => ({ landing: moveToCardDestination(context), card: context.card }),
  collectStart: context => ({ landing: startCardDestination(context), card: context.card }),
  goToJail: context => ({ landing: startCardDestination(context), card: context.card }),
  moveBack: context => ({ landing: moveBackCardDestination(context), card: context.card }),
  nearestRailroad: nearestRailroadCard,
  nearestUtility: nearestUtilityCard,
};

function resolveMovementCard(context) {
  const resolve = MOVEMENT_CARD_RESOLVERS[context.card.action];
  if (!resolve) return null;
  const result = resolve(context);
  if (!Number.isInteger(result.landing)) return null;
  if (!context.snapshot.board.some(entry => entry.index === result.landing)) return null;
  return result;
}

function resolvedMovementCardOutcomes({ snapshot, landing, boardLength, movements, count }) {
  const context = { snapshot, landing, boardLength };
  const outcomes = [];
  let movementCount = 0;
  movements.forEach(card => {
    const cardCount = Math.max(0, nonNegative(card.count));
    const resolved = resolveMovementCard({ ...context, card });
    if (!resolved) return;
    movementCount += cardCount;
    outcomes.push({ landing: resolved.landing, probability: cardCount / count, card: resolved.card });
  });
  return { outcomes, movementCount };
}

function completeMovementCardOutcomes(outcomes, landing, movementCount, count) {
  if (movementCount < count) outcomes.push({ landing, probability: (count - movementCount) / count, card: null });
  if (outcomes.length) return outcomes;
  return [{ landing, probability: 1, card: null }];
}

function movementCardOutcomes(snapshot, tile, landing, boardLength) {
  const key = movementCardKey(tile);
  if (!key) return [{ landing, probability: 1, card: null }];
  const cards = snapshot.rulesDigest?.cards || {};
  const count = Math.max(0, number(cards[`${key}Count`]));
  if (!count) return [{ landing, probability: 1, card: null }];
  const movements = cards[`${key}Movement`] || [];
  const result = resolvedMovementCardOutcomes({ snapshot, landing, boardLength, movements, count });
  return completeMovementCardOutcomes(result.outcomes, landing, result.movementCount, count);
}

function canCollectMovementRent(snapshot, tile, card) {
  if (!tile) return false;
  if (card?.grounded) return false;
  const owner = tileOwner(tile);
  if (owner === 'bank') return false;
  if (tile.mortgaged) return false;
  return !(owner.startsWith('opponent') && opponentIsJailed(snapshot, owner));
}

function movementCardRentFacts({ snapshot, state, tile, move, card }) {
  const facts = rentFactsFromSnapshot({ ...snapshot, board: state.board }, tile, move);
  if (card?.action !== 'nearestUtility') return facts;
  return {
    ...facts,
    tile: { ...tile, type: 'other', rent: move * nonNegative(card.multiplier || 10) },
    hasFullSet: false,
    doubleRent: false,
  };
}

function movementCardRentMultiplier(amount, card) {
  if (card?.action !== 'nearestRailroad') return amount;
  return amount * nonNegative(card.multiplier || 2);
}

function movementCardRent({ snapshot, state, tile, move, card }) {
  if (!canCollectMovementRent(snapshot, tile, card)) return 0;
  const amount = calculateRentFromFacts(movementCardRentFacts({ snapshot, state, tile, move, card }));
  const multiplied = movementCardRentMultiplier(amount, card);
  const owner = tileOwner(tile);
  if (owner !== 'self') return 0;
  if (state.inJail && snapshot.rulesDigest?.noRentWhileInPrison) return 0;
  return multiplied;
}

function directLandingOutcome({ snapshot, state, position, move, probability, boardLength, landing, tile }) {
  const baseRentRisk = tile ? landingRentRisk({ snapshot, board: state.board, tile, diceTotal: move, ownerInJail: state.inJail }) : { rent: 0, risk: 0 };
  return {
    landing,
    probability,
    rent: baseRentRisk.rent * probability,
    risk: (baseRentRisk.risk + (tile ? landingTaxRisk(snapshot, tile) : 0)) * probability,
    cardDelta: (tile ? expectedCardDelta(snapshot, tile) : 0) * probability,
    cashFlow: passStartValue(snapshot, position, move, boardLength) * probability,
    inJail: false,
    jailTurns: 0
  };
}

function isCardTile(tile) {
  return Boolean(tile && ['chance', 'chest'].includes(tile.type));
}

function isOpponentRentRiskDestination(snapshot, destination) {
  if (!destination) return 0;
  if (!destination.ownerSeat?.startsWith('opponent')) return 0;
  if (opponentIsJailed(snapshot, destination.ownerSeat)) return 0;
  if (destination.mortgaged) return 0;
  return 1;
}

function nearestUtilityCardRisk({ snapshot, state, destination, move, card }) {
  const facts = rentFactsFromSnapshot({ ...snapshot, board: state.board }, destination, move);
  const utilityFacts = {
    ...facts,
    tile: { ...destination, type: 'other', rent: move * nonNegative(card.multiplier || 10) },
    hasFullSet: false,
    doubleRent: false,
  };
  return calculateRentFromFacts(utilityFacts);
}

function movementCardLandingRentRisk(context) {
  const { snapshot, state, destination, move, card } = context;
  if (!isOpponentRentRiskDestination(snapshot, destination)) return 0;
  if (card.action === 'nearestRailroad') {
    return landingRent(snapshot, state.board, destination, move) * nonNegative(card.multiplier || 2);
  }
  if (card.action === 'nearestUtility') return nearestUtilityCardRisk(context);
  return landingRent(snapshot, state.board, destination, move);
}

function cardPassStartCash(snapshot, originLanding, outcome) {
  const startPassingActions = ['moveTo', 'nearestRailroad', 'nearestUtility'];
  if (!startPassingActions.includes(outcome.card.action)) return 0;
  if (outcome.landing >= originLanding) return 0;
  const base = number(snapshot.rulesDigest?.passStartCash, 200);
  const startIndex = number(snapshot.rulesDigest?.startTileIndex);
  if (outcome.landing === startIndex && snapshot.rulesDigest?.doubleGo) return base * 2;
  return base;
}

function movementCardLandingOutcome({ snapshot, state, position, move, probability, boardLength, landing, direct, outcome }) {
  const destination = state.board.find(entry => entry.index === outcome.landing);
  if (!outcome.card) {
    return {
      ...direct,
      landing: outcome.landing,
      probability: probability * outcome.probability,
      rent: 0,
      risk: 0,
      cardDelta: direct.cardDelta * outcome.probability,
      cashFlow: direct.cashFlow * outcome.probability,
    };
  }
  const rent = movementCardRent({ snapshot, state, tile: destination, move, card: outcome.card });
  const risk = movementCardLandingRentRisk({ snapshot, state, destination, move, card: outcome.card });
  const sentToJail = outcome.card.action === 'goToJail';
  const cardCash = cardPassStartCash(snapshot, landing, outcome);
  return {
    ...direct,
    landing: outcome.landing,
    probability: probability * outcome.probability,
    rent: rent * probability * outcome.probability,
    risk: (risk + (destination ? landingTaxRisk(snapshot, destination) : 0)) * probability * outcome.probability,
    cardDelta: direct.cardDelta * outcome.probability,
    cashFlow: direct.cashFlow * outcome.probability + cardCash * probability * outcome.probability,
    inJail: sentToJail,
    jailTurns: 0
  };
}

function landingOutcome({ snapshot, state, position, move, probability, boardLength }) {
  const landing = (position + move) % boardLength;
  const tile = state.board.find(entry => entry.index === landing);
  const direct = directLandingOutcome({ snapshot, state, position, move, probability, boardLength, landing, tile });
  if (!isCardTile(tile)) return [direct];
  return movementCardOutcomes(snapshot, tile, landing, boardLength).map(outcome => movementCardLandingOutcome({
    snapshot, state, position, move, probability, boardLength, landing, direct, outcome,
  }));
}

function seedHash(seed) {
  const text = String(seed ?? 'poorup');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scenarioUnit(seed, index) {
  let value = (seedHash(seed) + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0x100000000;
}

function sampledDiceRolls(actorState, budget, seed) {
  const counts = new Map();
  for (let sample = 0; sample < budget; sample += 1) {
    const stratifiedPoint = (sample + scenarioUnit(seed, sample)) / budget;
    const pair = DICE_PAIRS[Math.min(DICE_PAIRS.length - 1, Math.floor(stratifiedPoint * DICE_PAIRS.length))];
    const isDouble = pair.first === pair.second;
    const move = actorState.inJail && actorState.jailTurns < 2 && !isDouble
      ? null
      : pair.first + pair.second;
    const trackDouble = actorState.inJail && actorState.jailTurns >= 2;
    const key = `${move ?? 'jail'}:${trackDouble && isDouble ? 1 : 0}`;
    const previous = counts.get(key) || { move, isDouble: trackDouble && isDouble, count: 0 };
    previous.count += 1;
    counts.set(key, previous);
  }
  return [...counts.values()].map(outcome => ({ move: outcome.move, isDouble: outcome.isDouble, probability: outcome.count / budget }));
}

function diceRolls(actorState, { rolloutBudget = 0, seed = 'poorup' } = {}) {
  if (ALLOWED_ROLLOUT_BUDGETS.has(rolloutBudget)) return sampledDiceRolls(actorState, rolloutBudget, seed);
  if (!actorState.inJail) return DICE_TOTALS.map(([move, probability]) => ({ move, probability, isDouble: false }));
  if (actorState.jailTurns < 2) return [
    { move: 4, probability: 1 / 36, isDouble: true },
    { move: 8, probability: 1 / 36, isDouble: true },
    { move: 12, probability: 1 / 36, isDouble: true },
    { move: null, probability: 5 / 6, isDouble: false }
  ];
  return DICE_PAIRS.map(pair => ({ move: pair.first + pair.second, probability: 1 / 36, isDouble: pair.first === pair.second }));
}

function initialActorPositions(state) {
  const key = `${state.position}:${state.inJail ? 1 : 0}:${state.jailTurns}`;
  return new Map([[key, { position: state.position, inJail: state.inJail, jailTurns: state.jailTurns, probability: 1 }]]);
}

function jailedNoMoveOutcome(actorState, moveProbability) {
  return {
    position: actorState.position,
    inJail: true,
    jailTurns: actorState.jailTurns + 1,
    probability: actorState.probability * moveProbability,
    rent: 0,
    risk: 0,
    cardDelta: 0,
    cashFlow: 0,
  };
}

function jailFineForRoll(snapshot, actorState, isDouble) {
  if (!actorState.inJail) return 0;
  if (actorState.jailTurns < 2 || isDouble) return 0;
  return number(snapshot.rulesDigest?.jailFine, 50);
}

function actorRollLandingOutcomes(context, actorState, roll) {
  const { snapshot, state, boardLength } = context;
  const { move, probability, isDouble } = roll;
  if (move == null) return [jailedNoMoveOutcome(actorState, probability)];
  const weight = actorState.probability * probability;
  const fine = jailFineForRoll(snapshot, actorState, isDouble) * weight;
  const projectionState = { ...state, inJail: false };
  return landingOutcome({ snapshot, state: projectionState, position: actorState.position, move, probability: weight, boardLength })
    .map(outcome => ({ ...outcome, position: outcome.landing, risk: outcome.risk + fine }));
}

function actorTurnOutcomes(context, actorState) {
  const { options, turn } = context;
  const seed = `${options.seed}:${options.candidateId}:self:${turn}:${actorState.position}:${actorState.jailTurns}`;
  const rolls = diceRolls(actorState, { rolloutBudget: options.rolloutBudget, seed });
  return rolls.flatMap(roll => actorRollLandingOutcomes(context, actorState, roll));
}

function expandLandingTurn(context) {
  const outcomes = [];
  context.positions.forEach(actorState => outcomes.push(...actorTurnOutcomes(context, actorState)));
  return outcomes;
}

function accumulateLandingTotals(totals, outcomes) {
  outcomes.forEach(outcome => Object.keys(totals).forEach(key => { totals[key] += outcome[key] || 0; }));
}

function mergeLandingPositions(outcomes) {
  const next = new Map();
  outcomes.forEach(outcome => {
    const key = `${outcome.position}:${outcome.inJail ? 1 : 0}:${outcome.jailTurns}`;
    const prior = next.get(key);
    const position = { position: outcome.position, inJail: outcome.inJail, jailTurns: outcome.jailTurns };
    next.set(key, prior ? { ...prior, probability: prior.probability + outcome.probability } : { ...position, probability: outcome.probability });
  });
  return next;
}

function expectedLandingValue(snapshot, state, horizon, options = {}) {
  const boardLength = Math.max(1, (snapshot.board || []).length || 40);
  const totals = { rent: 0, risk: 0, cardDelta: 0, cashFlow: 0 };
  let positions = initialActorPositions(state);
  for (let turn = 0; turn < horizon; turn += 1) {
    const context = { snapshot, state, options, positions, boardLength, turn };
    const outcomes = expandLandingTurn(context);
    accumulateLandingTotals(totals, outcomes);
    positions = mergeLandingPositions(outcomes);
  }
  state.expectedRisk = totals.risk;
  state.expectedCardDelta = totals.cardDelta;
  state.expectedCashFlow = totals.cashFlow;
  state.expectedRent = expectedOpponentRent({ snapshot, state, horizon, boardLength, options });
}

function opponentStartPositions(opponent) {
  const position = number(opponent.position);
  const inJail = opponent.inJail === true;
  const jailTurns = nonNegative(opponent.jailTurns);
  const key = `${position}:${inJail ? 1 : 0}:${jailTurns}`;
  return new Map([[key, { position, inJail, jailTurns, probability: 1 }]]);
}

function storeOpponentPosition(next, outcome) {
  const key = `${outcome.position}:${outcome.inJail ? 1 : 0}:${outcome.jailTurns}`;
  const prior = next.get(key);
  if (prior) {
    next.set(key, { ...prior, probability: prior.probability + outcome.probability });
    return;
  }
  next.set(key, { ...outcome });
}

function opponentJailOutcome(actorState, moveProbability) {
  return {
    position: actorState.position,
    inJail: true,
    jailTurns: actorState.jailTurns + 1,
    probability: actorState.probability * moveProbability,
  };
}

function opponentRollProjection(context, actorState, roll) {
  if (roll.move == null) return { rent: 0, outcomes: [opponentJailOutcome(actorState, roll.probability)] };
  const landings = landingOutcome({
    snapshot: context.snapshot,
    state: context.state,
    position: actorState.position,
    move: roll.move,
    probability: actorState.probability * roll.probability,
    boardLength: context.boardLength,
  });
  return {
    rent: landings.reduce((sum, outcome) => sum + outcome.rent, 0),
    outcomes: landings.map(outcome => ({
      position: outcome.landing,
      inJail: outcome.inJail,
      jailTurns: outcome.jailTurns,
      probability: outcome.probability,
    })),
  };
}

function opponentTurnSeed(context, actorState) {
  const { options, opponentIndex, turn } = context;
  return `${options.seed}:${options.candidateId}:opponent:${opponentIndex}:${turn}:${actorState.position}:${actorState.jailTurns}`;
}

function projectOpponentTurn(context) {
  const next = new Map();
  let rent = 0;
  context.positions.forEach(actorState => {
    const seed = opponentTurnSeed(context, actorState);
    const rolls = diceRolls(actorState, { rolloutBudget: context.options.rolloutBudget, seed });
    rolls.forEach(roll => {
      const projection = opponentRollProjection(context, actorState, roll);
      rent += projection.rent;
      projection.outcomes.forEach(outcome => storeOpponentPosition(next, outcome));
    });
  });
  return { positions: next, rent };
}

function opponentRentOverHorizon(context) {
  let positions = opponentStartPositions(context.opponent);
  let rent = 0;
  for (let turn = 0; turn < context.horizon; turn += 1) {
    const turnProjection = projectOpponentTurn({ ...context, turn, positions });
    rent += turnProjection.rent;
    positions = turnProjection.positions;
  }
  return rent;
}

function expectedOpponentRent({ snapshot, state, horizon, boardLength, options = {} }) {
  return (snapshot.opponents || []).reduce((total, opponent, opponentIndex) => total + opponentRentOverHorizon({
    snapshot,
    state,
    horizon,
    boardLength,
    options,
    opponent,
    opponentIndex,
  }), 0);
}

function groupPotential(snapshot, state) {
  const completed = completeGroupCount(snapshot, state);
  const partial = [...new Set(state.board.map(tile => tile.group).filter(Boolean))]
    .reduce((sum, group) => sum + Math.min(propertyGroupCount(state, group), groupTarget(snapshot, group)) / Math.max(1, groupTarget(snapshot, group)), 0);
  return completed * 80 + partial * 8;
}

function liquidityValue(snapshot, state) {
  const reserve = currentReserve(snapshot);
  const buffer = state.cash - reserve;
  if (buffer >= 0) return Math.min(60, buffer / 10);
  return buffer * 1.8;
}

function debtRisk(state) {
  const bank = state.bankLoan ? number(state.bankLoan.remaining) * 0.12 : 0;
  const margin = number(state.marketExpansion?.margin?.balance) * 0.12;
  const short = number(state.shortDefaultDebt) * 0.2;
  return bank + margin + short;
}

function deedNetWorth(tile) {
  if (tile.ownerSeat !== 'self') return 0;
  const faceValue = nonNegative(tile.price);
  return tile.mortgaged ? Math.floor(faceValue / 2) : faceValue;
}

function contractNetWorth(contract) {
  if (!['active', 'due', 'pending'].includes(contract.status)) return 0;
  const exposure = nonNegative(contract.remaining || contract.amount);
  return contract.role === 'lender' ? exposure : -exposure;
}

function bankDebtNetWorth(state) {
  if (!state.bankLoan) return 0;
  if (['paid', 'defaulted'].includes(state.bankLoan.status)) return 0;
  return -nonNegative(state.bankLoan.remaining);
}

function estimatedNetWorth(state) {
  const deedValue = state.board.reduce((sum, tile) => sum + deedNetWorth(tile), 0);
  const marketValue = Object.entries(state.marketPositions || {}).reduce((sum, [instrumentId, position]) => {
    const quantity = nonNegative(position?.quantity);
    const quote = Number(state.marketQuotes?.[instrumentId]);
    const averageCost = Number(position?.averageCost);
    const mark = Number.isFinite(quote) && quote > 0
      ? quote
      : Number.isFinite(averageCost) && averageCost > 0 ? averageCost : 0;
    return sum + quantity * mark;
  }, 0);
  const contractValue = state.contracts.reduce((sum, contract) => sum + contractNetWorth(contract), 0);
  const expansionDebt = nonNegative(state.marketExpansion?.margin?.balance);
  const shortDebt = nonNegative(state.shortDefaultDebt);
  return state.cash + deedValue + marketValue + contractValue + bankDebtNetWorth(state) - expansionDebt - shortDebt;
}

function marketDecisionEdge(snapshot, candidate) {
  if (candidate?.kind !== 'market') return 0;
  const forecast = forecastMarketOrder({
    instrumentId: candidate.instrumentId,
    quote: snapshot.marketQuotes?.[candidate.instrumentId],
    quantity: candidate.quantity || 1,
    side: candidate.side,
    history: snapshot.marketQuoteHistory,
    marketVolatility: snapshot.rulesDigest?.globalEvents?.activeEffects?.marketVolatility,
    activeEventId: snapshot.activeEvent?.phase === 'active' ? snapshot.activeEvent.id : null,
    activeEventStartedRound: snapshot.activeEvent?.startedRound,
    eventPriceMultiplier: snapshot.rulesDigest?.globalEvents?.activeEffects?.marketPriceMultiplier
  });
  if (!forecast.supported) return 0;
  // applyMarketCandidate already prices the fee through cash. Only add the
  // risk-adjusted price movement here so fees are counted exactly once.
  return forecast.expectedPnl + forecast.fee;
}

function eventHedgeValue(snapshot, state) {
  const effects = snapshot.rulesDigest?.globalEvents?.activeEffects || {};
  const penalties = [
    effects.constructionBlocked ? state.properties.reduce((sum, tile) => sum + nonNegative(tile.houseCount), 0) * 2 : 0,
    effects.rentMultiplier && number(effects.rentMultiplier) < 1 ? state.expectedRisk * 0.15 : 0,
    effects.buildingCostMultiplier && number(effects.buildingCostMultiplier) > 1 ? state.properties.length * 2 : 0
  ];
  return -penalties.reduce((sum, penalty) => sum + penalty, 0);
}

export function planningHorizon(difficulty) {
  return PLANNING_HORIZONS[difficulty] ?? PLANNING_HORIZONS.table;
}

export function evaluateCandidate(snapshot, candidate, { difficulty = 'table', seed = 'poorup', rolloutBudget = 0 } = {}) {
  const horizon = clamp(planningHorizon(difficulty), 0, MAX_HORIZON);
  const safeRolloutBudget = normalizeRolloutBudget(rolloutBudget);
  const state = stateClone(snapshot);
  const beforeGroups = completeGroupCount(snapshot, state);
  const beforeNetWorth = estimatedNetWorth(state);
  const beforeCash = state.cash;
  const projectionStatus = applyCandidate(snapshot, state, candidate);
  if (projectionStatus !== 'projected') {
    return {
      score: 0,
      horizon,
      policyVersion: NO_AI_POLICY_VERSION,
      rolloutBudget: safeRolloutBudget,
      expectedRent: 0,
      expectedRisk: 0,
      expectedCardDelta: 0,
      expectedCashFlow: 0,
      profileAdjustment: 0,
      liquidity: null,
      completeGroups: null,
      projectionStatus
    };
  }
  expectedLandingValue(snapshot, state, horizon, { seed, candidateId: candidate?.id, rolloutBudget: safeRolloutBudget });
  const afterGroups = completeGroupCount(snapshot, state);
  const estimatedNetWorthDelta = estimatedNetWorth(state) - beforeNetWorth;
  const expectedMarketEdge = marketDecisionEdge(snapshot, candidate);
  // Concentration bonus (bounded +8): develop the single highest-gain
  // group first instead of spreading houses. Needs no cost data; the
  // candidate's own cost gate still applies downstream.
  let concentration = 0;
  if (candidate?.kind === 'build' && candidate?.tileIndex != null) {
    const built = tileFor(snapshot, candidate.tileIndex);
    const best = bestGainGroup(snapshot.board);
    if (built?.group && best && built.group === best.group) concentration = 8;
  }
  // Heads-up survival: with exactly two seats, damp risky plays so the
  // bot preserves winning lines instead of gambling them. Skipped when
  // the snapshot carries no opponent list (fixtures stay pinned).
  const survival = Array.isArray(snapshot.opponents) && snapshot.opponents.length === 1
    ? -Math.max(0, Number(candidate?.risk) || 0) * 10
    : 0;
  const weights = NO_AI_OUTCOME_WEIGHTS;
  const opportunityCost = Math.max(0, beforeCash - state.cash);
  const strategic = survival * weights.survival
    + estimatedNetWorthDelta * weights.netWorth
    + liquidityValue(snapshot, state) * weights.liquidity
    + state.expectedRisk * weights.rentRisk
    + state.expectedCardDelta * weights.cardCash
    + state.expectedCashFlow * weights.passStartCash
    + state.expectedRent * weights.rentIncome
    + groupPotential(snapshot, state) * weights.groupPotential
    + (afterGroups - beforeGroups) * weights.setCompletion
    + concentration * weights.concentration
    + eventHedgeValue(snapshot, state) * weights.eventExposure
    + debtRisk(state) * weights.debtRisk
    + opportunityCost * weights.opportunityCost
    + expectedMarketEdge
    + 0;
  return {
    score: strategic,
    horizon,
    policyVersion: NO_AI_POLICY_VERSION,
    estimatedNetWorthDelta,
    expectedRent: state.expectedRent,
    expectedRisk: state.expectedRisk,
    expectedCardDelta: state.expectedCardDelta,
    expectedCashFlow: state.expectedCashFlow,
    expectedMarketEdge,
    profileAdjustment: 0,
    liquidity: state.cash,
    completeGroups: afterGroups,
    projectionStatus,
    rolloutBudget: safeRolloutBudget
  };
}

export function rankCandidates(snapshot, candidates = [], options = {}) {
  return candidates.map((candidate, index) => {
    const evaluation = evaluateCandidate(snapshot, candidate, options);
    return { candidate, index, evaluation, projectionStatus: evaluation.projectionStatus, policyVersion: evaluation.policyVersion };
  }).sort((a, b) => b.evaluation.score - a.evaluation.score || Number(a.candidate.risk || 0) - Number(b.candidate.risk || 0) || a.index - b.index);
}
