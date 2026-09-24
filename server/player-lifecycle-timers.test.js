import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';

const failures = [];

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

class FakeClock {
  constructor(now = 1_000_000) {
    this.time = now;
    this.nextId = 1;
    this.pending = new Map();
    this.records = [];
    this.clearCalls = [];
  }

  now = () => this.time;

  setTimeout = (callback, delay) => {
    const timer = {
      id: this.nextId++,
      callback,
      dueAt: this.time + Math.max(0, Number(delay) || 0),
      cancelled: false
    };
    this.pending.set(timer.id, timer);
    this.records.push(timer);
    return timer;
  };

  clearTimeout = timer => {
    if (!timer) return;
    this.clearCalls.push(timer.id);
    timer.cancelled = true;
    this.pending.delete(timer.id);
  };

  advanceBy(milliseconds) {
    const target = this.time + milliseconds;
    while (true) {
      const next = [...this.pending.values()]
        .filter(timer => !timer.cancelled)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0];
      if (!next || next.dueAt > target) break;
      this.pending.delete(next.id);
      this.time = next.dueAt;
      next.callback();
    }
    this.time = target;
  }

  invokeEvenIfCancelled(timer) {
    timer.callback();
  }
}

class FakeSocket {
  constructor(id, roomCode) {
    this.id = id;
    this.rooms = new Set([id, roomCode]);
    this.data = {};
    this.middlewares = [];
    this.emitted = [];
  }

  use(middleware) { this.middlewares.push(middleware); }
  join(roomCode) { this.rooms.add(roomCode); }
  leave(roomCode) { this.rooms.delete(roomCode); }
  emit(event, payload) { this.emitted.push({ event, payload }); }

  receive(event = 'client-activity') {
    this.middlewares.forEach(middleware => middleware([event], () => {}));
  }
}

function makeFixture({ players = 3, currentIndex = 0, started = true, includeBots = false } = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  const seats = [room.game.players[0]];
  for (let index = 1; index < players; index += 1) {
    const suffix = String.fromCharCode(97 + index);
    const result = room.addOrReconnectPlayer({
      socketId: `socket-${suffix}`,
      clientId: `client-${suffix}`,
      nickname: suffix.toUpperCase()
    });
    seats.push(result.player);
    manager.socketRoom.set(result.player.socketId, room);
  }
  if (includeBots) {
    const result = room.addOrReconnectPlayer({
      socketId: null,
      clientId: 'bot-seat',
      nickname: 'Bot',
      isBot: true
    });
    seats.push(result.player);
  }

  room.game.started = started;
  room.game.startedAt = started ? 900_000 : null;
  room.game.roundNumber = 1;
  room.game.turnOrder = seats.map(player => player.id);
  room.game.currentPlayerId = seats[currentIndex]?.id || null;

  const sockets = new Map();
  seats.filter(player => !player.isBot).forEach(player => {
    const socket = new FakeSocket(player.socketId, room.roomCode);
    sockets.set(socket.id, socket);
  });
  const connectionHandlers = [];
  const io = {
    on(event, handler) {
      if (event === 'connection') connectionHandlers.push(handler);
    },
    emit() {},
    in() { return { emit() {} }; },
    sockets: { sockets }
  };
  const clock = new FakeClock();
  const runtime = createRuntime({
    io,
    roomManager: manager,
    accountStore: {},
    socialStore: {},
    matchStore: {},
    achievementStore: {},
    seasonStore: {},
    cosmeticStore: {},
    telemetryStore: { record() {} },
    botAdvisor: {},
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
    maintenance: {},
    metrics: { setMetric() {} },
    authoritativeStore: {},
    pubsubAdapter: {},
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: () => ({ unref() {} }),
    clearInterval() {}
  });
  connectionHandlers.forEach(connect => sockets.forEach(socket => connect(socket)));
  return { manager, room, seats, sockets, io, clock, runtime, connectionHandlers };
}

