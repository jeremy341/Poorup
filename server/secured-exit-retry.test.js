import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { createRuntime, settleAfkPayment } from './socketRuntime.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';

function fixture({ bankFailure = false } = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'retry-lender', clientId: 'retry-lender', nickname: 'Lender', rulesProfile: 'advanced', rulesetOverrides: [{ key: 'bankLoans', value: true }] });
  room.addOrReconnectPlayer({ socketId: 'retry-borrower', clientId: 'retry-borrower', nickname: 'Borrower' });
  room.addOrReconnectPlayer({ socketId: 'retry-other', clientId: 'retry-other', nickname: 'Other' });
  assert.equal(room.startGame().success, true);
  const game = room.game, [lender, borrower, other] = game.players;
  for (const index of [1, 3]) { game.getTile(index).ownerId = borrower.id; borrower.properties.push(index); }
  const proposed = game.proposePlayerContract('retry-lender', { toPlayerId: borrower.id, kind: 'loan', amount: 300, durationRounds: 3, collateralTileIndices: [1, 3] });
  assert.equal(proposed.success, true, proposed.error);
  assert.equal(game.respondPlayerContract('retry-borrower', true).success, true);
  const contract = game.playerContracts[0];
  borrower.cash = 0;
  game.currentPlayerId = borrower.id;
  if (bankFailure) {
    game.getTile(39).ownerId = borrower.id;
    borrower.properties.push(39);
    assert.equal(game.takeBankLoan('retry-borrower').success, true);
    borrower.cash = 0;
  }
  manager.socketRoom.set(borrower.socketId, room);
  manager.socketRoom.set(other.socketId, room);
  game.pendingPayment = { playerId: borrower.id, creditorId: other.id, amountRemaining: 80, reason: 'preserve retry debt' };
  game.pendingPaymentTurnOptions = { allowExtraRoll: true };
  game.pendingPaymentQueue = [{ payment: { playerId: other.id, creditorId: lender.id, amountRemaining: 5 }, turnOptions: {}, hooks: {} }];
  game.pendingTrade = { id: 'retry-trade', fromPlayerId: borrower.id, toPlayerId: other.id };
  const transfer = game.applyPropertyOwnershipChange.bind(game);
  let failed = false;
  if (bankFailure) {
    const feed = game.feedMessage.bind(game);
    game.feedMessage = text => { if (!failed && text.includes('The bank seized')) { failed = true; throw new Error('one-time bank foreclosure feed failure'); } return feed(text); };
  } else game.applyPropertyOwnershipChange = (...args) => { transfer(...args); if (!failed) { failed = true; throw new Error('one-time secured exit failure'); } };
  return { manager, room, game, lender, borrower, other, contract };
}
function snapshot({ manager, room, game }) {
  return structuredClone({ players: game.players, tiles: game.tiles, contracts: game.playerContracts, claims: game.defaultClaims, feed: game.feed,
    pending: game.pendingPayment, options: game.pendingPaymentTurnOptions, queue: game.pendingPaymentQueue, trade: game.pendingTrade,
    turnOrder: game.turnOrder, current: game.currentPlayerId, rolled: game.hasRolled, started: game.started,
    mappings: [...manager.socketRoom].map(([socketId, mapped]) => [socketId, mapped.roomCode]), hostId: room.hostId,
    blockedClients: [...room.kickedClientIds], blockedAccounts: [...room.kickedAccountIds] });
}
function assertSettled(ctx) {
  assert.equal(ctx.contract.status, 'defaulted');
  assert.equal(ctx.contract.collateralCreditApplied, 120);
  assert.deepEqual(ctx.contract.collateralSeizedTileIndices, [1, 3]);
  for (const index of [1, 3]) {
    assert.equal(ctx.game.getTile(index).ownerId, ctx.lender.id);
    assert.equal(ctx.lender.properties.filter(owned => owned === index).length, 1);
  }
}

test('room seat removal preserves mappings, debt, and estate on failure and retries once', () => {
  const ctx = fixture(), before = snapshot(ctx);
  const remove = () => ctx.manager.removeRoomSeat({ clientId: ctx.borrower.clientId, socketId: ctx.borrower.socketId, room: ctx.room, preventRejoin: true });
  const failed = remove();
  assert.equal(failed.success, false);
  assert.equal(failed.retryable, true);
  assert.deepEqual(snapshot(ctx), before);
  assert.equal(remove().success, true);
  assert.equal(ctx.game.players.includes(ctx.borrower), false);
  assertSettled(ctx);
});

for (const route of ['trySettlePendingPayment', 'skipDisconnectedCurrentPlayer', 'settleAfkPayment']) {
  test(`${route} preserves the pending debt and turn on retryable collateral failure`, () => {
    const ctx = fixture();
    ctx.borrower.disconnected = true;
    const before = snapshot(ctx);
    const run = () => route === 'settleAfkPayment' ? settleAfkPayment(ctx.game, ctx.borrower) : ctx.game[route]();
    const failed = run();
    assert.notEqual(failed, true);
    assert.deepEqual(snapshot(ctx), before);
    run();
    assert.equal(ctx.borrower.bankrupt, true);
    assertSettled(ctx);
  });
}


test('bank foreclosure feed failure preserves the whole seat exit and retries both agreements', () => {
  const ctx = fixture({ bankFailure: true }), before = snapshot(ctx);
  const remove = () => ctx.manager.removeRoomSeat({ clientId: ctx.borrower.clientId, socketId: ctx.borrower.socketId, room: ctx.room });
  assert.equal(remove().retryable, true);
  assert.deepEqual(snapshot(ctx), before);
  assert.equal(remove().success, true);
  assertSettled(ctx);
  assert.equal(ctx.borrower.bankLoan.collateralCreditApplied, 400);
  assert.equal(ctx.game.getTile(39).ownerId, null);
});

