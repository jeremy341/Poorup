// Pins the mechanism that orders the bot difficulty levels. The outcome ordering (Expert > Table > House
// in head-to-head wins) was measured with the tournament harness, which is too slow for the suite.
// These checks pin what produced it, so a refactor cannot flatten the levels:
//   - the investment horizon (rounds of extra rent credited to a deed, house or unmortgage) grows with the level: House 8 < Table 16 < Expert 32;
//   - at one fixed position the same build scores strictly higher the deeper the level;
//   - the dice horizon still grows with the level, and an unknown level plays as Table.
// (The auction judgement difference is pinned in bot-economics.test.js.)
import assert from 'node:assert/strict';
import {
  INVESTMENT_ROUNDS,
  INVESTMENT_ROUNDS_BY_DIFFICULTY,
  evaluateCandidate,
  investmentRounds,
  planningHorizon,
  rankCandidates,
} from './botFuturePlanner.js';

assert.deepEqual(INVESTMENT_ROUNDS_BY_DIFFICULTY, { house: 8, table: 16, expert: 32 });
assert.ok(
  INVESTMENT_ROUNDS_BY_DIFFICULTY.house < INVESTMENT_ROUNDS_BY_DIFFICULTY.table
    && INVESTMENT_ROUNDS_BY_DIFFICULTY.table < INVESTMENT_ROUNDS_BY_DIFFICULTY.expert,
  'the investment horizon is ordered House < Table < Expert',
);
assert.equal(INVESTMENT_ROUNDS, INVESTMENT_ROUNDS_BY_DIFFICULTY.table, 'the exported default is the Table horizon');
assert.equal(investmentRounds('nonsense'), INVESTMENT_ROUNDS, 'an unknown level plays as Table');
assert.ok(planningHorizon('house') < planningHorizon('table') && planningHorizon('table') < planningHorizon('expert'), 'dice horizon stays ordered');

// A bot that owns the whole Brown set with spare cash and three rivals who will land on it.
const snapshot = {
  board: [
    { index: 1, name: 'Salvador', type: 'property', group: 'Brown', ownerSeat: 'self', price: 60, rent: 2, houseCount: 0, mortgaged: false },
    { index: 3, name: 'Rio', type: 'property', group: 'Brown', ownerSeat: 'self', price: 60, rent: 4, houseCount: 0, mortgaged: false },
  ],
  opponents: [{ seat: 'opponent-1', position: 0 }, { seat: 'opponent-2', position: 0 }, { seat: 'opponent-3', position: 0 }],
  botState: { position: 0, cash: 900, properties: [], marketPositions: {}, bankLoan: null, casino: { net: 0, entryFee: 0 } },
  rulesDigest: { purchaseReserve: 120, evenBuild: true, casino: { entryFee: 0 }, globalEvents: { activeEffects: {} } },
  marketQuotes: {},
};
const build = { id: 'build:1', kind: 'build', tileIndex: 1, cost: 50, risk: 0.1 };
const scoreAt = difficulty => evaluateCandidate(snapshot, build, { difficulty, seed: 'difficulty-order' }).score;
const scores = { house: scoreAt('house'), table: scoreAt('table'), expert: scoreAt('expert') };
assert.ok(scores.house < scores.table, `Table values the same build above House (${JSON.stringify(scores)})`);
assert.ok(scores.table < scores.expert, `Expert values the same build above Table (${JSON.stringify(scores)})`);

// The horizon is the only thing that moves the score: a candidate that earns no rent
// (standing still) is scored 0 at every level.
for (const difficulty of ['house', 'table', 'expert']) {
  const ranked = rankCandidates(snapshot, [build, { id: 'roll', kind: 'roll', risk: 0 }], { difficulty, seed: 'difficulty-order' });
  const roll = ranked.find(entry => entry.candidate.kind === 'roll');
  assert.equal(roll.evaluation.score, 0, `standing still scores 0 at ${difficulty}`);
}

// The ranking is deterministic: the same inputs give the same score.
assert.equal(scoreAt('expert'), scores.expert);

console.log('bot difficulty order: investment horizon ladder and build valuation passed');
