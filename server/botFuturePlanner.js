// Bounded, side-effect-free future evaluation for bot candidates. The planner
// consumes the provider-safe strategic snapshot and never receives or mutates
// a live GameState. It is deliberately small: a deterministic horizon is a
// better first step than an unbounded tree in a real-time table.
import { MARKET_FEE_RATE } from './marketLogic.js';

export const PLANNING_HORIZONS = { house: 0, table: 1, expert: 3 };
const MAX_HORIZON = 3;
const DICE_TOTALS = [
  [2, 1 / 36], [3, 2 / 36], [4, 3 / 36], [5, 4 / 36], [6, 5 / 36],
  [7, 6 / 36], [8, 5 / 36], [9, 4 / 36], [10, 3 / 36], [11, 2 / 36], [12, 1 / 36]
];

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
    bankLoan: bot.bankLoan ? { ...bot.bankLoan } : null,
    contracts: (bot.contracts || []).map(contract => ({ ...contract })),
    casinoNet: number(bot.casino?.net),
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
  return Math.max(120, number(snapshot.rulesDigest?.purchaseReserve, 120));
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
  state.cash = Math.max(0, state.cash - nonNegative(candidate.price || tile.price));
  const target = state.board.find(entry => entry.index === tile.index);
  if (target) Object.assign(target, { ownerSeat: 'self', mortgaged: false, houseCount: 0 });
  state.properties = state.board.filter(entry => entry.ownerSeat === 'self' && entry.group).map(entry => ({ ...entry }));
}

function applyBuildCandidate(state, candidate, tile) {
  state.cash = Math.max(0, state.cash - nonNegative(candidate.cost));
  const target = state.board.find(entry => entry.index === tile.index);
  if (target) target.houseCount = Math.min(5, nonNegative(target.houseCount) + 1);
}

function applyMortgageCandidate(state, candidate, tile) {
  state.cash += nonNegative(candidate.proceeds);
  const target = state.board.find(entry => entry.index === tile.index);
  if (target) target.mortgaged = true;
}

function applyLoanCandidate(state, candidate) {
  state.cash += nonNegative(candidate.principal);
  state.bankLoan = { status: 'active', remaining: nonNegative(candidate.totalDue || candidate.principal), dueRound: candidate.dueRound || null };
}

function applyMarketCandidate(snapshot, state, candidate) {
  const quote = nonNegative(snapshot.marketQuotes?.[candidate.instrumentId]) || 100;
  const quantity = nonNegative(candidate.quantity || 1);
  const fee = Math.max(1, Math.ceil(quote * quantity * MARKET_FEE_RATE));
  if (candidate.side === 'sell') {
    const position = state.marketPositions[candidate.instrumentId];
    if (!position || position.quantity < quantity) return;
    state.cash += Math.max(0, quote * quantity - fee);
    position.realizedPnl = number(position.realizedPnl) + (quote - number(position.averageCost)) * quantity - fee;
    position.quantity -= quantity;
    if (position.quantity <= 0) delete state.marketPositions[candidate.instrumentId];
    return;
  }
  state.cash = Math.max(0, state.cash - quote * quantity - fee);
  const position = state.marketPositions[candidate.instrumentId] || { quantity: 0, averageCost: 0, realizedPnl: 0 };
  const existingQuantity = nonNegative(position.quantity);
  const existingCost = number(position.averageCost) * existingQuantity;
  position.quantity += quantity;
  position.averageCost = (existingCost + quote * quantity + fee) / Math.max(1, existingQuantity + quantity);
  state.marketPositions[candidate.instrumentId] = position;
}

function applyCasinoCandidate(snapshot, state, candidate) {
  const fee = nonNegative(snapshot.rulesDigest?.casino?.entryFee);
  const stake = nonNegative(candidate.stake);
  state.cash = Math.max(0, state.cash - stake - fee);
  // Conservative expectation: account for the house edge, never a lucky spin.
  state.casinoNet -= Math.ceil(stake / 37) + fee;
}