check('disconnect grace retains a seat until exactly 120 seconds, then advances the current turn', () => {
  const ctx = makeFixture();
  const [departing, next] = ctx.seats;
  ctx.room.game.currentPlayerId = departing.id;
  ctx.runtime.handleSocketDisconnect(ctx.sockets.get(departing.socketId));

  ctx.clock.advanceBy(119_999);
  assert.equal(ctx.room.game.getPlayerByClient(departing.clientId), departing);
  assert.equal(departing.disconnected, true);

  ctx.clock.advanceBy(1);
  assert.equal(Boolean(ctx.room.game.getPlayerByClient(departing.clientId)), false);
  assert.equal(ctx.room.game.turnOrder.includes(departing.id), false);
  assert.equal(ctx.room.game.currentPlayerId, next.id);
});

check('disconnect expiry removes a non-current seat without moving the active turn', () => {
  const ctx = makeFixture({ currentIndex: 0 });
  const [active, departing] = ctx.seats;
  ctx.runtime.handleSocketDisconnect(ctx.sockets.get(departing.socketId));
  ctx.clock.advanceBy(120_000);

  assert.equal(Boolean(ctx.room.game.getPlayerByClient(departing.clientId)), false, 'expired non-current seat should be removed');
  assert.equal(ctx.room.game.turnOrder.includes(departing.id), false, 'expired non-current seat should leave turn order');
  assert.equal(ctx.room.game.currentPlayerId, active.id, 'the current seat should keep the turn');
});

check('disconnect expiry settles a debtor and clears the removed seat assets and obligations', () => {
  const ctx = makeFixture();
  const [departing, creditor] = ctx.seats;
  const deed = ctx.room.game.getTile(1);
  departing.cash = 50;
  departing.properties = [deed.index];
  deed.ownerId = departing.id;
  const instrumentId = Object.keys(ctx.room.game.marketQuotes)[0];
  ctx.room.game.marketQuotes[instrumentId] = 10;
  departing.marketPositions = { [instrumentId]: { quantity: 2, averageCost: 9, realizedPnl: 0 } };
  ctx.room.game.pendingTrade = { fromPlayerId: departing.id, toPlayerId: creditor.id };
  ctx.room.game.pendingPlayerContract = { fromPlayerId: departing.id, toPlayerId: creditor.id };
  ctx.room.game.pendingPayment = {
    playerId: departing.id,
    creditorId: creditor.id,
    amountRemaining: 500,
    reason: 'rent'
  };
  ctx.room.game.pendingPaymentTurnOptions = {};
  ctx.runtime.handleSocketDisconnect(ctx.sockets.get(departing.socketId));

  ctx.clock.advanceBy(120_000);

  assert.equal(Boolean(ctx.room.game.getPlayerByClient(departing.clientId)), false);
  assert.equal(departing.bankrupt, true);
  assert.equal(departing.cash, 0);
  assert.equal(deed.ownerId, creditor.id);
  assert.equal(departing.marketPositions[instrumentId].quantity, 0);
  assert.equal(ctx.room.game.pendingTrade, null);
  assert.equal(ctx.room.game.pendingPlayerContract, null);
  assert.equal(creditor.cash, 1_569);
  assert.equal(ctx.room.game.pendingPayment, null);
  assert.equal(ctx.room.game.turnOrder.includes(departing.id), false);
  assert.equal(ctx.room.game.currentPlayerId, creditor.id);
});

check('a reconnect makes the previous disconnect callback harmless', () => {
  const ctx = makeFixture({ started: false });
  const player = ctx.seats[0];
  ctx.runtime.handleSocketDisconnect(ctx.sockets.get(player.socketId));
  const staleTimer = ctx.clock.records[0];
  assert.ok(staleTimer, 'disconnect should schedule an expiry callback');

  assert.equal(ctx.manager.restoreConnection(player.clientId, 'socket-a-new'), ctx.room);
  ctx.runtime.clearDisconnectTimer(player.clientId);
  ctx.clock.invokeEvenIfCancelled(staleTimer);

  assert.equal(ctx.room.game.getPlayerByClient(player.clientId), player);
  assert.equal(player.disconnected, false);
  assert.equal(player.socketId, 'socket-a-new');
});

