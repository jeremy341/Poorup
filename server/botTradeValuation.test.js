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
  monopolyRequirement,
  tradeSetChanges,
  portfolioValue,
} from './botTradeValuation.js';
import { unmortgageCostFor } from './propertyRules.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const TILES = {
  1: { index: 1, price: 60, group: 'Brown', ownerId: 'H', rent: 10, houseCount: 0 },
  3: { index: 3, price: 60, group: 'Brown', ownerId: 'BOT', rent: 10, houseCount: 0 },
  16: { index: 16, price: 180, group: 'Orange', ownerId: 'H', rent: 14, houseCount: 0 },
  18: { index: 18, price: 180, group: 'Orange', ownerId: null, rent: 14, houseCount: 0 },
  19: { index: 19, price: 200, group: 'Orange', ownerId: null, rent: 16, houseCount: 0 },
};

function fakeGame(cashH = 1500, valueMultiplier = 1) {
  const players = { H: { id: 'H', cash: cashH }, BOT: { id: 'BOT', cash: 500 } };
  return {
    tiles: Object.values(TILES),
    getTile: index => TILES[index] || null,
    getGroupTiles: group => Object.values(TILES).filter(tile => tile.group === group),
    getPlayerById: id => players[id] || null,
    propertyValueMultiplier: () => valueMultiplier,
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

check('mortgaged property and railroad values deduct only canonical redemption cost', () => {
  const game = fakeGame();
  assert.equal(deedValue(game, { ...TILES[1], mortgaged: true }), 57 - unmortgageCostFor(60));
  assert.equal(deedValue(game, { price: 200, type: 'railroad', mortgaged: true }), 200 - unmortgageCostFor(200));
  const eventGame = fakeGame(1500, 1.5);
  assert.equal(deedValue(eventGame, { price: 200, type: 'railroad', mortgaged: true }), 200 - unmortgageCostFor(200, 1.5));
  assert.equal(deedValue(fakeGame(1500, 2), { ...TILES[1], mortgaged: true }), 0, 'redemption cost cannot push the deed valuation below zero');
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

check('monopolyGiveaway nets the receiver\'s own deeds of the group going back', () => {
  // H owns Brown 1; BOT hands over Brown 3 but takes Brown 1 back: nobody completes anything.
  assert.equal(monopolyGiveaway(fakeGame(1500), [3], 'H', [1]).givesMonopoly, false);
  assert.equal(monopolyGiveaway(fakeGame(1500), [3], 'H', [16]).givesMonopoly, true, 'a deed of another group does not net out');
});

check('monopolyRequirement prices the completer at the 2x premium', () => {
  const req = monopolyRequirement(fakeGame(0), [3], [], 'H');
  assert.equal(req.givesMonopoly, true);
  assert.equal(req.requiredValue, 114);
  assert.equal(req.needCash, 114);
  assert.equal(monopolyRequirement(fakeGame(0), [3], [16], 'H').needCash, -120, 'incoming deeds count as payment (234 - 114 overpays)');
  assert.equal(monopolyRequirement(fakeGame(0), [18], [], 'H').needCash, 0, 'no completion, no premium');
});

check('tradeSetChanges reports sets a seat completes or breaks', () => {
  // BOT owns Brown 3 only; H owns Brown 1 and Orange 16.
  assert.deepEqual(tradeSetChanges(fakeGame(), 'H', [16], [3]), { completes: ['Brown'], breaks: [] });
  const game = fakeGame();
  TILES[1].ownerId = 'BOT';
  try {
    assert.deepEqual(tradeSetChanges(game, 'BOT', [3], [16]), { completes: [], breaks: ['Brown'] });
  } finally {
    TILES[1].ownerId = 'H';
  }
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

check('vetoTrade fires on any uncompensated set completion, whatever the buyer holds', () => {
  const trade = {
    fromPlayerId: 'H', toPlayerId: 'BOT',
    giveCash: 0, givePropertyIndexes: [],
    requestCash: 0, requestPropertyIndexes: [3],
  };
  const vetoed = vetoTrade(fakeGame(1500), trade, 'BOT');
  assert.equal(vetoed.vetoed, true);
  assert.equal(vetoed.reasonCode, 'veto-monopoly-build-ready');
  // Audit finding 5: the old rule needed cash >= one house, so a $0 buyer sailed through.
  assert.equal(vetoTrade(fakeGame(0), trade, 'BOT').vetoed, true, 'the buyer\'s cash is no longer a loophole');
  // Paying the 2x monopoly premium (2 x 57 = 114) lifts the veto; one dollar short does not.
  assert.equal(vetoTrade(fakeGame(0), { ...trade, giveCash: 113 }, 'BOT').vetoed, true);
  assert.equal(vetoTrade(fakeGame(0), { ...trade, giveCash: 114 }, 'BOT').vetoed, false);
  // A deed handed back in the same trade counts toward the price (Orange 16 is worth 234).
  assert.equal(vetoTrade(fakeGame(0), { ...trade, givePropertyIndexes: [16] }, 'BOT').vetoed, false);
  // Legacy shapes without player ids never veto (pinned behavior preserved).
  assert.equal(vetoTrade(fakeGame(), { giveCash: 1, requestCash: 0 }, 'BOT').vetoed, false);
  assert.equal(vetoTrade(null, trade, 'BOT').vetoed, false);
});

check('one portfolio valuation prices both trade paths the same way', () => {
  const game = fakeGame();
  // Deeds (234 + 234 + 260) plus the quadratic progress credit of a
  // completed Orange set (728), plus the build value of the finished set:
  // three houses on each deed, three circuits out (2515 * 3).
  const complete = portfolioValue(game, 'BOT', [16, 18, 19]);
  assert.equal(complete, 728 + 728 + 2515 * 3, 'a completed set carries its build value');
  // Two deeds of the same group: the face value and the progress credit of
  // a set that is not finished yet, and no build value.
  const partial = portfolioValue(game, 'BOT', [16, 18]);
  assert.equal(partial, 234 + 234 + 323);
  assert.ok(complete > partial, 'completing the set is worth more than the deeds alone');
  assert.equal(portfolioValue(game, 'BOT', []), 0);
  assert.equal(portfolioValue(null, 'BOT', [16]), 0);
});

console.log(`botTradeValuation tests: ${passed} passed, 0 failed`);
