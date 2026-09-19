// Unit tests for the shared deterministic trade valuation core.
// Every assertion pins a Jev-guided parameter choice: quadratic progress
// credit, 2x monopoly premium constant, flat traffic tiers, 1-house
// build-readiness threshold.
import assert from 'node:assert/strict';
import {
  MONOPOLY_PREMIUM_NUM,
  MONOPOLY_PREMIUM_DEN,
  deedValue,
  progressCredit,
  ownedInGroup,
  monopolyGiveaway,
  vetoTrade,
} from './botTradeValuation.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const TILES = {
  1: { index: 1, price: 60, group: 'Brown', ownerId: 'H' },
  3: { index: 3, price: 60, group: 'Brown', ownerId: 'BOT' },
  16: { index: 16, price: 180, group: 'Orange', ownerId: 'H' },
  18: { index: 18, price: 180, group: 'Orange', ownerId: null },
  19: { index: 19, price: 200, group: 'Orange', ownerId: null },
};

function fakeGame(cashH = 1500) {
  const players = { H: { id: 'H', cash: cashH }, BOT: { id: 'BOT', cash: 500 } };
  return {
    tiles: Object.values(TILES),
    getTile: index => TILES[index] || null,
    getGroupTiles: group => Object.values(TILES).filter(tile => tile.group === group),
    getPlayerById: id => players[id] || null,
    getPropertyHouseCost: tile => (tile?.group === 'Orange' ? 100 : 50),
  };
}

check('monopoly premium constant is 2x face', () => {
  assert.equal(MONOPOLY_PREMIUM_NUM / MONOPOLY_PREMIUM_DEN, 2);
});

check('deedValue applies flat traffic tiers', () => {
  const game = fakeGame();
  assert.equal(deedValue(game, TILES[16]), 234); // 180 * 130%
  assert.equal(deedValue(game, TILES[1]), 57); // 60 * 95%
  assert.equal(deedValue(game, { index: 9, price: 100 }), 100); // no group: face
});

check('progressCredit is quadratic: completer worth most', () => {
  const game = fakeGame();
  const first = progressCredit(game, 'Brown', 0, 1);
  const completer = progressCredit(game, 'Brown', 1, 2);
  assert.equal(first, 28); // 114 * 1/4
  assert.equal(completer, 85); // 114 * 3/4
  assert.ok(completer > first * 2);
  assert.equal(progressCredit(game, 'Brown', 1, 1), 0);
});

check('ownedInGroup counts deeds', () => {
  assert.deepEqual(ownedInGroup(fakeGame(), 'H', 'Brown'), { owned: 1, total: 2 });
  assert.deepEqual(ownedInGroup(fakeGame(), 'H', 'Orange'), { owned: 1, total: 3 });
});

check('monopolyGiveaway detects completion and build-readiness', () => {
  const rich = monopolyGiveaway(fakeGame(1500), [3], 'H');
  assert.equal(rich.givesMonopoly, true);
  assert.equal(rich.buildReady, true);
  assert.deepEqual(rich.groups, [{ group: 'Brown', before: 1, after: 2, total: 2 }]);
  const poor = monopolyGiveaway(fakeGame(0), [3], 'H');
  assert.equal(poor.givesMonopoly, true);
  assert.equal(poor.buildReady, false);
  const noComplete = monopolyGiveaway(fakeGame(1500), [18], 'H');
  assert.equal(noComplete.givesMonopoly, false);
  assert.equal(monopolyGiveaway(fakeGame(), [], 'H').givesMonopoly, false);
});

check('vetoTrade fires only on build-ready giveaways', () => {
  const trade = {
    fromPlayerId: 'H', toPlayerId: 'BOT',
    giveCash: 0, givePropertyIndexes: [16],
    requestCash: 0, requestPropertyIndexes: [3],
  };
  const vetoed = vetoTrade(fakeGame(1500), trade, 'BOT');
  assert.equal(vetoed.vetoed, true);
  assert.equal(vetoed.reasonCode, 'veto-monopoly-build-ready');
  assert.equal(vetoTrade(fakeGame(0), trade, 'BOT').vetoed, false);
  // Legacy shapes without player ids never veto (pinned behavior preserved).
  assert.equal(vetoTrade(fakeGame(), { giveCash: 1, requestCash: 0 }, 'BOT').vetoed, false);
  assert.equal(vetoTrade(null, trade, 'BOT').vetoed, false);
});

console.log(`botTradeValuation tests: ${passed} passed, 0 failed`);
