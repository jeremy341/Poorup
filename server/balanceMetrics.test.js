import assert from 'node:assert/strict';
import { summarizeBalanceCampaign, summarizePolicyComparison } from './balanceMetrics.js';

const report = summarizeBalanceCampaign([
  { ended: true, steps: 100, round: 8, winnerSeat: 0, bankruptcies: 1, featureUsage: { auction: true, casino: false } },
  { ended: false, steps: 2000, round: 40, winnerSeat: 1, bankruptcies: 2, featureUsage: { auction: true, casino: true } },
  { ended: true, steps: 200, round: 12, winnerSeat: 0, bankruptcies: 0, featureUsage: { auction: false, casino: false } }
]);

assert.equal(report.games, 3);
assert.equal(report.completed, 2);
assert.equal(report.boundedGames, 1);
assert.equal(report.completionRate, 2 / 3);
assert.equal(report.winnerShareBySeat['0'], 2 / 3);
assert.equal(report.winnerShareBySeat['1'], 1 / 3);
assert.equal(report.bankruptcies.total, 3);
assert.equal(report.bankruptcies.gamesWithBankruptcy, 2);
assert.equal(report.bankruptcies.rate, 2 / 3);
assert.equal(report.featureAdoption.auction, 2 / 3);
assert.equal(report.featureAdoption.casino, 1 / 3);
assert.equal(report.duration.rounds.median, 12);
assert.equal(report.duration.steps.p95, 2000);

console.log('balance metrics: reducer checks passed, 0 failed');

const comparison = summarizePolicyComparison([
  { seed: 1, seatRotation: 0, ended: true, winnerPolicyId: 'candidate', placementsByPolicy: { candidate: 1, baseline: 2 } },
  { seed: 2, seatRotation: 1, ended: true, winnerPolicyId: 'baseline', placementsByPolicy: { candidate: 2, baseline: 1 } },
  { seed: 3, seatRotation: 0, ended: false, winnerPolicyId: null, placementsByPolicy: {} }
], 'candidate', 'baseline');

assert.equal(comparison.pairs, 3);
assert.equal(comparison.completedPairs, 2);
assert.equal(comparison.incompletePairs, 1);
assert.equal(comparison.intervalStatus, 'insufficient-sample');
assert.equal(comparison.winRateDeltaCI95, null);
assert.equal(comparison.placementDeltaCI95, null);
assert.deepEqual(summarizePolicyComparison([
  { seed: 1, seatRotation: 0, ended: true, winnerPolicyId: 'candidate', placementsByPolicy: { candidate: 1, baseline: 2 } },
  { seed: 2, seatRotation: 1, ended: true, winnerPolicyId: 'baseline', placementsByPolicy: { candidate: 2, baseline: 1 } },
  { seed: 3, seatRotation: 0, ended: false, winnerPolicyId: null, placementsByPolicy: {} }
], 'candidate', 'baseline'), comparison, 'paired bootstrap intervals are reproducible');

function comparisonRows(clusters, { rotations = [0, 1, 2], incomplete = false } = {}) {
  return clusters.flatMap(({ seed, opponentPolicyId }) => rotations.map(seatRotation => {
    const candidateWon = seed % 2 === 0;
    return {
      seed,
      seatRotation,
      boardVariant: 'standard-40',
      policyBySeat: ['candidate', 'baseline', opponentPolicyId],
      ended: !incomplete,
      winnerPolicyId: incomplete ? null : candidateWon ? 'candidate' : 'baseline',
      placementsByPolicy: incomplete ? {} : { candidate: candidateWon ? 1 : 2, baseline: candidateWon ? 2 : 1 }
    };
  }));
}

const singletonRows = comparisonRows([{ seed: 7, opponentPolicyId: 'control-a' }], { rotations: [0, 1, 2, 3] });
const singletonSummary = summarizePolicyComparison(singletonRows, 'candidate', 'baseline');
assert.equal(singletonSummary.independentCompletedClusters, 1, 'seat rotations stay inside one seed/opponent cluster');
assert.equal(singletonSummary.intervalStatus, 'insufficient-sample');
assert.equal(singletonSummary.winRateDeltaCI95, null);
assert.equal(singletonSummary.placementDeltaCI95, null);

const twentyNineClusters = [
  ...Array.from({ length: 9 }, (_, index) => [1, 2, 3].map(opponent => ({ seed: index + 1, opponentPolicyId: `control-${opponent}` }))).flat(),
  { seed: 10, opponentPolicyId: 'control-1' },
  { seed: 10, opponentPolicyId: 'control-2' }
];
const twentyNineSummary = summarizePolicyComparison(comparisonRows(twentyNineClusters), 'candidate', 'baseline');
assert.equal(twentyNineSummary.independentCompletedClusters, 29);
assert.equal(twentyNineSummary.intervalStatus, 'insufficient-sample');
assert.equal(twentyNineSummary.winRateDeltaCI95, null);

const thirtyClusters = Array.from({ length: 10 }, (_, index) => [1, 2, 3].map(opponent => ({ seed: index + 1, opponentPolicyId: `control-${opponent}` }))).flat();
const thirtySummary = summarizePolicyComparison(comparisonRows(thirtyClusters), 'candidate', 'baseline');
assert.equal(thirtySummary.independentCompletedClusters, 30);
assert.equal(thirtySummary.intervalStatus, 'available');
assert.ok(Array.isArray(thirtySummary.winRateDeltaCI95));
assert.ok(Array.isArray(thirtySummary.placementDeltaCI95));
assert.ok(thirtySummary.winRateDeltaCI95[0] <= thirtySummary.winRateDeltaCI95[1]);
assert.ok(thirtySummary.placementDeltaCI95[0] <= thirtySummary.placementDeltaCI95[1]);

const incompleteRows = comparisonRows(twentyNineClusters).concat(comparisonRows(
  Array.from({ length: 100 }, (_, index) => ({ seed: 100 + index, opponentPolicyId: 'control-incomplete' })),
  { incomplete: true }
));
const incompleteSummary = summarizePolicyComparison(incompleteRows, 'candidate', 'baseline');
assert.equal(incompleteSummary.completedPairs, 29 * 3);
assert.equal(incompleteSummary.incompletePairs, 100 * 3);
assert.equal(incompleteSummary.independentCompletedClusters, 29, 'incomplete seed/opponent strata do not increase the independent sample count');
assert.equal(incompleteSummary.intervalStatus, 'insufficient-sample');
assert.equal(incompleteSummary.winRateDeltaCI95, null);