function applyTradeCandidate(state, candidate) {
  state.cash = Math.max(0, state.cash - nonNegative(candidate.giveCash) + nonNegative(candidate.requestCash));
  applyPropertyTransfer(state, candidate.givePropertyIndexes, 'self', 'opponent-1');
  applyPropertyTransfer(state, candidate.requestPropertyIndexes, 'opponent-1', 'self');
}

const CANDIDATE_APPLIERS = {
  buy: (snapshot, state, candidate, tile) => tile && applyBuyCandidate(state, candidate, tile),
  build: (snapshot, state, candidate, tile) => tile && applyBuildCandidate(state, candidate, tile),
  mortgage: (snapshot, state, candidate, tile) => tile && applyMortgageCandidate(state, candidate, tile),
  loan: (_snapshot, state, candidate) => applyLoanCandidate(state, candidate),
  repay: (_snapshot, state, candidate) => applyRepayCandidate(state, candidate),
  market: applyMarketCandidate,
  'close-position': (_snapshot, _state, _candidate) => {},
  'end-finance-window': (_snapshot, _state, _candidate) => {},
  casino: applyCasinoCandidate,
  trade: (_snapshot, state, candidate) => applyTradeCandidate(state, candidate)
};

function applyCandidate(snapshot, state, candidate) {
  const handler = CANDIDATE_APPLIERS[candidate?.kind];
  const tile = tileFor(snapshot, candidate?.tileIndex);
  if (handler) handler(snapshot, state, candidate, tile);
}

function eventRentMultiplier(snapshot, tile) {
  const effects = snapshot.rulesDigest?.globalEvents?.activeEffects || {};
  let multiplier = number(effects.rentMultiplier, 1);
  if (tile.type === 'railroad') multiplier *= number(effects.airportRentMultiplier, 1);
  if (tile.type === 'utility') multiplier *= number(effects.utilityRentMultiplier, 1);
  if (tile.group === 'Dark Blue') multiplier *= number(effects.premiumRentMultiplier, 1);
  return Math.max(0, multiplier);
}

function expectedCardDelta(snapshot, tile) {
  if (tile.type === 'chance') return number(snapshot.rulesDigest?.cards?.surpriseExpectedCash);
  if (tile.type === 'chest') return number(snapshot.rulesDigest?.cards?.treasureExpectedCash);
  return 0;
}

function applyRepayCandidate(state, candidate) {
  const contract = state.contracts.find(entry => entry.id === candidate.contractId);
  const amount = Math.min(state.cash, nonNegative(candidate.amount));
  if (!contract || amount <= 0) return;
  state.cash -= amount;
  contract.remaining = Math.max(0, nonNegative(contract.remaining) - amount);
  if (contract.remaining === 0) contract.status = 'paid';
}

function passStartValue(snapshot, position, move, boardLength) {
  if (position + move < boardLength) return 0;
  const base = number(snapshot.rulesDigest?.passStartCash, 200);
  const exactBonus = position + move === boardLength && snapshot.rulesDigest?.doubleGo ? base : 0;
  return base + exactBonus;
}

function landingRentRisk(snapshot, tile) {
  const buildings = 1 + number(tile.houseCount) * 0.45;
  const rent = number(tile.rent) * buildings * eventRentMultiplier(snapshot, tile);
  const owner = tileOwner(tile);
  return {
    rent: owner === 'self' && !tile.mortgaged ? rent : 0,
    risk: owner.startsWith('opponent') && !tile.mortgaged ? rent : 0
  };
}

function landingTaxRisk(snapshot, tile) {
  if (tile.type !== 'tax') return 0;
  return number(tile.price || tile.amount) * number(snapshot.rulesDigest?.globalEvents?.activeEffects?.taxMultiplier, 1);
}

