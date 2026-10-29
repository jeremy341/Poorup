// Property mortgage gates, purchase-offer liveness, tile coercion, bank-loan issue guards,
// and loan collateral naming. Style mirrors server/contracts-market.test.js: results array,
// check, summary and process.exit.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

function ownedRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('playerFinance', true);
  room.setRoomSetting('bankLoans', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const owner = game.players[0];
  game.currentPlayerId = owner.id;
  game.canMortgageTile = () => true;
  game.canUnmortgageTile = () => true;
  const give = (index) => {
    const tile = game.getTile(index);
    tile.ownerId = owner.id;
    owner.properties.push(tile.index);
    return tile;
  };
  return { room, game, owner, give };
}

function offerRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('playerFinance', true);
  room.setRoomSetting('bankLoans', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const buyer = game.players[0];
  game.currentPlayerId = buyer.id;
  game.settings.auction = false;
  return { room, game, buyer };
}

function loanRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('playerFinance', true);
  room.setRoomSetting('bankLoans', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const borrower = game.players[0];
  game.currentPlayerId = borrower.id;
  borrower.cash = 100;
  return { room, game, borrower };
}

const PROPERTY_LIVENESS_ERROR = 'Property access is unavailable right now.';
const BANK_LIVENESS_ERROR = 'Bank credit is unavailable right now.';

check('mortgage blocked for bankrupt seat', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.owner.bankrupt = true;
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('mortgage blocked for disconnected seat', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.owner.disconnected = true;
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('unmortgage blocked for bankrupt seat', () => {
  const ctx = ownedRoom();
  const tile = ctx.give(1);
  tile.mortgaged = true;
  ctx.owner.bankrupt = true;
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'unmortgage' }), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('mortgage raises funds to settle pendingPayment', () => {
  const ctx = ownedRoom();
  const tile = ctx.give(1);
  ctx.owner.cash = 0;
  ctx.game.pendingPayment = { playerId: ctx.owner.id, creditorId: null, amountRemaining: 10, reason: 'r' };
  const result = ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' });
  assert.equal(result.success, true);
  assert.equal(tile.mortgaged, true);
  assert.equal(ctx.game.pendingPayment, null);
  assert.equal(ctx.owner.cash, 20);
});

check('debt owed by another seat does not block a mortgage', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.game.pendingPayment = { playerId: 'another-player', creditorId: null, amountRemaining: 10, reason: 'r' };
  const result = ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' });
  assert.equal(result.success, true);
});

check('mortgage remains available while an unrelated auction is open', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.game.auction = { active: true };
  assert.equal(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }).success, true);
});

check('mortgage remains available while an unrelated trade is open', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.game.pendingTrade = { id: 't1' };
  assert.equal(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }).success, true);
});

check('mortgage remains available while an unrelated contract is open', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.game.pendingPlayerContract = { id: 'c1' };
  assert.equal(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }).success, true);
});

check('mortgage remains available while another player property offer is open', () => {
  const ctx = ownedRoom();
  ctx.give(6);
  ctx.game.pendingPurchaseOffer = { playerId: ctx.owner.id, tileIndex: 1 };
  assert.equal(ctx.game.manageProperty('socket-a', { tileIndex: 6, action: 'mortgage' }).success, true);
});

check('liveness wins over table obligation', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.owner.bankrupt = true;
  ctx.game.pendingPayment = { playerId: ctx.owner.id, creditorId: null, amountRemaining: 5, reason: 'r' };
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('mortgage still succeeds with a live seat and a free table', () => {
  const ctx = ownedRoom();
  const tile = ctx.give(1);
  ctx.owner.cash = 0;
  assert.equal(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }).success, true);
  assert.equal(tile.mortgaged, true);
});

check('summary projects event-aware property action costs and reasons', () => {
  const ctx = ownedRoom();
  const tile = ctx.give(1);
  ctx.game.globalEvent = { id: 'housing', phase: 'active', effects: { buildingCostMultiplier: 1.35, propertyValueMultiplier: 0.65 } };
  const projected = ctx.game.getGameSummary(ctx.owner.id).tiles.find(entry => entry.index === tile.index).propertyActions;
  assert.equal(projected.buildHouse.cost, 68);
  assert.equal(projected.mortgage.cost, 19);
  assert.equal(projected.unmortgage.cost, 22);
});

