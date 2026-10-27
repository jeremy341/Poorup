import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';
import { PLAYER_INACTIVITY_REMOVAL_MS } from './playerPresence.js';
import { createRoomPresenceRuntime } from './roomPresenceRuntime.js';

function createLobby() {
  const manager = new RoomManager();
  const room = manager.createRoom({
    socketId: 'host-socket',
    clientId: 'host-client',
    accountId: 'host-account',
    nickname: 'Host',
  });
  room.addOrReconnectPlayer({ socketId: 'guest-socket', clientId: 'guest-client', nickname: 'Guest' });
  room.addOrReconnectPlayer({ socketId: 'third-socket', clientId: 'third-client', nickname: 'Third' });
  return { manager, room };
}

assert.equal(typeof RoomManager.prototype.removeRoomSeat, 'function', 'RoomManager exposes an idempotent seat removal operation');

{
  const { manager, room } = createLobby();
  const result = manager.removeRoomSeat({ clientId: 'host-client', socketId: 'host-socket', reason: 'vote-kick', preventRejoin: true });
  assert.equal(result.success, true);
  assert.equal(room.hostId, room.game.players[0].id, 'lobby host is reassigned to a remaining human');
  assert.equal(room.game.players.some(player => player.clientId === 'host-client'), false);
  assert.equal(manager.removeRoomSeat({ clientId: 'host-client', socketId: 'host-socket', reason: 'vote-kick', preventRejoin: true }).success, false);
  assert.equal(room.addOrReconnectPlayer({ socketId: 'host-socket-2', clientId: 'host-client', accountId: 'host-account', nickname: 'Host' }).success, false);
}

{
  const { manager, room } = createLobby();
  const removed = manager.removeRoomSeat({ clientId: 'guest-client', socketId: 'guest-socket', reason: 'inactivity', preventRejoin: false });
  assert.equal(removed.success, true);
  assert.equal(room.addOrReconnectPlayer({ socketId: 'guest-socket-2', clientId: 'guest-client', nickname: 'Guest' }).success, true);
  assert.equal(room.game.players.filter(player => player.clientId === 'guest-client').length, 1);
}

{
  const { manager, room } = createLobby();
  const [host, guest, third] = room.game.players;
  room.game.started = true;
  room.game.turnOrder = [host.id, guest.id, third.id];
  room.game.currentPlayerId = host.id;
  const result = manager.removeRoomSeat({ clientId: 'host-client', socketId: 'host-socket', reason: 'vote-kick', preventRejoin: true });
  assert.equal(result.success, true);
  assert.deepEqual(room.game.turnOrder, [guest.id, third.id]);
  assert.equal(room.game.currentPlayerId, guest.id);
  assert.equal(room.hostId, guest.id);
}

console.log('room presence runtime seat cleanup: 3 passed');

