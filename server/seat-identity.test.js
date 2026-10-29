// Seat identity across rooms. A clientId or account holds one live seat at a time, disconnect grace timers belong to their own room,
// a socket cannot release another room's seat, bot seats cannot be claimed, and a private invite code whose humans are still in grace is not reclaimed.
// Real RoomManager and runtime with a fake clock, same harness shape as host-election-repair.test.js.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';

const GRACE_MS = 1000;
const SEAT_IN_USE = 'That seat is already in use.';
const CODE_HELD_ELSEWHERE = 'That seat is still held by another room. Restore it or wait for it to expire.';
const ACCOUNT_SEATED_ELSEWHERE = 'This account is already seated in another room.';
const NO_SESSION = 'No active session found.';
const CODE_IN_USE = 'That private room code is already in use. Choose another.';

const failures = [];
function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.message}\n${String(error.stack).split('\n').slice(1, 4).join('\n')}`);
  }
}

class FakeClock {
  constructor() {
    this.time = Date.now();
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
    for (;;) {
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

function harness() {
  const clock = new FakeClock();
  const manager = new RoomManager();
  const sockets = new Map();
  const broadcasts = [];
  const runtime = createRuntime({
    io: {
      emit() {},
      in() { return { emit(event, payload) { broadcasts.push({ event, payload }); } }; },
      sockets: { sockets },
    },
    roomManager: manager,
    accountStore: {
      recordGameResults() { return { matchId: 'match-test', playerCount: 0, roundCount: 0, market: [], participants: [], botDecisions: [] }; },
      getMatchHistory() { return []; },
      updateMatchRecord() {},
      sessionTokenHashFor() { return null; },
    },
    socialStore: {},
    matchStore: { record() {} },
    achievementStore: { evaluateMatch() { return []; } },
    telemetryStore: { record() {} },
    botAdvisor: {},
    social: {
      chatLastSent: new Map(),
      patrolRuns: new Map(),
      socketsForAccount() { return []; },
      accountForSocket(socket) { return socket?.account || null; },
      recordVerifiedAchievement() {},
    },
    maintenance: {},
    metrics: { setMetric() {} },
    authoritativeStore: {},
    pubsubAdapter: {},
    disconnectGraceMs: GRACE_MS,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: () => ({ unref() {} }),
    clearInterval() {},
  });
  return { clock, manager, runtime, sockets, broadcasts };
}

function makeSocket(id, account = null) {
  return {
    id,
    account,
    // Each peer has its own address, as a real handshake does, so the
    // per-peer join budget is not shared between the test sockets.
    handshake: { address: `peer-${id}` },
    rooms: new Set([id]),
    data: {},
    handlers: new Map(),
    on(event, handler) { this.handlers.set(event, handler); },
    emit() {},
    join(roomCode) { this.rooms.add(roomCode); },
    leave(roomCode) { this.rooms.delete(roomCode); },
  };
}

function connect(world, id, account = null) {
  const socket = makeSocket(id, account);
  registerAccountSocketHandlers((event, handler) => socket.on(event, handler), socket, world.runtime);
  world.sockets.set(id, socket);
  return socket;
}

function call(socket, event, payload = {}) {
  let ack;
  socket.handlers.get(event)(payload, response => { ack = response; });
  return ack;
}

function seatHost(world, socketId, { clientId, roomCode, visibility = 'private' }) {
  const room = world.manager.createRoom({ socketId, clientId, nickname: 'Host', visibility, roomCode });
  connect(world, socketId);
  return room;
}

function drop(world, socketId) {
  const socket = world.sockets.get(socketId) || connect(world, socketId);
  world.runtime.handleSocketDisconnect(socket);
}

// Fixture seat (bypasses the socket join guard) for the "two rooms share one clientId" state
// that the join guard refuses to create.
function fixtureSeat(world, room, socketId, { clientId, nickname = 'Guest', accountId = null }) {
  const result = room.addOrReconnectPlayer({ socketId, clientId, nickname, accountId });
  assert.equal(result.success, true);
  world.manager.socketRoom.set(socketId, room);
  return result.player;
}

const seatOf = (room, clientId) => room.game.getPlayerByClient(clientId);

check('a clientId already live in another room cannot join a second room', () => {
  const world = harness();
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  const roomB = seatHost(world, 'hb', { clientId: 'hb-client', roomCode: 'ROOMB1' });
  const s1 = connect(world, 's1');
  assert.equal(call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'G', nickname: 'GuestG' }).success, true);
  const s2 = connect(world, 's2');
  const ack = call(s2, 'join-room', { roomCode: 'ROOMB1', clientId: 'G', nickname: 'GuestG' });
  assert.deepEqual(ack, { success: false, error: SEAT_IN_USE });
  assert.equal(seatOf(roomB, 'G'), undefined, 'the rejected join must not seat G in room B');
  assert.ok(seatOf(roomA, 'G'), 'room A keeps its live seat');
});

check('a disconnected seat in grace is not stolen by a join into another room', () => {
  const world = harness();
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  const roomB = seatHost(world, 'hb', { clientId: 'hb-client', roomCode: 'ROOMB1' });
  const s1 = connect(world, 's1');
  call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'G', nickname: 'GuestG' });
  drop(world, 's1');
  const ghost = seatOf(roomA, 'G');
  assert.equal(ghost.disconnected, true);
  const s2 = connect(world, 's2');
  const ack = call(s2, 'join-room', { roomCode: 'ROOMB1', clientId: 'G', nickname: 'GuestG' });
  assert.deepEqual(ack, { success: false, error: CODE_HELD_ELSEWHERE });
  assert.equal(seatOf(roomB, 'G'), undefined);
  // A lobby seat never times out on a dropped connection...
  world.clock.advanceBy(GRACE_MS + 1);
  assert.ok(seatOf(roomA, 'G'), 'a lobby seat survives its grace window');
  assert.deepEqual(call(s2, 'join-room', { roomCode: 'ROOMB1', clientId: 'G', nickname: 'GuestG' }), { success: false, error: CODE_HELD_ELSEWHERE });
  // ...but once the game is running the grace timer of room A expires its own seat.
  roomA.game.started = true;
  world.clock.advanceBy(GRACE_MS + 1);
  assert.equal(seatOf(roomA, 'G'), undefined, 'room A seat expires on its own timer');
  const retry = call(s2, 'join-room', { roomCode: 'ROOMB1', clientId: 'G', nickname: 'GuestG' });
  assert.equal(retry.success, true, 'once room A releases the seat the same clientId may join room B');
});

check('expiry of room A never removes a live seat in room B that shares its clientId', () => {
  const world = harness();
  // Room B is registered first, so a first-match clientId lookup lands on B.
  const roomB = seatHost(world, 'hb', { clientId: 'hb-client', roomCode: 'ROOMB1' });
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  fixtureSeat(world, roomA, 's1', { clientId: 'G' });
  const liveB = fixtureSeat(world, roomB, 's2', { clientId: 'G' });
  roomA.game.started = true; // lobby seats never time out on a dropped connection
  drop(world, 's1');
  world.clock.advanceBy(GRACE_MS + 1);
  assert.equal(seatOf(roomA, 'G'), undefined, 'room A seat expired');
  assert.equal(roomB.game.getPlayerByClient('G'), liveB, 'room B seat untouched');
  assert.equal(liveB.disconnected, false);
  assert.equal(liveB.socketId, 's2');
});

check('two graced seats that share a clientId each expire on their own timer', () => {
  const world = harness();
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  const roomB = seatHost(world, 'hb', { clientId: 'hb-client', roomCode: 'ROOMB1' });
  fixtureSeat(world, roomA, 's1', { clientId: 'G' });
  fixtureSeat(world, roomB, 's2', { clientId: 'G' });
  roomA.game.started = true; // lobby seats never time out on a dropped connection
  roomB.game.started = true;
  drop(world, 's1');
  drop(world, 's2');
  world.clock.advanceBy(GRACE_MS + 1);
  assert.equal(seatOf(roomA, 'G'), undefined, 'A ghost must not outlive its grace window');
  assert.equal(seatOf(roomB, 'G'), undefined, 'B ghost must not outlive its grace window');
});

check('leave-room cannot release a seat in another room and orphan the socket live seat', () => {
  const world = harness();
  const accountU = { id: 'acct-u', displayName: 'V3User', color: '#286ea1', avatarGrid: null };
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  const roomB = seatHost(world, 'hb', { clientId: 'hb-client', roomCode: 'ROOMB1' });
  const s1 = connect(world, 's1', accountU);
  assert.equal(call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'cA', nickname: 'V3User' }).success, true);
  drop(world, 's1');
  assert.equal(seatOf(roomA, 'cA').disconnected, true);
  const s2 = connect(world, 's2', { ...accountU, id: 'acct-v' });
  assert.equal(call(s2, 'join-room', { roomCode: 'ROOMB1', clientId: 'cB', nickname: 'V3User' }).success, true);
  const ack = call(s2, 'leave-room', { clientId: 'cA' });
  assert.deepEqual(ack, { success: false, error: NO_SESSION });
  assert.equal(world.manager.getRoomBySocket('s2'), roomB, 'the socket keeps its room B mapping');
  assert.equal(seatOf(roomB, 'cB').disconnected, false, 'room B seat stays live');
  assert.equal(seatOf(roomB, 'cB').socketId, 's2');
  assert.ok(seatOf(roomA, 'cA'), 'room A seat is left for its own expiry');
  assert.equal(call(s2, 'leave-room', { clientId: 'cB' }).success, true, 'a socket may still release its own seat');
});

check('a socket releases its own seat even when it is mapped to that room', () => {
  const world = harness();
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  const s1 = connect(world, 's1');
  call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'G', nickname: 'GuestG' });
  assert.equal(call(s1, 'leave-room', { clientId: 'G' }).success, true);
  assert.equal(seatOf(roomA, 'G'), undefined);
  assert.equal(world.manager.getRoomBySocket('s1'), null);
});

check('an account with a live seat in another room cannot join a second room from another socket', () => {
  const world = harness();
  const accountU = { id: 'acct-u', displayName: 'V3User', color: '#286ea1', avatarGrid: null };
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  seatHost(world, 'hb', { clientId: 'hb-client', roomCode: 'ROOMB1' });
  const s1 = connect(world, 's1', accountU);
  assert.equal(call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'cA', nickname: 'V3User' }).success, true);
  const s2 = connect(world, 's2', accountU);
  assert.deepEqual(call(s2, 'join-room', { roomCode: 'ROOMB1', clientId: 'cB', nickname: 'V3User' }), { success: false, error: ACCOUNT_SEATED_ELSEWHERE });
  assert.ok(seatOf(roomA, 'cA'), 'room A seat is not disturbed');
});

check('an account with a disconnected seat in grace cannot join another room', () => {
  const world = harness();
  const accountU = { id: 'acct-u', displayName: 'V3User', color: '#286ea1', avatarGrid: null };
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  const roomB = seatHost(world, 'hb', { clientId: 'hb-client', roomCode: 'ROOMB1' });
  const s1 = connect(world, 's1', accountU);
  assert.equal(call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'cA', nickname: 'V3User' }).success, true);
  drop(world, 's1');
  const gracedSeat = seatOf(roomA, 'cA');
  assert.equal(gracedSeat.disconnected, true);

  const s2 = connect(world, 's2', accountU);
  // Even if a reconnecting socket reuses the old socket id, a disconnected
  // seat does not qualify for the live same-socket room-move exception.
  gracedSeat.socketId = s2.id;
  assert.deepEqual(call(s2, 'join-room', { roomCode: 'ROOMB1', clientId: 'cB', nickname: 'V3User' }), {
    success: false,
    error: ACCOUNT_SEATED_ELSEWHERE
  });
  assert.equal(seatOf(roomB, 'cB'), undefined, 'the account gets no second seat during reconnect grace');
  assert.equal(seatOf(roomA, 'cA'), gracedSeat, 'the original seat remains in its grace window');
});

check('a bankrupt account seat does not block joining another room', () => {
  const world = harness();
  const accountU = { id: 'acct-u', displayName: 'V3User', color: '#286ea1', avatarGrid: null };
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  const roomB = seatHost(world, 'hb', { clientId: 'hb-client', roomCode: 'ROOMB1' });
  const s1 = connect(world, 's1', accountU);
  assert.equal(call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'cA', nickname: 'V3User' }).success, true);
  seatOf(roomA, 'cA').bankrupt = true;

  const s2 = connect(world, 's2', accountU);
  assert.equal(call(s2, 'join-room', { roomCode: 'ROOMB1', clientId: 'cB', nickname: 'V3User' }).success, true);
  assert.ok(seatOf(roomB, 'cB'), 'a bankrupt seat does not hold the account at another table');
});

check('create-room cannot give an account a second seat while it is live in another room', () => {
  const world = harness();
  const accountU = { id: 'acct-u', displayName: 'V3User', color: '#286ea1', avatarGrid: null };
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  const s1 = connect(world, 's1', accountU);
  assert.equal(call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'cA', nickname: 'V3User' }).success, true);
  // A second socket of the same account tries to create its own room: the
  // account already plays a table, so it may not take a second seat.
  const s2 = connect(world, 's2', accountU);
  const ack = call(s2, 'create-room', { clientId: 'cB', nickname: 'V3User', visibility: 'private', roomCode: 'DUPRM1', roomName: 'Second' });
  assert.deepEqual(ack, { success: false, error: ACCOUNT_SEATED_ELSEWHERE });
  assert.equal(world.manager.getRoom('DUPRM1'), null, 'the account gets no second room');
  assert.ok(seatOf(roomA, 'cA'), 'the live seat in room A is untouched');
});

check('Scope 09 create-room leaves a held seat in grace instead of settling it away', () => {
  const world = harness();
  const accountU = { id: 'acct-u', displayName: 'V3User', color: '#286ea1', avatarGrid: null };
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  const s1 = connect(world, 's1', accountU);
  assert.equal(call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'cA', nickname: 'V3User' }).success, true);
  roomA.game.started = true; // a started table, so a release would settle the estate
  drop(world, 's1');
  const graced = seatOf(roomA, 'cA');
  assert.equal(graced.disconnected, true, 'the seat waits in its grace window');
  const s2 = connect(world, 's2', accountU);
  const ack = call(s2, 'create-room', { clientId: 'cA', nickname: 'V3User', visibility: 'private', roomCode: 'GRACM1', roomName: 'Second' });
  assert.deepEqual(ack, { success: false, error: CODE_HELD_ELSEWHERE });
  assert.equal(world.manager.getRoom('GRACM1'), null, 'no room is created while the seat is held');
  assert.equal(seatOf(roomA, 'cA'), graced, 'the held seat is not settled away');
  assert.equal(graced.disconnected, true, 'the held seat keeps its grace');
});

check('the same socket may still switch rooms, releasing its lobby seat', () => {
  const world = harness();
  const accountU = { id: 'acct-u', displayName: 'V3User', color: '#286ea1', avatarGrid: null };
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  const roomB = seatHost(world, 'hb', { clientId: 'hb-client', roomCode: 'ROOMB1' });
  const s1 = connect(world, 's1', accountU);
  call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'cA', nickname: 'V3User' });
  assert.equal(call(s1, 'join-room', { roomCode: 'ROOMB1', clientId: 'cB', nickname: 'V3User' }).success, true);
  assert.equal(seatOf(roomA, 'cA'), undefined, 'lobby seat in room A is released by the switch');
  assert.ok(seatOf(roomB, 'cB'));
  assert.equal(world.manager.getRoomBySocket('s1'), roomB);
});

check('a socket disconnect puts every seat on that socket into grace, not only the mapped room', () => {
  const world = harness();
  const roomA = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'ROOMA1' });
  seatHost(world, 'hc', { clientId: 'hc-client', roomCode: 'ROOMC1' });
  const s1 = connect(world, 's1');
  call(s1, 'join-room', { roomCode: 'ROOMA1', clientId: 'G', nickname: 'GuestG' });
  // Re-map this socket by hand; the seat it left in room A stays on the socket. (create-room
  // does not strand a lobby seat this way: it releases it, covered in
  // serverSocketRoomLifecycle.test.js, so the stranded state is built directly.)
  world.manager.socketRoom.set('s1', world.manager.getRoom('ROOMC1'));
  drop(world, 's1');
  assert.equal(seatOf(roomA, 'G').disconnected, true, 'the stranded seat enters grace');
  roomA.game.started = true; // lobby seats never time out on a dropped connection
  world.clock.advanceBy(GRACE_MS + 1);
  assert.equal(seatOf(roomA, 'G'), undefined, 'and expires instead of staying live forever');
});

check('a voluntary leave announces the pending trade it cancels, as expiry does', () => {
  const world = harness();
  const room = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'TRADEA' });
  const s1 = connect(world, 's1');
  call(s1, 'join-room', { roomCode: 'TRADEA', clientId: 'G', nickname: 'GuestG' });
  const guest = seatOf(room, 'G');
  room.game.pendingTrade = { fromPlayerId: guest.id, toPlayerId: room.hostId };
  assert.equal(call(s1, 'leave-room', { clientId: 'G' }).success, true);
  assert.equal(room.game.pendingTrade, null, 'the trade is cancelled with the seat');
  assert.ok(
    world.broadcasts.some(entry => entry.event === 'system-message' && /pending trade was cancelled/.test(entry.payload?.text || '')),
    'the cancellation is announced to the table',
  );
});

check('a voluntary leave auctions the purchase offer it passes, as expiry does', () => {
  const world = harness();
  const room = seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'PURCHA' });
  const s1 = connect(world, 's1');
  call(s1, 'join-room', { roomCode: 'PURCHA', clientId: 'G', nickname: 'GuestG' });
  assert.equal(room.startGame().success, true);
  const guest = seatOf(room, 'G');
  const tile = room.game.tiles.find(candidate => candidate.ownerId === null && candidate.name);
  assert.ok(tile, 'the board has an unowned property');
  room.game.pendingPurchaseOffer = { playerId: guest.id, tileIndex: tile.index };
  assert.equal(call(s1, 'leave-room', { clientId: 'G' }).success, true);
  assert.equal(room.game.pendingPurchaseOffer, null, 'the purchase offer is resolved with the seat');
  assert.ok(
    room.game.feed.some(entry => /passed on/.test(entry.text)),
    'the pass is recorded in the feed, as the expiry path records it',
  );
});

check('a peer that exhausts its failed-join budget is throttled, other peers are not', () => {
  const world = harness();
  seatHost(world, 'ha', { clientId: 'ha-client', roomCode: 'THROTL' });
  const brute = connect(world, 'brute-peer');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    assert.deepEqual(
      call(brute, 'join-room', { roomCode: 'NOPE01', clientId: `guess-${attempt}`, nickname: 'Guesser' }),
      { success: false, error: 'Room not found.' },
    );
  }
  assert.deepEqual(
    call(brute, 'join-room', { roomCode: 'THROTL', clientId: 'real-guess', nickname: 'Guesser' }),
    { success: false, error: 'Too many join attempts. Try again shortly.' },
  );
  const honest = connect(world, 'honest-peer');
  assert.equal(call(honest, 'join-room', { roomCode: 'THROTL', clientId: 'honest-client', nickname: 'Honest' }).success, true);
});

check('a bot seat cannot be claimed through join-room with its clientId', () => {
  const world = harness();
  const room = seatHost(world, 'host', { clientId: 'host-client', roomCode: 'BOTROM' });
  room.setRoomSetting('bots', 1);
  room.ensureBots();
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  assert.ok(bot, 'the started table has a bot seat');
  assert.notEqual(bot.clientId, `bot-${room.roomCode}-1`, 'bot clientIds are not predictable from the room code');
  const attacker = connect(world, 'atk');
  const ack = call(attacker, 'join-room', { roomCode: room.roomCode, clientId: bot.clientId, nickname: 'Attacker' });
  assert.deepEqual(ack, { success: false, error: SEAT_IN_USE });
  assert.equal(bot.isBot, true);
  assert.equal(bot.nickname === 'Attacker', false);
  assert.equal(world.manager.getRoomBySocket('atk'), null, 'the attacker socket is not mapped to the bot seat');
});

check('the predictable legacy bot clientId joins as a new guest and is refused by the started game', () => {
  const world = harness();
  const room = seatHost(world, 'host', { clientId: 'host-client', roomCode: 'BOTRM2' });
  room.setRoomSetting('bots', 1);
  room.ensureBots();
  assert.equal(room.startGame().success, true);
  const attacker = connect(world, 'atk');
  const ack = call(attacker, 'join-room', { roomCode: room.roomCode, clientId: `bot-${room.roomCode}-1`, nickname: 'Attacker' });
  assert.deepEqual(ack, { success: false, error: 'Game is already in progress.' });
  assert.equal(room.game.players.some(player => player.nickname === 'Attacker'), false);
});

check('a private code whose humans are both in grace is not reclaimed', () => {
  const world = harness();
  const room = seatHost(world, 'host', { clientId: 'host-client', roomCode: 'ZZ9Q11' });
  connect(world, 'guest');
  const guest = world.sockets.get('guest');
  assert.equal(call(guest, 'join-room', { roomCode: 'ZZ9Q11', clientId: 'guest-client', nickname: 'GuestD' }).success, true);
  drop(world, 'host');
  drop(world, 'guest');
  const third = connect(world, 'third');
  assert.deepEqual(
    call(third, 'create-room', { clientId: 'third-client', nickname: 'Third', visibility: 'private', roomCode: 'ZZ9Q11', roomName: 'X' }),
    { success: false, error: CODE_IN_USE },
  );
  assert.equal(world.manager.getRoom('ZZ9Q11'), room, 'the original room survives');
  const back = connect(world, 'host2');
  assert.equal(call(back, 'restore-session', { clientId: 'host-client' }).success, true, 'the original host restores within grace');
});

check('a private code whose room holds only bots is reclaimable', () => {
  const world = harness();
  const room = seatHost(world, 'host', { clientId: 'host-client', roomCode: 'BOTONL' });
  room.setRoomSetting('bots', 1);
  room.ensureBots();
  assert.equal(world.manager.leaveRoomByClient('host-client', 'host'), room);
  assert.equal(room.hasHumanSeats(), false);
  const next = connect(world, 'next');
  const ack = call(next, 'create-room', { clientId: 'next-client', nickname: 'Next', visibility: 'private', roomCode: 'BOTONL', roomName: 'Y' });
  assert.equal(ack.success, true, 'a bots-only room no longer holds its code');
});

check('a kicked clientId cannot reclaim the private code of the room that kicked it', () => {
  const world = harness();
  const room = seatHost(world, 'host', { clientId: 'host-client', roomCode: 'KICKD1' });
  room.setRoomSetting('bots', 1);
  room.ensureBots();
  room.kickedClientIds.add('kicked-client');
  world.manager.leaveRoomByClient('host-client', 'host');
  const kicked = connect(world, 'kicked');
  assert.deepEqual(
    call(kicked, 'create-room', { clientId: 'kicked-client', nickname: 'Kicked', visibility: 'private', roomCode: 'KICKD1', roomName: 'Z' }),
    { success: false, error: CODE_IN_USE },
  );
});

if (failures.length) {
  console.log(`\n${failures.length} seat identity check(s) failed`);
  process.exit(1);
}
console.log('seat identity: all passed');
