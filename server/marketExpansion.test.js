import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { forceLiquidate, maintenanceDue } from './marketExpansion.js';

function roomAt(complexity) {
  const room = new RoomManager().createRoom({ rulesProfile: 'advanced', socketId: 'a', clientId: 'a', nickname: 'A', rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true }, marketComplexity: complexity });
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
// The liquidation closes the position, so no margin debt may survive it. The
// $66 the collateral and the sale could not cover stays owed to the house as
// an explicit obligation instead of a balance with no position behind it.
assert.equal(liquidationPlayer.marginBalance, 0);
assert.equal(liquidationPlayer.shortDefaultDebt, marginDebtBeforeLiquidation - 34);
assert.equal(liquidationPlayer.marginCollateral, 0);
assert.equal(liquidationPlayer.reservedCash, 0);
assert.deepEqual(liquidationPlayer.marginPositions, {});
// The forced sale is a realized trade: $9 of proceeds against a $102 basis.
assert.equal(liquidationPlayer.marketPositions.brazil.realizedPnl, 9 - 102);

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
assert.equal(shortDefaultPlayer.shortDefaultDebt, 155);

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
// Borrow fees retire proportionally: two partial covers charge once total.
const feeRoom = roomAt('shorting');
const feePlayer = feeRoom.game.players[0];
assert.equal(feeRoom.openShort('a', 'brazil', 2, 'fee-open').success, true);
const openedFee = feePlayer.shortPositions.brazil.borrowFee;
assert.ok(openedFee >= 1);
feePlayer.marketActionsThisTurn = 0;
assert.equal(feeRoom.coverShort('a', 'brazil', 1, 'fee-cover-1').success, true);
assert.equal(feePlayer.shortPositions.brazil.borrowFee, openedFee - Math.ceil(openedFee / 2));
feePlayer.marketActionsThisTurn = 0;
assert.equal(feeRoom.coverShort('a', 'brazil', 1, 'fee-cover-2').success, true);
assert.equal(feePlayer.shortPositions.brazil, undefined);

// Expired options cannot be closed for value; expiry pays zero.
const expiryRoom = roomAt('derivatives');
const expiryOpen = expiryRoom.openOption('a', { instrumentId: 'brazil', quantity: 1, premium: 10, expiryRounds: 1, requestId: 'expiry-open' });
assert.equal(expiryOpen.success, true);
expiryRoom.game.roundNumber += 2;
expiryRoom.game.players[0].marketActionsThisTurn = 0;
assert.deepEqual(expiryRoom.closePosition('a', expiryOpen.option.id, 'expiry-close'), { success: false, error: 'That option has expired.' });

const closeRoom = roomAt('derivatives');
const closeOpen = closeRoom.openOption('a', { instrumentId: 'brazil', quantity: 1, premium: 10, requestId: 'close-open' });
assert.equal(closeOpen.success, true);
const closePlayer = closeRoom.game.players[0];
closePlayer.marketActionsThisTurn = 0;
const closeResult = closeRoom.closePosition('a', closeOpen.option.id, 'close-1');
assert.equal(closeResult.success, true);
assert.deepEqual(closeRoom.closePosition('a', closeOpen.option.id, 'close-1'), closeResult);
assert.deepEqual(closeRoom.closePosition('a', closeOpen.option.id, 'close-2'), { success: false, error: 'You have already placed a market order this turn.' });

