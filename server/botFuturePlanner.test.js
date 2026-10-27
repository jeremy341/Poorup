// Pure planning tests: the candidate evaluator must be deterministic and
// must never mutate the provider snapshot it receives.
import assert from 'node:assert/strict';
import { currentReserve, estimatedNetWorth, evaluateCandidate, planningHorizon, rankCandidates } from './botFuturePlanner.js';
import { dynamicReserve, forecastMaxHit } from './botDevelopmentForecast.js';
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

const mortgagedTradeSnapshot = {
  ...snapshot,
  board: snapshot.board.map(tile => tile.index === 1
    ? { ...tile, ownerSeat: 'opponent-1', mortgaged: true }
    : tile.index === 3 ? { ...tile, ownerSeat: 'bank' } : tile)
};
const mortgagedTradeForecast = evaluateCandidate(mortgagedTradeSnapshot, {
  id: 'trade:mortgaged-deed', kind: 'trade', requestPropertyIndexes: [1]
});
assert.equal(mortgagedTradeForecast.projectionStatus, 'projected');
assert.equal(mortgagedTradeForecast.expectedRent, 0, 'a transferred mortgage remains on the received deed in future forecasts');

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
const partialMarketSell = evaluateCandidate(sellSnapshot, { id: 'market:sell:brazil:one', kind: 'market', instrumentId: 'brazil', side: 'sell', quantity: 1 }, { difficulty: 'table', seed: 'same' });
// Holding a volatile position is charged its risk reserve in the baseline, so
// exiting it beats holding it; the exit is not charged the reserve on top.
const volatileHistory = [100, 140, 100, 140, 100, 140, 100].map((quote, index) => ({ round: index + 1, eventId: null, quotes: { brazil: quote } }));
const heldVolatile = {
  ...snapshot,
  marketQuotes: { brazil: 100 },
  marketQuoteHistory: volatileHistory,
  botState: { ...snapshot.botState, marketPositions: { brazil: { quantity: 2, averageCost: 100, realizedPnl: 0 } } }
};
const holdBaseline = evaluateCandidate(heldVolatile, { id: 'roll', kind: 'roll' }, { difficulty: 'table' });
const exitVolatile = evaluateCandidate(heldVolatile, { id: 'market:sell:brazil', kind: 'market', instrumentId: 'brazil', side: 'sell', quantity: 2 }, { difficulty: 'table' });
assert.ok(exitVolatile.score > holdBaseline.score, 'exiting a volatile holding scores above holding it');
// The server refuses every market order while a global event pauses trading,
// sells included, so a paused market projects nothing: no legal outcome exists.
const pausedMarket = { ...heldVolatile, rulesDigest: { ...heldVolatile.rulesDigest, globalEvents: { activeEffects: { tradingEnabled: false } } } };
for (const candidate of [
  { id: 'market:sell:brazil', kind: 'market', instrumentId: 'brazil', side: 'sell', quantity: 1 },
  { id: 'market:buy:brazil', kind: 'market', instrumentId: 'brazil', side: 'buy', quantity: 1 },
  { id: 'margin:brazil', kind: 'open-margin', instrumentId: 'brazil', quantity: 1 }
]) {
  const paused = evaluateCandidate(pausedMarket, candidate, { difficulty: 'table' });
  assert.equal(paused.projectionStatus, 'unsupported', `a paused market does not project ${candidate.id}`);
  assert.equal(paused.score, 0);
}
const marketBuySnapshot = { ...snapshot, marketQuotes: { brazil: 180 } };
const marketBuy = evaluateCandidate(marketBuySnapshot, { id: 'market:buy:brazil', kind: 'market', instrumentId: 'brazil', side: 'buy', quantity: 1 }, { difficulty: 'table', seed: 'same' });
const emptyPositionSell = evaluateCandidate(marketBuySnapshot, { id: 'market:sell:brazil', kind: 'market', instrumentId: 'brazil', side: 'sell', quantity: 1 }, { difficulty: 'table', seed: 'same' });
const missingQuoteSell = evaluateCandidate({ ...sellSnapshot, marketQuotes: {} }, { id: 'market:sell:brazil', kind: 'market', instrumentId: 'brazil', side: 'sell', quantity: 2 }, { difficulty: 'table', seed: 'same' });
const marketDowntrend = {
  ...sellSnapshot,
  marketQuotes: { brazil: 90 },
  marketQuoteHistory: [100, 95, 90].map((quote, index) => ({ round: index + 1, eventId: null, quotes: { brazil: quote } }))
};
const sellIntoDowntrend = evaluateCandidate(marketDowntrend, { id: 'market:sell:brazil', kind: 'market', instrumentId: 'brazil', side: 'sell', quantity: 2 }, { difficulty: 'table', seed: 'same' });
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
assert.equal(partialMarketSell.estimatedNetWorthDelta, -4, 'a partial sale retains the unsold units at the current quote and charges only the order fee');
assert.equal(emptyPositionSell.projectionStatus, 'unsupported', 'selling an empty position is not fabricated into a legal action');
assert.equal(missingQuoteSell.projectionStatus, 'unsupported', 'a missing quote never becomes a zero-price order');
assert.ok(sellIntoDowntrend.expectedMarketEdge > 0, 'downward market history makes reducing exposure more attractive');
assert.equal(marketBuy.estimatedNetWorthDelta, -4, 'a $180 holding offsets the $180 purchase; only the $4 fee reduces marked-to-market value');
assert.equal(marketSell.estimatedNetWorthDelta, -8, 'selling $360 of holdings for $352 cash loses only the $8 fee at the current quote');
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
assert.ok(Math.abs((multi.score - duelRisky.score) - 5) < 1e-9);
// Real purchase offers spend cash like buys (were evaluated as free).
const purchaseEval = evaluateCandidate(snapshot, { id: 'purchase:6', kind: 'purchase', tileIndex: 6, price: 100, risk: 0.2 }, { difficulty: 'table', seed: 'same' });
assert.equal(purchaseEval.liquidity, 400);
assert.equal(purchaseEval.estimatedNetWorthDelta, 0);
assert.equal(purchaseEval.policyVersion, 'no-ai-outcome-v2');
const loanNetWorth = evaluateCandidate(snapshot, { id: 'loan:net-worth', kind: 'loan', principal: 300, totalDue: 450 }, { difficulty: 'table' });
assert.equal(loanNetWorth.estimatedNetWorthDelta, -150);
// Liquidity target = dynamicReserve (live opponent hit plus one house). Two
// opponent Dark Blue deeds at two houses (traffic 90%) are a $675 hit, which
// must lift the target above the old $400 cap on half the hit.
const hitBoard = Array.from({ length: 40 }, (_, index) => ({ index, type: 'other', ownerSeat: 'bank', rent: 0, group: null, price: 0, houseCount: 0, mortgaged: false }));
hitBoard[37] = { index: 37, type: 'property', group: 'Dark Blue', ownerSeat: 'opponent-1', price: 400, rent: 50, houseCount: 2, mortgaged: false };
hitBoard[39] = { index: 39, type: 'property', group: 'Dark Blue', ownerSeat: 'opponent-1', price: 400, rent: 50, houseCount: 2, mortgaged: false };
assert.equal(forecastMaxHit(hitBoard), 675);
assert.equal(currentReserve({ ...snapshot, board: hitBoard }), dynamicReserve(hitBoard), 'liquidity target follows dynamicReserve');
assert.equal(currentReserve({ ...snapshot, board: hitBoard }), 775, 'the target covers the $675 live hit plus one $100 house');
// Houses are worth their resale value (half the Brown house cost of $50) to the
// bot: building books only the half that is lost, and selling at resale is
// net-worth neutral.
const houseBuild = evaluateCandidate(snapshot, { id: 'build:1', kind: 'build', tileIndex: 1, cost: 50, risk: 0.1 }, { difficulty: 'table' });
assert.equal(houseBuild.estimatedNetWorthDelta, -25, 'a $50 house is a $25 loss at resale');
const builtSnapshot = { ...snapshot, board: snapshot.board.map(tile => tile.index === 1 ? { ...tile, houseCount: 1 } : tile) };
const houseSale = evaluateCandidate(builtSnapshot, { id: 'sell:1', kind: 'sell', tileIndex: 1, proceeds: 25 }, { difficulty: 'table' });
assert.equal(houseSale.estimatedNetWorthDelta, 0, 'selling a house at resale leaves net worth unchanged');
assert.equal(builtSnapshot.board.find(tile => tile.index === 1).houseCount, 1, 'projecting a sale never edits the provider snapshot');
const mortgagedSnapshot = { ...snapshot, board: snapshot.board.map(tile => tile.index === 1 ? { ...tile, mortgaged: true } : tile) };
evaluateCandidate(mortgagedSnapshot, { id: 'unmortgage:1', kind: 'unmortgage', tileIndex: 1, cost: 33 }, { difficulty: 'table' });
assert.equal(mortgagedSnapshot.board.find(tile => tile.index === 1).mortgaged, true, 'projecting an unmortgage never edits the provider snapshot');
// Roulette pays 1:1 on colours (18 of 37 pockets) and 35:1 on green, so a bet's
// expected cost is stake/37 plus the entry fee, not the full stake.
const casinoEntry = { ...snapshot, rulesDigest: { ...snapshot.rulesDigest, casino: { entryFee: 5 } } };
const casinoBet = evaluateCandidate(casinoEntry, { id: 'casino:red:370', kind: 'casino', color: 'red', stake: 370 }, { difficulty: 'table' });
assert.equal(casinoBet.estimatedNetWorthDelta, -15, 'a $370 bet costs its $10 house edge plus the $5 entry fee in expectation');
assert.equal(casinoBet.liquidity, 485, 'expected cash after the spin keeps the house edge, not the full stake');

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
// A jailed actor escapes only on a double: all six doubles (2,4,...,12) are
// enumerated, so the escape mass is 1/6. From 30, the 10 and 12 doubles pass
// Start: 200 * 2/36 of expected cash flow (dropping odd doubles gave 200/36).
const jailEscapeBoard = Array.from({ length: 40 }, (_, index) => ({ index, type: 'other', ownerSeat: 'bank', rent: 0 }));
const jailEscapeSnapshot = {
  ...rentSnapshot,
  board: jailEscapeBoard,
  opponents: [],
  botState: { ...rentSnapshot.botState, position: 30, cash: 500, inJail: true, jailTurns: 0, jailFreeCards: 0 },
  rulesDigest: { ...rentSnapshot.rulesDigest, jailFine: 50, doubleGo: false, globalEvents: { activeEffects: {} } }
};
assert.ok(Math.abs(evaluateCandidate(jailEscapeSnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table' }).expectedCashFlow - 400 / 36) < 1e-9, 'jail escape enumerates every double');

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
// Double-rent railroad card under a rent cap: the engine doubles the table rent
// and then applies the cap once (cardApi.cardRentAmount). The forecast must
// price the same amount; capping first and doubling after overstated it.
function railroadCardParity(capped) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: `socket-rr-${capped}`, clientId: `client-rr-${capped}`, nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: `socket-rr-b-${capped}`, clientId: `client-rr-b-${capped}`, nickname: 'Bob' });
  const game = room.game;
  game.tiles[15].ownerId = game.players[1].id;
  game.globalEvent = { id: 'custom', phase: 'active', effects: capped ? { rentCap: 30 } : {} };
  const engineAmount = game.cardRentAmount(game.getTile(15), { action: 'nearestRailroad', multiplier: 2 }, 'railroad');
  const parityBoard = Array.from({ length: 40 }, (_, index) => ({ index, type: 'other', ownerSeat: 'bank', group: null, price: 0, rent: 0, houseCount: 0, mortgaged: false }));
  parityBoard[2] = { index: 2, type: 'chance', ownerSeat: 'bank', group: null, price: 0, rent: 0, houseCount: 0, mortgaged: false };
  parityBoard[15] = { index: 15, type: 'railroad', ownerSeat: 'opponent-1', group: null, price: 200, rent: 25, houseCount: 0, mortgaged: false };
  const paritySnapshot = {
    ...rentSnapshot,
    board: parityBoard,
    opponents: [{ seat: 'opponent-1', position: 0, inJail: false }],
    rulesDigest: {
      ...rentSnapshot.rulesDigest,
      doubleRent: false,
      globalEvents: { activeEffects: capped ? { rentCap: 30 } : {} },
      cards: { surpriseCount: 1, surpriseExpectedCash: 0, surpriseMovement: [{ action: 'nearestRailroad', count: 1, multiplier: 2 }] }
    }
  };
  // Only the move of 2 (1/36) lands on the chance tile, and its one card goes to the railroad.
  const forecastAmount = evaluateCandidate(paritySnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table' }).expectedRisk * 36;
  return { engineAmount, forecastAmount };
}
const cappedRailroad = railroadCardParity(true);
assert.equal(cappedRailroad.engineAmount, 30, 'engine: double the $25 railroad rent, then cap at $30');
assert.ok(Math.abs(cappedRailroad.forecastAmount - cappedRailroad.engineAmount) < 1e-9, 'capped double-rent card: forecast equals the engine');
const uncappedRailroad = railroadCardParity(false);
assert.equal(uncappedRailroad.engineAmount, 50);
assert.ok(Math.abs(uncappedRailroad.forecastAmount - uncappedRailroad.engineAmount) < 1e-9, 'uncapped double-rent card: forecast equals the engine');

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

// Marginal scoring: standing still is the zero baseline. A build that only
// loses value on a monopoly (nwDelta -50 at resale) and a market buy that
// loses its expected move must both rank below the neutral end-turn; before,
// absolute group and liquidity terms made them look positive against 0.
const orangeBoard = Array.from({ length: 40 }, (_, index) => ({ index, type: 'other', ownerSeat: 'bank', rent: 0, group: null, price: 0, houseCount: 0, mortgaged: false }));
for (const index of [11, 13, 14]) orangeBoard[index] = { index, type: 'property', group: 'Orange', price: 180, rent: 18, ownerSeat: 'self', houseCount: 0, mortgaged: false };
const orangeSnapshot = { ...snapshot, board: orangeBoard, botState: { ...snapshot.botState, cash: 1000 } };
const standStill = evaluateCandidate(orangeSnapshot, { id: 'roll', kind: 'roll' }, { difficulty: 'table', seed: 'orange' });
assert.equal(standStill.score, 0, 'the stand-still baseline is zero by definition');
const orangeBuild = evaluateCandidate(orangeSnapshot, { id: 'build:11', kind: 'build', tileIndex: 11, cost: 100, risk: 0.1 }, { difficulty: 'table', seed: 'orange' });
assert.ok(orangeBuild.score < 0, 'a build that only loses value scores below standing still');
const orangeRanking = rankCandidates(orangeSnapshot, [
  { id: 'build:11', kind: 'build', tileIndex: 11, cost: 100, risk: 0.1 },
  { id: 'end-turn', kind: 'end-turn' }
], { difficulty: 'table', seed: 'orange' });
assert.equal(orangeRanking[0].candidate.id, 'end-turn', 'the neutral end-turn beats a negative-marginal build');
const marketLoss = { ...marketBuySnapshot, marketQuoteHistory: [100, 95, 90, 85].map((quote, index) => ({ round: index + 1, eventId: null, quotes: { brazil: quote } })), marketQuotes: { brazil: 85 } };
const falling = evaluateCandidate(marketLoss, { id: 'market:buy:brazil', kind: 'market', instrumentId: 'brazil', side: 'buy', quantity: 1 }, { difficulty: 'table', seed: 'falling' });
assert.ok(falling.score < 0, 'buying into a falling market loses to standing still');
assert.equal(evaluateCandidate(snapshot, { id: 'finish', kind: 'end-turn' }).projectionStatus, 'neutral');
assert.equal(evaluateCandidate(snapshot, { id: 'finance-finish', kind: 'end-finance-window' }).projectionStatus, 'neutral');
assert.equal(evaluateCandidate(snapshot, { id: 'mystery', kind: 'future-kind' }).projectionStatus, 'unsupported');
assert.equal(evaluateCandidate(snapshot, { id: 'mystery', kind: 'future-kind' }).score, 0);
assert.equal(evaluateCandidate(snapshot, { id: 'market:invent', kind: 'market', instrumentId: 'brazil', side: 'invent', quantity: 1 }).projectionStatus, 'unsupported');

// --- portfolio accounting: held options, equity contracts, event houses ---

// A held option is an asset: the planner has to carry it at its intrinsic
// value, or exercising one looks like money out of nowhere.
const optionSnapshot = {
  ...snapshot,
  roundNumber: 3,
  marketQuotes: { brazil: 150 },
  botState: {
    ...snapshot.botState,
    cash: 500,
    marketExpansion: {
      options: [{ id: 'o1', instrumentId: 'brazil', role: 'holder', side: 'call', strike: 100, quantity: 2, reserveHeld: 100, expiryRound: 5, status: 'open' }]
    }
  }
};
const exerciseHeldOption = evaluateCandidate(optionSnapshot, { id: 'exercise-option:o1', kind: 'exercise-option', optionId: 'o1' }, { difficulty: 'table' });
assert.equal(exerciseHeldOption.liquidity, 600, 'the payout is credited');
assert.equal(exerciseHeldOption.estimatedNetWorthDelta, 0, 'exercising an option turns an asset into cash, it does not create value');
const closeHeldOption = evaluateCandidate(optionSnapshot, { id: 'close-position:o1', kind: 'close-position', optionId: 'o1' }, { difficulty: 'table' });
assert.equal(closeHeldOption.liquidity, 580, 'closing pays 80% of the intrinsic value');
assert.equal(closeHeldOption.estimatedNetWorthDelta, -20, 'closing an option pays 80% of what it was worth');
// An option with no exercise value is refused by the engine, so the planner
// must not project it as a legal action either.
const worthlessOptionSnapshot = {
  ...optionSnapshot,
  marketQuotes: { brazil: 90 }
};
assert.equal(
  evaluateCandidate(worthlessOptionSnapshot, { id: 'exercise-option:o1', kind: 'exercise-option', optionId: 'o1' }, { difficulty: 'table' }).projectionStatus,
  'unsupported',
  'an option with no exercise value cannot be exercised'
);

// An equity contract carries no principal: it is a share of a property's
// rent, not a loan, so it is neither a receivable nor a debt.
const equityPortfolio = {
  cash: 1000,
  board: snapshot.board,
  marketPositions: {},
  marketExpansion: { options: [] },
  contracts: [{ id: 'eq1', kind: 'equity', role: 'lender', status: 'active', amount: 1000, remaining: 0 }],
  bankLoan: null,
  shortDefaultDebt: 0
};
assert.equal(estimatedNetWorth(equityPortfolio, 0.5, snapshot), 1120, 'an equity contract is not an asset');
// A defaulted contract leaves the books, but the principal it still owes
// does not disappear with it, and a defaulted bank loan keeps its balance
// until the bank is paid.
const defaultedPortfolio = {
  ...equityPortfolio,
  contracts: [{ id: 'c2', kind: 'loan', role: 'borrower', status: 'defaulted', amount: 300, remaining: 300 }]
};
assert.equal(estimatedNetWorth(defaultedPortfolio, 0.5, snapshot), 1000 + 120 - 300, 'a defaulted contract the seat owes stays a debt');
const defaultedLoanPortfolio = { ...equityPortfolio, contracts: [], bankLoan: { status: 'defaulted', remaining: 200 } };
assert.equal(estimatedNetWorth(defaultedLoanPortfolio, 0.5, snapshot), 1000 + 120 - 200, 'a defaulted bank loan still owes its balance');
const equitySnapshot = { ...snapshot, botState: { ...snapshot.botState, cash: 1000, contracts: equityPortfolio.contracts } };
const equityRepay = evaluateCandidate(equitySnapshot, { id: 'repay:eq1', kind: 'repay', contractId: 'eq1', amount: 1000 }, { difficulty: 'table' });
assert.equal(equityRepay.projectionStatus, 'unsupported', 'an equity contract has no principal to repay');
const loanProposal = evaluateCandidate(equitySnapshot, { id: 'contract:loan:o1', kind: 'contract-propose', offer: { kind: 'loan', amount: 1000 } }, { difficulty: 'table' });
assert.equal(loanProposal.estimatedNetWorthDelta, 0, 'a loan contract is a receivable while it is pending');
const equityProposal = evaluateCandidate(equitySnapshot, { id: 'contract:equity:o1', kind: 'contract-propose', offer: { kind: 'equity', amount: 1000 } }, { difficulty: 'table' });
assert.equal(equityProposal.estimatedNetWorthDelta, -1000, 'an equity contract is not a receivable');

// The engine builds at the event-adjusted house cost and sells a house back
// at the sale multiplier of that cost, so a house is worth more than the
// static table during a cost-raising event.
const bubbleSnapshot = {
  ...snapshot,
  rulesDigest: { ...snapshot.rulesDigest, globalEvents: { activeEffects: { buildingCostMultiplier: 2, buildingSaleMultiplier: 0.4 } } }
};
const bubbleBuild = evaluateCandidate(bubbleSnapshot, { id: 'build:1', kind: 'build', tileIndex: 1, cost: 100 }, { difficulty: 'table' });
assert.equal(bubbleBuild.estimatedNetWorthDelta, -60, 'the house is worth floor(50 x 2 x 0.4) = 40 at resale');

// --- live seats: bankrupt and disconnected seats are out of the game ---

const rentOpponentBoard = Array.from({ length: 40 }, (_, index) => ({ index, type: 'other', ownerSeat: 'bank', rent: 0 }));
rentOpponentBoard[10] = { index: 10, type: 'property', group: 'Brown', ownerSeat: 'self', rent: 10, houseCount: 0, mortgaged: false };
const liveOpponentSnapshot = { ...snapshot, board: rentOpponentBoard, opponents: [{ seat: 'opponent-1', position: 5 }] };
const bankruptOpponentSnapshot = { ...snapshot, board: rentOpponentBoard, opponents: [{ seat: 'opponent-1', position: 5, bankrupt: true }] };
const disconnectedOpponentSnapshot = { ...snapshot, board: rentOpponentBoard, opponents: [{ seat: 'opponent-1', position: 5, disconnected: true }] };
const emptyTableSnapshot = { ...snapshot, board: rentOpponentBoard, opponents: [] };
const rollCandidate = { id: 'roll', kind: 'roll' };
assert.ok(evaluateCandidate(liveOpponentSnapshot, rollCandidate, { difficulty: 'table' }).expectedRent > 0, 'a live opponent pays rent');
assert.equal(evaluateCandidate(bankruptOpponentSnapshot, rollCandidate, { difficulty: 'table' }).expectedRent, 0, 'a bankrupt opponent pays no rent');
assert.equal(evaluateCandidate(disconnectedOpponentSnapshot, rollCandidate, { difficulty: 'table' }).expectedRent, 0, 'a disconnected opponent pays no rent');
assert.equal(
  evaluateCandidate(disconnectedOpponentSnapshot, rollCandidate, { difficulty: 'table' }).score,
  evaluateCandidate(emptyTableSnapshot, rollCandidate, { difficulty: 'table' }).score,
  'a disconnected seat is not part of the table'
);

// --- the jail fine: a cash cost, due on the limit turn, only if it can be paid ---

const jailFineSnapshot = {
  ...snapshot,
  board: Array.from({ length: 40 }, (_, index) => ({ index, type: 'other', ownerSeat: 'bank', rent: 0 })),
  botState: { ...snapshot.botState, cash: 500, position: 10, inJail: true, jailTurns: 2 },
  opponents: [],
  rulesDigest: { ...snapshot.rulesDigest, jailFine: 50, jailMaxTurns: 3, doubleGo: false }
};
const jailFineTurn = evaluateCandidate(jailFineSnapshot, rollCandidate, { difficulty: 'table' });
assert.ok(Math.abs(jailFineTurn.expectedFine - 50 * 30 / 36) < 1e-9, 'the fine is due on every failed roll that reaches the limit');
assert.equal(jailFineTurn.expectedRisk, 0, 'the jail fine is a cash cost, not rent risk');
const brokeJailSnapshot = { ...jailFineSnapshot, botState: { ...jailFineSnapshot.botState, cash: 10 } };
assert.equal(evaluateCandidate(brokeJailSnapshot, rollCandidate, { difficulty: 'table' }).expectedFine, 0, 'a seat that cannot pay the fine stays in jail');

// --- auction escrow: the leading bid is reserved cash ---

const escrowSnapshot = {
  ...snapshot,
  botState: { ...snapshot.botState, cash: 500, marketExpansion: { shortDefaultDebt: 200 } },
  obligations: { auction: { tileIndex: 5, highestBid: 400, highestBidderSeat: 'self', participantCount: 2 } }
};
const settleCandidate = { id: 'settle-short-default', kind: 'settle-short-default', amount: 200 };
assert.equal(evaluateCandidate(escrowSnapshot, settleCandidate, { difficulty: 'table' }).liquidity, 400, 'only the cash outside the reserved bid can pay the buy-in debt');
assert.equal(evaluateCandidate({ ...escrowSnapshot, obligations: {} }, settleCandidate, { difficulty: 'table' }).liquidity, 300, 'without a reserved bid the whole debt can be paid');

// --- the liquidity target covers the rent the engine would actually charge ---

const uncappedHitSnapshot = { ...snapshot, board: hitBoard, rulesDigest: { ...snapshot.rulesDigest, globalEvents: { activeEffects: {} } } };
assert.equal(currentReserve(uncappedHitSnapshot), 775, 'without a modifier the full $675 hit is covered');
const cappedHitSnapshot = { ...snapshot, board: hitBoard, rulesDigest: { ...snapshot.rulesDigest, globalEvents: { activeEffects: { rentCap: 300 } } } };
assert.equal(currentReserve(cappedHitSnapshot), 370, 'the rent cap lowers the covered hit');
const boostedHitSnapshot = {
  ...snapshot,
  board: hitBoard,
  activeEvent: { id: 'custom', phase: 'active', effects: { rentMultiplier: 1.2 } },
  rulesDigest: { ...snapshot.rulesDigest, globalEvents: { activeEffects: { rentMultiplier: 1.2 } } }
};
assert.equal(currentReserve(boostedHitSnapshot), 910, 'the event rent modifier raises the covered hit');

console.log('bot future planner: focused projection and candidate coverage checks passed');
