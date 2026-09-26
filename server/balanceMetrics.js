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
