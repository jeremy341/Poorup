// Audit fixes for property mortgage gates, purchase-offer liveness and
// tile coercion, bank-loan issue guards, and loan collateral naming.
// Style mirrors server/contracts-market.test.js: results array, check,
// summary, process.exit.
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
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const borrower = game.players[0];
  game.currentPlayerId = borrower.id;
  borrower.cash = 100;
  return { room, game, borrower };
}

const MORTGAGE_TABLE_ERROR = 'Resolve the table obligation before managing property.';
const PROPERTY_LIVENESS_ERROR = 'Property access is unavailable right now.';
const BANK_LIVENESS_ERROR = 'Bank credit is unavailable right now.';

check('FIX1 mortgage blocked for bankrupt seat', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.owner.bankrupt = true;
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('FIX1 mortgage blocked for disconnected seat', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.owner.disconnected = true;
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('FIX1 unmortgage blocked for bankrupt seat', () => {
  const ctx = ownedRoom();
  const tile = ctx.give(1);
  tile.mortgaged = true;
  ctx.owner.bankrupt = true;
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'unmortgage' }), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('FIX1 mortgage blocked while pendingPayment is open', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.game.pendingPayment = { playerId: ctx.owner.id, creditorId: null, amountRemaining: 10, reason: 'r' };
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }), { success: false, error: MORTGAGE_TABLE_ERROR });
});

check('FIX1 mortgage blocked while auction is open', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.game.auction = { active: true };
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }), { success: false, error: MORTGAGE_TABLE_ERROR });
});

check('FIX1 mortgage blocked while pendingTrade is open', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.game.pendingTrade = { id: 't1' };
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }), { success: false, error: MORTGAGE_TABLE_ERROR });
});

check('FIX1 mortgage blocked while pendingPlayerContract is open', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.game.pendingPlayerContract = { id: 'c1' };
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }), { success: false, error: MORTGAGE_TABLE_ERROR });
});

check('FIX1 mortgage blocked while pendingPurchaseOffer is open', () => {
  const ctx = ownedRoom();
  ctx.give(6);
  ctx.game.pendingPurchaseOffer = { playerId: ctx.owner.id, tileIndex: 1 };
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 6, action: 'mortgage' }), { success: false, error: MORTGAGE_TABLE_ERROR });
});

check('FIX1 liveness wins over table obligation', () => {
  const ctx = ownedRoom();
  ctx.give(1);
  ctx.owner.bankrupt = true;
  ctx.game.pendingPayment = { playerId: ctx.owner.id, creditorId: null, amountRemaining: 5, reason: 'r' };
  assert.deepEqual(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('FIX1 mortgage still succeeds with a live seat and a free table', () => {
  const ctx = ownedRoom();
  const tile = ctx.give(1);
  ctx.owner.cash = 0;
  assert.equal(ctx.game.manageProperty('socket-a', { tileIndex: 1, action: 'mortgage' }).success, true);
  assert.equal(tile.mortgaged, true);
});

check('FIX2 purchase accept blocked for bankrupt seat', () => {
  const ctx = offerRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  ctx.buyer.cash = 1500;
  ctx.game.pendingPurchaseOffer = { playerId: ctx.buyer.id, tileIndex: 1 };
  ctx.buyer.bankrupt = true;
  assert.deepEqual(ctx.game.purchaseProperty('socket-a', 1), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('FIX2 purchase accept blocked for disconnected seat', () => {
  const ctx = offerRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  ctx.buyer.cash = 1500;
  ctx.game.pendingPurchaseOffer = { playerId: ctx.buyer.id, tileIndex: 1 };
  ctx.buyer.disconnected = true;
  assert.deepEqual(ctx.game.purchaseProperty('socket-a', 1), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('FIX2 decline blocked for bankrupt seat', () => {
  const ctx = offerRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  ctx.game.pendingPurchaseOffer = { playerId: ctx.buyer.id, tileIndex: 1 };
  ctx.buyer.bankrupt = true;
  assert.deepEqual(ctx.game.declineProperty('socket-a', 1), { success: false, error: PROPERTY_LIVENESS_ERROR });
});

check('FIX2 string tileIndex is coerced for purchase', () => {
  const ctx = offerRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  ctx.buyer.cash = 1500;
  ctx.game.pendingPurchaseOffer = { playerId: ctx.buyer.id, tileIndex: 1 };
  assert.deepEqual(ctx.game.purchaseProperty('socket-a', '1'), { success: true });
  assert.equal(tile.ownerId, ctx.buyer.id);
});

check('FIX2 string tileIndex is coerced for decline', () => {
  const ctx = offerRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  ctx.game.pendingPurchaseOffer = { playerId: ctx.buyer.id, tileIndex: 1 };
  assert.deepEqual(ctx.game.declineProperty('socket-a', '1'), { success: true });
  assert.equal(ctx.game.pendingPurchaseOffer, null);
});

check('FIX3 bank loan blocked for bankrupt seat', () => {
  const ctx = loanRoom();
  ctx.borrower.bankrupt = true;
  assert.deepEqual(ctx.game.takeBankLoan('socket-a', 'audit-bankrupt'), { success: false, error: BANK_LIVENESS_ERROR });
});

check('FIX3 bank loan blocked for disconnected seat', () => {
  const ctx = loanRoom();
  ctx.borrower.disconnected = true;
  assert.deepEqual(ctx.game.takeBankLoan('socket-a', 'audit-disconnected'), { success: false, error: BANK_LIVENESS_ERROR });
});

check('FIX3 bank loan blocked while inDebt', () => {
  const ctx = loanRoom();
  ctx.borrower.inDebt = true;
  assert.deepEqual(ctx.game.takeBankLoan('socket-a', 'audit-indebt'), { success: false, error: BANK_LIVENESS_ERROR });
});

check('FIX3 bank loan still succeeds for a live solvent seat', () => {
  const ctx = loanRoom();
  const result = ctx.game.takeBankLoan('socket-a', 'audit-clean');
  assert.equal(result.success, true);
  assert.equal(result.loan.status, 'active');
});

check('FIX4 issued loan stores collateralName', () => {
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

check('FIX4 issued loan falls back to NONE with no deed', () => {
  const ctx = loanRoom();
  const result = ctx.game.takeBankLoan('socket-a', 'audit-none');
  assert.equal(result.success, true);
  assert.equal(result.loan.collateralName, 'NONE');
});

const failed = results.filter((entry) => entry !== true).length;
console.log(`\naudit property-loan tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