function runtimeHarness(ctx) {
  let time = 10_000, serial = 0;
  const timers = new Map(), sockets = new Map(), emitted = [];
  for (const player of ctx.game.players) sockets.set(player.socketId, {
    id: player.socketId, data: {}, rooms: new Set([player.socketId, ctx.room.roomCode]),
    emit(event, payload) { emitted.push({ socketId: this.id, event, payload, seatPresent: ctx.game.players.includes(player) }); },
    join(code) { this.rooms.add(code); }, leave(code) { this.rooms.delete(code); }
  });
  const runtime = createRuntime({
    io: { sockets: { sockets }, on() {}, emit() {}, to() { return { emit() {} }; }, in() { return { emit(event, payload) { emitted.push({ event, payload }); } }; } },
    roomManager: ctx.manager, accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {},
    social: { accountForSocket: () => null, chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount: () => [] },
    setInterval: () => 0, clearInterval() {}, disconnectGraceMs: 100, now: () => time,
    setTimeout(callback, delay) { const timer = { id: ++serial, callback, delay, deadline: time + delay }; timers.set(timer.id, timer); return timer; },
    clearTimeout(timer) { if (timer) timers.delete(timer.id); }
  });
  return { runtime, timers, emitted, socket: sockets.get(ctx.borrower.socketId), sockets,
    setTime(value) { time = value; },
    runDue() { const due = [...timers.values()].filter(timer => timer.deadline <= time); for (const timer of due) { timers.delete(timer.id); timer.callback(); } }
  };
}

for (const event of ['leave-room', 'create-room']) {
  test(`${event} acknowledges retryable exit failure without detaching the original seat`, () => {
    const ctx = fixture(), harness = runtimeHarness(ctx), handlers = new Map();
    registerAccountSocketHandlers((name, handler) => handlers.set(name, handler), harness.socket, harness.runtime);
    const payload = { clientId: ctx.borrower.clientId, nickname: 'Borrower', visibility: 'public' };
    const invoke = () => { let response; handlers.get(event)(payload, value => { response = value; }); return response; };
    const before = snapshot(ctx);
    assert.equal(invoke().retryable, true);
    assert.deepEqual(snapshot(ctx), before);
    assert.equal(harness.socket.rooms.has(ctx.room.roomCode), true);
    assert.equal(ctx.manager.rooms.size, 1);
    assert.equal(invoke().success, true);
    assert.equal(ctx.game.players.includes(ctx.borrower), false);
    assertSettled(ctx);
    if (event === 'create-room') assert.equal(ctx.manager.rooms.size, 2);
  });
}

for (const reason of ['disconnect', 'inactivity']) {
  test(`${reason} expiry retains its original deadline and retries settlement after one second`, () => {
    const ctx = fixture(), harness = runtimeHarness(ctx);
    if (reason === 'disconnect') harness.runtime.handleSocketDisconnect(harness.socket);
    else assert.equal(harness.runtime.setPlayerPresence(harness.socket, { state: 'inactive', reason: 'idle' }).success, true);
    const deadline = reason === 'disconnect' ? ctx.borrower.disconnectDeadline : ctx.borrower.presence.inactiveUntil;
    const before = snapshot(ctx);
    harness.setTime(deadline);
    harness.runDue();
    assert.deepEqual(snapshot(ctx), before);
    assert.equal([...harness.timers.values()].some(timer => timer.delay === 1_000), true);
    assert.equal(harness.emitted.some(entry => entry.payload?.text?.includes('was removed for')), false);
    harness.setTime(deadline + 1_000);
    harness.runDue();
    assert.equal(ctx.game.players.includes(ctx.borrower), false);
    assertSettled(ctx);
  });
}

const isRemovedAfterNotice = entry => entry.payload?.text?.includes('was removed after');
function removedAfterNotices(harness) {
  const notices = harness.emitted.filter(isRemovedAfterNotice);
  return { direct: notices.filter(entry => entry.socketId === harness.socket.id), room: notices.filter(entry => !entry.socketId) };
}
function assertOneRemovalNotice(harness) {
  const { direct, room } = removedAfterNotices(harness);
  assert.equal(direct.length, 1, 'the removed target receives one direct successful notice');
  assert.equal(room.length, 1, 'the room receives one successful notice');
}

test('a passed vote-kick retries safe settlement without extra ballots or early removal notices', () => {
  const ctx = fixture(), harness = runtimeHarness(ctx);
  const started = harness.runtime.startRoomVoteKick(harness.sockets.get(ctx.lender.socketId), { targetPlayerId: ctx.borrower.id, requestId: 'secured-vote-start' });
  assert.equal(started.success, true);
  const before = snapshot(ctx);
  const payload = { voteId: started.vote.voteId, choice: 'yes', requestId: 'secured-vote-cast' };
  const passed = harness.runtime.castRoomVoteKick(harness.sockets.get(ctx.other.socketId), payload);
  assert.equal(passed.vote.status, 'passed');
  assert.deepEqual(snapshot(ctx), before);
  assert.equal(harness.emitted.some(isRemovedAfterNotice), false);
  harness.runtime.castRoomVoteKick(harness.sockets.get(ctx.other.socketId), payload);
  assert.deepEqual(snapshot(ctx), before);
  harness.setTime(11_000);
  harness.runDue();
  assert.equal(ctx.game.players.includes(ctx.borrower), false);
  assertOneRemovalNotice(harness);
  assert.equal(removedAfterNotices(harness).direct[0].seatPresent, false, 'the direct notice follows successful seat removal');
  assertSettled(ctx);
  harness.setTime(12_000);
  harness.runDue();
  assertOneRemovalNotice(harness);
});
