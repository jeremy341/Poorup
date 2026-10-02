function nonNegativeNumber(value) {
  return Math.max(0, Number(value) || 0);
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' ? value : {};
}

function textOrDefault(value, fallback) {
  return String(value || fallback);
}

function fieldNumber(object, key) {
  const value = object ? object[key] : undefined;
  return Number(value || 0);
}

function tileAssetValue(game, index) {
  const tile = gameTile(game, index);
  const improvements = fieldNumber(tile, 'houseCount') + fieldNumber(tile, 'hotelCount') * 5;
  return fieldNumber(tile, 'price') + improvements * fieldNumber(tile, 'houseCost') / 2;
}

function gameTile(game, index) {
  if (typeof game.getTile === 'function') return game.getTile(index);
  return Array.isArray(game.tiles) ? game.tiles.find(entry => entry.index === index) : undefined;
}

function playerDebt(player) {
  return Number(player.bankLoan?.remaining ?? player.bankLoan?.totalDue ?? player.bankLoan?.principal ?? 0);
}

export function playerNetWorth(game, player) {
  const deeds = (player.properties || []).reduce((sum, index) => sum + tileAssetValue(game, index), 0);
  return Number(player.cash || 0) + deeds - playerDebt(player);
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
  return playerNetWorth(game, game.players[right]) - playerNetWorth(game, game.players[left]);
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

// Where a seat's money actually came from. rentCollected is the only
// server-side running total for rent; realized market P&L is the sum of the
// per-position realizedPnl the settlement path writes (there is no per-player
// marketNet field). This is a measurement aid for the balance campaign; it
// never feeds game state.
function playerMarketRealized(player) {
  const positions = Object.values(player.marketPositions || {});
  return positions.reduce((sum, position) => sum + countValue(position?.realizedPnl), 0);
}

function matchIncomeComposition(game) {
  const seats = game.players.map(player => ({
    rent: countValue(player.rentCollected),
    market: playerMarketRealized(player),
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

export function buildMatchResult(room, { seed, policyBySeat, steps, stepLimit, decisionTrace, actionLegalityByPolicy = new Map() }) {
  const game = room.game;
  const { netWorthByPolicy, seatsByPolicy } = collectPolicyWorth(game, policyBySeat);
  const winnerSeat = winnerSeatForGame(game);
  const placementOrder = [...game.players.keys()].sort((left, right) => compareSeatNetWorth(game, winnerSeat, left, right));
  const placementsByPolicy = buildPlacementsByPolicy(seatsByPolicy, placementOrder);
  const legalityByPolicy = buildLegalityByPolicy(seatsByPolicy, actionLegalityByPolicy);
  const hasWinner = winnerSeat != null && winnerSeat >= 0;
  return {
    seed,
    policyBySeat: policyBySeat.map(policy => policy.policyId),
    ended: !game.started,
    stepLimitReached: Boolean(game.started && steps >= stepLimit),
    steps,
    round: game.roundNumber,
    winnerSeat: hasWinner ? winnerSeat : null,
    winnerPolicyId: hasWinner ? policyBySeat[winnerSeat]?.policyId || null : null,
    placementsByPolicy,
    netWorthByPolicy,
    bankruptciesByPolicy: bankruptciesByPolicy(game, seatsByPolicy),
    legalityByPolicy,
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
