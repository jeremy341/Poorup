// An empty sample must not report a median of 0, which reads as a real value.
import assert from 'node:assert/strict';
import { summarizeBalanceCampaign } from './balanceMetrics.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const rowsOf = values => values.map(round => ({ ended: true, completed: true, winnerSeat: 0, round, steps: round }));

check('the median of an empty list is null, not 0', () => {
  const { duration } = summarizeBalanceCampaign([]);
  assert.equal(duration.rounds.median, null);
  assert.equal(duration.steps.median, null);
});

check('the median of [1,3,2] is 2', () => {
  assert.equal(summarizeBalanceCampaign(rowsOf([1, 3, 2])).duration.rounds.median, 2);
});

check('a real median of 0 stays 0', () => {
  assert.equal(summarizeBalanceCampaign(rowsOf([0, 0, 0])).duration.rounds.median, 0);
});
