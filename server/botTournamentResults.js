import { netWorth, netWorthBreakdown } from './netWorth.js';

function nonNegativeNumber(value) {
  return Math.max(0, Number(value) || 0);
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' ? value : {};
}

function textOrDefault(value, fallback) {
  return String(value || fallback);
}

// One net-worth definition for the whole server (netWorth.js): cash, deeds, houses at resale, spot and derivative exposure,
// bank loan, short-default debt, pending payments, loan and hybrid contracts, and default claims. The tournament must not
// add up its own partial total, so a seat with a contract, short-default debt or paid-off loan is valued as the engine ranks it.
export function playerNetWorth(game, player) {
  return netWorth(game, player);
}

// The engine crowns the round-limit winner on the unclamped breakdown total
// (gameLogic.endForRoundLimit), so the placement order uses the same number:
// a seat deep in debt stays below a solvent seat and never ties with it.
function seatWorthForOrder(game, player) {
  const breakdown = netWorthBreakdown(game, player);
  return breakdown ? breakdown.total : netWorth(game, player);
}

function policyIdForSeat(policyBySeat, seat) {
  return policyBySeat[seat]?.policyId || `seat-${seat}`;
}

function addSeatToPolicy(seatsByPolicy, policyId, seat) {
  if (!seatsByPolicy[policyId]) seatsByPolicy[policyId] = [];
  seatsByPolicy[policyId].push(seat);
}

function collectPolicyWorth(game, policyBySeat) {
  const netWorthByPolicy = {};
  const seatsByPolicy = {};
  for (let seat = 0; seat < game.players.length; seat += 1) {
    const policyId = policyIdForSeat(policyBySeat, seat);
    netWorthByPolicy[policyId] = (netWorthByPolicy[policyId] || 0) + playerNetWorth(game, game.players[seat]);
    addSeatToPolicy(seatsByPolicy, policyId, seat);
  }
  return { netWorthByPolicy, seatsByPolicy };
}

function winnerSeatForGame(game) {
  if (!game.lastWinner) return null;
  return game.players.findIndex(player => player.id === game.lastWinner.id);
}

function compareSeatNetWorth(game, winnerSeat, left, right) {
  if (left === winnerSeat) return -1;
  if (right === winnerSeat) return 1;
  return seatWorthForOrder(game, game.players[right]) - seatWorthForOrder(game, game.players[left]);
}

function buildPlacementsByPolicy(seatsByPolicy, placementOrder) {
  return Object.fromEntries(Object.entries(seatsByPolicy).map(([policyId, seats]) => [
    policyId,
    Math.min(...seats.map(seat => placementOrder.indexOf(seat) + 1)),
  ]));
}

function legalityForPolicy(actionLegalityByPolicy, policyId) {
  const counts = actionLegalityByPolicy.get(policyId) || {
    actionAttempts: 0,
    legalActions: 0,
    illegalActions: 0,
    unclassifiedActions: 0,
  };
  const classifiedActions = counts.legalActions + counts.illegalActions;
  const status = counts.actionAttempts === 0 ? 'no-actions' : counts.unclassifiedActions ? 'partial' : 'measured';
  return {
    ...counts,
    classifiedActions,
    legalityRate: classifiedActions ? counts.legalActions / classifiedActions : null,
    status,
  };
}

function buildLegalityByPolicy(seatsByPolicy, actionLegalityByPolicy) {
  return Object.fromEntries(Object.keys(seatsByPolicy).map(policyId => [
    policyId,
    legalityForPolicy(actionLegalityByPolicy, policyId),
  ]));
}

function bankruptciesByPolicy(game, seatsByPolicy) {
  return Object.fromEntries(Object.entries(seatsByPolicy).map(([policyId, seats]) => [
    policyId,
    seats.filter(seat => game.players[seat].bankrupt).length,
  ]));
}

