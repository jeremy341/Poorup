import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

function fakeSocket(id) {
  return { id, emit() {} };
}

function fakeRuntime(room, delivered) {
  const emitTo = target => ({ emit(event, payload) { delivered.push({ target, event, payload }); } });
  return {
    getRoomForSocket() { return room; },
    emitRoomState() {},
    cachedContractCancel() { return null; },
    cacheContractCancel() {},
    io: {
      to: emitTo,
      in(target) { return { emit(event, payload) { delivered.push({ target, event, payload }); } }; }
    }
  };
}

function handlersFor(socket, runtime) {
  const handlers = new Map();
  registerGameSocketHandlers((event, handler) => handlers.set(event, handler), socket, runtime);
  return handlers;
}

function invoke(handler, payload) {
  let response;
  handler(payload, value => { response = value; });
  return response;
}

const manager = new RoomManager();
const host = fakeSocket('offturn-cancel-a');
const guest = fakeSocket('offturn-cancel-b');
const room = manager.createRoom({ socketId: host.id, clientId: 'offturn-cancel-a-client', nickname: 'Host', roomCode: 'OFFTURNA' });
room.addOrReconnectPlayer({ socketId: guest.id, clientId: 'offturn-cancel-b-client', nickname: 'Guest' });
assert.equal(room.startGame().success, true);
const [sender, recipient] = room.game.players;
room.game.currentPlayerId = sender.id;
const delivered = [];
const runtime = fakeRuntime(room, delivered);
const handlers = handlersFor(host, runtime);

const proposal = invoke(handlers.get('propose-player-contract'), {
  toPlayerId: recipient.id,
  kind: 'loan',
  amount: 50,
  requestId: 'offturn-cancel-proposal'
});
assert.equal(proposal.success, true);
assert.equal(room.game.pendingPlayerContract.id, proposal.contract.id);

room.game.currentPlayerId = recipient.id;
const cancellation = invoke(handlers.get('cancel-player-contract'), {
  contractId: proposal.contract.id,
  requestId: 'offturn-cancel-request'
});
assert.equal(cancellation.success, true);
assert.equal(room.game.pendingPlayerContract, null);
assert.equal(room.game.feed.filter(entry => entry.text === 'Host canceled the player contract.').length, 1);
assert.equal(delivered.filter(entry => entry.event === 'player-contract-update').length, 1);

console.log('senderCanCancelPendingPlayerContractOffTurn: passed');
