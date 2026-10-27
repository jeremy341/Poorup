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
// F-088: socket.emit(event, callback) delivers the ack as the first argument.
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
