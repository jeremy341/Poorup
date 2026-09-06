// Audit fixes for rooms settle/appearance: FIX1 reconnect identity,
// FIX2 bot identity, FIX3 obligation parity, FIX4 face validation.
// Mirrors server/contracts-market.test.js check() style: sync asserts run
// on load, counts printed, non-zero exit on failure.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const GRID_ERROR = 'Avatar face must be up to 8x8 cells of hex colors.';
const TAKEN_ERROR = 'That icon is already taken at this table.';

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

function validGrid(fill = '#ffffff') {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => fill));
}

function otherValidGrid() {
  const grid = validGrid('#000000');
  grid[0][0] = '#ffffff';
  return grid;
}

function feedTexts(room) {
  return room.game.feed.map(entry => entry.text);
}

const SEAT_B = { socketId: 'socket-b', clientId: 'client-b', nickname: 'B', color: '#286ea1' };
const SEAT_C = { socketId: 'socket-c', clientId: 'client-c', nickname: 'C', color: '#d9a62f' };

function roomWith(seats) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', color: '#d74438' });
  for (const seat of seats) room.addOrReconnectPlayer(seat);
  return { manager, room, game: room.game };
}

function startedWith(seats) {
  const ctx = roomWith(seats);
  assert.equal(ctx.room.startGame().success, true);
  const game = ctx.room.game;
  game.currentPlayerId = game.players[0].id;
  return { ...ctx, game };
}

function plantDebt(game, debtorId, creditorId) {
  game.pendingPayment = { playerId: debtorId, creditorId, amountRemaining: 100, reason: 'test debt' };
  game.pendingPaymentTurnOptions = { turn: 'test' };
}

// FIX1: reconnect always resolves effective color against effective grid.
check('FIX1 reconnect omitted color with colliding face resolves color', () => {
  const { room, game } = roomWith([SEAT_B]);
  const custom = validGrid('#ffffff');
  assert.equal(game.setPlayerAppearance('socket-a', { color: '#286ea1', avatarGrid: custom }).success, true);
  const result = room.addOrReconnectPlayer({ socketId: 'socket-b2', clientId: 'client-b', nickname: 'B', avatarGrid: custom });
  assert.equal(result.success, true);
  assert.deepEqual(result.player.avatarGrid, custom);
  assert.equal(result.player.color, '#d74438');
  const a = game.getPlayerByClient('client-a');
  assert.notEqual(result.player.color.toLowerCase(), a.color.toLowerCase());
});

check('FIX1 reconnect invalid color with colliding face falls back and resolves', () => {
  const { room, game } = roomWith([SEAT_B]);
  const custom = validGrid('#ffffff');
  assert.equal(game.setPlayerAppearance('socket-a', { color: '#286ea1', avatarGrid: custom }).success, true);
  const result = room.addOrReconnectPlayer({ socketId: 'socket-b2', clientId: 'client-b', nickname: 'B', color: 'not-a-color', avatarGrid: custom });
  assert.equal(result.success, true);
  assert.deepEqual(result.player.avatarGrid, custom);
  assert.equal(result.player.color, '#d74438');
});

check('FIX1 reconnect non-colliding keeps requested color and grid', () => {
  const { room } = roomWith([SEAT_B]);
  const fresh = otherValidGrid();
  const result = room.addOrReconnectPlayer({ socketId: 'socket-b2', clientId: 'client-b', nickname: 'B', color: '#d9a62f', avatarGrid: fresh });
  assert.equal(result.success, true);
  assert.equal(result.player.color, '#d9a62f');
  assert.deepEqual(result.player.avatarGrid, fresh);
});

// FIX2: bots resolve through the same color-plus-face identity.
check('FIX2 bot colliding generic color resolves to first free preset', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', color: '#286ea1' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  assert.ok(bot);
  assert.equal(bot.color, '#d74438');
});

check('FIX2 bot same color different face keeps requested color', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', color: '#286ea1' });
  const custom = validGrid('#ffffff');
  assert.equal(room.game.setPlayerAppearance('socket-a', { color: '#286ea1', avatarGrid: custom }).success, true);
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  assert.ok(bot);
  assert.equal(bot.color, '#286ea1');
});

