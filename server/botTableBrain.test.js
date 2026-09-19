// Unit tests for the table-wide strategic brain.
import assert from 'node:assert/strict';
import {
  netWorth,
  standings,
  threatPerCircuit,
  threatMatrix,
  nearCompleteGroups,
  winPath,
  kingmakerState,
  endgameClock,
  solveEndgame,
  tableBrain,
} from './botTableBrain.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const TILES = {
  1: { index: 1, price: 60, rent: 10, group: 'Brown', type: 'property', ownerId: 'A', houseCount: 0, mortgaged: false },
  3: { index: 3, price: 60, rent: 10, group: 'Brown', type: 'property', ownerId: 'B', houseCount: 0, mortgaged: false },
  16: { index: 16, price: 180, rent: 14, group: 'Orange', type: 'property', ownerId: 'A', houseCount: 2, mortgaged: false },
  18: { index: 18, price: 180, rent: 14, group: 'Orange', type: 'property', ownerId: 'A', houseCount: 2, mortgaged: false },
  19: { index: 19, price: 200, rent: 16, group: 'Orange', type: 'property', ownerId: null, houseCount: 0, mortgaged: false },
  37: { index: 37, price: 400, rent: 35, group: 'Dark Blue', type: 'property', ownerId: 'C', houseCount: 4, mortgaged: false },
};

function fakeGame() {
  const players = [
    { id: 'A', cash: 1500, properties: [1, 16, 18], bankLoan: null, bankrupt: false, disconnected: false },
    { id: 'B', cash: 200, properties: [3], bankLoan: { remaining: 100 }, bankrupt: false, disconnected: false },
    { id: 'C', cash: 3000, properties: [37], bankrupt: false, disconnected: false },
  ];
  return {
    tiles: Object.values(TILES),
    players,
    getTile: index => TILES[index] || null,
    getGroupTiles: group => Object.values(TILES).filter(tile => tile.group === group),
    getPropertyHouseCost: tile => (tile?.group === 'Orange' ? 100 : tile?.group === 'Dark Blue' ? 200 : 50),
  };
}

check('net worth counts cash, deeds, houses at half, minus debts', () => {
  const game = fakeGame();
  const a = game.players[0];
  // 1500 + 60 + 180 + 180 + houses(4 * 100 * 0.5) = 2120
  assert.equal(netWorth(game, a), 2120);
  const b = game.players[1];
  // 200 + 60 - 100 = 160
  assert.equal(netWorth(game, b), 160);
  assert.equal(netWorth(game, null), 0);
});

check('standings rank richest first', () => {
  const table = standings(fakeGame()).map(entry => entry.id);
  assert.deepEqual(table, ['C', 'A', 'B']);
});

check('threat matrix prices developed deeds, ignores bank', () => {
  const game = fakeGame();
  // C hotel-ish Dark Blue: floor(35*80 * 90/100 / 40) = floor(63) = 63
  assert.equal(threatPerCircuit(game, 'A', 'C'), 63);
  const matrix = threatMatrix(game, 'B').map(entry => entry.id);
  assert.equal(matrix[0], 'C');
});

check('near-complete groups spot one-away sets', () => {
  const groups = nearCompleteGroups(fakeGame(), 'A').map(entry => entry.group);
  assert.ok(groups.includes('Brown'));
  assert.ok(groups.includes('Orange'));
});

check('win path names nearest completion and reserve', () => {
  const path = winPath(fakeGame(), 'B');
  assert.equal(path.target.group, 'Brown');
  assert.deepEqual(path.target.missingIndexes, [1]);
  assert.ok(path.reserve >= 120);
  assert.equal(path.topThreat, 'C');
});

check('spoiler mode triggers at 2x leader gap with 3 seats', () => {
  const state = kingmakerState(fakeGame(), 'B');
  assert.equal(state.spoiler, true);
  assert.equal(state.target, 'C');
  assert.equal(kingmakerState(fakeGame(), 'C').spoiler, false);
});

check('endgame clock fires at two seats', () => {
  assert.equal(endgameClock(fakeGame()).endgame, false);
  const game = fakeGame();
  game.players[2].bankrupt = true;
  assert.equal(endgameClock(game).endgame, true);
});

check('endgame solver projects the rent war', () => {
  assert.equal(solveEndgame(fakeGame(), 'A'), null); // 3 seats
  const duel = fakeGame();
  duel.players = duel.players.filter(player => player.id !== 'B');
  const solved = solveEndgame(duel, 'A');
  assert.equal(solved.win, false); // C's hotel outguns A
  assert.ok(solved.margin > 0);
  assert.ok(Number.isFinite(solved.circuitsToRuin));
});

check('full report composes rank, threats, path, kingmaker, clock', () => {
  const report = tableBrain(fakeGame(), 'A');
  assert.equal(report.rank, 2);
  assert.equal(report.seats, 3);
  assert.ok(Array.isArray(report.threats));
  assert.ok(report.path && report.kingmaker && report.clock);
});

console.log(`botTableBrain tests: ${passed} passed, 0 failed`);