// Market P&L is booked on the player's own book: voluntary sells, forced margin liquidations and bankruptcy liquidations all
// add to marketPositions[*].realizedPnl. The display ledger is a capped view (newest 300 rows) that never records forced or
// derivative settlements, so aggregate the book and add any explicit settlement rows the ledger carries on top.
// Unrealised P&L of one held position, marked at its quote (average cost when unquoted). A flat position carries none.
function openPositionPnl(game, instrumentId, position) {
  const quantity = Math.max(0, Number(position?.quantity) || 0);
  if (!quantity) return 0;
  const averageCost = Math.max(0, Number(position?.averageCost) || 0);
  const quote = Number(game.marketQuotes?.[instrumentId]);
  const mark = Number.isFinite(quote) && quote > 0 ? quote : averageCost;
  return (mark - averageCost) * quantity;
}

// Realised plus open P&L across one player's own market book.
function bookMarketPnl(game, player) {
  let realized = 0;
  let open = 0;
  for (const [instrumentId, position] of Object.entries(player.marketPositions || {})) {
    realized += Number(position?.realizedPnl) || 0;
    open += openPositionPnl(game, instrumentId, position);
  }
  return realized + open;
}

// The P&L a ledger row settles outside the book (forced or derivative settlements). Buys and sells are already on the book.
function ledgerSettlementPnl(entry) {
  if (!entry?.playerId || ['buy', 'sell'].includes(entry.side)) return null;
  const settled = Number(entry.realizedPnl);
  return Number.isFinite(settled) ? settled : null;
}

function marketPnlByPlayer(game) {
  const totals = new Map();
  for (const player of game.players || []) {
    totals.set(player.id, bookMarketPnl(game, player));
  }
  for (const entry of game.marketLedger || []) {
    const settled = ledgerSettlementPnl(entry);
    if (settled === null) continue;
    totals.set(entry.playerId, (totals.get(entry.playerId) || 0) + settled);
  }
  return totals;
}

function policyMarketPnl(game, seatsByPolicy) {
  const byPlayer = marketPnlByPlayer(game);
  return Object.fromEntries(Object.entries(seatsByPolicy).map(([policyId, seats]) => [
    policyId,
    seats.reduce((sum, seat) => sum + (byPlayer.get(game.players[seat].id) || 0), 0)
  ]));
}

function matchIncomeComposition(game) {
  const marketPnl = marketPnlByPlayer(game);
  const seats = game.players.map(player => ({
    rent: countValue(player.rentCollected),
    market: marketPnl.get(player.id) || 0,
    casino: countValue(player.casinoNet),
    loans: countValue(player.bankLoan && player.bankLoan.status !== 'defaulted' ? player.bankLoan.remaining : 0),
  }));
  const totals = seats.reduce((sum, seat) => ({
    rent: sum.rent + seat.rent,
    market: sum.market + seat.market,
    casino: sum.casino + seat.casino,
    loans: sum.loans + seat.loans,
  }), { rent: 0, market: 0, casino: 0, loans: 0 });
  const measured = totals.rent + Math.abs(totals.market) + Math.abs(totals.casino);
  return {
    totals,
    shares: {
      rent: ratio(totals.rent, measured),
      market: ratio(totals.market, measured),
      casino: ratio(totals.casino, measured),
    },
  };
}

function ratio(value, total) {
  return total > 0 ? Number((value / total).toFixed(4)) : 0;
}

function matchFeatureUsage(game) {
  return {
    auction: Number(game.auctionsCompleted || 0) > 0,
    casino: Array.isArray(game.casinoLedger) && game.casinoLedger.length > 0,
    market: Array.isArray(game.marketLedger) && game.marketLedger.length > 0,
    globalEvents: Number(game.globalEventsTriggered || 0) > 0,
  };
}

// How the match ended. 'winner' and 'round-limit' are natural endings the engine
// crowned; 'step-limit' and 'stall' are harness-censored (the position is
// unfinished, so it must not feed win-rate or placement statistics).
export function matchCompletionKind(game, { steps, stepLimit, stalled = false, hasWinner }) {
  if (stalled) return 'stall';
  if (game.started) return steps >= stepLimit ? 'step-limit' : 'stall';
  if (!hasWinner) return 'no-winner';
  return game.lastEndReason === 'round-limit' ? 'round-limit' : 'winner';
}

