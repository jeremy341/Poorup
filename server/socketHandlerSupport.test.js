import assert from 'node:assert/strict';
import * as socketHandlerSupport from './socketHandlerSupport.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

assert.equal(typeof socketHandlerSupport.publicActionHistoryKind, 'function', 'socket handler support classifies allowlisted public action kinds');
const publicActionHistoryKind = socketHandlerSupport.publicActionHistoryKind;
const successful = { success: true };
assert.equal(publicActionHistoryKind('auction-bid', {}, successful), 'auction-bid');
assert.equal(publicActionHistoryKind('purchase-property', {}, successful), 'purchase');
assert.equal(publicActionHistoryKind('manage-property', { action: 'build-house' }, successful), 'build');
assert.equal(publicActionHistoryKind('manage-property', { action: 'sell-house' }, successful), null);
assert.equal(publicActionHistoryKind('respond-trade', { accept: true }, successful), 'trade-accept');
assert.equal(publicActionHistoryKind('counter-trade', {}, successful), 'trade-counter');
assert.equal(publicActionHistoryKind('respond-player-contract', { accept: true }, successful), 'contract-accept');
assert.equal(publicActionHistoryKind('counter-player-contract', {}, successful), 'contract-counter');
assert.equal(publicActionHistoryKind('auction-bid', {}, { success: false }), null, 'rejected actions are omitted');
assert.equal(publicActionHistoryKind('propose-trade', {}, successful), null, 'unrequested categories are omitted');

const player = {};
const recorded = [];
const room = {
  game: {
    recordHumanAction() {},
    recordPublicAction(...args) { recorded.push(args); }
  },
  getPlayerBySocket() { return player; },
  act(_socketId, payload) { return payload.success ? { success: true } : { success: false }; }
};
const runtime = { getRoomForSocket: () => room, emitRoomState() {}, io: { in: () => ({ emit() {} }) } };
const socket = { id: 'private-socket-id' };
const definition = { event: 'auction-bid', verb: 'act', args: payload => [payload] };
const handler = socketHandlerSupport.makeRoomVerbHandler(socket, runtime, definition);
handler({ success: true, privateOffer: 'must-not-be-recorded' }, () => {});
handler({ success: false }, () => {});
assert.equal(recorded.length, 1, 'only successful server actions are recorded');
assert.deepEqual(recorded[0], [player, 'auction-bid']);
assert.equal(JSON.stringify(recorded).includes('private-socket-id'), false);
assert.equal(JSON.stringify(recorded).includes('privateOffer'), false);

const gameListeners = new Map();
let managedPayload = null;
const gamePlayer = {};
const gameRoom = {
  roomCode: 'SALE1',
  getPlayerBySocket: () => gamePlayer,
  manageProperty(_socketId, payload) { managedPayload = payload; return { success: true, payout: 30 }; },
  game: { recordHumanAction() {}, recordPublicAction() {} }
};
registerGameSocketHandlers((event, handler) => gameListeners.set(event, handler), socket, {
  getRoomForSocket: () => gameRoom,
  emitRoomState() {},
  io: { in: () => ({ emit() {} }) }
});
let deedSaleAck = null;
gameListeners.get('manage-property')({ tileIndex: 5, action: 'sell-deed', requestId: 'sale-wire-1' }, ack => { deedSaleAck = ack; });
assert.deepEqual(managedPayload, { tileIndex: 5, action: 'sell-deed', requestId: 'sale-wire-1' }, 'deed-sale request id reaches authoritative property handler');
assert.deepEqual(deedSaleAck, { success: true, error: undefined }, 'sale uses the standard management acknowledgement');
// Socket.emit(event, callback) delivers the ack as the first argument.
// The handler still gets an empty payload, and the ack must still be called.
{
  const listeners = new Map();
  const fakeSocket = { id: 'no-payload-socket', on(event, listener) { listeners.set(event, listener); } };
  const on = socketHandlerSupport.createSafeEmitter(fakeSocket);
  let seen = null;
  on('get-maintenance-state', (payload, callback) => {
    seen = { payload };
    callback({ success: true, marker: 'ack' });
  });
  const acks = [];
  listeners.get('get-maintenance-state')(ack => acks.push(ack));
  assert.deepEqual(seen.payload, {});
  assert.deepEqual(acks, [{ success: true, marker: 'ack' }], 'a no-payload emit gets its ack');
  console.log('socket no-payload emit: the ack arriving as the first argument is delivered');
}

console.log('socket action history classification: focused checks passed');

{
  const listeners = new Map();
  const socket = { id: 'presence-socket', on(event, listener) { listeners.set(event, listener); } };
  const activity = [];
  let allowed = true;
  const on = socketHandlerSupport.createSafeEmitter(socket, {
    allow: () => allowed,
    onAccepted: (socketId, event) => activity.push([socketId, event]),
  });
  on('send-chat', (payload, callback) => callback({ success: payload.success }));
  listeners.get('send-chat')({ success: true }, () => {});
  listeners.get('send-chat')({ success: false }, () => {});
  allowed = false;
  listeners.get('send-chat')({}, () => {});
  assert.deepEqual(activity, [['presence-socket', 'send-chat']], 'only successful, admitted registered input reaches presence tracking');
}

{
  const listeners = new Map();
  const fakeSocket = { id: 'game-socket', on(event, listener) { listeners.set(event, listener); } };
  const activity = [];
  const player = {};
  const room = {
    roomCode: 'PLAY1',
    game: { presentation: {}, recordHumanAction() {} },
    getPlayerBySocket: () => player,
    purchaseProperty: () => ({ success: true }),
  };
  const gameRuntime = { getRoomForSocket: () => room, emitRoomState() {}, io: { in: () => ({ emit() {} }) } };
  const on = socketHandlerSupport.createSafeEmitter(fakeSocket, { onAccepted: (_id, event) => activity.push(event) });
  registerGameSocketHandlers(on, fakeSocket, gameRuntime);
  listeners.get('purchase-property')({ tileIndex: 1 });
  assert.deepEqual(activity, ['purchase-property'], 'a real gameplay handler records success without a client acknowledgement');
}
