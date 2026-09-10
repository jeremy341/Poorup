import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { forceLiquidate } from './marketExpansion.js';

function roomAt(complexity) {
  const room = new RoomManager().createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', rulesetPreset: 'after-hours', marketComplexity: complexity });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('market', true);
  room.setRoomSetting('marketComplexity', complexity);
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

const basic = roomAt('basic');
assert.equal(basic.openMargin('a', 'brazil', 1, 'm1').success, false);
const margin = roomAt('margin');
const open = margin.openMargin('a', 'brazil', 2, 'm1');
assert.equal(open.success, true);
assert.equal(margin.game.players[0].marginPositions.brazil.quantity, 2);
assert.deepEqual(margin.openMargin('a', 'ghana', 1, 'm1b'), { success: false, error: 'You have already placed a market order this turn.' });
assert.equal(margin.reduceMargin('a', 50, 'm2').success, true);
const short = roomAt('shorting');
const openShort = short.openShort('a', 'brazil', 1, 's1');
assert.equal(openShort.success, true);
assert.equal(short.game.players[0].shortPositions.brazil.quantity, 1);
assert.equal(short.coverShort('a', 'brazil', 1, 's2').success, true);
short.game.globalEvent = { id: 'credit-freeze', phase: 'active', effects: {} };
assert.equal(short.openShort('a', 'brazil', 1, 's3').success, false);
const derivatives = roomAt('derivatives');
const option = derivatives.openOption('a', { instrumentId: 'brazil', side: 'call', quantity: 1, strike: 80, premium: 10, expiryRounds: 3, requestId: 'opt-1' });
assert.equal(option.success, true);
assert.equal(derivatives.openOption('a', { instrumentId: 'brazil', side: 'call', quantity: 1, strike: 80, premium: 10, expiryRounds: 3, requestId: 'opt-1' }).option.id, option.option.id);
assert.equal(derivatives.game.players[0].optionPositions.length, 1);
const openOptionCandidates = derivatives.game.marketExpansionCandidates(derivatives.game.players[0]);
assert.equal(openOptionCandidates.some(candidate => candidate.kind === 'close-position' && candidate.optionId === option.option.id), true);
derivatives.game.marketQuotes.brazil = 140;
assert.equal(derivatives.exerciseOption('a', option.option.id, 'exercise-1').success, true);
assert.ok(derivatives.game.players[0].cash >= 0);
const writer = roomAt('derivatives');
writer.game.players[0].cash = 100;
assert.equal(writer.openOption('a', { instrumentId: 'brazil', role: 'writer', side: 'call', quantity: 2, strike: 100 }).success, false);
assert.ok(writer.game.players[0].cash >= 0);
const marginLow = roomAt('margin');
marginLow.game.players[0].cash = 1;
assert.equal(marginLow.openMargin('a', 'brazil', 10, 'low').success, false);
assert.ok(marginLow.game.players[0].cash >= 0);
const marginPlayer = margin.game.players[0];
marginPlayer.marginMaintenance = 500;
marginPlayer.marginPositions = { brazil: { quantity: 1, averageCost: 100 } };
margin.game.marketQuotes.brazil = 10;
assert.equal(margin.openMargin('a', 'brazil', 1, 'blocked').success, false);
derivatives.game.players[0].marketActionsThisTurn = 0;
assert.ok(derivatives.marketExpansionCandidates(derivatives.game.players[0]).length >= 1);

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
assert.equal(liquidationPlayer.marginBalance, marginDebtBeforeLiquidation - 9);
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
assert.equal(optionReserveRoom.exerciseOption('a', buyerOption.option.id, 'house-exercise').success, true);
assert.equal(optionBuyer.cash, optionCashBefore + 50);
assert.equal(optionReserveRoom.game.marketOptionReserve, reserveAfterOpen + 20);
console.log('market expansion: 12 passed, 0 failed');