{
  let currentTime = 50_000;
  const timerHandles = new Map();
  let timerId = 0;
  const sockets = new Map();
  const io = {
    sockets: { sockets },
    on() {},
    emit() {},
    in() { return { emit() {} }; },
    to() { return { emit() {} }; },
  };
  const manager = new RoomManager();
  const runtime = createRuntime({
    io,
    roomManager: manager,
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount: () => [], accountForSocket: () => null },
    setInterval: () => 0,
    now: () => currentTime,
    setTimeout(callback, delay) {
      const handle = { id: ++timerId, callback, deadline: currentTime + delay, delay };
      timerHandles.set(handle.id, handle);
      return handle;
    },
    clearTimeout(handle) { if (handle) timerHandles.delete(handle.id); },
  });
  const host = manager.createRoom({ socketId: 'presence-host', clientId: 'presence-host-client', accountId: 'private-account', nickname: 'Host' });
  const guest = host.addOrReconnectPlayer({ socketId: 'presence-guest', clientId: 'presence-guest-client', nickname: 'Guest' }).player;
  manager.socketRoom.set('presence-guest', host);
  const handlers = new Map();
  const socket = {
    id: 'presence-host',
    rooms: new Set(['presence-host', host.roomCode]),
    data: {},
    on(event, handler) { handlers.set(event, handler); },
    use() {}, emit() {}, join() {}, leave() {},
  };
  sockets.set(socket.id, socket);
  registerGameSocketHandlers((event, handler) => socket.on(event, handler), socket, runtime);
  assert.equal(typeof handlers.get('player-presence'), 'function');

  const inactive = runtime.setPlayerPresence(socket, { state: 'inactive', reason: 'hidden', accountId: 'attacker-controlled' });
  assert.equal(inactive.success, true);
  assert.equal(inactive.presence.inactiveSince, 50_000);
  assert.equal(inactive.presence.inactiveUntil, 230_000);
  const deadline = inactive.presence.inactiveUntil;
  currentTime += 20_000;
  const duplicate = runtime.setPlayerPresence(socket, { state: 'inactive', reason: 'idle' });
  assert.equal(duplicate.presence.inactiveUntil, deadline, 'duplicate inactive events do not extend the server deadline');
  runtime.setPlayerPresence({ id: 'stale-presence-host' }, { state: 'active' });
  assert.equal(host.game.getPlayerByClient('presence-host-client').presence.inactiveUntil, deadline);

  runtime.setPlayerPresence({ ...socket, id: 'presence-guest' }, { state: 'inactive', reason: 'idle' });
  assert.equal(timerHandles.size, 2, 'inactive human seats receive independent deadlines');
  const oldGuestSocket = { id: 'presence-guest' };
  host.addOrReconnectPlayer({ socketId: 'presence-guest-new', clientId: 'presence-guest-client', nickname: 'Guest' });
  manager.socketRoom.delete('presence-guest');
  manager.socketRoom.set('presence-guest-new', host);
  assert.equal(runtime.setPlayerPresence(oldGuestSocket, { state: 'active' }).success, false, 'a stale socket cannot clear a replacement seat deadline');
  runtime.emitRoomState(host);
  assert.equal(host.game.getPlayerByClient('presence-guest-client').presence.state, 'active');
  assert.equal(timerHandles.size, 1, 'reconnect clears only that seat timer');
  const summary = host.game.getGameSummary(guest.id);
  assert.equal(summary.players.find(player => player.id === host.game.players[0].id).accountId, null);
  assert.deepEqual(summary.players.find(player => player.id === host.game.players[0].id).presence, {
    state: 'inactive', inactiveSince: 50_000, inactiveUntil: 230_000,
  });
  assert.equal('reason' in summary.players.find(player => player.id === guest.id).presence, false);

  // Nobody times out while the lobby is being set up: the deadline passes,
  // nobody is removed, and the countdown simply restarts.
  currentTime = deadline;
  const lobbyDue = [...timerHandles.values()].filter(timer => timer.deadline <= currentTime);
  lobbyDue.forEach(timer => { timerHandles.delete(timer.id); timer.callback(); });
  assert.equal(host.game.players.some(player => player.clientId === 'presence-host-client'), true, 'a lobby seat is not removed for inactivity');
  const restarted = host.game.getPlayerByClient('presence-host-client').presence.inactiveUntil;
  assert.equal(restarted, deadline + PLAYER_INACTIVITY_REMOVAL_MS, 'the lobby inactivity clock restarts');

  // Once the game is running the same deadline removes the seat.
  host.game.started = true;
  currentTime = restarted;
  const due = [...timerHandles.values()].filter(timer => timer.deadline <= currentTime);
  due.forEach(timer => { timerHandles.delete(timer.id); timer.callback(); });
  assert.equal(host.game.players.some(player => player.clientId === 'presence-host-client'), false);
  assert.equal(host.game.players.some(player => player.clientId === 'presence-guest-client'), true);
}

// F-091: a connected human who holds the turn (or must answer a pending trade
// or contract) and sends no socket event for PLAYER_INACTIVITY_REMOVAL_MS is
// idled by the server, even if its client never reports presence. The idle
// seat then leaves through the existing inactivity-removal flow.
function createIdleHarness() {
  const clock = { now: 1_000_000 };
  const timerHandles = new Map();
  let timerId = 0;
  const io = {
    sockets: { sockets: new Map() },
    on() {},
    emit() {},
    in() { return { emit() {} }; },
    to() { return { emit() {} }; },
  };
  const manager = new RoomManager();
  const runtime = createRuntime({
    io,
    roomManager: manager,
    accountStore: {},
    socialStore: {},
    matchStore: {},
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount: () => [], accountForSocket: () => null },
    setInterval: () => 0,
    now: () => clock.now,
    setTimeout(callback, delay) {
      const handle = { id: ++timerId, callback, deadline: clock.now + delay };
      timerHandles.set(handle.id, handle);
      return handle;
    },
    clearTimeout(handle) { if (handle) timerHandles.delete(handle.id); },
  });
  const room = manager.createRoom({ socketId: 'idle-host', clientId: 'idle-host-client', nickname: 'Host' });
  room.addOrReconnectPlayer({ socketId: 'idle-guest', clientId: 'idle-guest-client', nickname: 'Guest' });
  room.addOrReconnectPlayer({ socketId: 'idle-third', clientId: 'idle-third-client', nickname: 'Third' });
  manager.socketRoom.set('idle-host', room);
  manager.socketRoom.set('idle-guest', room);
  manager.socketRoom.set('idle-third', room);
  assert.equal(room.startGame().success, true);
  const guest = room.game.getPlayerByClient('idle-guest-client');
  room.game.currentPlayerId = guest.id;
  const host = room.game.getPlayerByClient('idle-host-client');
  return { clock, timerHandles, runtime, room, guest, host };
}

