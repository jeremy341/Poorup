import assert from 'node:assert/strict';
import { summarizeBalanceCampaign } from './balanceMetrics.js';

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
