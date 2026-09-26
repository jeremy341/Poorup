import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

function makeHarness() {
  let currentTime = 10_000;
  let timerId = 0;
  const timers = new Map();
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
      timers.set(handle.id, handle);
      return handle;
    },
    clearTimeout(handle) { if (handle) timers.delete(handle.id); },
  });
  function addSocket(socketId, clientId, nickname, existingRoom = null) {
    const handlers = new Map();
    const socket = {
      id: socketId,
      rooms: new Set([socketId]),
      data: {},
      on(event, handler) { handlers.set(event, handler); },
      use() {},
      emit() {},
      join(roomCode) { this.rooms.add(roomCode); },
      leave(roomCode) { this.rooms.delete(roomCode); },
      handlers,
    };
    let room = existingRoom || manager.getRoomBySocket(socketId);
    if (!room) room = manager.createRoom({ socketId, clientId, nickname });
    else {
      room.addOrReconnectPlayer({ socketId, clientId, nickname });
      manager.socketRoom.set(socketId, room);
    }
    socket.join(room.roomCode);
    sockets.set(socketId, socket);
    registerGameSocketHandlers((event, handler) => socket.on(event, handler), socket, runtime);
    return { socket, room, ask(event, payload = {}) {
      return new Promise(resolve => handlers.get(event)?.(payload, resolve));
    } };
  }
  return {
    manager,
    runtime,
    timers,
    addSocket,
    setTime(value) { currentTime = value; },
    runTimers() {
      const due = [...timers.values()].filter(timer => timer.deadline <= currentTime);
      due.forEach(timer => { timers.delete(timer.id); timer.callback(); });
    },
  };
}

{
  const harness = makeHarness();
  const host = harness.addSocket('host-socket', 'host-client', 'Host');
  const target = harness.addSocket('target-socket', 'target-client', 'Target', host.room);
  const voter = harness.addSocket('voter-socket', 'voter-client', 'Voter', host.room);
  const targetId = target.room.game.players.find(player => player.clientId === 'target-client').id;
  assert.equal(typeof host.socket.handlers.get('room-votekick-start'), 'function');
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'start-1' });
  assert.equal(started.success, true);
  assert.equal(started.vote.eligibleCount, 2);
  assert.equal('voterIds' in started.vote, false, 'public vote state exposes counts without voter identities');
  const repeat = await host.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'cast-1' });
  assert.equal(repeat.success, false, 'initiator cannot cast a second ballot');
  const result = await voter.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'cast-2' });
  assert.equal(result.success, true);
  assert.equal(result.vote.status, 'passed');
  assert.equal(host.room.game.players.some(player => player.id === targetId), false);
  assert.equal(target.room.addOrReconnectPlayer({ socketId: 'target-retry', clientId: 'target-client', nickname: 'Target' }).success, false);
}

{
  const harness = makeHarness();
  const host = harness.addSocket('timeout-host', 'timeout-host-client', 'Host');
  harness.addSocket('timeout-target', 'timeout-target-client', 'Target', host.room);
  harness.addSocket('timeout-voter', 'timeout-voter-client', 'Voter', host.room);
  const targetId = host.room.game.players.find(player => player.clientId === 'timeout-target-client').id;
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'timeout-start-1' });
  assert.equal(started.success, true);
  harness.setTime(40_000);
  harness.runTimers();
  assert.equal(host.room.voteKickSnapshot.status, 'expired');
  const cooledDown = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'timeout-start-2' });
  assert.equal(cooledDown.success, false, 'the initiator cooldown outlasts an early timeout');
  harness.setTime(70_000);
  const afterCooldown = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'timeout-start-3' });
  assert.equal(afterCooldown.success, true, 'the same initiator may start again once the full cooldown expires');
}

console.log('room vote-kick runtime: 2 scenarios passed');