function fireDueTimers(harness) {
  for (const handle of [...harness.timerHandles.values()]) {
    if (handle.deadline > harness.clock.now) continue;
    harness.timerHandles.delete(handle.id);
    handle.callback();
  }
}

{
  const harness = createIdleHarness();
  const { clock, runtime, room, guest } = harness;
  runtime.sweepIdleSeats();
  clock.now += PLAYER_INACTIVITY_REMOVAL_MS - 1;
  runtime.sweepIdleSeats();
  assert.equal(guest.presence.state, 'active', 'a silent turn holder is not idle before the threshold');
  clock.now += 1;
  runtime.sweepIdleSeats();
  assert.equal(guest.presence.state, 'inactive', 'a silent turn holder is idled at the threshold');
  assert.equal(guest.presence.reason, 'idle');
  assert.equal(guest.presence.inactiveSince, clock.now);
  assert.equal(guest.presence.inactiveUntil, clock.now + PLAYER_INACTIVITY_REMOVAL_MS);
  clock.now = guest.presence.inactiveUntil;
  fireDueTimers(harness);
  assert.equal(room.game.players.some(player => player.clientId === 'idle-guest-client'), false, 'the idle seat leaves through the inactivity flow');
  assert.equal(room.game.players.some(player => player.clientId === 'idle-host-client'), true);
  console.log('room presence idle detection: a silent turn holder is idled and removed without a client report');
}

{
  const harness = createIdleHarness();
  const { clock, runtime, guest } = harness;
  for (let step = 0; step < 10; step += 1) {
    clock.now += 60_000;
    runtime.noteSocketEvent('idle-guest');
    runtime.sweepIdleSeats();
  }
  assert.equal(guest.presence.state, 'active', 'a seat that keeps sending socket events is not idle');
  console.log('room presence idle detection: socket events keep the turn holder active');
}

{
  const harness = createIdleHarness();
  const { clock, runtime, room, guest, host } = harness;
  room.game.currentPlayerId = host.id;
  for (let step = 0; step < 10; step += 1) {
    clock.now += 60_000;
    runtime.noteSocketEvent('idle-host');
    runtime.sweepIdleSeats();
  }
  assert.equal(guest.presence.state, 'active', 'a silent seat that is not blocking the table is not idled');
  console.log('room presence idle detection: a silent seat that is not blocking the table is left alone');
}

{
  // S02-F5: a seat the server idled that then resumes playing is returned to
  // active, so its pending removal deadline no longer evicts a live player.
  const harness = createIdleHarness();
  const { clock, runtime, room, guest } = harness;
  runtime.sweepIdleSeats();
  clock.now += PLAYER_INACTIVITY_REMOVAL_MS;
  runtime.sweepIdleSeats();
  assert.equal(guest.presence.state, 'inactive');
  const removalDeadline = guest.presence.inactiveUntil;
  clock.now += 60_000;
  runtime.noteSocketEvent('idle-guest');
  assert.equal(guest.presence.state, 'active', 'a server-idled seat that sends an event is active again');
  assert.equal(guest.presence.inactiveUntil, null);
  clock.now = removalDeadline;
  fireDueTimers(harness);
  assert.equal(room.game.players.some(player => player.clientId === 'idle-guest-client'), true, 'the resumed seat is not evicted at the old deadline');
  console.log('room presence idle detection: a server-idled seat that resumes is not evicted');
}