// F-034: units stay on margin until the balance is fully repaid, then become
// ordinary spot inventory that can be sold. Margin still open at game end is
// settled from its liquidation proceeds instead of being stranded.
const repaidRoom = roomAt('margin');
const repaidPlayer = repaidRoom.game.players[0];
assert.equal(repaidRoom.openMargin('a', 'brazil', 2, 'f34-open').success, true);
repaidPlayer.marketActionsThisTurn = 0;
assert.equal(repaidRoom.reduceMargin('a', 50, 'f34-partial').success, true);
assert.equal(repaidPlayer.marginPositions.brazil.quantity, 2);
assert.equal(repaidPlayer.marketPositions.brazil, undefined);
repaidPlayer.marketActionsThisTurn = 0;
assert.equal(repaidRoom.reduceMargin('a', 150, 'f34-repay').success, true);
assert.deepEqual(repaidPlayer.marginPositions, {});
assert.equal(repaidPlayer.marketPositions.brazil.quantity, 2);
// The margin opening fee ($4 on a $200 gross) is part of the cost basis, so
// the converted units carry it into the spot book and the realized P&L of the
// sale reports it (E2).
assert.equal(repaidPlayer.marketPositions.brazil.averageCost, 102);
repaidPlayer.marketActionsThisTurn = 0;
assert.equal(repaidRoom.tradeMarket('a', 'brazil', 'sell', 2, 'f34-sell').success, true);
assert.equal(repaidPlayer.marketPositions.brazil.quantity, 0);
assert.equal(repaidPlayer.marketPositions.brazil.realizedPnl, (100 - 102) * 2 - 4);

const endRoom = roomAt('margin');
const endPlayer = endRoom.game.players[0];
assert.equal(endRoom.openMargin('a', 'brazil', 2, 'f34-end').success, true);
const cashAtEnd = endPlayer.cash;
endRoom.game.endGame();
assert.deepEqual(endPlayer.marginPositions, {});
assert.equal(endPlayer.marginBalance, 0);
assert.equal(endPlayer.marginCollateral, 0);
assert.equal(endPlayer.reservedCash, 0);
assert.equal(endPlayer.cash, cashAtEnd + 46);

// E1: loan-backed cash may not open exposure, but it must never lock a seat
// out of the risk-reducing side of its own book. Reducing or covering a
// position is how a borrower funds the repayment, so those paths stay open.
{
  const loanRoom = roomAt('margin');
  const loanPlayer = loanRoom.game.players[0];
  assert.equal(loanRoom.openMargin('a', 'brazil', 1, 'loan-margin-open').success, true);
  loanPlayer.marketActionsThisTurn = 0;
  loanPlayer.bankLoan = { status: 'active', remaining: 500, collateralTileIndex: null };
  assert.deepEqual(loanRoom.openMargin('a', 'brazil', 1, 'loan-margin-open-2'), {
    success: false,
    error: 'Loan-backed cash cannot fund margin, short, or option positions.'
  });
  const reduced = loanRoom.reduceMargin('a', 50, 'loan-margin-reduce');
  assert.equal(reduced.success, true, JSON.stringify(reduced));
}
{
  const loanShortRoom = roomAt('shorting');
  const loanShortPlayer = loanShortRoom.game.players[0];
  assert.equal(loanShortRoom.openShort('a', 'brazil', 1, 'loan-short-open').success, true);
  loanShortPlayer.marketActionsThisTurn = 0;
  loanShortPlayer.bankLoan = { status: 'active', remaining: 500, collateralTileIndex: null };
  assert.deepEqual(loanShortRoom.openShort('a', 'brazil', 1, 'loan-short-open-2'), {
    success: false,
    error: 'Loan-backed cash cannot fund margin, short, or option positions.'
  });
  const covered = loanShortRoom.coverShort('a', 'brazil', 1, 'loan-short-cover');
  assert.equal(covered.success, true, JSON.stringify(covered));
}

// E3: a forced or terminal settlement pays a buyer option what it is worth.
// The reserve still bounds the payout, and only the unused part returns to
// the house.
{
  const settleRoom = roomAt('derivatives');
  const settlePlayer = settleRoom.game.players[0];
  const buyerOption = settleRoom.openOption('a', {
    instrumentId: 'brazil',
    role: 'buyer',
    side: 'call',
    quantity: 1,
    strike: 80,
    premium: 10,
    expiryRounds: 5,
    requestId: 'settle-option'
  });
  assert.equal(buyerOption.success, true);
  settleRoom.game.marketQuotes.brazil = 140;
  settleRoom.game.roundNumber += 1;
  const reserveBeforeSettlement = settleRoom.game.marketOptionReserve;
  settleRoom.game.liquidateAllMarketPositions(settlePlayer);
  assert.equal(settlePlayer.optionPositions[0].status, 'closed');
  assert.equal(settlePlayer.optionPositions[0].reserveHeld, 0);
  assert.equal(settlePlayer.cash, 1500 - 10 + 60, 'the holder is paid the intrinsic value');
  assert.equal(settleRoom.game.marketOptionReserve, reserveBeforeSettlement + 20, 'only the unused reserve returns to the house');
}

