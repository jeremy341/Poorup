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
  const market = Object.entries(player.marketPositions || {}).reduce((sum, [instrumentId, position]) => {
    const quote = Number(game.marketQuotes?.[instrumentId]);
    const mark = Number.isFinite(quote) && quote > 0 ? quote : Number(position?.averageCost) || 0;
    return sum + Math.max(0, Number(position?.quantity) || 0) * mark;
  }, 0);
  return Number(player.cash || 0) + deeds + market - playerDebt(player);
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

function marketPnlByPlayer(game) {
  const positions = new Map();
  const realized = new Map();
  [...(game.marketLedger || [])].reverse().forEach(entry => {
    if (!['buy', 'sell'].includes(entry?.side)) return;
    const playerId = entry.playerId;
    const instrumentId = entry.instrumentId;
    if (!playerId || !instrumentId) return;
    const key = `${playerId}:${instrumentId}`;
    const position = positions.get(key) || { playerId, instrumentId, quantity: 0, cost: 0 };
    const quantity = Math.max(0, Math.floor(Number(entry.quantity) || 0));
    const quote = Math.max(0, Number(entry.quote) || 0);
    const fee = Math.max(0, Number(entry.fee) || 0);
    if (!quantity || !quote) return;
    if (entry.side === 'buy') {
      position.cost += quote * quantity + fee;
      position.quantity += quantity;
    } else if (position.quantity > 0) {
      const sold = Math.min(quantity, position.quantity);
      const averageCost = position.cost / position.quantity;
      realized.set(playerId, (realized.get(playerId) || 0) + ((quote - averageCost) * sold) - fee);
      position.cost = Math.max(0, position.cost - averageCost * sold);
      position.quantity -= sold;
    }
    positions.set(key, position);
  });
  const total = new Map(realized);
  positions.forEach(position => {
    if (!position.quantity) return;
    const quote = Number(game.marketQuotes?.[position.instrumentId]);
    if (!Number.isFinite(quote) || quote <= 0) return;
    const openPnl = quote * position.quantity - position.cost;
    total.set(position.playerId, (total.get(position.playerId) || 0) + openPnl);
  });
  return total;
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

export function buildMatchResult(room, { seed, policyBySeat, steps, stepLimit, decisionTrace, actionLegalityByPolicy = new Map(), strategyMetricsByPolicy = {} }) {
  const game = room.game;
  const { netWorthByPolicy, seatsByPolicy } = collectPolicyWorth(game, policyBySeat);
  const winnerSeat = winnerSeatForGame(game);
  const placementOrder = [...game.players.keys()].sort((left, right) => compareSeatNetWorth(game, winnerSeat, left, right));
  const placementsByPolicy = buildPlacementsByPolicy(seatsByPolicy, placementOrder);
  const legalityByPolicy = buildLegalityByPolicy(seatsByPolicy, actionLegalityByPolicy);
  const marketPnl = policyMarketPnl(game, seatsByPolicy);
  const hasWinner = winnerSeat != null && winnerSeat >= 0;
  return {
    seed,
    policyBySeat: policyBySeat.map(policy => policy.policyId),
    policyConfiguration: Object.fromEntries(policyBySeat.map(policy => [policy.policyId, {
      brain: policy.brain || 'no-ai',
      difficulty: policy.difficulty || 'table'
    }])),
    ended: !game.started,
    completed: !game.started && hasWinner,
    censored: Boolean(game.started && steps >= stepLimit),
    stepLimitReached: Boolean(game.started && steps >= stepLimit),
    steps,
    round: game.roundNumber,
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