export function buildMatchResult(room, { seed, policyBySeat, steps, stepLimit, stalled = false, decisionTrace, actionLegalityByPolicy = new Map(), strategyMetricsByPolicy = {} }) {
  const game = room.game;
  const { netWorthByPolicy, seatsByPolicy } = collectPolicyWorth(game, policyBySeat);
  const winnerSeat = winnerSeatForGame(game);
  const placementOrder = [...game.players.keys()].sort((left, right) => compareSeatNetWorth(game, winnerSeat, left, right));
  const placementsByPolicy = buildPlacementsByPolicy(seatsByPolicy, placementOrder);
  const legalityByPolicy = buildLegalityByPolicy(seatsByPolicy, actionLegalityByPolicy);
  const marketPnl = policyMarketPnl(game, seatsByPolicy);
  const hasWinner = winnerSeat != null && winnerSeat >= 0;
  const completionKind = matchCompletionKind(game, { steps, stepLimit, stalled, hasWinner });
  return {
    seed,
    policyBySeat: policyBySeat.map(policy => policy.policyId),
    policyConfiguration: Object.fromEntries(policyBySeat.map(policy => [policy.policyId, {
      brain: policy.brain || 'no-ai',
      difficulty: policy.difficulty || 'table'
    }])),
    ended: !game.started,
    completed: !game.started && hasWinner,
    completionKind,
    censored: completionKind === 'step-limit' || completionKind === 'stall',
    stepLimitReached: Boolean(game.started && steps >= stepLimit),
    steps,
    stepLimit,
    round: game.roundNumber,
    endReason: game.lastEndReason || null,
    winnerSeat: hasWinner ? winnerSeat : null,
    winnerPolicyId: hasWinner ? policyBySeat[winnerSeat]?.policyId || null : null,
    placementsByPolicy,
    netWorthByPolicy,
    bankruptciesByPolicy: bankruptciesByPolicy(game, seatsByPolicy),
    legalityByPolicy,
    marketPnlByPolicy: marketPnl,
    strategyMetricsByPolicy: Object.fromEntries(Object.keys(seatsByPolicy).map(policyId => [
      policyId,
      { ...(strategyMetricsByPolicy[policyId] || {}), marketPnl: marketPnl[policyId] || 0 }
    ])),
    bankruptcies: game.players.filter(player => player.bankrupt).length,
    featureUsage: matchFeatureUsage(game),
    incomeComposition: matchIncomeComposition(game),
    stalls: 0,
    decisionTrace,
  };
}

function countValue(value) {
  return Number(value) || 0;
}

function traceCoverage(evaluation) {
  const coverage = objectOrEmpty(evaluation.candidateCoverage);
  return {
    totalCount: countValue(coverage.totalCount),
    sentCount: countValue(coverage.sentCount),
    omittedCount: countValue(coverage.omittedCount),
    omittedByKind: { ...objectOrEmpty(coverage.omittedByKind) },
  };
}

export function safeShadowEvaluationTrace(evaluation, policyId) {
  if (!evaluation || typeof evaluation !== 'object') return null;
  return {
    policyId,
    actionKind: textOrDefault(evaluation.actionKind, 'unknown'),
    deterministicActionKind: textOrDefault(evaluation.deterministicActionKind, 'unknown'),
    agreement: evaluation.agreement === true,
    phase: textOrDefault(evaluation.phase, 'unknown'),
    candidateCoverage: traceCoverage(evaluation),
    provider: textOrDefault(evaluation.provider, 'unknown'),
    model: textOrDefault(evaluation.model, 'unknown'),
    promptVersion: textOrDefault(evaluation.promptVersion, 'unknown'),
    fallback: evaluation.fallback === true,
    modelFallback: evaluation.modelFallback === true,
    latencyMs: nonNegativeNumber(evaluation.latencyMs),
    fallbackReason: textOrDefault(evaluation.fallbackReason, ''),
  };
}
