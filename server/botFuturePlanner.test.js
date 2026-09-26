// Pure planning tests: the candidate evaluator must be deterministic and
// must never mutate the provider snapshot it receives.
import assert from 'node:assert/strict';
import { evaluateCandidate, planningHorizon, rankCandidates } from './botFuturePlanner.js';
import { RoomManager } from './gameLogic.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { getBotChoiceCandidates } from './botLogic.js';

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
const profileCandidate = { id: 'build:1', kind: 'build', tileIndex: 1, cost: 50, risk: 0.1 };
const noProfileEvaluation = evaluateCandidate({ ...snapshot, opponents: [{ seat: 'opponent-1' }] }, profileCandidate, { difficulty: 'expert', seed: 'same' });
const unknownProfile = evaluateCandidate({
  ...snapshot,
  opponents: [{ seat: 'opponent-1', publicActionProfile: { status: 'unknown', effectiveSampleWeight: 0, confidence: 0, actionFrequencies: null } }]
}, profileCandidate, { difficulty: 'expert', seed: 'same' });
assert.equal(unknownProfile.profileAdjustment, 0, 'unknown public-action profiles have no production scoring effect');
assert.equal(unknownProfile.score, noProfileEvaluation.score, 'unknown profiles preserve the existing planner choice score');
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
assert.ok(first.every(entry => ['projected', 'neutral', 'unsupported'].includes(entry.projectionStatus)), 'ranked entries expose projection support at top level');
const exactSeedCandidate = { id: 'exact-seed-check', kind: 'build', tileIndex: 1, cost: 50, risk: 0.1 };
const exactSeedA = evaluateCandidate(snapshot, exactSeedCandidate, { difficulty: 'expert', seed: 'seed-a', rolloutBudget: 0 });
const exactSeedB = evaluateCandidate(snapshot, exactSeedCandidate, { difficulty: 'expert', seed: 'seed-b', rolloutBudget: 0 });
assert.equal(exactSeedA.score, exactSeedB.score, 'exact scenario enumeration cannot change score when only seed changes');
// Heads-up survival damps risky plays; multiplayer snapshots are unaffected.
const survivalOnlyBoard = snapshot.board.map(tile => ({ ...tile, ownerSeat: 'bank' }));
const marketValueSnapshot = { ...snapshot, board: survivalOnlyBoard, marketQuotes: { brazil: 100 } };
const multi = evaluateCandidate(marketValueSnapshot, { id: 'm', kind: 'market', instrumentId: 'brazil', side: 'buy', risk: 0.5 }, { difficulty: 'table', seed: 'same' });
const duel = { ...marketValueSnapshot, opponents: [{ seat: 'opponent-1' }] };
const duelRisky = evaluateCandidate(duel, { id: 'm', kind: 'market', instrumentId: 'brazil', side: 'buy', risk: 0.5 }, { difficulty: 'table', seed: 'same' });
assert.equal(multi.expectedRent, 0);
assert.equal(duelRisky.expectedRent, 0);
assert.equal(multi.score - duelRisky.score, 5);
// Real purchase offers spend cash like buys (were evaluated as free).
const purchaseEval = evaluateCandidate(snapshot, { id: 'purchase:6', kind: 'purchase', tileIndex: 6, price: 100, risk: 0.2 }, { difficulty: 'table', seed: 'same' });
assert.equal(purchaseEval.liquidity, 400);
assert.equal(purchaseEval.estimatedNetWorthDelta, 0);
assert.equal(purchaseEval.policyVersion, 'no-ai-outcome-v1');
const loanNetWorth = evaluateCandidate(snapshot, { id: 'loan:net-worth', kind: 'loan', principal: 300, totalDue: 450 }, { difficulty: 'table' });
assert.equal(loanNetWorth.estimatedNetWorthDelta, -150);

