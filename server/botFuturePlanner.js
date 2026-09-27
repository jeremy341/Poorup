// Bounded, side-effect-free future evaluation for bot candidates. The planner
// consumes the provider-safe strategic snapshot and never receives or mutates
// a live GameState. It is deliberately small: a deterministic horizon is a
// better first step than an unbounded tree in a real-time table.
import { MARKET_FEE_RATE } from './marketLogic.js';
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

function applyMarketCandidate(snapshot, state, candidate) {
  if (!['buy', 'sell'].includes(candidate.side) || !candidate.instrumentId) return false;
  const quote = marketQuote(snapshot, candidate.instrumentId);
  if (quote === null) return false;
  const quantity = nonNegative(candidate.quantity || 1);
  const fee = Math.max(1, Math.ceil(quote * quantity * MARKET_FEE_RATE));
  if (candidate.side === 'sell') {
    const position = state.marketPositions[candidate.instrumentId];
    if (!position || position.quantity < quantity) return false;
    state.cash += Math.max(0, quote * quantity - fee);
    position.realizedPnl = number(position.realizedPnl) + (quote - number(position.averageCost)) * quantity - fee;
    position.quantity -= quantity;
    if (position.quantity <= 0) delete state.marketPositions[candidate.instrumentId];
    return true;
  }
  state.cash = Math.max(0, state.cash - quote * quantity - fee);
  const position = state.marketPositions[candidate.instrumentId] || { quantity: 0, averageCost: 0, realizedPnl: 0 };
  const existingQuantity = nonNegative(position.quantity);
  const existingCost = number(position.averageCost) * existingQuantity;
  position.quantity += quantity;
  position.averageCost = (existingCost + quote * quantity + fee) / Math.max(1, existingQuantity + quantity);
  state.marketPositions[candidate.instrumentId] = position;
  return true;
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

function applyMarketExpansionCandidate(snapshot, state, candidate) {
  const quote = marketQuote(snapshot, candidate.instrumentId);
  if (['open-margin', 'open-short', 'cover-short'].includes(candidate.kind) && quote === null) return false;
  const projectionQuote = quote ?? 0;
  const quantity = nonNegative(candidate.quantity || 1);
  const expansion = state.marketExpansion || (state.marketExpansion = {});
  const margin = expansion.margin || (expansion.margin = { balance: 0, maintenance: 0, positions: {} });
  margin.positions ||= {};
  const shorts = expansion.shorts || (expansion.shorts = {});
  const shortPositions = shorts.positions || (shorts.positions = {});
  const fee = Math.max(1, Math.ceil(quote * quantity * MARKET_FEE_RATE));
  if (candidate.kind === 'open-margin') {
    if (!candidate.instrumentId) return false;
    state.cash = Math.max(0, state.cash - fee);
    const position = margin.positions[candidate.instrumentId] || { quantity: 0, averageCost: 0 };
    position.averageCost = ((number(position.averageCost) * nonNegative(position.quantity)) + projectionQuote * quantity) / Math.max(1, nonNegative(position.quantity) + quantity);
    position.quantity = nonNegative(position.quantity) + quantity;
    margin.positions[candidate.instrumentId] = position;
    margin.balance = number(margin.balance) + projectionQuote * quantity;
    margin.maintenance = number(margin.maintenance) + projectionQuote * quantity * 0.25;
    return true;
  } else if (candidate.kind === 'reduce-margin') {
    if (number(margin.balance) <= 0) return false;
    const repayment = Math.min(number(margin.balance), nonNegative(candidate.amount));
    state.cash = Math.max(0, state.cash - repayment);
    margin.balance = Math.max(0, number(margin.balance) - repayment);
    return repayment > 0;
  } else if (candidate.kind === 'open-short') {
    if (!candidate.instrumentId) return false;
    const gross = projectionQuote * quantity;
    const collateral = Math.ceil(gross * 0.5);
    state.cash = Math.max(0, state.cash + gross - fee - collateral);
    shorts.reservedCash = number(shorts.reservedCash) + collateral;
    const position = shortPositions[candidate.instrumentId] || { quantity: 0, entryQuote: 0, collateral: 0 };
    position.entryQuote = ((number(position.entryQuote) * nonNegative(position.quantity)) + gross) / Math.max(1, nonNegative(position.quantity) + quantity);
    position.quantity = nonNegative(position.quantity) + quantity;
    position.collateral = number(position.collateral) + collateral;
    shortPositions[candidate.instrumentId] = position;
    return true;
  } else if (candidate.kind === 'cover-short') {
    const position = shortPositions[candidate.instrumentId];
    if (!position || !candidate.instrumentId) return false;
    const collateral = Math.min(number(position.collateral), number(shorts.reservedCash));
    state.cash = Math.max(0, state.cash - Math.max(0, projectionQuote * quantity + fee - collateral));
    shorts.reservedCash = Math.max(0, number(shorts.reservedCash) - collateral);
    position.quantity = Math.max(0, nonNegative(position.quantity) - quantity);
    if (!position.quantity) delete shortPositions[candidate.instrumentId];
    return true;
  } else if (candidate.kind === 'open-option') {
    if (!candidate.instrumentId) return false;
    state.cash = Math.max(0, state.cash - nonNegative(candidate.premium || 10) * quantity);
    return true;
  }
  return false;
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
  if (!offer || !Number.isFinite(Number(offer.amount)) || Number(offer.amount) <= 0) return false;
  const amount = nonNegative(offer.amount);
  state.cash = Math.max(0, state.cash - amount);
  state.contracts.push({ kind: offer.kind, status: 'pending', role: 'lender', amount, premiumRate: number(offer.premiumRate), durationRounds: nonNegative(offer.durationRounds) });
  return true;
}

function applyOptionCandidate(snapshot, state, candidate, close = false) {
  const option = (state.marketExpansion?.options || []).find(entry => entry.id === candidate.optionId && entry.status === 'open');
  if (!option || (snapshot.roundNumber != null && Number(snapshot.roundNumber) > Number(option.expiryRound)) || option.role === 'writer') return false;
  const quote = marketQuote(snapshot, option.instrumentId);
  if (quote === null) return false;
  const strike = nonNegative(option.strike);
  const intrinsic = option.side === 'call' ? Math.max(0, quote - strike) : Math.max(0, strike - quote);
  const payout = Math.min(close ? Math.floor(intrinsic * nonNegative(option.quantity) * 0.8) : intrinsic * nonNegative(option.quantity), nonNegative(option.reserveHeld));
  state.cash += payout;
  option.reserveHeld = 0;
  option.status = close ? 'closed' : 'exercised';
  option.exercised = !close;
  return true;
}

function applyJailCandidate(state, candidate) {
  if (!state.inJail) return false;
  if (candidate.kind === 'jail-fine') {
    const fine = nonNegative(candidate.fine || 50);
    if (state.cash < fine) return false;
    state.cash -= fine;
  } else {
    if (state.jailFreeCards <= 0) return false;
    state.jailFreeCards -= 1;
  }
  state.inJail = false;
  state.jailTurns = 0;
  return true;
}

function landingRentRisk(snapshot, board, tile, diceTotal, ownerInJail = false) {
  const rent = landingRent(snapshot, board, tile, diceTotal);
  const owner = tileOwner(tile);
  return {
    rent: owner === 'self' && !tile.mortgaged && !(ownerInJail && snapshot.rulesDigest?.noRentWhileInPrison) ? rent : 0,
    risk: owner.startsWith('opponent') && !tile.mortgaged && !opponentIsJailed(snapshot, owner) ? rent : 0
  };
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

function movementCardOutcomes(snapshot, tile, landing, boardLength) {
  if (!['chance', 'chest'].includes(tile?.type)) return [{ landing, probability: 1, card: null }];
  const cards = snapshot.rulesDigest?.cards || {};
  const key = tile.type === 'chance' ? 'surprise' : 'treasure';
  const count = Math.max(0, number(cards[`${key}Count`]));
  if (!count) return [{ landing, probability: 1, card: null }];
  const movements = cards[`${key}Movement`] || [];
  const outcomes = [];
  let movementCount = 0;
  movements.forEach(card => {
    const cardCount = Math.max(0, nonNegative(card.count));
    let destination = null;
    if (card.action === 'moveTo') {
      destination = card.tileId ? snapshot.board.find(entry => entry.tileId === card.tileId)?.index : Number(card.tileIndex);
    } else if (card.action === 'collectStart' || card.action === 'goToJail') {
      destination = card.tileIndex ?? (card.action === 'goToJail' ? snapshot.rulesDigest?.jailTileIndex : snapshot.rulesDigest?.startTileIndex);
    } else if (card.action === 'moveBack') {
      destination = (landing - nonNegative(card.steps) + boardLength) % boardLength;
    } else if (card.action === 'nearestRailroad') {
      const effects = snapshot.rulesDigest?.globalEvents?.activeEffects || {};
      const grounded = (snapshot.activeEvent?.phase === 'active' && snapshot.activeEvent?.id === 'airport-strike') || effects.airportCardsBlocked;
      destination = grounded ? landing : nearestCardDestination(snapshot.board, landing, 'railroad');
      if (grounded) card = { ...card, grounded: true };
    } else if (card.action === 'nearestUtility') {
      destination = nearestCardDestination(snapshot.board, landing, 'utility');
    }
    if (!Number.isInteger(destination) || !snapshot.board.some(entry => entry.index === destination)) return;
    movementCount += cardCount;
    outcomes.push({ landing: destination, probability: cardCount / count, card });
  });
  if (movementCount < count) outcomes.push({ landing, probability: (count - movementCount) / count, card: null });
  return outcomes.length ? outcomes : [{ landing, probability: 1, card: null }];
}

function movementCardRent(snapshot, state, tile, move, card) {
  if (!tile || card?.grounded) return 0;
  const owner = tileOwner(tile);
  if (owner === 'bank' || tile.mortgaged || (owner.startsWith('opponent') && opponentIsJailed(snapshot, owner))) return 0;
  let facts = rentFactsFromSnapshot({ ...snapshot, board: state.board }, tile, move);
  if (card?.action === 'nearestUtility') {
    facts = { ...facts, tile: { ...tile, type: 'other', rent: move * nonNegative(card.multiplier || 10) }, hasFullSet: false, doubleRent: false };
  }
  const amount = calculateRentFromFacts(facts);
  const multiplied = card?.action === 'nearestRailroad' ? amount * nonNegative(card.multiplier || 2) : amount;
  return owner === 'self' && !(state.inJail && snapshot.rulesDigest?.noRentWhileInPrison) ? multiplied : 0;
}

function landingOutcome(snapshot, state, position, move, probability, boardLength) {
  const landing = (position + move) % boardLength;
  const tile = state.board.find(entry => entry.index === landing);
  const baseRentRisk = tile ? landingRentRisk(snapshot, state.board, tile, move, state.inJail) : { rent: 0, risk: 0 };
  const direct = {
    landing,
    probability,
    rent: baseRentRisk.rent * probability,
    risk: (baseRentRisk.risk + (tile ? landingTaxRisk(snapshot, tile) : 0)) * probability,
    cardDelta: (tile ? expectedCardDelta(snapshot, tile) : 0) * probability,
    cashFlow: passStartValue(snapshot, position, move, boardLength) * probability,
    inJail: false,
    jailTurns: 0
  };
  if (!tile || !['chance', 'chest'].includes(tile.type)) return [direct];
  return movementCardOutcomes(snapshot, tile, landing, boardLength).map(outcome => {
    const destination = state.board.find(entry => entry.index === outcome.landing);
    if (!outcome.card) return { ...direct, landing: outcome.landing, probability: probability * outcome.probability, rent: 0, risk: 0, cardDelta: direct.cardDelta * outcome.probability, cashFlow: direct.cashFlow * outcome.probability };
    const rent = movementCardRent(snapshot, state, destination, move, outcome.card);
    const risk = destination?.ownerSeat?.startsWith('opponent') && !opponentIsJailed(snapshot, destination.ownerSeat) && !destination.mortgaged
      ? (outcome.card.action === 'nearestRailroad'
        ? landingRent(snapshot, state.board, destination, move) * nonNegative(outcome.card.multiplier || 2)
        : outcome.card.action === 'nearestUtility'
          ? calculateRentFromFacts({ ...rentFactsFromSnapshot({ ...snapshot, board: state.board }, destination, move), tile: { ...destination, type: 'other', rent: move * nonNegative(outcome.card.multiplier || 10) }, hasFullSet: false, doubleRent: false })
          : landingRent(snapshot, state.board, destination, move))
      : 0;
    const sentToJail = outcome.card.action === 'goToJail';
    const cardPassedStart = ['moveTo', 'nearestRailroad', 'nearestUtility'].includes(outcome.card.action)
      && outcome.landing < landing;
    const cardStartCash = cardPassedStart
      ? outcome.landing === number(snapshot.rulesDigest?.startTileIndex) && snapshot.rulesDigest?.doubleGo
        ? number(snapshot.rulesDigest?.passStartCash, 200) * 2
        : number(snapshot.rulesDigest?.passStartCash, 200)
      : 0;
    return {
      ...direct,
      landing: outcome.landing,
      probability: probability * outcome.probability,
      rent: rent * probability * outcome.probability,
      risk: (risk + (destination ? landingTaxRisk(snapshot, destination) : 0)) * probability * outcome.probability,
      cardDelta: direct.cardDelta * outcome.probability,
      cashFlow: direct.cashFlow * outcome.probability + cardStartCash * probability * outcome.probability,
      inJail: sentToJail,
      jailTurns: 0
    };
  });
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

function expectedLandingValue(snapshot, state, horizon, options = {}) {
  const boardLength = Math.max(1, (snapshot.board || []).length || 40);
  const totals = { rent: 0, risk: 0, cardDelta: 0, cashFlow: 0 };
  let positions = new Map([[`${state.position}:${state.inJail ? 1 : 0}:${state.jailTurns}`, { position: state.position, inJail: state.inJail, jailTurns: state.jailTurns, probability: 1 }]]);
  for (let turn = 0; turn < horizon; turn += 1) {
    const outcomes = [];
    positions.forEach(actorState => {
      const seed = `${options.seed}:${options.candidateId}:self:${turn}:${actorState.position}:${actorState.jailTurns}`;
      diceRolls(actorState, { rolloutBudget: options.rolloutBudget, seed }).forEach(({ move, probability: moveProbability, isDouble }) => {
        if (move == null) {
          outcomes.push({ position: actorState.position, inJail: true, jailTurns: actorState.jailTurns + 1, probability: actorState.probability * moveProbability, rent: 0, risk: 0, cardDelta: 0, cashFlow: 0 });
          return;
        }
        const jailTurnExpired = actorState.inJail && actorState.jailTurns >= 2 && !isDouble;
        const fine = jailTurnExpired ? number(snapshot.rulesDigest?.jailFine, 50) : 0;
        landingOutcome(snapshot, { ...state, inJail: false }, actorState.position, move, actorState.probability * moveProbability, boardLength)
          .forEach(next => outcomes.push({ ...next, position: next.landing, inJail: next.inJail, jailTurns: next.jailTurns, risk: next.risk + fine * actorState.probability * moveProbability }));
      });
    });
    outcomes.forEach(outcome => Object.keys(totals).forEach(key => { totals[key] += outcome[key] || 0; }));
    const next = new Map();
    outcomes.forEach(outcome => {
      const key = `${outcome.position}:${outcome.inJail ? 1 : 0}:${outcome.jailTurns}`;
      const prior = next.get(key);
      next.set(key, prior ? { ...prior, probability: prior.probability + outcome.probability } : { position: outcome.position, inJail: outcome.inJail, jailTurns: outcome.jailTurns, probability: outcome.probability });
    });
    positions = next;
  }
  state.expectedRisk = totals.risk;
  state.expectedCardDelta = totals.cardDelta;
  state.expectedCashFlow = totals.cashFlow;
  state.expectedRent = expectedOpponentRent(snapshot, state, horizon, boardLength, options);
}

function expectedOpponentRent(snapshot, state, horizon, boardLength, options = {}) {
  let total = 0;
  (snapshot.opponents || []).forEach((opponent, opponentIndex) => {
    let positions = new Map([[`${opponent.position || 0}:${opponent.inJail ? 1 : 0}:${number(opponent.jailTurns)}`, {
      position: number(opponent.position), inJail: opponent.inJail === true, jailTurns: nonNegative(opponent.jailTurns), probability: 1
    }]]);
    for (let turn = 0; turn < horizon; turn += 1) {
      const next = new Map();
      positions.forEach(actorState => {
        const seed = `${options.seed}:${options.candidateId}:opponent:${opponentIndex}:${turn}:${actorState.position}:${actorState.jailTurns}`;
        diceRolls(actorState, { rolloutBudget: options.rolloutBudget, seed }).forEach(({ move, probability, isDouble }) => {
        if (move == null) {
          const key = `${actorState.position}:1:${actorState.jailTurns + 1}`;
          const prior = next.get(key);
          next.set(key, prior ? { ...prior, probability: prior.probability + actorState.probability * probability } : { position: actorState.position, inJail: true, jailTurns: actorState.jailTurns + 1, probability: actorState.probability * probability });
          return;
        }
        landingOutcome(snapshot, state, actorState.position, move, actorState.probability * probability, boardLength)
          .forEach(outcome => {
            total += outcome.rent;
            const key = `${outcome.landing}:${outcome.inJail ? 1 : 0}:${outcome.jailTurns}`;
            const prior = next.get(key);
            const entry = { position: outcome.landing, inJail: outcome.inJail, jailTurns: outcome.jailTurns, probability: outcome.probability };
            next.set(key, prior ? { ...prior, probability: prior.probability + entry.probability } : entry);
          });
        });
      });
      positions = next;
    }
  });
  return total;
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

function estimatedNetWorth(state) {
  let value = state.cash;
  state.board.forEach(tile => {
    if (tile.ownerSeat !== 'self') return;
    const faceValue = nonNegative(tile.price);
    value += tile.mortgaged ? Math.floor(faceValue / 2) : faceValue;
  });
  state.contracts.forEach(contract => {
    if (!['active', 'due', 'pending'].includes(contract.status)) return;
    const exposure = nonNegative(contract.remaining || contract.amount);
    value += contract.role === 'lender' ? exposure : -exposure;
  });
  if (state.bankLoan && !['paid', 'defaulted'].includes(state.bankLoan.status)) value -= nonNegative(state.bankLoan.remaining);
  value -= nonNegative(state.marketExpansion?.margin?.balance);
  value -= nonNegative(state.shortDefaultDebt);
  return value;
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
