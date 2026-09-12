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
console.log('server socket account settings: 4 scenarios passed, 0 failed');
