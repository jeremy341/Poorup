import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

function fakeSocket(id) {
  return { id, emitted: [], emit(event, payload) { this.emitted.push({ event, payload }); } };
}

function fakeRuntime(room, delivered) {
  const emitTo = target => ({
    emit(event, payload) {
      delivered.push({ target, event, payload });
    }
  });
  return {
    getRoomForSocket() { return room; },
    emitRoomState() {},
    io: {
      to: emitTo,
      in() { return { emit() {} }; }
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

function relayRoom(hostSocketId, guestSocketId, hostClientId, guestClientId) {
  const manager = new RoomManager();
  const host = fakeSocket(hostSocketId);
  const guest = fakeSocket(guestSocketId);
  const room = manager.createRoom({ socketId: hostSocketId, clientId: hostClientId, nickname: 'Host', visibility: 'private', roomCode: hostClientId.toUpperCase() });
  room.addOrReconnectPlayer({ socketId: guestSocketId, clientId: guestClientId, nickname: 'Guest' });
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  const delivered = [];
  const runtime = fakeRuntime(room, delivered);
  return { room, host, guest, delivered, hostHandlers: handlersFor(host, runtime), guestHandlers: handlersFor(guest, runtime) };
}

const first = relayRoom('relay-a', 'relay-b', 'relay-a-client', 'relay-b-client');
const [lender, borrower] = first.room.game.players;
const firstProposal = invoke(first.hostHandlers.get('propose-player-contract'), {
  toPlayerId: borrower.id, kind: 'loan', amount: 50, requestId: 'relay-initial'
});
assert.equal(firstProposal.success, true);
const firstCounter = invoke(first.guestHandlers.get('counter-player-contract'), {
  contractId: firstProposal.contract.id, amount: 60, requestId: 'relay-counter-one'
});
assert.equal(firstCounter.success, true);
const secondCounter = invoke(first.hostHandlers.get('counter-player-contract'), {
  contractId: firstCounter.contract.id, amount: 70, requestId: 'relay-counter-two'
});
assert.equal(secondCounter.success, true);
assert.deepEqual(first.delivered.filter(entry => entry.event === 'player-contract-offer').map(entry => [entry.target, entry.payload.contract.amount]), [
  [borrower.socketId, 50],
  [lender.socketId, 60],
  [borrower.socketId, 70]
]);
const borrowerResponse = invoke(first.guestHandlers.get('respond-player-contract'), {
  accept: true, contractId: secondCounter.contract.id, requestId: 'relay-borrower-response'
});
assert.equal(borrowerResponse.success, true);
assert.deepEqual(first.delivered.filter(entry => entry.event === 'player-contract-update').map(entry => entry.target), [lender.socketId]);

const second = relayRoom('relay-c', 'relay-d', 'relay-c-client', 'relay-d-client');
const [, secondBorrower] = second.room.game.players;
const proposal = invoke(second.hostHandlers.get('propose-player-contract'), {
  toPlayerId: secondBorrower.id, kind: 'loan', amount: 50, requestId: 'relay-response-initial'
});
const counter = invoke(second.guestHandlers.get('counter-player-contract'), {
  contractId: proposal.contract.id, amount: 55, requestId: 'relay-response-counter'
});
assert.equal(counter.success, true);
const lenderResponse = invoke(second.hostHandlers.get('respond-player-contract'), {
  accept: true, contractId: counter.contract.id, requestId: 'relay-lender-response'
});
assert.equal(lenderResponse.success, true);
assert.deepEqual(second.delivered.filter(entry => entry.event === 'player-contract-update').map(entry => entry.target), [secondBorrower.socketId]);
console.log('server socket game relay: 2 scenarios passed, 0 failed');
