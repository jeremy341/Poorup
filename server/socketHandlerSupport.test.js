import assert from 'node:assert/strict';
import * as socketHandlerSupport from './socketHandlerSupport.js';

assert.equal(typeof socketHandlerSupport.publicActionHistoryKind, 'function', 'socket handler support classifies allowlisted public action kinds');
const publicActionHistoryKind = socketHandlerSupport.publicActionHistoryKind;
const successful = { success: true };
assert.equal(publicActionHistoryKind('auction-bid', {}, successful), 'auction-bid');
assert.equal(publicActionHistoryKind('auction-pass', {}, successful), 'auction-pass');
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
console.log('socket action history classification: focused checks passed');
