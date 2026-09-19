// Unit tests for multi-turn development planning math.
import assert from 'node:assert/strict';
import {
  rentAtLevel,
  houseDeltaPerCircuit,
  buildPaybackRounds,
  groupBuildPlan,
  bestBuildTarget,
  groupGainToThree,
  bestGainGroup,
  forecastMaxHit,
  developmentStage,
  dynamicReserve,
} from './botDevelopmentForecast.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// Brown-1: price 60, base rent 10. Orange-16: price 180, base rent 14.
const BOARD = [
  { index: 1, group: 'Brown', ownerSeat: 'self', rent: 10, houseCount: 0, mortgaged: false, price: 60 },
  { index: 3, group: 'Brown', ownerSeat: 'self', rent: 10, houseCount: 0, mortgaged: false, price: 60 },
  { index: 16, group: 'Orange', ownerSeat: 'self', rent: 14, houseCount: 0, mortgaged: false, price: 180 },
  { index: 18, group: 'Orange', ownerSeat: 'self', rent: 14, houseCount: 1, mortgaged: false, price: 180 },
  { index: 19, group: 'Orange', ownerSeat: 'self', rent: 16, houseCount: 0, mortgaged: false, price: 200 },
  { index: 37, group: 'Dark Blue', ownerSeat: 'opponent-1', rent: 35, houseCount: 4, mortgaged: false, price: 400 },
  { index: 39, group: 'Dark Blue', ownerSeat: 'opponent-1', rent: 50, houseCount: 0, mortgaged: true, price: 400 },
];
const costOf = () => 100;

check('rent scales by house level multipliers', () => {
  assert.equal(rentAtLevel({ rent: 10 }, 0), 10);
  assert.equal(rentAtLevel({ rent: 10 }, 1), 50);
  assert.equal(rentAtLevel({ rent: 10 }, 9), rentAtLevel({ rent: 10 }, 5));
});

check('build payback ranks Orange above Brown', () => {
  const brownDelta = houseDeltaPerCircuit({ rent: 10, houseCount: 0, group: 'Brown' });
  const orangeDelta = houseDeltaPerCircuit({ rent: 14, houseCount: 0, group: 'Orange' });
  assert.equal(brownDelta, 38); // (50-10) * 95%
  assert.equal(orangeDelta, 72); // (70-14) * 130%
  assert.ok(orangeDelta > brownDelta);
  assert.equal(buildPaybackRounds({ rent: 10, houseCount: 0, group: 'Brown' }, 50), 2);
  assert.equal(buildPaybackRounds({ rent: 14, houseCount: 1, group: 'Orange' }, 100), 1);
  assert.equal(buildPaybackRounds({ rent: 10, houseCount: 5, group: 'Brown' }, 50), Number.MAX_SAFE_INTEGER);
});

check('group plan prices the road to 3 houses', () => {
  const plan = groupBuildPlan(BOARD, 'Brown', costOf);
  assert.deepEqual(plan, { group: 'Brown', cost: 600, gainPerCircuit: 836, paybackRounds: 1 });
  assert.equal(groupBuildPlan(BOARD, 'Dark Blue', costOf), null); // not ours
});

check('best target concentrates on highest ROI set', () => {
  const best = bestBuildTarget(BOARD, costOf);
  assert.equal(best.group, 'Orange');
});

check('gain-to-3 needs no cost data', () => {
  const brown = groupGainToThree(BOARD, 'Brown');
  assert.equal(brown.housesNeeded, 6);
  assert.ok(brown.gainPerCircuit > 0);
  assert.equal(groupGainToThree(BOARD, 'Dark Blue'), null);
  assert.equal(bestGainGroup(BOARD).group, 'Orange');
});

check('forecast sees the developed hotel threat, ignores mortgaged', () => {
  // Dark Blue-37 at 4 houses: 35*80=2800, tier 90% -> 2520.
  assert.equal(forecastMaxHit(BOARD), 2520);
  assert.equal(forecastMaxHit([]), 0);
});

check('stage follows development facts', () => {
  assert.equal(developmentStage([]), 'early');
  assert.equal(developmentStage(BOARD.filter(tile => tile.ownerSeat === 'self')), 'mid');
  assert.equal(developmentStage(BOARD), 'late');
});

check('dynamic reserve covers the gauntlet within bounds', () => {
  assert.equal(dynamicReserve([], 100), 120);
  assert.equal(dynamicReserve(BOARD, 100), 1000);
  assert.ok(dynamicReserve(BOARD, 100) >= 120);
});

console.log(`botDevelopmentForecast tests: ${passed} passed, 0 failed`);
