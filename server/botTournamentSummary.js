import { summarizePolicyComparison } from './balanceMetrics.js';

function matchesForPolicy(matches, policyId) {
  return matches.filter(match => match.policyBySeat.includes(policyId));
}

function completedMatches(matches) {
  return matches.filter(match => match.completed ?? (match.ended && match.winnerPolicyId != null));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function legalityForPolicy(matches, policyId) {
  const totals = matches.reduce((sum, match) => {
    const metric = match.legalityByPolicy?.[policyId];
    if (!metric) return sum;
    sum.actionAttempts += metric.actionAttempts;
    sum.legalActions += metric.legalActions;
    sum.illegalActions += metric.illegalActions;
    sum.unclassifiedActions += metric.unclassifiedActions;
    return sum;
  }, { actionAttempts: 0, legalActions: 0, illegalActions: 0, unclassifiedActions: 0 });
  const classifiedActions = totals.legalActions + totals.illegalActions;
  return {
    ...totals,
    classifiedActions,
    legalityRate: classifiedActions ? totals.legalActions / classifiedActions : null,
    status: totals.actionAttempts === 0 ? 'no-actions' : totals.unclassifiedActions ? 'partial' : 'measured',
  };
}

function policyOutcome(matches, policyId) {
  const participating = matchesForPolicy(matches, policyId);
  const completed = completedMatches(participating);
  const placements = completed
    .map(match => match.placementsByPolicy[policyId])
    .filter(value => value != null);
  return {
    matches: participating.length,
    completed: completed.length,
    wins: completed.filter(match => match.winnerPolicyId === policyId).length,
    averagePlacement: mean(placements),
    legality: legalityForPolicy(matches, policyId),
  };
}

function policyOutcomes(matches, policyIds) {
  return Object.fromEntries(policyIds.map(policyId => [policyId, policyOutcome(matches, policyId)]));
}

function policyPairs(match) {
  const ids = [...new Set(match.policyBySeat)].sort();
  return ids.flatMap((leftId, index) => ids.slice(index + 1).map(rightId => {
    const opponents = ids.filter(id => id !== leftId && id !== rightId);
    return { leftId, rightId, opponents, key: `${leftId}:${rightId}:vs:${opponents.join('+') || 'none'}` };
  }));
}

function addMatchToComparisonGroups(groups, match) {
  for (const pair of policyPairs(match)) {
    const stratum = groups.get(pair.key) || { ...pair, rows: [] };
    stratum.rows.push(match);
    groups.set(pair.key, stratum);
  }
}

function pairedDifferences(matches) {
  const groups = new Map();
  matches.forEach(match => addMatchToComparisonGroups(groups, match));
  return Object.fromEntries([...groups].map(([key, stratum]) => [key, {
    ...summarizePolicyComparison(stratum.rows, stratum.leftId, stratum.rightId),
    opponentPolicyIds: stratum.opponents,
  }]));
}

function emptyShadowRow() {
  return { decisions: 0, agreements: 0, actionKinds: {}, deterministicActionKinds: {}, phases: {}, fallbacks: 0, matches: 0 };
}

function incrementCount(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function accumulateShadowEntry(rows, entry) {
  const row = rows.get(entry.policyId) || emptyShadowRow();
  row.decisions += 1;
  row.agreements += entry.agreement ? 1 : 0;
  incrementCount(row.actionKinds, entry.actionKind);
  incrementCount(row.deterministicActionKinds, entry.deterministicActionKind);
  incrementCount(row.phases, entry.phase);
  row.fallbacks += entry.fallback || entry.modelFallback ? 1 : 0;
  row.matches += 1;
  rows.set(entry.policyId, row);
}

function shadowSummary(matches, outcomes) {
  const rows = new Map();
  matches.forEach(match => (match.shadowTrace || []).forEach(entry => accumulateShadowEntry(rows, entry)));
  return Object.fromEntries([...rows].map(([policyId, row]) => [policyId, {
    ...row,
    agreementRate: row.decisions ? row.agreements / row.decisions : 0,
    aggregatePolicyOutcome: outcomes[policyId] || null,
  }]));
}

function matchTotals(matches) {
  const completed = completedMatches(matches).length;
  return {
    completedCount: completed,
    incompleteCount: matches.length - completed,
    liveAiCalls: matches.reduce((sum, match) => sum + match.liveAiCalls, 0),
    liveAiCapExhaustions: matches.reduce((sum, match) => sum + match.liveAiCapExhaustions, 0),
    liveAiFallbacks: matches.reduce((sum, match) => sum + match.liveAiFallbacks, 0),
    liveAiCappedMatches: matches.filter(match => match.liveAiCallCapReached).length,
    liveAiStatus: campaignStatus(matches),
  };
}

function strategyMetricsByPolicy(matches, policyIds) {
  const sumFields = ['providerCalls', 'auctionBidCount', 'auctionBidPremiumTotal', 'auctionBidFacePremiumTotal', 'completedTrades', 'completedGroupsLost', 'opponentGroupsBroken'];
  return Object.fromEntries(policyIds.map(policyId => {
    const result = Object.fromEntries(sumFields.map(field => [field, 0]));
    result.maxAuctionBidPremium = 0;
    result.maxAuctionBidFacePremium = 0;
    result.marketPnl = 0;
    result.matches = 0;
    matches.forEach(match => {
      const metrics = match.strategyMetricsByPolicy?.[policyId];
      if (!metrics) return;
      result.matches += 1;
      sumFields.forEach(field => { result[field] += Number(metrics[field]) || 0; });
      result.maxAuctionBidPremium = Math.max(result.maxAuctionBidPremium, Number(metrics.maxAuctionBidPremium) || 0);
      result.maxAuctionBidFacePremium = Math.max(result.maxAuctionBidFacePremium, Number(metrics.maxAuctionBidFacePremium) || 0);
      result.marketPnl += Number(match.marketPnlByPolicy?.[policyId] ?? metrics.marketPnl) || 0;
    });
    return [policyId, result];
  }));
}

function campaignStatus(matches) {
  if (matches.some(match => match.liveAiCallCapReached)) return 'cap-exhausted-fallbacks';
  return matches.some(match => match.liveAiStatus === 'within-call-cap') ? 'within-call-cap' : 'stubbed';
}

export function buildTournamentSummary(matches, policyIds) {
  const outcomes = policyOutcomes(matches, policyIds);
  return {
    matches,
    ...matchTotals(matches),
    policyOutcomes: outcomes,
    strategyMetricsByPolicy: strategyMetricsByPolicy(matches, policyIds),
    pairedDifferences: pairedDifferences(matches),
    shadowEvaluationSummary: shadowSummary(matches, outcomes),
  };
}
