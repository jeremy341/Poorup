import assert from 'node:assert/strict';
import * as searchBenchmark from './bot-search-benchmark.js';

assert.equal(typeof searchBenchmark.benchmarkBotSearch, 'function', 'offline search benchmark is available');
const benchmarkBotSearch = searchBenchmark.benchmarkBotSearch;
const snapshot = {
  board: [
    { index: 1, type: 'property', group: 'Brown', ownerSeat: 'self', price: 60, rent: 10, houseCount: 0, mortgaged: false },
    { index: 3, type: 'property', group: 'Brown', ownerSeat: 'self', price: 60, rent: 10, houseCount: 0, mortgaged: false },
    { index: 5, type: 'railroad', ownerSeat: 'opponent-1', price: 200, rent: 25, houseCount: 0, mortgaged: false }
  ],
  botState: { position: 0, cash: 500, properties: [], marketPositions: {}, bankLoan: null, casino: { net: 0 } },
  opponents: [{ seat: 'opponent-1', position: 2, inJail: false, jailTurns: 0 }],
  rulesDigest: { purchaseReserve: 120, evenBuild: true, globalEvents: { activeEffects: {} } },
  marketQuotes: {}
};
const candidates = [
  { id: 'build:1', kind: 'build', tileIndex: 1, cost: 50, risk: 0.1 },
  { id: 'build:3', kind: 'build', tileIndex: 3, cost: 50, risk: 0.1 }
];
const output = benchmarkBotSearch({ snapshot, candidates, seed: 'benchmark-seed' });
assert.equal(output.productionEnabled, false);
assert.deepEqual(output.comparisons.map(row => row.nodeBudget), [16, 64, 256]);
assert.equal(output.accountingUnit, 'candidate-evaluations-and-nominal-per-state-scenario-budget');
assert.equal(Object.hasOwn(output, 'equalBudgetComparison'), false, 'the exact and stratified modes are not represented as equal-cost');
assert.equal(output.exactReference.mode, 'exact-2d6');
assert.equal(output.exactReference.comparisonRole, 'reference-only');
assert.equal(output.exactReference.nominalPerStateScenarioBudget, 36);
assert.equal(output.exactReference.nominalScenarioBudgetTotal, candidates.length * 36);
assert.equal(Object.hasOwn(output.exactReference, 'scenarioEvaluations'), false,
  'nominal per-state budgets must not be presented as total evaluated scenarios');
assert.ok(output.exactReference.evaluations.every(evaluation => evaluation.rolloutBudget === 0));
for (const comparison of output.comparisons) {
  assert.equal(comparison.comparisonBasis, 'sensitivity/scaling-not-equal-cost');
  assert.equal(comparison.exactReference.comparisonRole, 'reference-only');
  assert.equal(comparison.exactReference.nominalScenarioBudgetTotal, candidates.length * 36);
  assert.equal(comparison.stratified.rolloutBudget, comparison.nodeBudget);
  assert.equal(comparison.stratified.candidateEvaluations, candidates.length);
  assert.equal(comparison.stratified.nominalPerStateScenarioBudget, comparison.nodeBudget);
  assert.equal(comparison.stratified.nominalScenarioBudgetTotal, candidates.length * comparison.nodeBudget);
  assert.equal(Object.hasOwn(comparison.stratified, 'scenarioEvaluations'), false);
  assert.equal(comparison.uct.status, 'unsupported/not-comparable');
  assert.equal(comparison.progressiveWidening.status, 'unsupported/not-comparable');
  assert.ok(comparison.uct.reason.includes('transition'));
  assert.equal(comparison.uct.requestedNodeBudget, comparison.nodeBudget);
}
assert.deepEqual(benchmarkBotSearch({ snapshot, candidates, seed: 'benchmark-seed' }), output, 'benchmark output is deterministic');
const hiddenDeckSnapshot = {
  ...snapshot,
  surpriseDeck: [{ cardId: 'secret-card-a' }, { cardId: 'secret-card-b' }],
  treasureDeck: [{ cardId: 'secret-card-c' }]
};
hiddenDeckSnapshot.surpriseDeck.reverse();
assert.deepEqual(benchmarkBotSearch({ snapshot: hiddenDeckSnapshot, candidates, seed: 'benchmark-seed' }), output,
  'offline benchmark depends only on the same public snapshot and never reads hidden deck order');
assert.equal(JSON.stringify(output).includes('secret-card'), false);
console.log('bot search benchmark: reference-only exact mode, stratified scaling, and hidden-deck isolation passed');
