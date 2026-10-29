import { summarizePolicyComparison } from './balanceMetrics.js';

function matchesForPolicy(matches, policyId) {
  return matches.filter(match => match.policyBySeat.includes(policyId));
}

function completedMatches(matches) {
  return matches.filter(match => match.completed ?? (match.ended && match.winnerPolicyId != null));
}

export const COMPLETION_KINDS = Object.freeze(['winner', 'round-limit', 'step-limit', 'stall']);
const CENSORED_KINDS = new Set(['step-limit', 'stall']);

// Matches written before completionKind existed are classified from their flags.
function completionKindOf(match) {
  if (match.completionKind) return match.completionKind;
  if (match.stepLimitReached || match.censored) return 'step-limit';
  return completedMatches([match]).length ? 'winner' : 'no-winner';
}

function countCompletionKinds(matches) {
  const counts = Object.fromEntries(COMPLETION_KINDS.map(kind => [kind, 0]));
  matches.forEach(match => {
    const kind = completionKindOf(match);
    counts[kind] = (counts[kind] || 0) + 1;
  });
  return counts;
}

// No completed match means no placement at all: an average of zero would read
// as "the policy finished last in every match", which is a different claim.
function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
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
  const wins = completed.filter(match => match.winnerPolicyId === policyId).length;
  return {
    matches: participating.length,
    completed: completed.length,
    // Step-limit and stall matches are unfinished positions: they are counted
    // here so they stay visible, but they are not in wins, winRate or placement.
    censored: participating.filter(match => CENSORED_KINDS.has(completionKindOf(match))).length,
    completionKinds: countCompletionKinds(participating),
    wins,
    winRate: completed.length ? wins / completed.length : null,
    averagePlacement: mean(placements),
    legality: legalityForPolicy(matches, policyId),
  };
}

function policyOutcomes(matches, policyIds) {
  return Object.fromEntries(policyIds.map(policyId => [policyId, policyOutcome(matches, policyId)]));
}

// The stratum key joins the two compared policies and the opponents they
// shared. The parts are escaped, because a raw join lets two different
// strata collide: 'a:b' vs 'c' and 'a' vs 'b:c' both produced 'a:b:c:vs:none'.
function escapeKeyPart(value) {
  return String(value).replace(/([\\:+])/g, '\\$1');
}

function policyPairs(match) {
  const ids = [...new Set(match.policyBySeat)].sort();
  return ids.flatMap((leftId, index) => ids.slice(index + 1).map(rightId => {
    const opponents = ids.filter(id => id !== leftId && id !== rightId);
    const key = `${escapeKeyPart(leftId)}:${escapeKeyPart(rightId)}:vs:${opponents.length ? opponents.map(escapeKeyPart).join('+') : 'none'}`;
    return { leftId, rightId, opponents, key };
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

// A shadow row counts decisions, but its match count is the number of matches
// the policy was evaluated in, not the number of decisions it made: one match
// with twelve decisions is one match.
function shadowMatchKey(match, index) {
  return JSON.stringify([match?.seed ?? null, match?.seatRotation ?? null, match?.boardVariant ?? null, match?.policyBySeat ?? [], index]);
}

function accumulateShadowEntry(rows, entry, matchKey, matchKeysByPolicy) {
  const row = rows.get(entry.policyId) || emptyShadowRow();
  row.decisions += 1;
  row.agreements += entry.agreement ? 1 : 0;
  incrementCount(row.actionKinds, entry.actionKind);
  incrementCount(row.deterministicActionKinds, entry.deterministicActionKind);
  incrementCount(row.phases, entry.phase);
  row.fallbacks += entry.fallback || entry.modelFallback ? 1 : 0;
  const seen = matchKeysByPolicy.get(entry.policyId) || new Set();
  if (!seen.has(matchKey)) {
    seen.add(matchKey);
    row.matches += 1;
  }
  matchKeysByPolicy.set(entry.policyId, seen);
  rows.set(entry.policyId, row);
}

function shadowSummary(matches, outcomes) {
  const rows = new Map();
  const matchKeysByPolicy = new Map();
  matches.forEach((match, index) => {
    const matchKey = shadowMatchKey(match, index);
    (match.shadowTrace || []).forEach(entry => accumulateShadowEntry(rows, entry, matchKey, matchKeysByPolicy));
  });
  return Object.fromEntries([...rows].map(([policyId, row]) => [policyId, {
    ...row,
    agreementRate: row.decisions ? row.agreements / row.decisions : 0,
    aggregatePolicyOutcome: outcomes[policyId] || null,
  }]));
}

// A match row that predates a counter, or one that failed before it was
// written, must not turn the campaign totals into NaN.
function totalCount(matches, field) {
  return matches.reduce((sum, match) => sum + (Number(match?.[field]) || 0), 0);
}

function matchTotals(matches) {
  const completed = completedMatches(matches).length;
  return {
    completedCount: completed,
    incompleteCount: matches.length - completed,
    completionKinds: countCompletionKinds(matches),
    censoredCount: matches.filter(match => CENSORED_KINDS.has(completionKindOf(match))).length,
    liveAiCalls: totalCount(matches, 'liveAiCalls'),
    liveAiCapExhaustions: totalCount(matches, 'liveAiCapExhaustions'),
    liveAiFallbacks: totalCount(matches, 'liveAiFallbacks'),
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
