// Pure reducers for the release balance campaign. They consume simulation
// summaries only; no player/account identifiers or live game state enter the
// report.

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value) {
  return Math.max(0, finite(value));
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length - 1) * fraction)));
  return sorted[index];
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function deterministicRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const MIN_INDEPENDENT_COMPARISON_CLUSTERS = 30;

function bootstrapInterval(values, seed) {
  const random = deterministicRandom(seed);
  const samples = Array.from({ length: 1_000 }, () => {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)];
    }
    return total / values.length;
  });
  return [percentile(samples, 0.025), percentile(samples, 0.975)];
}

function pairedClusterValues(rows, valueForRow, leftPolicyId, rightPolicyId) {
  const grouped = new Map();
  rows.forEach(row => {
    const opponentPolicyIds = Array.isArray(row.opponentPolicyIds)
      ? row.opponentPolicyIds
      : (Array.isArray(row.policyBySeat) ? row.policyBySeat : []).filter(policyId => policyId !== leftPolicyId && policyId !== rightPolicyId);
    const key = JSON.stringify([
      row.seed ?? 'seed',
      [...new Set(opponentPolicyIds)].sort(),
      row.boardVariant ?? 'board'
    ]);
    grouped.set(key, [...(grouped.get(key) || []), valueForRow(row)]);
  });
  return [...grouped.values()].map(values => values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function summarizePolicyComparison(matchRows = [], leftPolicyId, rightPolicyId) {
  const pairs = (Array.isArray(matchRows) ? matchRows : []).filter(row => row && typeof row === 'object');
  const completed = pairs.filter(row => row.ended === true
    && row.winnerPolicyId != null
    && Number.isFinite(Number(row.placementsByPolicy?.[leftPolicyId]))
    && Number.isFinite(Number(row.placementsByPolicy?.[rightPolicyId])));
  const winDeltas = pairedClusterValues(completed, row => (row.winnerPolicyId === leftPolicyId ? 1 : 0) - (row.winnerPolicyId === rightPolicyId ? 1 : 0), leftPolicyId, rightPolicyId);
  const placementDeltas = pairedClusterValues(completed, row => Number(row.placementsByPolicy[rightPolicyId]) - Number(row.placementsByPolicy[leftPolicyId]), leftPolicyId, rightPolicyId);
  const intervalStatus = winDeltas.length >= MIN_INDEPENDENT_COMPARISON_CLUSTERS
    ? 'available'
    : 'insufficient-sample';
  const mean = values => ratio(values.reduce((sum, value) => sum + value, 0), values.length);
  return {
    pairs: pairs.length,
    completedPairs: completed.length,
    incompletePairs: pairs.length - completed.length,
    independentCompletedClusters: winDeltas.length,
    intervalStatus,
    winRateDelta: mean(winDeltas),
    placementDelta: mean(placementDeltas),
    winRateDeltaCI95: intervalStatus === 'available' ? bootstrapInterval(winDeltas, 0x51f15e) : null,
    placementDeltaCI95: intervalStatus === 'available' ? bootstrapInterval(placementDeltas, 0x6d2b79) : null
  };
}

export function summarizeBalanceCampaign(results = []) {
  const rows = Array.isArray(results) ? results.filter(row => row && typeof row === 'object') : [];
  const games = rows.length;
  const completed = rows.filter(row => row.ended === true).length;
  const winnerCounts = {};
  rows.forEach(row => {
    const seat = String(row.winnerSeat ?? 'unknown');
    winnerCounts[seat] = (winnerCounts[seat] || 0) + 1;
  });
  const winnerShareBySeat = Object.fromEntries(Object.entries(winnerCounts).map(([seat, count]) => [seat, ratio(count, games)]));
  const rounds = rows.map(row => nonNegative(row.round));
  const steps = rows.map(row => nonNegative(row.steps));
  const bankruptcies = rows.reduce((sum, row) => sum + Math.floor(nonNegative(row.bankruptcies)), 0);
  const gamesWithBankruptcy = rows.filter(row => Math.floor(nonNegative(row.bankruptcies)) > 0).length;
  const featureKeys = new Set(rows.flatMap(row => Object.keys(row.featureUsage || {})));
  const featureAdoption = Object.fromEntries([...featureKeys].sort().map(key => [key, ratio(rows.filter(row => row.featureUsage?.[key] === true).length, games)]));
  return {
    schemaVersion: 1,
    games,
    completed,
    boundedGames: Math.max(0, games - completed),
    completionRate: ratio(completed, games),
    winnerShareBySeat,
    bankruptcies: { total: bankruptcies, gamesWithBankruptcy, rate: ratio(gamesWithBankruptcy, games) },
    featureAdoption,
    duration: {
      rounds: { median: percentile(rounds, 0.5), p95: percentile(rounds, 0.95) },
      steps: { median: percentile(steps, 0.5), p95: percentile(steps, 0.95) }
    }
  };
}