const rentBoard = Array.from({ length: 40 }, (_, index) => ({ index, type: 'other', ownerSeat: 'bank', rent: 0 }));
rentBoard[2] = { index: 2, type: 'property', group: 'Brown', ownerSeat: 'opponent-1', rent: 10, houseCount: 1, mortgaged: false };
const rentSnapshot = {
  ...snapshot,
  board: rentBoard,
  botState: { ...snapshot.botState, position: 0, cash: 1000 },
  opponents: [{ seat: 'opponent-1', position: 0, inJail: false }],
  rulesDigest: { ...snapshot.rulesDigest, doubleRent: false, globalEvents: { activeEffects: {} } }
};
const exactRentRisk = evaluateCandidate(rentSnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table' });
assert.equal(exactRentRisk.expectedRisk, 50 / 36);
const exactScenario = evaluateCandidate(rentSnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table', seed: 'seed-a', rolloutBudget: 0 });
for (const rolloutBudget of [16, 64, 256]) {
  const sampleOptions = { difficulty: 'table', seed: 'fixed-public-sample', rolloutBudget };
  const sampled = evaluateCandidate(rentSnapshot, { id: 'roll', kind: 'roll' }, sampleOptions);
  const repeated = evaluateCandidate(rentSnapshot, { id: 'roll', kind: 'roll' }, sampleOptions);
  assert.equal(sampled.rolloutBudget, rolloutBudget, `budget ${rolloutBudget} is applied`);
  assert.equal(sampled.projectionStatus, 'projected');
  assert.equal(sampled.expectedRisk, repeated.expectedRisk, `budget ${rolloutBudget} sample is reproducible`);
  assert.ok(Number.isFinite(sampled.score), `budget ${rolloutBudget} produces a finite score`);
  if (rolloutBudget === 16) assert.notEqual(sampled.expectedRisk, exactScenario.expectedRisk, 'sample budget changes scenario weights rather than adding score noise');
  if (rolloutBudget === 256) assert.ok(Math.abs(sampled.expectedRisk - exactScenario.expectedRisk) < 0.5, 'larger stratified sample tracks exact rent exposure');
}

rentBoard[2] = { ...rentBoard[2], ownerSeat: 'self' };
const earnedRent = evaluateCandidate(rentSnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table' });
assert.equal(earnedRent.expectedRent, 50 / 36);

const jailBoard = Array.from({ length: 40 }, (_, index) => ({ index, type: 'other', ownerSeat: 'bank', rent: 0 }));
jailBoard[14] = { index: 14, type: 'property', group: 'Brown', ownerSeat: 'opponent-1', rent: 10, houseCount: 1, mortgaged: false };
const jailedSnapshot = {
  ...rentSnapshot,
  board: jailBoard,
  botState: { ...rentSnapshot.botState, position: 10, inJail: true, jailTurns: 0 },
  rulesDigest: { ...rentSnapshot.rulesDigest, jailFine: 50 }
};
const jailedRisk = evaluateCandidate(jailedSnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table' });
assert.equal(jailedRisk.expectedRisk, 50 / 36);
const jailedOwnerSnapshot = {
  ...rentSnapshot,
  board: rentBoard,
  botState: { ...rentSnapshot.botState, position: 0, cash: 500, inJail: true, jailTurns: 0, jailFreeCards: 1 },
  opponents: [{ seat: 'opponent-1', position: 0, inJail: false }],
  rulesDigest: { ...rentSnapshot.rulesDigest, noRentWhileInPrison: true }
};
assert.equal(evaluateCandidate(jailedOwnerSnapshot, { id: 'jail:free', kind: 'jail-free' }, { difficulty: 'table' }).expectedRent, 50 / 36);

const cardBoard = Array.from({ length: 40 }, (_, index) => ({ index, type: 'other', ownerSeat: 'bank', rent: 0 }));
cardBoard[2] = { index: 2, type: 'chance', ownerSeat: 'bank', rent: 0 };
cardBoard[30] = { index: 30, type: 'property', ownerSeat: 'opponent-1', group: 'Brown', rent: 10, houseCount: 1, mortgaged: false };
const cardMovementSnapshot = {
  ...rentSnapshot,
  board: cardBoard,
  rulesDigest: {
    ...rentSnapshot.rulesDigest,
    cards: { surpriseCount: 16, surpriseExpectedCash: 0, surpriseMovement: [{ action: 'moveTo', tileIndex: 30, count: 1 }] }
  }
};
const movementCardRisk = evaluateCandidate(cardMovementSnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table' });
assert.equal(movementCardRisk.expectedRisk, 50 / (36 * 16));
const startCardSnapshot = {
  ...cardMovementSnapshot,
  board: cardBoard.map(tile => tile.index === 0 ? { ...tile, type: 'start' } : tile),
  rulesDigest: {
    ...cardMovementSnapshot.rulesDigest,
    doubleGo: true,
    cards: { surpriseCount: 16, surpriseExpectedCash: 0, surpriseMovement: [{ action: 'moveTo', tileIndex: 0, count: 1 }] }
  }
};
assert.equal(evaluateCandidate(startCardSnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table' }).expectedCashFlow, 400 / (36 * 16));
const groundedCardSnapshot = {
  ...cardMovementSnapshot,
  board: cardBoard.map(tile => tile.index === 30 ? { ...tile, type: 'railroad', ownerSeat: 'opponent-1', rent: 25 } : tile),
  activeEvent: { id: 'custom', phase: 'active', effects: { airportCardsBlocked: true } },
  rulesDigest: {
    ...cardMovementSnapshot.rulesDigest,
    globalEvents: { activeEffects: { airportCardsBlocked: true } },
    cards: { surpriseCount: 16, surpriseExpectedCash: 0, surpriseMovement: [{ action: 'nearestRailroad', count: 1, multiplier: 2 }] }
  }
};
assert.equal(evaluateCandidate(groundedCardSnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table' }).expectedRisk, 0);

const projectedEffects = [
  [{ id: 'sell:1', kind: 'sell', tileIndex: 1, proceeds: 20 }, 520],
  [{ id: 'unmortgage:3', kind: 'unmortgage', tileIndex: 3, cost: 40 }, 460],
  [{ id: 'bank-repay:b1', kind: 'bank-repay', amount: 80 }, 420],
  [{ id: 'repay:c1', kind: 'repay', contractId: 'c1', amount: 20 }, 480],
  [{ id: 'contract:loan:o1', kind: 'contract-propose', offer: { kind: 'loan', amount: 100 } }, 400],
  [{ id: 'exercise-option:o1', kind: 'exercise-option', optionId: 'o1' }, 600],
  [{ id: 'close-position:o1', kind: 'close-position', optionId: 'o1' }, 580],
  [{ id: 'jail:fine', kind: 'jail-fine' }, 450],
  [{ id: 'jail:free', kind: 'jail-free' }, 500]
];
const effectSnapshot = {
  ...snapshot,
  botState: {
    ...snapshot.botState,
    cash: 500,
    bankLoan: { status: 'active', remaining: 100 },
    contracts: [{ id: 'c1', kind: 'loan', status: 'active', remaining: 60 }],
    marketExpansion: { ...snapshot.botState.marketExpansion, options: [{ id: 'o1', instrumentId: 'brazil', role: 'holder', side: 'call', strike: 100, expiryRound: 5, quantity: 2, reserveHeld: 100, status: 'open' }] },
    inJail: true,
    jailFreeCards: 1
  },
  roundNumber: 3,
  marketQuotes: { brazil: 150 },
  board: snapshot.board.map(tile => tile.index === 1 ? { ...tile, houseCount: 1 } : tile.index === 3 ? { ...tile, mortgaged: true } : tile)
};
for (const [candidate, expectedCash] of projectedEffects) {
  const evaluation = evaluateCandidate(effectSnapshot, candidate);
  assert.equal(evaluation.projectionStatus, 'projected', candidate.kind);
  assert.equal(evaluation.liquidity, expectedCash, candidate.kind);
}

const quoteDependentCandidates = [
  { id: 'market:buy:brazil', kind: 'market', instrumentId: 'brazil', side: 'buy', quantity: 1 },
  { id: 'market:sell:brazil', kind: 'market', instrumentId: 'brazil', side: 'sell', quantity: 1 },
  { id: 'margin:brazil', kind: 'open-margin', instrumentId: 'brazil', quantity: 1 },
  { id: 'short:brazil', kind: 'open-short', instrumentId: 'brazil', quantity: 1 },
  { id: 'cover:brazil', kind: 'cover-short', instrumentId: 'brazil', quantity: 1 },
  { id: 'exercise-option:o1', kind: 'exercise-option', optionId: 'o1' },
  { id: 'close-position:o1', kind: 'close-position', optionId: 'o1' }
];
const quoteState = {
  ...effectSnapshot,
  botState: {
    ...effectSnapshot.botState,
    marketPositions: { brazil: { quantity: 2, averageCost: 50, realizedPnl: 0 } },
    marketExpansion: {
      ...effectSnapshot.botState.marketExpansion,
      margin: { balance: 100, maintenance: 25, positions: { brazil: { quantity: 1, averageCost: 100 } } },
      shorts: { reservedCash: 100, positions: { brazil: { quantity: 1, entryQuote: 100, collateral: 100 } } }
    }
  }
};
for (const quote of [undefined, 0]) {
  const quoteSnapshot = {
    ...quoteState,
    marketQuotes: quote === undefined ? {} : { brazil: quote }
  };
  const beforeQuoteEvaluation = JSON.stringify(quoteSnapshot);
  for (const candidate of quoteDependentCandidates) {
    const evaluation = evaluateCandidate(quoteSnapshot, candidate);
    assert.equal(evaluation.projectionStatus, 'unsupported', `${candidate.kind} quote ${quote}`);
    assert.equal(evaluation.score, 0, `${candidate.kind} quote ${quote} score`);
    assert.equal(evaluation.liquidity, null, `${candidate.kind} quote ${quote} liquidity`);
    assert.equal(evaluation.expectedCashFlow, 0, `${candidate.kind} quote ${quote} cash flow`);
  }
  assert.equal(JSON.stringify(quoteSnapshot), beforeQuoteEvaluation, `quote ${quote} snapshot remains unchanged`);
}

for (const { cash, amount } of [{ cash: 500, amount: 0 }, { cash: 0, amount: 20 }]) {
  const noOpBankRepaymentSnapshot = {
    ...effectSnapshot,
    botState: { ...effectSnapshot.botState, cash }
  };
  const beforeBankRepayment = JSON.stringify(noOpBankRepaymentSnapshot);
  const evaluation = evaluateCandidate(noOpBankRepaymentSnapshot, { id: 'bank-repay:b1', kind: 'bank-repay', amount });
  assert.equal(evaluation.projectionStatus, 'unsupported', `bank-repay amount=${amount}, cash=${cash}`);
  assert.equal(evaluation.score, 0, `bank-repay amount=${amount}, cash=${cash} score`);
  assert.equal(evaluation.liquidity, null, `bank-repay amount=${amount}, cash=${cash} liquidity`);
  assert.equal(JSON.stringify(noOpBankRepaymentSnapshot), beforeBankRepayment, `bank-repay amount=${amount}, cash=${cash} snapshot`);
}

for (const { cash, amount } of [{ cash: 500, amount: 0 }, { cash: 0, amount: 20 }]) {
  const noOpRepaymentSnapshot = {
    ...effectSnapshot,
    botState: { ...effectSnapshot.botState, cash }
  };
  const beforeNoOpRepayment = JSON.stringify(noOpRepaymentSnapshot);
  const evaluation = evaluateCandidate(noOpRepaymentSnapshot, { id: 'repay:c1', kind: 'repay', contractId: 'c1', amount });
  assert.equal(evaluation.projectionStatus, 'unsupported', `repay amount=${amount}, cash=${cash}`);
  assert.equal(evaluation.score, 0, `repay amount=${amount}, cash=${cash} score`);
  assert.equal(evaluation.liquidity, null, `repay amount=${amount}, cash=${cash} liquidity`);
  assert.equal(JSON.stringify(noOpRepaymentSnapshot), beforeNoOpRepayment, `repay amount=${amount}, cash=${cash} snapshot`);
}

function makeCandidateFixture(phase, configure = () => {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: `socket-${phase}`, clientId: `client-${phase}`, nickname: 'Bot' });
  room.addOrReconnectPlayer({ socketId: `other-${phase}`, clientId: `other-client-${phase}`, nickname: 'Opponent' });
  const game = room.game;
  const bot = game.players[0];
  bot.isBot = true;
  game.currentPlayerId = bot.id;
  configure(game, bot);
  return { game, bot, phase, snapshot: buildBotStrategicContext(game, bot, phase) };
}

function collectCandidatesFromFixtures(fixtures) {
  return fixtures.flatMap(({ game, bot, phase, snapshot: candidateSnapshot }) => {
    const candidates = phase === 'pre-roll'
      ? game.getBotCandidates(bot, { expanded: true, parity: true })
      : phase === 'post-roll'
        ? game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true })
        : getBotChoiceCandidates(game, bot, phase);
    return candidates.map(candidate => ({ snapshot: candidateSnapshot, candidate }));
  });
}

const candidateFixtures = [
  makeCandidateFixture('pre-roll'),
  makeCandidateFixture('post-roll', (game) => { game.hasRolled = true; }),
  makeCandidateFixture('pre-roll', (_game, bot) => { bot.inJail = true; bot.jailTurns = 2; }),
  makeCandidateFixture('pre-roll', game => { game.settings.market = true; }),
  makeCandidateFixture('pre-roll', (game, bot) => { game.pendingPayment = { playerId: bot.id, amountRemaining: 100 }; }),
  makeCandidateFixture('vote', game => { game.globalEvent = { phase: 'voting', choices: [{ id: 'low-tax', label: 'LOW TAX' }], votes: {} }; }),
  makeCandidateFixture('trade', (game, bot) => { game.pendingTrade = { id: 'coverage-trade', toPlayerId: bot.id, fromPlayerId: game.players[1].id, giveCash: 100, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [], counterDepth: 0 }; }),
  makeCandidateFixture('contract', (game, bot) => { game.pendingPlayerContract = { id: 'coverage-contract', fromPlayerId: game.players[1].id, toPlayerId: bot.id, kind: 'loan', amount: 100, premiumRate: 10, durationRounds: 2, counterDepth: 0 }; }),
  makeCandidateFixture('sponsorship', (game, bot) => { game.pendingSponsoredPurchase = { buyerId: bot.id, tileIndex: 1, price: 60, contributions: [{ sponsorId: game.players[1].id, amount: 60 }] }; }),
  makeCandidateFixture('payment', (game, bot) => { game.pendingPayment = { playerId: bot.id, amountRemaining: 100 }; })
];
for (const fixture of candidateFixtures) {
  assert.ok(collectCandidatesFromFixtures([fixture]).length > 0, `${fixture.phase} candidate fixture`);
}
const generatedCandidates = collectCandidatesFromFixtures(candidateFixtures);
assert.ok(generatedCandidates.length > 0);
for (const { snapshot: candidateSnapshot, candidate } of generatedCandidates) {
  const evaluation = evaluateCandidate(candidateSnapshot, candidate);
  assert.ok(['projected', 'neutral', 'unsupported'].includes(evaluation.projectionStatus), candidate.kind);
  if (evaluation.projectionStatus === 'unsupported') {
    assert.equal(evaluation.score, 0, `${candidate.kind} unsupported score`);
    assert.equal(evaluation.liquidity, null, `${candidate.kind} unsupported liquidity`);
  }
}

assert.equal(evaluateCandidate(snapshot, { id: 'finish', kind: 'end-turn' }).projectionStatus, 'neutral');
assert.equal(evaluateCandidate(snapshot, { id: 'finance-finish', kind: 'end-finance-window' }).projectionStatus, 'neutral');
assert.equal(evaluateCandidate(snapshot, { id: 'mystery', kind: 'future-kind' }).projectionStatus, 'unsupported');
assert.equal(evaluateCandidate(snapshot, { id: 'mystery', kind: 'future-kind' }).score, 0);
assert.equal(evaluateCandidate(snapshot, { id: 'market:invent', kind: 'market', instrumentId: 'brazil', side: 'invent', quantity: 1 }).projectionStatus, 'unsupported');
console.log('bot future planner: focused projection and candidate coverage checks passed');
