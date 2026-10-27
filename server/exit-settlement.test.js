// Exit settlement (audit F-018, F-028, F-029, F-030): a queued debtor settles
// its claim like a head debtor, a rematch keeps a seat in reconnect grace
// off the clock, a lone solvent seat in grace holds the table and is crowned
// at expiry, and an AFK debtor who can cover pays the debt instead of going
// bankrupt. Drives the public RoomManager/Room seams and the real runtime
// timers with an injected clock.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';
import { recordDefaultClaim } from './bankruptcyLogic.js';

const failures = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS — ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL — ${name}: ${error.message}`);
  }
}

function feedTexts(game) {
  return game.feed.map(entry => entry.text);
}

function plantDebt(game, debtor, creditor, amount) {
  return {
    playerId: debtor.id,
    creditorId: creditor ? creditor.id : null,
    amountRemaining: amount,
    reason: 'rent',
    equityTileIndex: null,
    equityOwnerId: null
  };
}

function setHead(game, debtor, creditor, amount) {
  game.pendingPayment = plantDebt(game, debtor, creditor, amount);
  game.pendingPaymentHooks = {};
  game.pendingPaymentTurnOptions = {};
}

function queueDebt(game, debtor, creditor, amount) {
  game.pendingPaymentQueue ||= [];
  game.pendingPaymentQueue.push({
    payment: plantDebt(game, debtor, creditor, amount),
    hooks: {},
    turnOptions: {}
  });
}

// Three connected human seats A (host), B, C on a started game.
function trio() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C' });
  room.setRoomSetting('bots', 0);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const seat = nickname => game.players.find(player => player.nickname === nickname);
  return { manager, room, game, A: seat('A'), B: seat('B'), C: seat('C') };
}

class FakeClock {
  // Starts at Date.now() so room.startGame()'s pruneExpiredSeats(Date.now())
  // and GameState.finishIfNoConnectedPlayers agree with the runtime clock.
  constructor(start = Date.now()) {
    this.time = start;
    this.nextId = 1;
    this.pending = new Map();
  }

  now = () => this.time;

  setTimeout = (callback, delay) => {
    const timer = { id: this.nextId++, callback, dueAt: this.time + Math.max(0, Number(delay) || 0), cancelled: false };
    this.pending.set(timer.id, timer);
    return timer;
  };

  clearTimeout = timer => {
    if (!timer) return;
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
}

// A started table with a real runtime and an injected clock. Seats are named
// client-a, client-b, ... in nickname order; the first nickname hosts.
function liveTable(nicknames) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: nicknames[0] });
  const seats = [room.game.players[0]];
  nicknames.slice(1).forEach((nickname, index) => {
    const suffix = String.fromCharCode(98 + index);
    const result = room.addOrReconnectPlayer({ socketId: `socket-${suffix}`, clientId: `client-${suffix}`, nickname });
    seats.push(result.player);
    manager.socketRoom.set(result.player.socketId, room);
  });
  room.setRoomSetting('bots', 0);
  assert.equal(room.startGame().success, true);
  const sockets = new Map();
  seats.forEach(player => sockets.set(player.socketId, new FakeSocket(player.socketId, room.roomCode)));
  const clock = new FakeClock();
  const io = {
    on() {},
    emit() {},
    in() { return { emit() {} }; },
    sockets: { sockets }
  };
  const runtime = createRuntime({
    io,
    roomManager: manager,
    accountStore: {},
    socialStore: {},
    matchStore: {},
    achievementStore: {},
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
  return { manager, room, game: room.game, seats, sockets, clock, runtime };
}

// --- F-018: a queued debtor settles its claim like a head debtor -----------

check('a bankrupt queued debtor settles its claim to the creditor like a head debtor', () => {
  const { room, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  const tile = game.getTile(1);
  tile.ownerId = B.id;
  B.properties.push(1);
  B.cash = 50;
  A.cash = 1000;
  C.cash = 0;
  setHead(game, C, A, 300);
  queueDebt(game, B, A, 400);

  assert.deepEqual(room.declareBankruptcy('socket-b'), { success: true, voluntary: false });
  assert.equal(B.bankrupt, true);
  assert.equal(A.cash, 1050);
  assert.equal(tile.ownerId, A.id);
  assert.equal(game.pendingPaymentQueue.length, 0);
  assert.equal(game.pendingPayment.playerId, C.id);
  assert.equal(game.pendingPayment.amountRemaining, 300);
  assert.equal(feedTexts(game).some(text => text.includes('written off')), false);
});

check('a queued debtor writes off the claims its estate cannot cover, with a feed line', () => {
  const { room, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  B.cash = 50;
  A.cash = 1000;
  C.cash = 0;
  setHead(game, C, A, 300);
  queueDebt(game, B, A, 400);
  queueDebt(game, B, C, 200);

  room.declareBankruptcy('socket-b');
  assert.equal(A.cash, 1050);
  assert.equal(game.pendingPaymentQueue.length, 0);
  assert.equal(game.pendingPayment.playerId, C.id);
  const writeOff = feedTexts(game).find(text => text.includes('written off'));
  assert.ok(writeOff, 'the uncovered claim is announced, not dropped silently');
  assert.ok(writeOff.includes('$200') && writeOff.includes('C'), writeOff);
});

check('a queued debtor that leaves the table settles its claim with its estate', () => {
  const { manager, room, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  const tile = game.getTile(1);
  tile.ownerId = B.id;
  B.properties.push(1);
  B.cash = 50;
  A.cash = 1000;
  C.cash = 0;
  setHead(game, C, A, 300);
  queueDebt(game, B, A, 400);

  assert.ok(manager.leaveRoomByClient('client-b', 'socket-b'));
  assert.equal(room.game.getPlayerByClient('client-b'), undefined);
  assert.equal(A.cash, 1050);
  assert.equal(tile.ownerId, A.id);
  assert.equal(game.pendingPaymentQueue.length, 0);
  assert.equal(game.pendingPayment.playerId, C.id);
});

check('a queued debtor that leaves keeps the head debt and its queue order intact', () => {
  const { manager, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  A.cash = 1000;
  C.cash = 0;
  B.cash = 0;
  setHead(game, C, A, 300);
  queueDebt(game, B, A, 400);
  queueDebt(game, C, A, 150);

  manager.leaveRoomByClient('client-b', 'socket-b');
  assert.equal(game.pendingPayment.playerId, C.id);
  assert.equal(game.pendingPayment.amountRemaining, 300);
  assert.deepEqual(game.pendingPaymentQueue.map(entry => entry.payment.playerId), [C.id]);
});

check('a queued creditor that leaves still forgives the claims owed to it', () => {
  const { manager, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  A.cash = 1000;
  B.cash = 50;
  C.cash = 0;
  setHead(game, C, A, 300);
  queueDebt(game, B, A, 400);

  manager.leaveRoomByClient('client-a', 'socket-a');
  assert.equal(game.pendingPayment, null);
  assert.equal(game.pendingPaymentQueue.length, 0);
  assert.equal(B.cash, 50);
  assert.equal(B.bankrupt, false);
});

check('a head debtor that leaves writes off its own queued claims instead of dropping them', () => {
  const { manager, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  const tile = game.getTile(1);
  tile.ownerId = B.id;
  B.properties.push(1);
  B.cash = 50;
  A.cash = 1000;
  setHead(game, B, A, 300);
  queueDebt(game, B, C, 200);

  manager.leaveRoomByClient('client-b', 'socket-b');
  assert.equal(A.cash, 1050);
  assert.equal(tile.ownerId, A.id);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.pendingPaymentQueue.length, 0);
  const texts = feedTexts(game);
  assert.ok(texts.some(text => text.includes('$200') && text.includes('written off')), 'the orphaned claim is announced');
  assert.ok(texts.includes('B left the table. A pending payment was cancelled.'));
});

// --- F-028: a rematch keeps a grace seat disconnected --------------------

check('a rematch keeps a seat still in its reconnect grace off the first turn and on its original timer', () => {
  const table = liveTable(['A', 'B', 'C']);
  const [, , C] = table.seats;
  table.runtime.handleSocketDisconnect(table.sockets.get(C.socketId));
  const deadline = C.disconnectDeadline;
  table.clock.advanceBy(30_000);
  table.game.endGame();

  assert.equal(table.room.startGame().success, true);
  assert.equal(C.disconnected, true);
  assert.equal(C.disconnectDeadline, deadline);
  assert.notEqual(table.game.currentPlayerId, C.id);
  for (let step = 0; step < 4; step += 1) {
    table.game.nextTurn();
    assert.notEqual(table.game.currentPlayerId, C.id);
  }

  table.clock.advanceBy(90_000);
  assert.equal(table.game.getPlayerByClient('client-c'), undefined, 'the original grace timer still releases the seat');
  assert.equal(table.game.started, true);
});

check('a seat that reconnects inside its grace after a rematch takes turns again', () => {
  const table = liveTable(['A', 'B', 'C']);
  const [, , C] = table.seats;
  table.runtime.handleSocketDisconnect(table.sockets.get(C.socketId));
  table.clock.advanceBy(30_000);
  table.game.endGame();
  assert.equal(table.room.startGame().success, true);

  assert.ok(table.manager.restoreConnection('client-c', 'socket-c2', null));
  assert.equal(C.disconnected, false);
  let reached = table.game.currentPlayerId === C.id;
  for (let step = 0; step < 4 && !reached; step += 1) {
    table.game.nextTurn();
    reached = table.game.currentPlayerId === C.id;
  }
  assert.equal(reached, true, 'the reconnected seat is in the turn order');
});

// --- F-029: one definition of a connected seat ---------------------------

check('a sole solvent seat in grace holds the table after the other seats go bankrupt', () => {
  const table = liveTable(['A', 'B']);
  const [A, B] = table.seats;
  table.game.currentPlayerId = A.id;
  table.runtime.handleSocketDisconnect(table.sockets.get(B.socketId));

  assert.deepEqual(table.room.declareBankruptcy('socket-a'), { success: true, voluntary: true });
  assert.equal(table.game.started, true);
  assert.equal(table.game.lastWinner, null);
  assert.equal(table.game.currentPlayerId, B.id);
  assert.equal(table.game.feed[0].text, 'Waiting for B to reconnect…');

  assert.ok(table.manager.restoreConnection('client-b', 'socket-b2', null));
  assert.equal(table.game.rollTurnRejection(B), null, 'the returning seat can take its turn');
});

check('the lone solvent seat is crowned when its reconnect grace runs out', () => {
  const table = liveTable(['A', 'B']);
  const [A, B] = table.seats;
  table.game.currentPlayerId = A.id;
  table.runtime.handleSocketDisconnect(table.sockets.get(B.socketId));
  table.room.declareBankruptcy('socket-a');
  // Match-stats settlement has its own suites; this seam checks the outcome.
  table.room.statsRecorded = true;

  table.clock.advanceBy(120_000);
  assert.equal(table.game.started, false);
  assert.equal(table.game.lastWinner?.id, B.id);
  assert.equal(table.game.getPlayerById(B.id), B, 'the crowned seat stays on the table for match stats');
  assert.ok(feedTexts(table.game).includes('B is the last player remaining and wins the game!'));
});

check('a leave by the current seat waits for a solvent seat still in grace', () => {
  const table = liveTable(['A', 'B']);
  const [A, B] = table.seats;
  table.game.currentPlayerId = A.id;
  table.runtime.handleSocketDisconnect(table.sockets.get(B.socketId));

  table.manager.leaveRoomByClient('client-a', 'socket-a');
  assert.equal(table.game.started, true);
  assert.equal(table.game.lastWinner, null);
  assert.equal(table.game.currentPlayerId, B.id);

  table.room.statsRecorded = true;
  table.clock.advanceBy(120_000);
  assert.equal(table.game.started, false);
  assert.equal(table.game.lastWinner?.id, B.id);
});

// --- F-030: an AFK debtor who can cover pays the debt, not the estate ----

function afkDebtFixture(cash) {
  const table = liveTable(['A', 'B', 'C']);
  const [A, B, C] = table.seats;
  table.game.currentPlayerId = C.id;
  const tile = table.game.getTile(1);
  tile.ownerId = A.id;
  A.properties = [1];
  A.cash = cash;
  B.cash = 100;
  table.runtime.handleSocketDisconnect(table.sockets.get(A.socketId));
  setHead(table.game, A, B, 500);
  return { ...table, A, B, C, tile };
}

check('a disconnected debtor who can cover pays the debt at expiry instead of going bankrupt', () => {
  const { game, clock, A, B, tile } = afkDebtFixture(1000);
  clock.advanceBy(120_000);
  assert.equal(game.getPlayerByClient('client-a'), undefined);
  assert.equal(B.cash, 600, 'the creditor is collected for the debt amount only');
  assert.notEqual(tile.ownerId, B.id, 'the estate does not pass to the creditor');
  assert.equal(game.pendingPayment, null);
  assert.equal(feedTexts(game).some(text => text.includes('Assets transferred to B')), false);
  assert.equal(A.bankrupt, true);
});

check('another seat settling during the debtor grace collects only the debt, never bankrupts it', () => {
  const { game, A, B, tile } = afkDebtFixture(1000);
  assert.equal(game.trySettlePendingPayment(), true);
  assert.equal(A.bankrupt, false);
  assert.equal(A.cash, 500);
  assert.equal(B.cash, 600);
  assert.notEqual(tile.ownerId, B.id);
  assert.equal(game.pendingPayment, null);
});

check('a disconnected debtor who cannot cover still goes bankrupt to its creditor at expiry', () => {
  const { game, clock, B, tile } = afkDebtFixture(300);
  clock.advanceBy(120_000);
  assert.equal(B.cash, 400);
  assert.equal(tile.ownerId, B.id);
  assert.equal(game.pendingPayment, null);
});

// --- F-031 / A7-10 / D2b-04: a seat with no solvent creditor forfeits its cash --
// Every exit path that settles a seat (declared or AFK bankruptcy, voluntary
// leave, vote-kick, inactivity, disconnect expiry) reaches sweepCashToCreditor.
// With no solvent creditor that cash goes to the bank: it is zeroed on the
// departed seat and announced, so the table never strands money on a dead seat.

check('a voluntary leave with no debt forfeits the leaver cash to the bank with a feed line', () => {
  const { manager, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  A.cash = 300;
  B.cash = 400;
  C.cash = 500;
  assert.ok(manager.leaveRoomByClient('client-b', 'socket-b'));
  assert.equal(B.bankrupt, true);
  assert.equal(B.cash, 0, 'the departed seat no longer holds the stranded cash');
  assert.equal(A.cash + C.cash, 800, 'the survivors keep exactly what they held');
  assert.ok(feedTexts(game).includes('B forfeits $400 to the bank.'), 'the forfeit is announced');
  assert.ok(feedTexts(game).includes('B left the table.'));
});

check('a seat with no cash leaving with no debt writes no forfeit line', () => {
  const { manager, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  A.cash = 300;
  B.cash = 0;
  C.cash = 500;
  manager.leaveRoomByClient('client-b', 'socket-b');
  assert.equal(feedTexts(game).some(text => text.includes('forfeits')), false);
});

check('a voluntary bankruptcy with no debt forfeits the seat cash to the bank before it is announced', () => {
  const { room, game, A, B } = trio();
  game.currentPlayerId = A.id;
  B.cash = 400;
  assert.deepEqual(room.declareBankruptcy('socket-b'), { success: true, voluntary: true });
  assert.equal(B.cash, 0);
  const texts = feedTexts(game);
  assert.equal(texts[0], 'B is bankrupt and removed from the game.');
  assert.equal(texts[1], 'B forfeits $400 to the bank.');
});

check('a debtor whose creditor is already bankrupt forfeits its cash to the bank, with the same feed line', () => {
  const { room, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  C.bankrupt = true;
  const creditorCash = C.cash;
  B.cash = 400;
  setHead(game, B, C, 500);
  assert.deepEqual(room.declareBankruptcy('socket-b'), { success: true, voluntary: false });
  assert.equal(B.cash, 0);
  assert.equal(C.cash, creditorCash, 'a bankrupt creditor receives nothing');
  assert.ok(feedTexts(game).includes('B forfeits $400 to the bank.'));
});

check('a disconnect that expires with no debt forfeits the seat cash to the bank', () => {
  const table = liveTable(['A', 'B', 'C']);
  const [A, B] = table.seats;
  table.game.currentPlayerId = A.id;
  B.cash = 400;
  table.runtime.handleSocketDisconnect(table.sockets.get(B.socketId));
  table.clock.advanceBy(120_000);
  assert.equal(table.game.getPlayerByClient('client-b'), undefined, 'the grace seat was released');
  assert.equal(B.cash, 0);
  assert.ok(feedTexts(table.game).includes('B forfeits $400 to the bank.'));
});

// --- F-064: a lender who leaves cancels its loan, and the borrower is told ----
// The settlement is unchanged: the loan is cancelled, the borrower keeps the
// funds it received, the balance still owed is forgiven, and the collateral is
// released rather than seized. What is new is the announcement: the room feed
// names the loan, and the borrower gets a private system message.

function plantLoan(game, lender, borrower, tile, status = 'active') {
  const loan = {
    id: `loan-${lender.nickname}-${borrower.nickname}`,
    kind: 'loan',
    status,
    fromPlayerId: lender.id,
    toPlayerId: borrower.id,
    amount: 300,
    premiumRate: 10,
    totalDue: 330,
    remaining: status === 'paid' ? 0 : 330,
    collateralTileIndex: tile.index,
    collateralTileIndices: [tile.index],
    dueRound: game.roundNumber + 3,
    cureRound: game.roundNumber + 4
  };
  game.playerContracts ||= [];
  game.playerContracts.push(loan);
  return loan;
}

const LOAN_CANCELLED_FEED = "B's $300 loan from C was cancelled: the $330 still owed is forgiven, B keeps the funds received, and the collateral is released.";
const LOAN_CANCELLED_NOTICE = 'C left the table, so your loan is cancelled. The $330 still owed is forgiven, you keep the funds already received, and your collateral is released.';

check('a lender removed by disconnect expiry cancels its loan, and the borrower hears it on its own socket (F-064)', () => {
  const table = liveTable(['A', 'B', 'C']);
  const [A, B, C] = table.seats;
  table.game.currentPlayerId = A.id;
  const deed = table.game.getTile(1);
  deed.ownerId = B.id;
  B.properties = [1];
  B.cash = 700;
  const loan = plantLoan(table.game, C, B, deed);
  table.runtime.handleSocketDisconnect(table.sockets.get(C.socketId));
  table.clock.advanceBy(120_000);
  assert.equal(table.game.getPlayerByClient('client-c'), undefined, 'the lender seat was released');
  assert.equal(loan.status, 'terminated', 'the loan is still cancelled, as before');
  assert.equal(B.cash, 700, 'the borrower keeps the funds it received');
  assert.equal(deed.ownerId, B.id, 'the collateral is released, not seized');
  assert.ok(feedTexts(table.game).includes(LOAN_CANCELLED_FEED), 'the room feed says what happened to the loan');
  const notices = table.sockets.get(B.socketId).emitted.filter(entry => entry.event === 'system-message');
  assert.deepEqual(notices.map(entry => entry.payload.text), [LOAN_CANCELLED_NOTICE]);
});

check('a lender who declares bankruptcy cancels its loan, and the borrower notice is delivered once', () => {
  const { room, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  const deed = game.getTile(1);
  deed.ownerId = B.id;
  B.properties = [1];
  const loan = plantLoan(game, C, B, deed);
  assert.deepEqual(room.declareBankruptcy('socket-c'), { success: true, voluntary: true });
  assert.equal(loan.status, 'terminated');
  assert.equal(deed.ownerId, B.id);
  assert.ok(feedTexts(game).includes(LOAN_CANCELLED_FEED));
  assert.deepEqual(game.takeBorrowerNotices().map(notice => notice.playerId), [B.id]);
  assert.deepEqual(game.takeBorrowerNotices(), [], 'a queued notice is taken once');
});

check('a lender leaving after its loan was repaid announces nothing about it', () => {
  const { room, game, A, B, C } = trio();
  game.currentPlayerId = A.id;
  const deed = game.getTile(1);
  deed.ownerId = B.id;
  B.properties = [1];
  const loan = plantLoan(game, C, B, deed, 'paid');
  room.declareBankruptcy('socket-c');
  assert.equal(loan.status, 'paid');
  assert.equal(feedTexts(game).some(text => text.includes('was cancelled')), false);
  assert.deepEqual(game.takeBorrowerNotices(), []);
});

// --- D3: the default-claim ledger cap never evicts an open claim -----------
// Open claims are live recovery records for lenders. The cap may trim settled
// history, but a new default must not silently erase an unpaid claim.

function ledgerClaim(id, status, lenderId, borrowerId) {
  return {
    id,
    contractId: `contract-${id}`,
    lenderId,
    borrowerId,
    principal: 10,
    remaining: status === 'open' ? 10 : 0,
    reason: 'loan-default',
    status,
    createdRound: 0
  };
}

check('a full ledger of open claims rejects the new default instead of evicting one', () => {
  const { game, A, B } = trio();
  game.defaultClaims = Array.from({ length: 200 }, (_, index) => ledgerClaim(`open_${index}`, 'open', A.id, B.id));
  const openIds = game.defaultClaims.map(claim => claim.id);
  const contract = { id: 'new-default', fromPlayerId: A.id, toPlayerId: B.id, remaining: 50 };

  assert.equal(recordDefaultClaim(game, contract, 50), null, 'the new claim is rejected when every slot is open');
  assert.deepEqual(game.defaultClaims.map(claim => claim.id), openIds, 'every open claim survives');
  assert.equal(contract.defaultClaimId, undefined, 'the rejected claim is not linked to the contract');
});

check('the default-claim cap trims settled history before any open claim', () => {
  const { game, A, B } = trio();
  game.defaultClaims = [
    ledgerClaim('open_first', 'open', A.id, B.id),
    ...Array.from({ length: 5 }, (_, index) => ledgerClaim(`settled_${index}`, 'settled', A.id, B.id)),
    ...Array.from({ length: 194 }, (_, index) => ledgerClaim(`open_${index}`, 'open', A.id, B.id))
  ];
  const openIds = game.defaultClaims.filter(claim => claim.status === 'open').map(claim => claim.id);
  const claim = recordDefaultClaim(game, { id: 'new-default', fromPlayerId: A.id, toPlayerId: B.id, remaining: 50 }, 50);

  assert.notEqual(claim, null, 'the new claim fits after the terminal history is trimmed');
  assert.equal(game.defaultClaims.length, 200);
  assert.equal(game.defaultClaims.some(entry => entry.id === 'settled_0'), false, 'the oldest settled claim is evicted');
  assert.equal(game.defaultClaims.some(entry => entry.id === 'open_first'), true, 'an open claim ahead of it is never evicted');
  assert.equal(game.defaultClaims.filter(entry => entry.status === 'settled').length, 4);
  assert.deepEqual(game.defaultClaims.filter(entry => entry.status === 'open').map(entry => entry.id), [...openIds, claim.id]);
});

console.log(`exit settlement tests: ${passed + failures.length} checks — ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('FAILED:', failures.join(', '));
  process.exitCode = 1;
}