// E4: the trade fee the short open already took out of the proceeds belongs
// in the realized P&L of the closed short, next to the cover fee and the
// borrow fee: $20 + $20 + $10 on a $1,000 notional opened and closed at the
// same quote.
{
  const shortFeeRoom = roomAt('shorting');
  const shortFeePlayer = shortFeeRoom.game.players[0];
  shortFeeRoom.game.marketQuotes.brazil = 100;
  assert.equal(shortFeeRoom.openShort('a', 'brazil', 10, 'open-fee-short').success, true);
  shortFeePlayer.marketActionsThisTurn = 0;
  const shortCover = shortFeeRoom.coverShort('a', 'brazil', 10, 'cover-fee-short');
  assert.equal(shortCover.success, true);
  assert.equal(shortCover.realizedPnl, -50);
}

// An unpaid short buy-in is a forced obligation to the house, but it must not
// trap the seat inside it: reducing margin, covering a short and closing a
// position are how a levered seat raises the cash that repays the debt. Only
// new exposure (the 'open' ladder) stays blocked.
{
  const debtMarginRoom = roomAt('margin');
  const debtMarginPlayer = debtMarginRoom.game.players[0];
  assert.equal(debtMarginRoom.openMargin('a', 'brazil', 2, 'debt-margin-open').success, true);
  debtMarginPlayer.marketActionsThisTurn = 0;
  debtMarginPlayer.shortDefaultDebt = 100;
  assert.deepEqual(debtMarginRoom.openMargin('a', 'brazil', 1, 'debt-margin-open-2'), {
    success: false,
    error: 'Settle your short buy-in debt before opening another market position.'
  });
  const reducedDebtMargin = debtMarginRoom.reduceMargin('a', 50, 'debt-margin-reduce');
  assert.equal(reducedDebtMargin.success, true, JSON.stringify(reducedDebtMargin));
}
{
  const debtShortRoom = roomAt('shorting');
  const debtShortPlayer = debtShortRoom.game.players[0];
  assert.equal(debtShortRoom.openShort('a', 'brazil', 1, 'debt-short-open').success, true);
  debtShortPlayer.marketActionsThisTurn = 0;
  debtShortPlayer.shortDefaultDebt = 100;
  assert.deepEqual(debtShortRoom.openShort('a', 'brazil', 1, 'debt-short-open-2'), {
    success: false,
    error: 'Settle your short buy-in debt before opening another market position.'
  });
  const coveredDebtShort = debtShortRoom.coverShort('a', 'brazil', 1, 'debt-short-cover');
  assert.equal(coveredDebtShort.success, true, JSON.stringify(coveredDebtShort));
}
{
  const debtOptionRoom = roomAt('derivatives');
  const debtOptionPlayer = debtOptionRoom.game.players[0];
  const debtOption = debtOptionRoom.openOption('a', { instrumentId: 'brazil', role: 'buyer', side: 'call', quantity: 1, strike: 80, premium: 10, expiryRounds: 5, requestId: 'debt-option' });
  assert.equal(debtOption.success, true);
  debtOptionPlayer.marketActionsThisTurn = 0;
  debtOptionPlayer.shortDefaultDebt = 100;
  assert.deepEqual(debtOptionRoom.openOption('a', { instrumentId: 'brazil', role: 'buyer', side: 'call', quantity: 1, strike: 80, premium: 10, expiryRounds: 5, requestId: 'debt-option-2' }), {
    success: false,
    error: 'Settle your short buy-in debt before opening another market position.'
  });
  const closedDebtOption = debtOptionRoom.closePosition('a', debtOption.option.id, 'debt-close');
  assert.equal(closedDebtOption.success, true, JSON.stringify(closedDebtOption));
}

console.log('market expansion: 28 passed, 0 failed');
