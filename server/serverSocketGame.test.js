import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';

function fakeSocket(id) {
  return { id, emitted: [], emit(event, payload) { this.emitted.push({ event, payload }); } };
}

function fakeRuntime(room, delivered) {
  let scheduledAuctions = 0;
  const rollTimeline = [];
  const emitTo = target => ({
    emit(event, payload) {
      delivered.push({ target, event, payload });
    }
  });
  return {
    getRoomForSocket() { return room; },
    emitRoomState() { rollTimeline.push({ type: 'room-state', auctionEndsAt: room.game.auction?.endsAt }); },
    scheduleAuctionFinish() {
      scheduledAuctions += 1;
      rollTimeline.push({ type: 'auction-scheduled' });
      const auction = room.game.auction;
      const presentationReadyAt = room.game.presentation?.readyAt;
      if (auction?.active && Number.isFinite(presentationReadyAt)) {
        auction.endsAt = Math.max(auction.endsAt, presentationReadyAt + 5_000);
      }
    },
    cachedContractCancel() { return null; },
    cacheContractCancel() {},
    io: {
      to: emitTo,
      in(target) { return { emit(event, payload) { delivered.push({ target, event, payload }); } }; }
    },
    getScheduledAuctions() { return scheduledAuctions; },
    getRollTimeline() { return rollTimeline; }
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
  return { room, host, guest, delivered, getScheduledAuctions: runtime.getScheduledAuctions, getRollTimeline: runtime.getRollTimeline, hostHandlers: handlersFor(host, runtime), guestHandlers: handlersFor(guest, runtime) };
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

const equity = relayRoom('relay-equity-a', 'relay-equity-b', 'relay-equity-a-client', 'relay-equity-b-client');
const [seller, buyer] = equity.room.game.players;
let equityCall;
const transfer = { id: 'equity-transfer-1', fromPlayerId: seller.id, toPlayerId: buyer.id, amount: 40, kind: 'equity-transfer' };
equity.room.game.proposeEquityShareTransfer = (socketId, offer) => {
  equityCall = { socketId, offer };
  return { success: true, transfer };
};
const equityResult = invoke(equity.hostHandlers.get('propose-equity-share-transfer'), {
  fromPlayerId: buyer.id,
  toPlayerId: buyer.id,
  requestId: 'equity-transfer-request',
});
assert.equal(equityCall.socketId, seller.socketId);
assert.equal(equityCall.offer.fromPlayerId, seller.id, 'the actor id comes from the authenticated room seat');
assert.equal(equityResult.contract, transfer);
assert.deepEqual(equity.delivered.filter(entry => entry.event === 'player-contract-offer').map(entry => [entry.target, entry.payload.contract]), [[buyer.socketId, transfer]]);

const cancellation = relayRoom('relay-cancel-a', 'relay-cancel-b', 'relay-cancel-a-client', 'relay-cancel-b-client');
const [, cancellationRecipient] = cancellation.room.game.players;
const cancellationOffer = invoke(cancellation.hostHandlers.get('propose-player-contract'), {
  toPlayerId: cancellationRecipient.id, kind: 'loan', amount: 50, requestId: 'cancel-propose'
});
assert.equal(cancellationOffer.success, true);
const cancellationResult = invoke(cancellation.hostHandlers.get('cancel-player-contract'), {
  contractId: cancellationOffer.contract.id, requestId: 'cancel-request'
});
assert.equal(cancellationResult.success, true);
assert.equal(cancellation.room.game.feed.filter(entry => entry.text === 'Host canceled the player contract.').length, 1);
assert.equal(cancellation.delivered.filter(entry => entry.event === 'system-message').length, 0, 'feed-backed cancellation is not emitted again as a system message');
assert.equal(cancellation.delivered.filter(entry => entry.event === 'player-contract-update').length, 1, 'the other seat still receives a contract update');

const rollAuction = relayRoom('relay-roll-auction-a', 'relay-roll-auction-b', 'relay-roll-auction-a-client', 'relay-roll-auction-b-client');
const roller = rollAuction.room.game.players[0];
const auctionTile = rollAuction.room.game.getTile(1);
rollAuction.room.game.rollDice = () => {
  rollAuction.room.game.startAuction(auctionTile, roller.id);
  rollAuction.room.game.presentation = { startedAt: Date.now(), readyAt: Date.now() + 5_040 };
  return { success: true, auctionStarted: true };
};
assert.equal(invoke(rollAuction.hostHandlers.get('roll-dice'), {}).success, true);
assert.deepEqual(rollAuction.getRollTimeline().map(event => event.type), ['auction-scheduled', 'room-state']);
assert.equal(rollAuction.getRollTimeline()[1].auctionEndsAt, rollAuction.room.game.presentation.readyAt + 5_000,
  'the initial room snapshot publishes the full post-arrival bid deadline');
assert.ok(rollAuction.room.game.feed.some(entry => entry.text === `Auction started for ${auctionTile.name}. Players may place bids.`));
assert.equal(rollAuction.delivered.filter(entry => entry.event === 'system-message').length, 0, 'roll auction start is announced by its detailed feed entry only');
assert.equal(rollAuction.getScheduledAuctions(), 1, 'removing the broadcast preserves the authoritative auction deadline');
console.log('PASS rollAuctionStartAppearsOnceInFeedAndStillSchedulesFinish');

const casino = relayRoom('relay-casino-a', 'relay-casino-b', 'relay-casino-a-client', 'relay-casino-b-client');
casino.room.game.settings.casino = true;
const casinoPlayer = casino.room.game.players[0];
assert.equal(invoke(casino.hostHandlers.get('place-casino-bet'), { color: 'red', stake: 10, requestId: 'casino-activity' }).success, true);
assert.equal(casino.room.game.feed.filter(entry => entry.text.startsWith(`${casinoPlayer.nickname} bet $10 on RED and `)).length, 1);
assert.equal(casino.delivered.filter(entry => entry.event === 'system-message').length, 0, 'the casino result feed replaces the generic settlement notice');
console.log('PASS casinoSettlementAppearsOnceInFeed');

const declinedAuction = relayRoom('relay-decline-auction-a', 'relay-decline-auction-b', 'relay-decline-auction-a-client', 'relay-decline-auction-b-client');
declinedAuction.room.game.settings.auction = true;
const decliningPlayer = declinedAuction.room.game.players[0];
const declinedTile = declinedAuction.room.game.getTile(1);
declinedAuction.room.game.pendingPurchaseOffer = { playerId: decliningPlayer.id, tileIndex: declinedTile.index, price: declinedTile.price };
assert.equal(invoke(declinedAuction.hostHandlers.get('decline-property'), { tileIndex: declinedTile.index }).success, true);
assert.ok(declinedAuction.room.game.feed.some(entry => entry.text === `Auction started for ${declinedTile.name}. Players may place bids.`));
assert.equal(declinedAuction.delivered.filter(entry => entry.event === 'system-message').length, 0, 'declining into auction uses the detailed feed instead of result.message');
console.log('PASS declinedAuctionStartUsesFeedOnly');
console.log('server socket game relay and activity deduplication: 7 scenarios passed, 0 failed');
