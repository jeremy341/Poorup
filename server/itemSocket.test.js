import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';
import { createSafeEmitter } from './socketHandlerSupport.js';
import { GAME_ACTION_CATALOG, registerGameSocketHandlers } from './serverSocketGame.js';

const ask = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  socket.timeout(1500).emit(event, payload, (error, response) => error ? reject(error) : resolve(response));
});

test('item use and sale are registered authoritative room verbs', () => {
  for (const [event, verb] of [['use-item', 'useItem'], ['sell-item', 'sellItem']]) {
    assert.deepEqual(GAME_ACTION_CATALOG.find(action => action.event === event), {
      event, verb, registration: 'registered-game-verb', surface: 'extended'
    });
  }
});

async function fixture(t) {
  const server = http.createServer();
  const io = new Server(server);
  const manager = new RoomManager();
  const runtime = createRuntime({
    io, roomManager: manager, accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {},
    telemetryStore: null, botAdvisor: {}, social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
    maintenance: {}, metrics: { setMetric() {} }, authoritativeStore: {}, pubsubAdapter: {}
  });
  io.on('connection', socket => registerGameSocketHandlers(createSafeEmitter(socket), socket, runtime));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const sockets = [];
  t.after(async () => {
    runtime.dispose();
    sockets.forEach(socket => socket.disconnect());
    await new Promise(resolve => io.close(resolve));
  });
  async function open() {
    const socket = connect(`http://127.0.0.1:${server.address().port}`, { transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket);
    await once(socket, 'connect');
    return socket;
  }
  const host = await open();
  const guest = await open();
  const outsider = await open();
  const room = manager.createRoom({ socketId: host.id, clientId: 'item-host', nickname: 'Host' });
  room.addOrReconnectPlayer({ socketId: guest.id, clientId: 'item-guest', nickname: 'Guest' });
  assert.equal(manager.restoreConnection('item-guest', guest.id), room);
  room.setRoomSetting('itemRewards', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [player, other] = game.players;
  game.currentPlayerId = player.id;
  await io.sockets.sockets.get(host.id).join(room.roomCode);
  await io.sockets.sockets.get(guest.id).join(room.roomCode);
  return { io, manager, runtime, room, game, player, other, host, guest, outsider };
}

test('real sockets redeem and sell once, reject theft and malformed input, and publish private inventories', async t => {
  const { game, room, player, other, host, guest, outsider } = await fixture(t);
  const bond = game.grantItem(player, 'parlor-bond', 'treasure');
  const keepsake = game.grantItem(player, 'silver-keepsake', 'surprise');
  const otherItem = game.grantItem(other, 'silver-keepsake', 'surprise');
  const startingCash = player.cash;
  assert.equal((await ask(host, 'use-item', { itemId: bond.itemId, requestId: 'early' })).success, false);
  assert.equal((await ask(guest, 'sell-item', { itemId: keepsake.itemId, requestId: 'theft' })).success, false);
  assert.equal((await ask(outsider, 'sell-item', { itemId: keepsake.itemId, requestId: 'outsider' })).error, 'Room not found.');
  for (const payload of [null, [], 'bad', { itemId: { id: keepsake.itemId }, requestId: 'bad-id' }, { itemId: keepsake.itemId }]) {
    assert.equal((await ask(host, 'sell-item', payload)).success, false);
  }
  assert.equal(player.cash, startingCash);
  const hostUpdate = once(host, 'update-state');
  const guestUpdate = once(guest, 'update-state');
  const sold = await ask(host, 'sell-item', { itemId: keepsake.itemId, requestId: 'sale', cashReceived: 9999, price: 9999 });
  assert.equal(sold.success, true);
  assert.equal(sold.action, 'sell');
  assert.equal(sold.itemId, keepsake.itemId);
  assert.equal(sold.cashReceived, 600);
  assert.deepEqual(await ask(host, 'sell-item', { itemId: keepsake.itemId, requestId: 'sale' }), sold);
  assert.equal(player.cash, startingCash + 600);
  const [{ game: ownerState }] = await hostUpdate;
  const [{ game: rivalState }] = await guestUpdate;
  assert.deepEqual(ownerState.players.find(seat => seat.id === player.id).items.map(item => item.itemId), [bond.itemId]);
  assert.equal(Object.hasOwn(ownerState.players.find(seat => seat.id === other.id), 'items'), false);
  assert.deepEqual(rivalState.players.find(seat => seat.id === other.id).items.map(item => item.itemId), [otherItem.itemId]);
  assert.equal(Object.hasOwn(rivalState.players.find(seat => seat.id === player.id), 'items'), false);
  for (const summary of [game.getGameSummary(), game.getGameSummary('spectator'), room.getRoomSummary()]) {
    assert.equal(JSON.stringify(summary).includes(bond.itemId), false);
    assert.equal(JSON.stringify(summary).includes(otherItem.itemId), false);
  }
  game.roundNumber = bond.maturesRound;
  const redeemed = await ask(host, 'use-item', { itemId: bond.itemId, requestId: 'redeem', redeemValue: 9999 });
  assert.deepEqual(redeemed, { success: true, action: 'use', itemId: bond.itemId, cashReceived: 800 });
  assert.deepEqual(await ask(host, 'use-item', { itemId: bond.itemId, requestId: 'redeem' }), redeemed);
  assert.equal(player.cash, startingCash + 1400);
  assert.equal((await ask(host, 'use-item', { itemId: bond.itemId, requestId: 'consumed' })).success, false);
  assert.equal((await ask(host, 'sell-item', { itemId: otherItem.itemId, requestId: 'sale' })).success, false);
});

test('real item sockets obey match authority and settle a debt rescue sale', async t => {
  const { game, player, other, host, guest } = await fixture(t);
  const key = game.grantItem(player, 'prison-key', 'surprise');
  player.inJail = true;
  const freed = await ask(host, 'use-item', { itemId: key.itemId, requestId: 'free' });
  assert.equal(freed.success, true);
  assert.equal(freed.cashReceived, 0);
  assert.equal(player.inJail, false);
  const offTurn = game.grantItem(other, 'silver-keepsake', 'treasure');
  assert.equal((await ask(guest, 'sell-item', { itemId: offTurn.itemId, requestId: 'off-turn' })).cashReceived, 600);
  const rescue = game.grantItem(other, 'silver-keepsake', 'treasure');
  other.cash = 0;
  game.chargePlayer({ player: other, amount: 60, creditor: player, message: 'Item rescue test' });
  const before = player.cash;
  const rescued = await ask(guest, 'sell-item', { itemId: rescue.itemId, requestId: 'rescue' });
  assert.equal(rescued.cashReceived, 600, JSON.stringify(rescued));
  assert.equal(game.pendingPayment, null);
  assert.equal(other.cash, 540);
  assert.equal(player.cash, before + 60);
  const unavailable = game.grantItem(player, 'silver-keepsake', 'surprise');
  game.started = false;
  assert.equal((await ask(host, 'sell-item', { itemId: unavailable.itemId, requestId: 'ended' })).success, false);
});

test('off-turn items can be sold or redeemed without disturbing another seat debt', async t => {
  const { game, player, other, host, guest } = await fixture(t);
  const keepsake = game.grantItem(other, 'silver-keepsake', 'surprise');
  const bond = game.grantItem(other, 'parlor-bond', 'treasure');
  const key = game.grantItem(other, 'prison-key', 'surprise');
  game.roundNumber = bond.maturesRound;
  other.inJail = true;
  assert.equal((await ask(guest, 'use-item', { itemId: key.itemId, requestId: 'off-turn-key' })).success, false);
  assert.equal((await ask(host, 'sell-item', { itemId: keepsake.itemId, requestId: 'steal-off-turn' })).success, false);
  player.cash = 0;
  game.chargePlayer({ player, amount: 200, creditor: other, message: 'Other seat debt' });
  other.cash = 0;
  game.chargePlayer({ player: other, amount: 30, creditor: player, message: 'Queued seller debt' });
  assert.equal(game.pendingPaymentQueue.length, 1);
  const pending = structuredClone(game.pendingPayment);
  const queue = structuredClone(game.pendingPaymentQueue);
  const cash = other.cash;
  const summary = game.summaryItems(other, other.id);
  assert.equal(summary.find(item => item.itemId === keepsake.itemId).canSell, true);
  assert.equal(summary.find(item => item.itemId === bond.itemId).canUse, true);
  const sale = await ask(guest, 'sell-item', { itemId: keepsake.itemId, requestId: 'off-turn-sale' });
  assert.equal(sale.cashReceived, 600);
  assert.deepEqual(await ask(guest, 'sell-item', { itemId: keepsake.itemId, requestId: 'off-turn-sale' }), sale);
  const redeemed = await ask(guest, 'use-item', { itemId: bond.itemId, requestId: 'off-turn-redeem' });
  assert.equal(redeemed.cashReceived, 800);
  assert.deepEqual(await ask(guest, 'use-item', { itemId: bond.itemId, requestId: 'off-turn-redeem' }), redeemed);
  const soldKey = await ask(guest, 'sell-item', { itemId: key.itemId, requestId: 'off-turn-key-sale' });
  assert.equal(soldKey.cashReceived, 25);
  assert.equal(other.cash, cash + 1425);
  assert.equal(player.cash, 0);
  assert.deepEqual(game.pendingPayment, pending);
  assert.deepEqual(game.pendingPaymentQueue, queue);
});

test('reconnected owner receives the same inventory instances and can act through the new socket', async t => {
  const { io, manager, runtime, room, game, player, host, guest, outsider: reconnected } = await fixture(t);
  const item = game.grantItem(player, 'silver-keepsake', 'surprise');
  const originalSocketId = host.id;
  runtime.handleSocketDisconnect(io.sockets.sockets.get(originalSocketId));
  host.disconnect();
  assert.ok(manager.restoreConnection('item-host', reconnected.id) === room);
  runtime.clearDisconnectTimer('item-host', room);
  assert.equal(manager.getRoomBySocket(originalSocketId), null);
  await io.sockets.sockets.get(reconnected.id).join(room.roomCode);
  const ownerUpdate = once(reconnected, 'update-state');
  const rivalUpdate = once(guest, 'update-state');
  runtime.emitRoomState(room);
  const [{ game: ownState }] = await ownerUpdate;
  const [{ game: rivalState }] = await rivalUpdate;
  assert.equal(ownState.players.find(seat => seat.id === player.id).items[0].itemId, item.itemId);
  assert.equal(Object.hasOwn(rivalState.players.find(seat => seat.id === player.id), 'items'), false);
  const sold = await ask(reconnected, 'sell-item', { itemId: item.itemId, requestId: 'reconnected-sale' });
  assert.equal(sold.success, true);
  assert.equal(sold.cashReceived, 600);
});