check('an old disconnect callback cannot remove a new seat with the same client id', () => {
  const ctx = makeFixture({ started: false, players: 2 });
  const original = ctx.seats[0];
  ctx.runtime.handleSocketDisconnect(ctx.sockets.get(original.socketId));
  const staleTimer = ctx.clock.records[0];
  ctx.clock.advanceBy(120_000);

  const replacement = ctx.room.addOrReconnectPlayer({
    socketId: 'socket-a-replacement',
    clientId: original.clientId,
    nickname: 'Replacement'
  }).player;
  ctx.manager.socketRoom.set(replacement.socketId, ctx.room);
  ctx.clock.invokeEvenIfCancelled(staleTimer);

  assert.equal(ctx.room.game.getPlayerByClient(original.clientId), replacement);
  assert.notEqual(replacement.id, original.id);
});

check('a stale inactivity callback cannot evict a reconnected current seat', () => {
  const ctx = makeFixture();
  const player = ctx.seats[0];
  const oldSocket = ctx.sockets.get(player.socketId);
  ctx.runtime.emitRoomState(ctx.room);
  const staleInactivityTimer = ctx.clock.records[0];
  ctx.runtime.handleSocketDisconnect(oldSocket);

  const reconnectedSocket = new FakeSocket('socket-a-reconnected', ctx.room.roomCode);
  assert.equal(ctx.manager.restoreConnection(player.clientId, reconnectedSocket.id), ctx.room);
  ctx.sockets.set(reconnectedSocket.id, reconnectedSocket);
  ctx.connectionHandlers.forEach(connect => connect(reconnectedSocket));
  ctx.runtime.clearDisconnectTimer(player.clientId);
  ctx.runtime.emitRoomState(ctx.room);
  ctx.clock.invokeEvenIfCancelled(staleInactivityTimer);

  assert.equal(ctx.room.game.getPlayerByClient(player.clientId), player);
  assert.equal(player.socketId, reconnectedSocket.id);
  assert.equal(player.disconnected, false);
});

check('reconnecting counts as fresh activity and restores a full inactivity window', () => {
  const ctx = makeFixture();
  const player = ctx.seats[0];
  const oldSocket = ctx.sockets.get(player.socketId);
  ctx.runtime.emitRoomState(ctx.room);
  ctx.clock.advanceBy(179_000);
  ctx.runtime.handleSocketDisconnect(oldSocket);
  ctx.clock.advanceBy(50_000);

  const reconnectedSocket = new FakeSocket('socket-a-reconnected', ctx.room.roomCode);
  assert.equal(ctx.manager.restoreConnection(player.clientId, reconnectedSocket.id), ctx.room);
  ctx.sockets.set(reconnectedSocket.id, reconnectedSocket);
  ctx.connectionHandlers.forEach(connect => connect(reconnectedSocket));
  ctx.runtime.clearDisconnectTimer(player.clientId);
  ctx.runtime.recordPlayerActivity(reconnectedSocket);
  ctx.runtime.emitRoomState(ctx.room);

  ctx.clock.advanceBy(179_999);
  assert.equal(ctx.room.game.getPlayerByClient(player.clientId), player);
  ctx.clock.advanceBy(1);
  assert.equal(Boolean(ctx.room.game.getPlayerByClient(player.clientId)), false);
});

check('pruning an expired disconnected seat clears its stale expiry registration', () => {
  const ctx = makeFixture({ started: false, players: 2 });
  const player = ctx.seats[0];
  ctx.runtime.handleSocketDisconnect(ctx.sockets.get(player.socketId));
  const expiry = ctx.clock.records.at(-1);
  assert.ok(expiry, 'disconnect should schedule an expiry callback');

  ctx.room.pruneExpiredSeats(Date.now());
  assert.equal(Boolean(ctx.room.game.getPlayerByClient(player.clientId)), false);
  ctx.clock.invokeEvenIfCancelled(expiry);
  const clearCountAfterCallback = ctx.clock.clearCalls.length;
  ctx.runtime.clearDisconnectTimer(player.clientId);

  assert.equal(ctx.clock.clearCalls.length, clearCountAfterCallback);
});

