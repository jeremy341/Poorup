import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

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

  currentTime = deadline;
  const due = [...timerHandles.values()].filter(timer => timer.deadline <= currentTime);
  due.forEach(timer => { timerHandles.delete(timer.id); timer.callback(); });
  assert.equal(host.game.players.some(player => player.clientId === 'presence-host-client'), false);
  assert.equal(host.game.players.some(player => player.clientId === 'presence-guest-client'), true);
}
