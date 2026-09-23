import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { registerAccountSocketHandlers } from './serverSocketAccount.js';

const manager = new RoomManager();
const socket = {
  id: 'settings-host',
  data: {},
  rooms: new Set(),
  join() {},
  leave() {},
  emit() {}
};
const room = manager.createRoom({ socketId: socket.id, clientId: 'settings-host-client', nickname: 'Host', visibility: 'private', roomCode: 'SET001' });
room.addOrReconnectPlayer({ socketId: 'settings-guest-one', clientId: 'settings-guest-one', nickname: 'Guest One' });
room.addOrReconnectPlayer({ socketId: 'settings-guest-two', clientId: 'settings-guest-two', nickname: 'Guest Two' });
const callbacks = new Map();
const runtime = {
  accountStore: {},
  roomManager: manager,
  social: { accountForSocket() { return null; } },
  getRoomForSocket() { return room; },
  emitRoomState() {},
  scheduleRoomsUpdated() {},
  leaveAllGameRooms() {},
  detachSocketFromOtherRoom() {},
  clearDisconnectTimer() {},
  reassignHostIfNeeded() {},
  emitPendingInteractions() {},
  io: { in() { return { emit() {} }; } }
};
registerAccountSocketHandlers((event, handler) => callbacks.set(event, handler), socket, runtime);

function invoke(payload) {
  let result;
  callbacks.get('set-setting')(payload, response => { result = response; });
  return result;
}

assert.deepEqual(invoke({ key: 'not-a-setting', value: true }), { success: false, error: 'Unknown room setting.' });
assert.deepEqual(invoke({ key: 'startingCash', value: 'not-number' }), { success: false, error: 'Invalid value for startingCash.' });
assert.deepEqual(invoke({ key: 'maxPlayers', value: 2 }), { success: false, error: 'Room capacity cannot be lower than the number of active players.' });
assert.deepEqual(invoke({ key: 'startingCash', value: 1800 }), { success: true });
assert.equal(room.settings.startingCash, 1800);
assert.deepEqual(invoke({ key: 'botBrain', value: 'no-ai' }), { success: true });
runtime.botProviderStatus = () => ({ state: 'quota-exhausted', revision: 1, reason: 'credits-exhausted' });
assert.deepEqual(invoke({ key: 'botBrain', value: 'ai' }), { success: false, code: 'AI_CREDITS_EXHAUSTED', error: 'AI credits are exhausted. Choose NO-AI BOT.' });
assert.equal(room.settings.botBrain, 'no-ai');
assert.deepEqual(invoke({ key: 'botBrain', value: { unexpected: true } }), { success: false, code: 'AI_CREDITS_EXHAUSTED', error: 'AI credits are exhausted. Choose NO-AI BOT.' });

function makeSocket(id) {
  return {
    id,
    data: {},
    rooms: new Set([id]),
    join(roomCode) { this.rooms.add(roomCode); },
    leave(roomCode) { this.rooms.delete(roomCode); },
    emit() {}
  };
}

function registerRoomHarness(roomManager, testSocket, snapshots) {
  const handlers = new Map();
  const testRuntime = {
    accountStore: {},
    roomManager,
    social: { accountForSocket() { return null; } },
    emitRoomState(roomState) { snapshots.push(roomState); },
    scheduleRoomsUpdated() {},
    leaveAllGameRooms() {},
    detachSocketFromOtherRoom() {},
    clearDisconnectTimer() {},
    reassignHostIfNeeded() {},
    emitPendingInteractions() {},
    destroyRoom(roomState) { roomManager.rooms.delete(roomState.roomCode); },
    io: { in() { return { emit() {} }; } }
  };
  registerAccountSocketHandlers((event, handler) => handlers.set(event, handler), testSocket, testRuntime);
  return handlers;
}

const replayManager = new RoomManager();
const snapshots = [];
const originSocket = makeSocket('lost-ack-origin');
const originHandlers = registerRoomHarness(replayManager, originSocket, snapshots);
const createPayload = {
  clientId: 'stable-create-client',
  requestId: 'create-request-lost-ack',
  nickname: 'Reliable Host',
  visibility: 'public',
  roomName: 'RELIABLE TABLE',
  boardVariant: 'metro-52',
};

// Fault injection: creation commits, but the caller discards the ack and the
// transport disconnects before it can know whether the side effect happened.
originHandlers.get('create-room')(createPayload, () => {});
const committedRoom = replayManager.getRoomByClient(createPayload.clientId);
assert.ok(committedRoom);
committedRoom.game.getPlayerByClient(createPayload.clientId).disconnected = true;
replayManager.disconnectPlayer(originSocket.id);

const replacementSocket = makeSocket('lost-ack-replacement');
const replacementHandlers = registerRoomHarness(replayManager, replacementSocket, snapshots);
let replayAck;
replacementHandlers.get('create-room')(createPayload, response => { replayAck = response; });

assert.equal(replayManager.rooms.size, 1, 'lost create ack must not create a duplicate room');
assert.equal(replayManager.getRoomBySocket(replacementSocket.id), committedRoom, 'retry must restore the replacement socket to the committed room');
assert.equal(snapshots.at(-1), committedRoom, 'retry must emit the authoritative room snapshot');
assert.deepEqual(replayAck, {
  success: true,
  roomCode: null,
  visibility: 'public',
  created: true,
  hostId: committedRoom.hostId,
  playerId: committedRoom.game.getPlayerByClient(createPayload.clientId).id,
  bots: 0,
  requestId: createPayload.requestId,
});
assert.equal(committedRoom.roomName, 'RELIABLE TABLE');
assert.equal(committedRoom.ruleset.boardVariant, 'metro-52');

let conflictAck;
replacementHandlers.get('create-room')({ ...createPayload, roomName: 'DIFFERENT TABLE' }, response => { conflictAck = response; });
assert.deepEqual(conflictAck, {
  success: false,
  error: 'That create-room request ID was already used with different details.'
});
assert.equal(replayManager.rooms.size, 1, 'request-id payload conflicts must not mutate rooms');

console.log('server socket account settings/replay: 13 scenarios passed, 0 failed');