check('current human inactivity expires after 180 seconds without inbound socket activity', () => {
  const ctx = makeFixture();
  const [departing, next] = ctx.seats;
  ctx.runtime.emitRoomState(ctx.room);

  ctx.clock.advanceBy(180_000);

  assert.equal(Boolean(ctx.room.game.getPlayerByClient(departing.clientId)), false);
  assert.equal(ctx.room.game.currentPlayerId, next.id);
});

check('same-seat synchronization is idempotent and a new game start resets its inactivity deadline', () => {
  const ctx = makeFixture();
  ctx.runtime.emitRoomState(ctx.room);
  const originalTimer = ctx.clock.records.at(-1);
  assert.ok(originalTimer, 'the active human should receive an inactivity timer');

  ctx.clock.advanceBy(5_000);
  ctx.runtime.emitRoomState(ctx.room);
  assert.equal(ctx.clock.records.at(-1), originalTimer, 'same-socket sync should preserve the current timer callback');
  assert.equal(originalTimer.dueAt, 1_180_000, 'same-socket sync should preserve the original deadline');

  ctx.room.game.startedAt += 1;
  ctx.runtime.emitRoomState(ctx.room);
  const restartedTimer = ctx.clock.records.at(-1);
  assert.notEqual(restartedTimer, originalTimer, 'a new game must receive a fresh timer callback');
  assert.equal(originalTimer.cancelled, true, 'the previous game timer must be cleared');
  assert.equal(restartedTimer.dueAt, ctx.clock.now() + 180_000, 'a new game must receive a full inactivity budget');
});

check('any inbound player packet resets the current seat inactivity budget', () => {
  const ctx = makeFixture();
  const [current] = ctx.seats;
  assert.equal(ctx.connectionHandlers.length, 1);
  assert.equal(ctx.sockets.get(current.socketId).middlewares.length, 1);
  ctx.runtime.emitRoomState(ctx.room);
  const socket = ctx.sockets.get(current.socketId);

  ctx.clock.advanceBy(179_999);
  socket.receive('send-chat');
  ctx.clock.advanceBy(179_999);
  assert.equal(ctx.room.game.getPlayerByClient(current.clientId), current);

  ctx.clock.advanceBy(1);
  assert.equal(Boolean(ctx.room.game.getPlayerByClient(current.clientId)), false);
});

check('a passive non-current player keeps a full inactivity budget until their turn begins', () => {
  const ctx = makeFixture({ players: 4 });
  const [current, waiting, next] = ctx.seats;
  assert.equal(ctx.room.game.connectedNonBankruptPlayers().length, 4);
  assert.equal(ctx.connectionHandlers.length, 1);
  assert.equal(ctx.sockets.get(current.socketId).middlewares.length, 1);
  ctx.runtime.emitRoomState(ctx.room);

  ctx.clock.advanceBy(180_000);
  assert.equal(Boolean(ctx.room.game.getPlayerByClient(current.clientId)), false);
  assert.equal(ctx.room.game.getPlayerByClient(waiting.clientId), waiting);
  assert.equal(ctx.room.game.currentPlayerId, waiting.id, `expected ${waiting.nickname} after ${current.nickname} expired; started=${ctx.room.game.started}, winner=${ctx.room.game.lastWinner?.nickname || 'none'}, seats=${ctx.room.game.players.map(player => player.nickname).join(',')}`);

  ctx.clock.advanceBy(179_999);
  assert.equal(ctx.room.game.getPlayerByClient(waiting.clientId), waiting);
  ctx.clock.advanceBy(1);
  assert.equal(Boolean(ctx.room.game.getPlayerByClient(waiting.clientId)), false);
  assert.equal(ctx.room.game.currentPlayerId, next.id);
});