function landingOutcome(snapshot, state, position, move, probability, boardLength) {
  const landing = (position + move) % boardLength;
  const tile = state.board.find(entry => entry.index === landing);
  const rentRisk = tile ? landingRentRisk(snapshot, tile) : { rent: 0, risk: 0 };
  return {
    landing,
    probability,
    rent: rentRisk.rent * probability,
    risk: (rentRisk.risk + (tile ? landingTaxRisk(snapshot, tile) : 0)) * probability,
    cardDelta: (tile ? expectedCardDelta(snapshot, tile) : 0) * probability,
    cashFlow: passStartValue(snapshot, position, move, boardLength) * probability
  };
}

function turnOutcomes(snapshot, state, positions, boardLength) {
  const outcomes = [];
  positions.forEach((probability, position) => {
    DICE_TOTALS.forEach(([move, moveProbability]) => outcomes.push(landingOutcome(snapshot, state, position, move, probability * moveProbability, boardLength)));
  });
  return outcomes;
}

function nextPositionMap(outcomes) {
  return outcomes.reduce((next, outcome) => {
    next.set(outcome.landing, (next.get(outcome.landing) || 0) + outcome.probability);
    return next;
  }, new Map());
}

function expectedLandingValue(snapshot, state, horizon) {
  const boardLength = Math.max(1, (snapshot.board || []).length || 40);
  const totals = { rent: 0, risk: 0, cardDelta: 0, cashFlow: 0 };
  let positions = new Map([[state.position, 1]]);
  for (let turn = 0; turn < horizon; turn += 1) {
    const outcomes = turnOutcomes(snapshot, state, positions, boardLength);
    outcomes.forEach(outcome => Object.keys(totals).forEach(key => { totals[key] += outcome[key]; }));
    positions = nextPositionMap(outcomes);
  }
  state.expectedRent = totals.rent;
  state.expectedRisk = totals.risk;
  state.expectedCardDelta = totals.cardDelta;
  state.expectedCashFlow = totals.cashFlow;
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
  if (!state.bankLoan) return 0;
  return number(state.bankLoan.remaining) * 0.12;
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

function seedValue(seed, candidateId) {
  const text = `${seed || 'poorup'}:${candidateId || 'candidate'}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

export function planningHorizon(difficulty) {
  return PLANNING_HORIZONS[difficulty] ?? PLANNING_HORIZONS.table;
}

export function evaluateCandidate(snapshot, candidate, { difficulty = 'table', seed = 'poorup' } = {}) {
  const horizon = clamp(planningHorizon(difficulty), 0, MAX_HORIZON);
  const state = stateClone(snapshot);
  const beforeGroups = completeGroupCount(snapshot, state);
  applyCandidate(snapshot, state, candidate);
  expectedLandingValue(snapshot, state, horizon);
  const afterGroups = completeGroupCount(snapshot, state);
  const strategic = liquidityValue(snapshot, state)
    + state.expectedRent * 0.65
    - state.expectedRisk * 0.5
    + state.expectedCardDelta * 0.35
    + state.expectedCashFlow * 0.25
    + groupPotential(snapshot, state)
    + (afterGroups - beforeGroups) * 90
    + eventHedgeValue(snapshot, state)
    - debtRisk(state)
    + (seedValue(seed, candidate?.id) - 0.5) * (difficulty === 'expert' ? 4 : 1);
  return {
    score: strategic,
    horizon,
    expectedRent: state.expectedRent,
    expectedRisk: state.expectedRisk,
    expectedCardDelta: state.expectedCardDelta,
    expectedCashFlow: state.expectedCashFlow,
    liquidity: state.cash,
    completeGroups: afterGroups
  };
}

export function rankCandidates(snapshot, candidates = [], options = {}) {
  return candidates.map((candidate, index) => ({
    candidate,
    index,
    evaluation: evaluateCandidate(snapshot, candidate, options)
  })).sort((a, b) => b.evaluation.score - a.evaluation.score || Number(a.candidate.risk || 0) - Number(b.candidate.risk || 0) || a.index - b.index);
}
