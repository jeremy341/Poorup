// Pure planning tests: the candidate evaluator must be deterministic and
// must never mutate the provider snapshot it receives.
import assert from 'node:assert/strict';
import { evaluateCandidate, planningHorizon, rankCandidates } from './botFuturePlanner.js';

const snapshot = {
  board: [
    { index: 1, name: 'Salvador', type: 'property', group: 'Brown', ownerSeat: 'self', price: 60, rent: 10, houseCount: 0, mortgaged: false },
    { index: 3, name: 'Rio', type: 'property', group: 'Brown', ownerSeat: 'self', price: 60, rent: 10, houseCount: 0, mortgaged: false },
    { index: 5, name: 'ACC Airport', type: 'railroad', group: null, ownerSeat: 'opponent-1', price: 200, rent: 25, houseCount: 0, mortgaged: false },
    { index: 6, name: 'Accra', type: 'property', group: 'Light Blue', ownerSeat: 'bank', price: 100, rent: 14, houseCount: 0, mortgaged: false },
  ],
  botState: {
    position: 0,
    cash: 500,
    properties: [],
    marketPositions: {},
    bankLoan: null,
    casino: { net: 0, entryFee: 0 }
  },
  rulesDigest: {
    purchaseReserve: 120,
    evenBuild: true,
    casino: { entryFee: 0 },
    globalEvents: { activeEffects: {} }
  },
  marketQuotes: {}
};

assert.equal(planningHorizon('house'), 0);
assert.equal(planningHorizon('table'), 1);
assert.equal(planningHorizon('expert'), 3);

const before = JSON.stringify(snapshot);
const build = evaluateCandidate(snapshot, { id: 'build:1', kind: 'build', tileIndex: 1, cost: 50, risk: 0.1 }, { difficulty: 'expert', seed: 'same' });
const mortgage = evaluateCandidate(snapshot, { id: 'mortgage:1', kind: 'mortgage', tileIndex: 1, proceeds: 30, risk: 0.25 }, { difficulty: 'table', seed: 'same' });
const purchase = evaluateCandidate(snapshot, { id: 'buy:6', kind: 'buy', tileIndex: 6, price: 100, risk: 0.2 }, { difficulty: 'table', seed: 'same' });
const loanWithoutTerms = evaluateCandidate(snapshot, { id: 'loan:emergency', kind: 'loan', principal: 300 }, { difficulty: 'table', seed: 'same' });
const loanWithTerms = evaluateCandidate(snapshot, {
  id: 'loan:emergency', kind: 'loan', principal: 300, totalDue: 450, premium: 150, dueRound: 4, cureRound: 5
}, { difficulty: 'table', seed: 'same' });
const sellSnapshot = { ...snapshot, marketQuotes: { brazil: 180 }, botState: { ...snapshot.botState, marketPositions: { brazil: { quantity: 2, averageCost: 50, realizedPnl: 0 } } } };
const marketSell = evaluateCandidate(sellSnapshot, { id: 'market:sell:brazil', kind: 'market', instrumentId: 'brazil', side: 'sell', quantity: 2 }, { difficulty: 'table', seed: 'same' });
const doubleGoSnapshot = { ...snapshot, rulesDigest: { ...snapshot.rulesDigest, doubleGo: true } };
const normalFlow = evaluateCandidate(snapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table', seed: 'same' });
const boostedFlow = evaluateCandidate(doubleGoSnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table', seed: 'same' });
assert.equal(build.horizon, 3);
assert.equal(mortgage.horizon, 1);
assert.equal(Number.isFinite(build.score), true);
assert.equal(Number.isFinite(build.expectedCashFlow), true);
assert.equal(boostedFlow.expectedCashFlow >= normalFlow.expectedCashFlow, true);
assert.equal(mortgage.liquidity, 530);
assert.equal(purchase.liquidity, 400);
assert.equal(loanWithTerms.score < loanWithoutTerms.score, true);
assert.equal(marketSell.liquidity, 852);
assert.equal(JSON.stringify(snapshot), before);

const candidates = [
  { id: 'roll', kind: 'roll', score: 0, risk: 0 },
  { id: 'build:1', kind: 'build', tileIndex: 1, cost: 50, risk: 0.1, score: 10 },
  { id: 'mortgage:1', kind: 'mortgage', tileIndex: 1, proceeds: 30, risk: 0.25, score: 8 }
];
const first = rankCandidates(snapshot, candidates, { difficulty: 'expert', seed: 'same' });
const second = rankCandidates(snapshot, candidates, { difficulty: 'expert', seed: 'same' });
assert.deepEqual(first.map(entry => entry.candidate.id), second.map(entry => entry.candidate.id));
assert.equal(first.length, candidates.length);
console.log('bot future planner: 10 passed, 0 failed');