check('purchase accept blocked for bankrupt seat', () => {
  const ctx = offerRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  ctx.buyer.cash = 1500;
  ctx.game.pendingPurchaseOffer = { playerId: ctx.buyer.id, tileIndex: 1 };
  ctx.buyer.bankrupt = true;
  assert.deepEqual(ctx.game.purchaseProperty('socket-a', 1), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('purchase accept blocked for disconnected seat', () => {
  const ctx = offerRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  ctx.buyer.cash = 1500;
  ctx.game.pendingPurchaseOffer = { playerId: ctx.buyer.id, tileIndex: 1 };
  ctx.buyer.disconnected = true;
  assert.deepEqual(ctx.game.purchaseProperty('socket-a', 1), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('decline blocked for bankrupt seat', () => {
  const ctx = offerRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  ctx.game.pendingPurchaseOffer = { playerId: ctx.buyer.id, tileIndex: 1 };
  ctx.buyer.bankrupt = true;
  assert.deepEqual(ctx.game.declineProperty('socket-a', 1), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('string tileIndex is coerced for purchase', () => {
  const ctx = offerRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  ctx.buyer.cash = 1500;
  ctx.game.pendingPurchaseOffer = { playerId: ctx.buyer.id, tileIndex: 1 };
  assert.deepEqual(ctx.game.purchaseProperty('socket-a', '1'), { success: true });
  assert.equal(tile.ownerId, ctx.buyer.id);
});

check('string tileIndex is coerced for decline', () => {
  const ctx = offerRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  ctx.game.pendingPurchaseOffer = { playerId: ctx.buyer.id, tileIndex: 1 };
  assert.deepEqual(ctx.game.declineProperty('socket-a', '1'), { success: true });
  assert.equal(ctx.game.pendingPurchaseOffer, null);
});

check('string tileIndex is coerced for property management', () => {
  const ctx = ownedRoom();
  const tile = ctx.give(1);
  ctx.owner.cash = 0;
  assert.equal(ctx.game.manageProperty('socket-a', { tileIndex: '1', action: 'mortgage' }).success, true);
  assert.equal(tile.mortgaged, true);
});

check('bank loan blocked for bankrupt seat', () => {
  const ctx = loanRoom();
  ctx.borrower.bankrupt = true;
  assert.deepEqual(ctx.game.takeBankLoan('socket-a', 'audit-bankrupt'), { success: false, error: BANK_LIVENESS_ERROR });
});

check('bank loan blocked for disconnected seat', () => {
  const ctx = loanRoom();
  ctx.borrower.disconnected = true;
  assert.deepEqual(ctx.game.takeBankLoan('socket-a', 'audit-disconnected'), { success: false, error: BANK_LIVENESS_ERROR });
});

check('bank loan remains available as an in-debt rescue action', () => {
  const ctx = loanRoom();
  ctx.borrower.inDebt = true;
  ctx.game.pendingPayment = { playerId: ctx.borrower.id, creditorId: null, amountRemaining: 500, reason: 'rent' };
  const result = ctx.game.takeBankLoan('socket-a', 'audit-indebt');
  assert.equal(result.success, true);
  assert.equal(result.loan.status, 'active');
  assert.equal(ctx.borrower.cash, 400);
  assert.equal(ctx.game.pendingPayment.amountRemaining, 500);
});

check('unknown socket reports unavailable bank credit', () => {
  const ctx = loanRoom();
  assert.deepEqual(ctx.game.takeBankLoan('socket-missing', 'audit-unknown'), { success: false, error: BANK_LIVENESS_ERROR });
});

check('bank loan still succeeds for a live solvent seat', () => {
  const ctx = loanRoom();
  const result = ctx.game.takeBankLoan('socket-a', 'audit-clean');
  assert.equal(result.success, true);
  assert.equal(result.loan.status, 'active');
});

check('bank loan remains blocked by other table obligations', () => {
  ['pendingPurchaseOffer', 'auction', 'pendingTrade', 'pendingPlayerContract'].forEach((key) => {
    const ctx = loanRoom();
    ctx.borrower.cash = 100;
    ctx.game[key] = {};
    assert.deepEqual(
      ctx.game.takeBankLoan('socket-a', 'audit-obligation-' + key),
      { success: false, error: 'Resolve the table obligation before borrowing.' }
    );
  });
});

check('issued loan stores collateralName', () => {
  const ctx = loanRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = ctx.borrower.id;
  tile.mortgaged = false;
  tile.houseCount = 0;
  ctx.borrower.properties.push(tile.index);
  const result = ctx.game.takeBankLoan('socket-a', 'audit-collateral');
  assert.equal(result.success, true);
  assert.equal(result.loan.collateralTileIndex, tile.index);
  assert.equal(result.loan.collateralName, tile.name);
});

check('issued loan falls back to NONE with no deed', () => {
  const ctx = loanRoom();
  const result = ctx.game.takeBankLoan('socket-a', 'audit-none');
  assert.equal(result.success, true);
  assert.equal(result.loan.collateralName, 'NONE');
});

check('bank collateral excludes deeds that already carry equity shares', () => {
  const ctx = loanRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = ctx.borrower.id;
  tile.equityShares = [{ holderId: 'equity-holder', share: 20, contractId: 'equity-1' }];
  ctx.borrower.properties.push(tile.index);
  const result = ctx.game.takeBankLoan('socket-a', 'audit-equity-collateral');
  assert.equal(result.success, true);
  assert.equal(result.loan.collateralTileIndex, null);
  assert.equal(result.loan.collateralName, 'NONE');
});

// Bank-loan default, replay cache and collateral sale rate

// A borrower whose bank loan is past the cure round, with the seat's cash and
// the debt it already owes left to the test.
function defaultingLoanRoom({ cash = 500, parked = 0 } = {}) {
  const ctx = loanRoom();
  const { game, borrower } = ctx;
  borrower.cash = cash;
  borrower.bankLoan = {
    status: 'due',
    remaining: 300,
    collateralTileIndex: null,
    issuedRound: 1,
    dueRound: 1,
    cureRound: 1
  };
  if (parked > 0) {
    game.pendingPayment = { playerId: borrower.id, creditorId: null, amountRemaining: parked, reason: 'rent' };
  }
  game.hasRolled = false;
  game.roundNumber = 3;
  return ctx;
}

check('a bank default waits behind the debt the seat already owes', () => {
  const ctx = defaultingLoanRoom({ cash: 500, parked: 100 });
  ctx.game.processBankLoans();
  assert.equal(ctx.borrower.bankLoan.status, 'defaulted');
  assert.equal(ctx.game.pendingPayment.amountRemaining, 100, 'the earlier claim keeps the head of the queue');
  assert.equal(ctx.game.pendingPaymentQueue.length, 1, 'the bank claim waits behind it');
  assert.equal(ctx.game.pendingPaymentQueue[0].payment.playerId, ctx.borrower.id);
  assert.equal(ctx.game.pendingPaymentQueue[0].payment.amountRemaining, 300);
  assert.equal(ctx.borrower.cash, 500, 'the cash is not spent behind the queue');
  assert.equal(ctx.borrower.bankLoan.remaining, 300, 'the balance is cleared only after settlement');
});

check('the queued bank claim clears the loan balance once it is paid', () => {
  const ctx = defaultingLoanRoom({ cash: 500, parked: 100 });
  ctx.game.processBankLoans();
  assert.equal(ctx.game.pendingPaymentQueue.length, 1, 'the bank claim is queued');
  assert.equal(ctx.borrower.bankLoan.remaining, 300, 'the balance is open until the bank is paid');
  assert.equal(ctx.game.trySettlePendingPayment(), true);
  assert.equal(ctx.borrower.bankLoan.remaining, 0, 'the balance closes when the bank is paid');
  assert.equal(ctx.borrower.cash, 100, 'the earlier claim and the bank claim are both paid');
  assert.equal(ctx.game.pendingPayment, null);
  assert.equal(ctx.game.pendingPaymentQueue.length, 0);
});

check('an unsettled bank claim keeps the loan balance open', () => {
  const ctx = defaultingLoanRoom({ cash: 40 });
  ctx.game.processBankLoans();
  assert.equal(ctx.game.pendingPayment.amountRemaining, 260);
  assert.equal(ctx.borrower.bankLoan.remaining, 260, 'the balance follows the unpaid claim');
  ctx.borrower.cash = 260;
  assert.equal(ctx.game.trySettlePendingPayment(), true);
  assert.equal(ctx.borrower.bankLoan.remaining, 0);
});

check('a solvent default with no claim ahead is still paid outright', () => {
  const ctx = defaultingLoanRoom({ cash: 500 });
  ctx.game.processBankLoans();
  assert.equal(ctx.borrower.bankLoan.status, 'defaulted');
  assert.equal(ctx.borrower.bankLoan.remaining, 0);
  assert.equal(ctx.borrower.cash, 200);
  assert.equal(ctx.game.pendingPayment, null);
  assert.equal(ctx.game.pendingPaymentQueue.length, 0);
});

check('a replayed loan answer is the state the loan was given in', () => {
  const ctx = loanRoom();
  const taken = ctx.game.takeBankLoan('socket-a', 'replay-take');
  assert.equal(taken.success, true);
  const totalDue = taken.loan.totalDue;
  ctx.borrower.cash = 1000;
  const repaid = ctx.game.repayBankLoan('socket-a', { amount: totalDue, requestId: 'replay-repay' });
  assert.equal(repaid.success, true);
  assert.equal(repaid.loan.remaining, 0);
  assert.equal(repaid.loan.status, 'paid');
  const replayed = ctx.game.takeBankLoan('socket-a', 'replay-take');
  assert.equal(replayed.loan.remaining, totalDue, 'the replayed issue keeps the balance it was issued with');
  assert.equal(replayed.loan.status, 'active');
  const replayedRepay = ctx.game.repayBankLoan('socket-a', { amount: totalDue, requestId: 'replay-repay' });
  assert.equal(replayedRepay.loan.remaining, 0);
  assert.equal(replayedRepay.loan.status, 'paid');
});

check('a repayment request id is scoped to the loan it paid', () => {
  const ctx = loanRoom();
  const first = ctx.game.takeBankLoan('socket-a', 'scope-take');
  ctx.borrower.cash = 1000;
  const paid = ctx.game.repayBankLoan('socket-a', { amount: first.loan.totalDue, requestId: 'scope-repay' });
  assert.equal(paid.success, true);
  assert.equal(ctx.borrower.bankLoan.status, 'paid');
  ctx.borrower.cash = 100;
  const second = ctx.game.takeBankLoan('socket-a', 'scope-take-2');
  assert.equal(second.success, true);
  assert.notEqual(second.loan.loanId, first.loan.loanId, 'the two loans are different instances');
  ctx.borrower.cash = 1000;
  const again = ctx.game.repayBankLoan('socket-a', { amount: second.loan.totalDue, requestId: 'scope-repay' });
  assert.equal(again.success, true);
  assert.equal(ctx.borrower.bankLoan.status, 'paid');
  assert.equal(ctx.borrower.cash, 1000 - second.loan.totalDue, 'the second repayment really ran');
});

check('a seized house is liquidated at the table sale rate', () => {
  const ctx = loanRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = ctx.borrower.id;
  tile.houseCount = 2;
  ctx.borrower.properties.push(tile.index);
  ctx.borrower.cash = 0;
  ctx.borrower.bankLoan = { status: 'due', remaining: 300, collateralTileIndex: tile.index, dueRound: 1, cureRound: 1 };
  ctx.game.roundNumber = 3;
  ctx.game.globalEvent = { id: 'housing-bubble', phase: 'active', effects: { buildingSaleMultiplier: 0.25 } };
  const houseCost = ctx.game.getPropertyHouseCost(tile);
  ctx.game.processBankLoans();
  assert.equal(ctx.borrower.bankLoan.status, 'defaulted');
  assert.equal(ctx.borrower.cash, Math.floor(2 * houseCost * 0.25), 'the houses liquidate at the sale rate');
});

check('bank-loan repayment cannot spend cash reserved for a parked player debt', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('bankLoans', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [a, b] = game.players;
  game.currentPlayerId = a.id;
  game.hasRolled = true;
  game.awaitingEndTurn = true;
  const deed = game.tiles.find((t) => t.type === 'property' && t.price >= 120 && t.price <= 130 && !t.ownerId);
  deed.ownerId = a.id; a.properties.push(deed.index); deed.mortgaged = false; deed.houseCount = 0;
  a.cash = 0;
  game.openDebtSettlement({ player: a, creditor: b, amount: 100, message: 'rent owed to B', turnOptions: {}, hooks: {} });
  a.bankLoan = { loanId: 'loan_t_1', status: 'active', principal: 300, totalDue: 450, remaining: 450, issuedRound: 1, dueRound: 9, cureRound: 10, collateralTileIndex: null, collateralTileIndices: [] };
  assert.equal(game.manageProperty('socket-a', { tileIndex: deed.index, action: 'mortgage' }).success, true);
  assert.equal(a.cash, 60, 'the mortgage pays 60, short of the 100 claim');
  const attempt = game.repayBankLoan('socket-a', { amount: 60, requestId: 'r-1' });
  assert.equal(attempt.success, false, 'the 60 is B\'s, so it cannot go to the bank');
  assert.match(attempt.error, /reserved for a debt/);
  assert.equal(a.cash, 60);
  assert.equal(a.bankLoan.remaining, 450, 'the loan balance is untouched');
  a.cash = 160;
  assert.equal(game.repayBankLoan('socket-a', { amount: 60, requestId: 'r-2' }).success, true, 'cash above the claim can still repay the bank');
  assert.equal(a.bankLoan.remaining, 390);
});

const failed = results.filter((entry) => entry !== true).length;
console.log(`\naudit property-loan tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