check('an inactive debtor is settled through bankruptcy before seat assets are released', () => {
  const ctx = makeFixture();
  const [debtor, creditor] = ctx.seats;
  const deed = ctx.room.game.getTile(1);
  debtor.cash = 50;
  debtor.properties = [deed.index];
  deed.ownerId = debtor.id;
  const instrumentId = Object.keys(ctx.room.game.marketQuotes)[0];
  ctx.room.game.marketQuotes[instrumentId] = 10;
  debtor.marketPositions = { [instrumentId]: { quantity: 2, averageCost: 9, realizedPnl: 0 } };
  ctx.room.game.pendingTrade = { fromPlayerId: debtor.id, toPlayerId: creditor.id };
  ctx.room.game.pendingPlayerContract = { fromPlayerId: debtor.id, toPlayerId: creditor.id };
  ctx.room.game.pendingPayment = {
    playerId: debtor.id,
    creditorId: creditor.id,
    amountRemaining: 500,
    reason: 'rent'
  };
  ctx.room.game.pendingPaymentTurnOptions = {};
  ctx.room.game.settings.bankruptMode = 'debt';
  const [,, queuedDebtor] = ctx.seats;
  ctx.room.game.pendingPaymentQueue = [{
    payment: { playerId: queuedDebtor.id, creditorId: null, amountRemaining: 80, reason: 'bank debt' },
    hooks: {},
    turnOptions: {}
  }];
  assert.equal(ctx.connectionHandlers.length, 1);
  assert.equal(ctx.sockets.get(debtor.socketId).middlewares.length, 1);
  ctx.runtime.emitRoomState(ctx.room);

  ctx.clock.advanceBy(180_000);

  assert.equal(Boolean(ctx.room.game.getPlayerByClient(debtor.clientId)), false);
  assert.equal(debtor.bankrupt, true);
  assert.equal(debtor.cash, 0);
  assert.equal(deed.ownerId, creditor.id);
  assert.equal(debtor.marketPositions[instrumentId].quantity, 0);
  assert.equal(ctx.room.game.pendingTrade, null);
  assert.equal(ctx.room.game.pendingPlayerContract, null);
  assert.equal(creditor.cash, 1_569);
  assert.deepEqual(ctx.room.game.pendingPayment, {
    playerId: queuedDebtor.id,
    creditorId: null,
    amountRemaining: 80,
    reason: 'bank debt'
  });
  assert.equal(ctx.room.game.turnOrder.includes(debtor.id), false);
});

check('pruning an expired seat uses the full started-game release path', () => {
  const ctx = makeFixture();
  const [departing, next] = ctx.seats;
  const deed = ctx.room.game.getTile(1);
  departing.properties = [deed.index];
  deed.ownerId = departing.id;
  departing.disconnected = true;
  departing.socketId = null;
  departing.disconnectDeadline = ctx.clock.now() - 1;

  assert.equal(ctx.room.pruneExpiredSeats(ctx.clock.now()), 1);

  assert.equal(Boolean(ctx.room.game.getPlayerByClient(departing.clientId)), false);
  assert.equal(deed.ownerId, null);
  assert.equal(ctx.room.game.turnOrder.includes(departing.id), false);
  assert.equal(ctx.room.game.currentPlayerId, next.id);
});

check('inactivity tracking never schedules a bot seat', () => {
  const ctx = makeFixture({ players: 2, currentIndex: 2, includeBots: true });
  const bot = ctx.seats[2];
  assert.equal(bot.isBot, true);
  assert.equal(ctx.connectionHandlers.length, 1);
  ctx.runtime.emitRoomState(ctx.room);

  assert.equal(ctx.clock.records.some(timer => timer.dueAt - ctx.clock.time === 180_000), false);
});

if (failures.length) {
  console.log(`\nplayer lifecycle timer tests: ${failures.length} failed`);
  process.exit(1);
}
console.log('\nplayer lifecycle timer tests: all passed');
process.exit(0);