// FIX3a: debtor quit clears with notice; creditor quit clears too.
check('FIX3a quitting debtor clears pendingPayment with notice', () => {
  const ctx = startedWith([SEAT_B, SEAT_C]);
  const b = ctx.game.getPlayerByClient('client-b');
  const a = ctx.game.getPlayerByClient('client-a');
  ctx.game.feed = [];
  plantDebt(ctx.game, b.id, a.id);
  ctx.manager.leaveRoomByClient('client-b', 'socket-b');
  assert.equal(ctx.game.pendingPayment, null);
  assert.equal(ctx.game.pendingPaymentTurnOptions, null);
  assert.ok(feedTexts(ctx.room).includes('B left the table. A pending payment was cancelled.'));
});

check('FIX3a quitting creditor forgives pendingPayment with notice', () => {
  const ctx = startedWith([SEAT_B, SEAT_C]);
  const b = ctx.game.getPlayerByClient('client-b');
  const a = ctx.game.getPlayerByClient('client-a');
  ctx.game.feed = [];
  plantDebt(ctx.game, b.id, a.id);
  ctx.manager.leaveRoomByClient('client-a', 'socket-a');
  assert.equal(ctx.game.pendingPayment, null);
  assert.equal(ctx.game.pendingPaymentTurnOptions, null);
  assert.ok(feedTexts(ctx.room).includes('A left the table. A pending payment was cancelled.'));
});

check('FIX3a uninvolved quit leaves pendingPayment alone', () => {
  const ctx = startedWith([SEAT_B, SEAT_C]);
  const b = ctx.game.getPlayerByClient('client-b');
  const a = ctx.game.getPlayerByClient('client-a');
  ctx.game.pendingPayment = { playerId: b.id, creditorId: a.id, amountRemaining: 100, reason: 'test debt' };
  ctx.game.pendingPaymentTurnOptions = { turn: 'test' };
  ctx.manager.leaveRoomByClient('client-c', 'socket-c');
  assert.deepEqual(ctx.game.pendingPayment, { playerId: b.id, creditorId: a.id, amountRemaining: 100, reason: 'test debt' });
  assert.deepEqual(ctx.game.pendingPaymentTurnOptions, { turn: 'test' });
});

check('FIX3a bank debt survives uninvolved quit but debtor quit clears', () => {
  const ctx = startedWith([SEAT_B, SEAT_C]);
  const b = ctx.game.getPlayerByClient('client-b');
  ctx.game.pendingPayment = { playerId: b.id, creditorId: null, amountRemaining: 50, reason: 'bank debt' };
  ctx.game.pendingPaymentTurnOptions = { turn: 'bank' };
  ctx.manager.leaveRoomByClient('client-c', 'socket-c');
  assert.ok(ctx.game.pendingPayment);
  ctx.manager.leaveRoomByClient('client-b', 'socket-b');
  assert.equal(ctx.game.pendingPayment, null);
  assert.equal(ctx.game.pendingPaymentTurnOptions, null);
});

// FIX3b: auction lead revoked on leader quit.
check('FIX3b quitting auction leader revokes lead but keeps bid', () => {
  const ctx = startedWith([SEAT_B, SEAT_C]);
  const b = ctx.game.getPlayerByClient('client-b');
  ctx.game.auction = { active: true, highestBidderId: b.id, highestBid: 100 };
  ctx.manager.leaveRoomByClient('client-b', 'socket-b');
  assert.equal(ctx.game.auction.highestBidderId, null);
  assert.equal(ctx.game.auction.highestBid, 100);
});

check('FIX3b non-leader quit leaves auction lead intact', () => {
  const ctx = startedWith([SEAT_B, SEAT_C]);
  const b = ctx.game.getPlayerByClient('client-b');
  ctx.game.auction = { active: true, highestBidderId: b.id, highestBid: 100 };
  ctx.manager.leaveRoomByClient('client-c', 'socket-c');
  assert.equal(ctx.game.auction.highestBidderId, b.id);
  assert.equal(ctx.game.auction.highestBid, 100);
});

// FIX3c: endGame clears every table obligation including payment and contract.
check('FIX3c endGame clears trade offer auction payment and contract', () => {
  const ctx = startedWith([SEAT_B]);
  ctx.game.pendingPurchaseOffer = { playerId: ctx.game.players[0].id };
  ctx.game.auction = { active: true };
  ctx.game.pendingTrade = { fromPlayerId: ctx.game.players[0].id, toPlayerId: ctx.game.players[1].id };
  ctx.game.pendingPayment = { playerId: ctx.game.players[0].id, creditorId: null, amountRemaining: 10, reason: 'r' };
  ctx.game.pendingPaymentTurnOptions = { turn: 't' };
  ctx.game.pendingPlayerContract = { fromPlayerId: ctx.game.players[0].id, toPlayerId: ctx.game.players[1].id };
  ctx.game.endGame();
  assert.equal(ctx.game.pendingPurchaseOffer, null);
  assert.equal(ctx.game.auction, null);
  assert.equal(ctx.game.pendingTrade, null);
  assert.equal(ctx.game.pendingPayment, null);
  assert.equal(ctx.game.pendingPaymentTurnOptions, null);
  assert.equal(ctx.game.pendingPlayerContract, null);
});