{
  // The wake-up is only for server-originated idling: a presence the client
  // reported itself is left to the client messages.
  const harness = createIdleHarness();
  const { clock, runtime, guest } = harness;
  runtime.setPlayerPresence({ id: 'idle-guest' }, { state: 'inactive', reason: 'hidden' });
  assert.equal(guest.presence.state, 'inactive');
  clock.now += 1_000;
  runtime.noteSocketEvent('idle-guest');
  assert.equal(guest.presence.state, 'inactive', 'a client-reported inactive presence is not reset by other events');
}

{
  // S17-04 / S02-F8: the idle-clock maps are keyed by seat id and must not keep
  // seats that already left (a voluntary leave never reaches clearPlayer), nor the
  // seats of a destroyed room.
  function createTrackingHarness() {
    const clock = { now: 2_000_000 };
    const manager = new RoomManager();
    const room = manager.createRoom({ socketId: 'track-host', clientId: 'track-host-client', nickname: 'Host' });
    room.addOrReconnectPlayer({ socketId: 'track-guest', clientId: 'track-guest-client', nickname: 'Guest' });
    manager.socketRoom.set('track-host', room);
    manager.socketRoom.set('track-guest', room);
    assert.equal(room.startGame().success, true);
    const presence = createRoomPresenceRuntime({
      roomManager: manager,
      runRoomTimer: (name, roomCode, callback) => callback(),
      setTimeoutFn: () => ({}),
      clearTimeoutFn() {},
      now: () => clock.now,
      emitRoomState() {},
      removeSeatForReason() { return true; },
    });
    presence.noteSocketEvent('track-host');
    presence.noteSocketEvent('track-guest');
    presence.sweepIdleSeats();
    return { manager, room, presence };
  }

  const left = createTrackingHarness();
  assert.equal(left.presence.trackedSeatCount(), 2, 'seated humans are tracked');
  left.manager.leaveRoomByClient('track-guest-client', 'track-guest', left.room);
  left.presence.sweepIdleSeats();
  assert.equal(left.presence.trackedSeatCount(), 1, 'a seat that left voluntarily is forgotten by the next sweep');

  const destroyed = createTrackingHarness();
  destroyed.presence.clearRoom(destroyed.room);
  assert.equal(destroyed.presence.trackedSeatCount(), 0, 'a destroyed room leaves nothing behind in the idle maps');
}

{
  const harness = createIdleHarness();
  const { clock, runtime, room, guest, host } = harness;
  room.game.currentPlayerId = host.id;
  for (let step = 0; step < 10; step += 1) {
    clock.now += 60_000;
    runtime.noteSocketEvent('idle-host');
    runtime.sweepIdleSeats();
  }
  room.game.currentPlayerId = guest.id;
  runtime.sweepIdleSeats();
  assert.equal(guest.presence.state, 'active', 'the idle clock starts when the seat begins to block, not at its last event');
  clock.now += PLAYER_INACTIVITY_REMOVAL_MS;
  runtime.sweepIdleSeats();
  assert.equal(guest.presence.state, 'inactive');
  {
  // X12: the idle watcher must watch the seat that has to answer a pending
  // contract. After a counter-offer that is the responder (the seat that made
  // the surviving offer), not the seat the contract was addressed to.
  const harness = createIdleHarness();
  const { clock, runtime, room, host } = harness;
  const guest = room.game.getPlayerByClient('idle-guest-client');
  const third = room.game.getPlayerByClient('idle-third-client');
  room.game.currentPlayerId = third.id;
  room.game.pendingPlayerContract = {
    id: 'contract_idle',
    kind: 'loan',
    fromPlayerId: host.id,
    toPlayerId: guest.id,
    amount: 100,
    status: 'pending',
    counterDepth: 1,
    lastProposerId: guest.id,
    createdRound: 1,
  };
  runtime.noteSocketEvent('idle-third');
  runtime.sweepIdleSeats();
  clock.now += PLAYER_INACTIVITY_REMOVAL_MS;
  runtime.noteSocketEvent('idle-third');
  runtime.sweepIdleSeats();
  assert.equal(host.presence.state, 'inactive', 'the seat that must answer the contract is watched');
  assert.equal(guest.presence.state, 'active', 'the addressed seat is not watched once it has countered');
  console.log('room presence idle detection: the contract responder is watched, not the addressed seat');
}

console.log('room presence idle detection: the clock starts when a silent seat begins to hold the turn');
}
