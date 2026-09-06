// Audit fixes for trade proposal guards, market obligation parity, and the
// auction charge-before-transfer ordering. Pinned in the check() style of
// server/contracts-market.test.js: results array, check(name, fn), summary
// print, process.exit(failed ? 1 : 0).
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

function startedRoom(settings = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  for (const [key, value] of Object.entries(settings)) room.setRoomSetting(key, value);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  game.currentPlayerId = game.players[0].id;
  return { room, game, a: game.players[0], b: game.players[1] };
}

function auctionFixture(bid, winnerCash) {
  const ctx = startedRoom();
  const tile = ctx.game.getTile(1);
  tile.ownerId = null;
  const winner = ctx.a;
  winner.cash = winnerCash;
  winner.properties = [];
  ctx.game.auction = {
    propertyTile: tile,
    active: true,
    highestBid: bid,
    highestBidderId: winner.id,
    participants: [ctx.a.id, ctx.b.id],
    passedPlayerIds: [],
    startedAt: Date.now(),
    endsAt: Date.now() + 5000,
    cooldownUntil: 0,
    lastBidAt: 0
  };
  ctx.game.auctionsCompleted = 0;
  ctx.game.pendingPayment = null;
  return { ...ctx, tile, winner };
}

function trapOwnerTransfer(tile, winner) {
  const state = { seen: false, cashAtTransfer: null };
  let current = tile.ownerId;
  Object.defineProperty(tile, 'ownerId', {
    configurable: true,
    get() {
      return current;
    },
    set(value) {
      state.seen = true;
      state.cashAtTransfer = winner.cash;
      current = value;
    }
  });
  return state;
}

function feedHas(game, text) {
  return game.feed.map((entry) => entry.text).includes(text);
}

check('auction winner without cash cannot win and holds no deed', () => {
  const { game, tile, winner } = auctionFixture(200, 50);
  game.finishAuction();
  assert.equal(tile.ownerId, null);
  assert.deepEqual(winner.properties, []);
  assert.equal(winner.cash, 50);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.auction, null);
  assert.equal(game.auctionsCompleted, 0);
  assert.equal(feedHas(game, 'Auction ended without a valid winner.'), true);
});

check('auction charge precedes transfer for a solvent winner', () => {
  const { game, tile, winner } = auctionFixture(200, 1500);
  const cashBefore = winner.cash;
  const trap = trapOwnerTransfer(tile, winner);
  game.finishAuction();
  assert.equal(trap.seen, true);
  assert.equal(trap.cashAtTransfer, cashBefore - 200);
  assert.equal(tile.ownerId, winner.id);
  assert.deepEqual(winner.properties, [tile.index]);
  assert.equal(winner.cash, cashBefore - 200);
  assert.equal(game.auction, null);
  assert.equal(game.auctionsCompleted, 1);
  assert.equal(feedHas(game, `${winner.nickname} won the auction for ${tile.name} at $200.`), true);
});

check('trade proposal blocked during pendingPayment', () => {
  const { game, b } = startedRoom();
  const toPlayer = game.getPlayerById(b.id);
  toPlayer.cash = 50;
  game.pendingPayment = { playerId: 'x', creditorId: null, amountRemaining: 1, reason: 'r' };
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 500 }), { success: false, error: 'Another trade is already pending.' });
  assert.equal(game.pendingTrade, null);
});

check('trade proposal blocked during auction', () => {
  const { game, b } = startedRoom();
  game.auction = { active: true };
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }), { success: false, error: 'Another trade is already pending.' });
  assert.equal(game.pendingTrade, null);
});

check('trade proposal blocked during pendingPurchaseOffer', () => {
  const { game, b } = startedRoom();
  game.pendingPurchaseOffer = { playerId: 'x', tileIndex: 1 };
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 10 }), { success: false, error: 'Another trade is already pending.' });
  assert.equal(game.pendingTrade, null);
});

check('trade proposal rejects unpayable requestCash', () => {
  const { game, b } = startedRoom();
  const toPlayer = game.getPlayerById(b.id);
  toPlayer.cash = 50;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, requestCash: 500 }), { success: false, error: 'One of the players no longer has enough cash.' });
  assert.equal(game.pendingTrade, null);
});

check('trade proposal keeps sender-cash precedence over requestCash', () => {
  const { game, a, b } = startedRoom();
  const fromPlayer = game.getPlayerById(a.id);
  const toPlayer = game.getPlayerById(b.id);
  fromPlayer.cash = 10;
  toPlayer.cash = 10;
  assert.deepEqual(game.proposeTrade('socket-a', { toPlayerId: b.id, giveCash: 100, requestCash: 500 }), { success: false, error: 'You do not have enough cash for this offer.' });
  assert.equal(game.pendingTrade, null);
});

check('market blocked on pendingPurchaseOffer', () => {
  const { game } = startedRoom({ market: true });
  game.pendingPurchaseOffer = { playerId: 'x', tileIndex: 1 };
  assert.deepEqual(game.tradeMarket('socket-a', 'brazil', 'buy', 1), { success: false, error: 'Resolve the table obligation before trading.' });
  game.pendingPurchaseOffer = null;
  const retry = game.tradeMarket('socket-a', 'brazil', 'buy', 1);
  assert.equal(retry.success, true);
});

const failed = results.filter((r) => !r).length;
console.log(`\naudit trade+auction tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