// FIX4: face validation uses a distinct error, never the taken error.
// Caps at 8x8 and hex-or-null-or-number cells; legacy small numeric faces
// stay valid so existing suites keep passing.
check('FIX4 setPlayerAppearance rejects malformed grids with distinct error', () => {
  const ctx = startedWith([SEAT_B]);
  const badRows = Array.from({ length: 9 }, () => Array.from({ length: 8 }, () => '#ffffff'));
  assert.deepEqual(ctx.game.setPlayerAppearance('socket-a', { color: '#123456', avatarGrid: badRows }), { success: false, error: GRID_ERROR });
  const badCols = validGrid();
  badCols[0] = Array.from({ length: 9 }, () => '#ffffff');
  assert.deepEqual(ctx.game.setPlayerAppearance('socket-a', { color: '#123456', avatarGrid: badCols }), { success: false, error: GRID_ERROR });
  const badCell = validGrid();
  badCell[3][3] = 'zzz';
  assert.deepEqual(ctx.game.setPlayerAppearance('socket-a', { color: '#123456', avatarGrid: badCell }), { success: false, error: GRID_ERROR });
  const big = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => '#ffffff'));
  assert.deepEqual(ctx.game.setPlayerAppearance('socket-a', { color: '#123456', avatarGrid: big }), { success: false, error: GRID_ERROR });
  assert.deepEqual(ctx.game.setPlayerAppearance('socket-a', { color: '#123456', avatarGrid: 'hi' }), { success: false, error: GRID_ERROR });
  assert.notEqual(GRID_ERROR, TAKEN_ERROR);
});

check('FIX4 legacy small numeric faces stay valid', () => {
  const ctx = startedWith([SEAT_B]);
  assert.equal(ctx.game.setPlayerAppearance('socket-a', { color: '#123456', avatarGrid: [[1, 0], [0, 1]] }).success, true);
  assert.equal(ctx.game.setPlayerAppearance('socket-a', { color: '#654322', avatarGrid: [[1]] }).success, true);
});

check('FIX4 setPlayerAppearance accepts valid null and undefined grids', () => {
  const ctx = startedWith([SEAT_B]);
  const custom = validGrid('#a1b2c3');
  assert.equal(ctx.game.setPlayerAppearance('socket-a', { color: '#123456', avatarGrid: custom }).success, true);
  assert.deepEqual(ctx.game.getPlayerBySocket('socket-a').avatarGrid, custom);
  assert.equal(ctx.game.setPlayerAppearance('socket-a', { color: '#654321', avatarGrid: null }).success, true);
  assert.equal(ctx.game.getPlayerBySocket('socket-a').avatarGrid, null);
  assert.equal(ctx.game.setPlayerAppearance('socket-a', { color: '#abcdef' }).success, true);
  assert.equal(ctx.game.getPlayerBySocket('socket-a').avatarGrid, null);
});

check('FIX4 reconnect rejects malformed grid with distinct error and keeps old face', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', color: '#d74438' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B', color: '#286ea1' });
  const before = room.game.getPlayerByClient('client-b').avatarGrid;
  const bad = Array.from({ length: 9 }, () => Array.from({ length: 8 }, () => '#ffffff'));
  const result = room.addOrReconnectPlayer({ socketId: 'socket-b2', clientId: 'client-b', nickname: 'B', avatarGrid: bad });
  assert.deepEqual(result, { success: false, error: GRID_ERROR });
  assert.deepEqual(room.game.getPlayerByClient('client-b').avatarGrid, before);
});

check('FIX4 reconnect accepts valid grid', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', color: '#d74438' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B', color: '#286ea1' });
  const custom = validGrid('#123456');
  const result = room.addOrReconnectPlayer({ socketId: 'socket-b2', clientId: 'client-b', nickname: 'B', avatarGrid: custom });
  assert.equal(result.success, true);
  assert.deepEqual(room.game.getPlayerByClient('client-b').avatarGrid, custom);
});

const failed = results.filter(r => !r).length;
console.log(`\naudit-rooms-settle tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
