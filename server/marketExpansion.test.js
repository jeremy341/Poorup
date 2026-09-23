import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { forceLiquidate, maintenanceDue } from './marketExpansion.js';

function roomAt(complexity) {
  const room = new RoomManager().createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', rulesetPreset: 'after-hours', marketComplexity: complexity });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('market', true);
  room.setRoomSetting('marketComplexity', complexity);
  assert.equal(room.startGame().success, true);
  // Existing market vectors model an approved pricing-policy deployment. The
  // default no-policy path is covered by game-invariant-regressions.test.js.
  room.game.optionPricingPolicy = { mode: 'approved-test-policy' };
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

const basic = roomAt('basic');
assert.equal(basic.openMargin('a', 'brazil', 1, 'm1').success, false);
const margin = roomAt('margin');
const open = margin.openMargin('a', 'brazil', 2, 'm1');
assert.equal(open.success, true);
assert.equal(margin.game.players[0].marginPositions.brazil.quantity, 2);
assert.equal(open.collateral, 50);
assert.equal(margin.game.players[0].marginCollateral, 50);
assert.equal(margin.game.players[0].reservedCash, 50);
assert.equal(margin.game.players[0].cash, 1446);
assert.deepEqual(margin.openMargin('a', 'ghana', 1, 'm1b'), { success: false, error: 'You have already placed a market order this turn.' });
assert.deepEqual(margin.reduceMargin('a', 50, 'm2'), { success: false, error: 'You have already placed a market order this turn.' });
margin.game.players[0].marketActionsThisTurn = 0;
const reducedMargin = margin.reduceMargin('a', 50, 'm2');
assert.equal(reducedMargin.success, true);
assert.equal(reducedMargin.collateralReleased, 13);
assert.equal(margin.game.players[0].marginCollateral, 37);
assert.equal(margin.game.players[0].reservedCash, 37);
const short = roomAt('shorting');
const openShort = short.openShort('a', 'brazil', 1, 's1');
assert.equal(openShort.success, true);
assert.equal(short.game.players[0].shortPositions.brazil.quantity, 1);
assert.deepEqual(short.coverShort('a', 'brazil', 1, 's2'), { success: false, error: 'You have already placed a market order this turn.' });
short.game.players[0].marketActionsThisTurn = 0;
assert.equal(short.coverShort('a', 'brazil', 1, 's2').success, true);
short.game.globalEvent = { id: 'credit-freeze', phase: 'active', effects: {} };
assert.equal(short.openShort('a', 'brazil', 1, 's3').success, false);
const derivatives = roomAt('derivatives');
const option = derivatives.openOption('a', { instrumentId: 'brazil', side: 'call', quantity: 1, strike: 80, premium: 10, expiryRounds: 3, requestId: 'opt-1' });
assert.equal(option.success, true);
assert.equal(derivatives.openOption('a', { instrumentId: 'brazil', side: 'call', quantity: 1, strike: 80, premium: 10, expiryRounds: 3, requestId: 'opt-1' }).option.id, option.option.id);
assert.equal(derivatives.game.players[0].optionPositions.length, 1);
const blockedOptionCandidates = derivatives.game.marketExpansionCandidates(derivatives.game.players[0]);
assert.equal(blockedOptionCandidates.some(candidate => candidate.kind === 'close-position' && candidate.optionId === option.option.id), false);
derivatives.game.players[0].marketActionsThisTurn = 0;
const openOptionCandidates = derivatives.game.marketExpansionCandidates(derivatives.game.players[0]);
assert.equal(openOptionCandidates.some(candidate => candidate.kind === 'close-position' && candidate.optionId === option.option.id), true);
derivatives.game.marketQuotes.brazil = 140;
derivatives.game.roundNumber += 1;
derivatives.game.players[0].marketActionsThisTurn = 0;
assert.equal(derivatives.exerciseOption('a', option.option.id, 'exercise-1').success, true);
assert.ok(derivatives.game.players[0].cash >= 0);
const writer = roomAt('derivatives');
writer.game.players[0].cash = 100;
assert.equal(writer.openOption('a', { instrumentId: 'brazil', role: 'writer', side: 'call', quantity: 2, strike: 100 }).success, false);
assert.ok(writer.game.players[0].cash >= 0);
const marginLow = roomAt('margin');
marginLow.game.players[0].cash = 1;
assert.deepEqual(marginLow.openMargin('a', 'brazil', 10, 'low'), {
  success: false,
  error: 'You need $270 cash for this margin position ($20 fee + $250 collateral).'
});
assert.ok(marginLow.game.players[0].cash >= 0);
const marginPlayer = margin.game.players[0];
marginPlayer.marginMaintenance = 500;
marginPlayer.marginPositions = { brazil: { quantity: 1, averageCost: 100 } };
margin.game.marketQuotes.brazil = 10;
assert.equal(margin.openMargin('a', 'brazil', 1, 'blocked').success, false);
derivatives.game.players[0].marketActionsThisTurn = 0;
assert.ok(derivatives.marketExpansionCandidates(derivatives.game.players[0]).length >= 1);

// Margin maintenance is based on account equity, not the gross marked value:
// $130 marked value + $35 held collateral - $100 remaining debt = $65 equity.
// Multiple positions and partial debt make each term observable at the strict
// maintenance boundary.
const marginEquityGame = { marketQuotes: { brazil: 40, ghana: 25 } };
function marginEquityPlayer(maintenance) {
  return {
    cash: 10,
    marginBalance: 100,
    marginMaintenance: maintenance,
    marginCollateral: 35,
    marginPositions: {
      brazil: { quantity: 2, averageCost: 50 },
      ghana: { quantity: 2, averageCost: 30 }
    },
    reservedCash: 35
  };
}

assert.equal(maintenanceDue(marginEquityGame, marginEquityPlayer(64)), false);
assert.equal(maintenanceDue(marginEquityGame, marginEquityPlayer(65)), false);
assert.equal(maintenanceDue(marginEquityGame, marginEquityPlayer(66)), true);

const equalEquityPlayer = marginEquityPlayer(65);
assert.deepEqual(forceLiquidate(marginEquityGame, equalEquityPlayer, {}), []);
assert.equal(equalEquityPlayer.marginBalance, 100);

const belowEquityPlayer = marginEquityPlayer(66);
assert.deepEqual(forceLiquidate(marginEquityGame, belowEquityPlayer, {}), ['margin-liquidation']);
assert.equal(belowEquityPlayer.cash, 72);
assert.equal(belowEquityPlayer.marginBalance, 0);
assert.equal(belowEquityPlayer.marginCollateral, 0);
assert.equal(belowEquityPlayer.reservedCash, 0);
assert.deepEqual(belowEquityPlayer.marginPositions, {});
assert.ok(belowEquityPlayer.cash >= 0);

// Margin liquidation must conserve cash: the sale proceeds repay the margin
// balance before any surplus reaches the wallet. This is the public
// forceLiquidate seam used by the market and bankruptcy paths.
const liquidationRoom = roomAt('margin');
const liquidationPlayer = liquidationRoom.game.players[0];
const openedLiquidation = liquidationRoom.openMargin('a', 'brazil', 1, 'liquidation-open');
assert.equal(openedLiquidation.success, true);
const cashBeforeLiquidation = liquidationPlayer.cash;
const marginDebtBeforeLiquidation = liquidationPlayer.marginBalance;
liquidationPlayer.marginMaintenance = 200;
liquidationRoom.game.marketQuotes.brazil = 10;
const liquidationActions = forceLiquidate(liquidationRoom.game, liquidationPlayer, {});
assert.equal(liquidationActions.includes('margin-liquidation'), true);
assert.equal(liquidationPlayer.cash, cashBeforeLiquidation);
assert.equal(liquidationPlayer.marginBalance, marginDebtBeforeLiquidation - 34);
assert.equal(liquidationPlayer.marginCollateral, 0);
assert.equal(liquidationPlayer.reservedCash, 0);
assert.deepEqual(liquidationPlayer.marginPositions, {});

// A forced short buy-in must close deterministically even when the player
// cannot fund the quote. The shortfall becomes an explicit bounded obligation
// instead of silently leaving the borrowed position open.
const shortDefaultRoom = roomAt('shorting');
const shortDefaultPlayer = shortDefaultRoom.game.players[0];
assert.equal(shortDefaultRoom.openShort('a', 'brazil', 1, 'short-default-open').success, true);
shortDefaultPlayer.cash = 0;
shortDefaultRoom.game.marketQuotes.brazil = 200;
const shortDefaultActions = forceLiquidate(shortDefaultRoom.game, shortDefaultPlayer, {});
assert.equal(shortDefaultActions.includes('short-buy-in-default'), true);
assert.equal(shortDefaultPlayer.shortPositions.brazil, undefined);
assert.equal(shortDefaultPlayer.reservedCash, 0);
assert.equal(shortDefaultPlayer.shortDefaultDebt, 154);

// A pending game payment blocks every player-initiated market action. The
// short-default settlement path shares the guard with the expansion actions.
const pendingMarketRoom = roomAt('derivatives');
const pendingMarketPlayer = pendingMarketRoom.game.players[0];
pendingMarketPlayer.shortDefaultDebt = 50;
pendingMarketPlayer.cash = 500;
pendingMarketRoom.game.pendingPayment = { playerId: pendingMarketPlayer.id, creditorId: null, amountRemaining: 10, reason: 'rent' };
const blockedMarketActions = [
  () => pendingMarketRoom.openMargin('a', 'brazil', 1, 'pending-margin'),
  () => pendingMarketRoom.reduceMargin('a', 10, 'pending-reduce-margin'),
  () => pendingMarketRoom.openShort('a', 'brazil', 1, 'pending-short'),
  () => pendingMarketRoom.coverShort('a', 'brazil', 1, 'pending-cover'),
  () => pendingMarketRoom.openOption('a', { instrumentId: 'brazil', quantity: 1, premium: 1, requestId: 'pending-option' }),
  () => pendingMarketRoom.exerciseOption('a', 'missing-option', 'pending-exercise'),
  () => pendingMarketRoom.closePosition('a', 'missing-option', 'pending-close'),
];
for (const action of blockedMarketActions) {
  assert.deepEqual(action(), { success: false, error: 'Resolve the table obligation before trading.' });
}
assert.deepEqual(pendingMarketRoom.settleShortDefault('a', 10, 'pending-default'), {
  success: false,
  error: 'Resolve the table obligation before trading.'
});
assert.equal(pendingMarketPlayer.shortDefaultDebt, 50);
assert.equal(pendingMarketPlayer.cash, 500);

// A buyer option is underwritten by the bounded market reserve. Exercise
// moves the intrinsic payout from that reserve, not from nowhere.
const optionReserveRoom = roomAt('derivatives');
const optionBuyer = optionReserveRoom.game.players[0];
const optionCashBefore = optionBuyer.cash;
const buyerOption = optionReserveRoom.openOption('a', {
  instrumentId: 'brazil',
  role: 'buyer',
  side: 'call',
  quantity: 1,
  strike: 80,
  premium: 10,
  expiryRounds: 3,
  requestId: 'house-option'
});
assert.equal(buyerOption.success, true);
const reserveAfterOpen = optionReserveRoom.game.marketOptionReserve;
optionReserveRoom.game.marketQuotes.brazil = 140;
optionReserveRoom.game.roundNumber += 1;
optionBuyer.marketActionsThisTurn = 0;
assert.equal(optionReserveRoom.exerciseOption('a', buyerOption.option.id, 'house-exercise').success, true);
assert.equal(optionBuyer.cash, optionCashBefore + 50);
assert.equal(optionReserveRoom.game.marketOptionReserve, reserveAfterOpen + 20);

// Management operations consume the same per-turn quota and still replay a
// successful idempotency key after the quota has been consumed.
assert.deepEqual(margin.reduceMargin('a', 50, 'm2'), reducedMargin);
assert.deepEqual(short.coverShort('a', 'brazil', 1, 's2'), short.coverShort('a', 'brazil', 1, 's2'));
const closeRoom = roomAt('derivatives');
const closeOpen = closeRoom.openOption('a', { instrumentId: 'brazil', quantity: 1, premium: 10, requestId: 'close-open' });
assert.equal(closeOpen.success, true);
const closePlayer = closeRoom.game.players[0];
closePlayer.marketActionsThisTurn = 0;
const closeResult = closeRoom.closePosition('a', closeOpen.option.id, 'close-1');
assert.equal(closeResult.success, true);
assert.deepEqual(closeRoom.closePosition('a', closeOpen.option.id, 'close-1'), closeResult);
assert.deepEqual(closeRoom.closePosition('a', closeOpen.option.id, 'close-2'), { success: false, error: 'You have already placed a market order this turn.' });
console.log('market expansion: 12 passed, 0 failed');
