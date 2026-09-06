// The in-game socket domain: dice, property, auction, trade, contract, jail,
// loan, economy, event-vote, and bankruptcy wiring. The repetitive room-verb
// handlers (resolve room -> verb -> broadcast -> ack) are installed from the
// GAME_VERB_HANDLERS table via socketHandlerSupport's factory — the same
// table-installed pass-through pattern server/rooms.js GAME_PASSTHROUGHS
// uses. Event names, ack payload key order, emit sequence, and message text
// are wire-identical to the original server.js handlers.
import { emitResultMessage, makeRoomVerbHandler, reply, roomVerbAck } from './socketHandlerSupport.js';

const NO_PENDING_CONTRACT = { success: false, error: 'No pending contract to cancel.' };

const AUCTION_STILL_OPEN = (result, room) => Boolean(result?.success && room.game.auction?.active);

// Small builders that keep the repetitive verbs table free of copy-paste
// accessor arrows: verb arguments are picked by payload key, ack extras are
// picked (in key order) from the result.
function pickArgs(keys) {
  return payload => keys.map(key => payload[key]);
}

function pickAckFields(fields) {
  return result => {
    const ack = {};
    fields.forEach(field => {
      ack[field] = result?.[field];
    });
    return ack;
  };
}

const NO_ARGS = () => [];
const WHOLE_PAYLOAD = payload => [payload];

const GAME_VERB_HANDLERS = [
  { event: 'purchase-property', verb: 'purchaseProperty', args: pickArgs(['tileIndex']), message: true },
  { event: 'decline-property', verb: 'declineProperty', args: pickArgs(['tileIndex']), auctionRefresh: r => Boolean(r?.auctionStarted), message: true },
  { event: 'auction-bid', verb: 'placeAuctionBid', args: pickArgs(['amount']), auctionRefresh: AUCTION_STILL_OPEN, message: true },
  { event: 'auction-pass', verb: 'passAuction', args: NO_ARGS, auctionRefresh: AUCTION_STILL_OPEN },
  { event: 'end-turn', verb: 'endTurn', args: NO_ARGS },
  { event: 'manage-property', verb: 'manageProperty', args: p => [{ tileIndex: p.tileIndex, action: p.action }], message: true },
  { event: 'propose-trade', verb: 'proposeTrade', args: WHOLE_PAYLOAD, relay: { event: 'trade-offer', field: 'trade', recipient: 'toPlayerId' }, ackExtras: pickAckFields(['trade']) },
  { event: 'respond-trade', verb: 'respondToTrade', args: WHOLE_PAYLOAD, ackExtras: pickAckFields(['accepted']) },
  { event: 'propose-player-contract', verb: 'proposePlayerContract', args: WHOLE_PAYLOAD, relay: { event: 'player-contract-offer', field: 'contract', recipient: 'toPlayerId' }, ackExtras: pickAckFields(['contract']) },
  { event: 'respond-player-contract', verb: 'respondPlayerContract', args: p => [p.accept === true, p.requestId], relay: { event: 'player-contract-update', field: 'contract', recipient: 'fromPlayerId' }, ackExtras: pickAckFields(['contract', 'accepted']) },
  { event: 'repay-player-contract', verb: 'repayPlayerContract', args: WHOLE_PAYLOAD, ackExtras: pickAckFields(['contract']) },
  { event: 'pay-jail-fine', verb: 'payJailFine', args: NO_ARGS, message: true },
  { event: 'use-jail-free', verb: 'useJailFree', args: NO_ARGS, message: true },
  { event: 'take-bank-loan', verb: 'takeBankLoan', args: pickArgs(['requestId']), message: true, ackExtras: pickAckFields(['loan']) },
  { event: 'repay-bank-loan', verb: 'repayBankLoan', args: WHOLE_PAYLOAD, ackExtras: pickAckFields(['loan']) },
  { event: 'market-order', verb: 'tradeMarket', args: pickArgs(['instrumentId', 'side', 'quantity', 'requestId']), ackExtras: pickAckFields(['order', 'economy']) },
  { event: 'vote-global-event', verb: 'voteGlobalEvent', args: pickArgs(['choiceId']) },
  { event: 'declare-bankruptcy', verb: 'declareBankruptcy', args: NO_ARGS }
];

function registerGameSocketHandlers(on, socket, runtime) {
  GAME_VERB_HANDLERS.forEach(definition => {
    on(definition.event, makeRoomVerbHandler(socket, runtime, definition));
  });

  on('roll-dice', handleRollDice);
  on('cancel-player-contract', handleCancelPlayerContract);
  on('get-bank-loan-offer', handleBankLoanOffer);
  on('get-economy-snapshot', handleEconomySnapshot);
  on('place-casino-bet', handlePlaceCasinoBet);

  function handleRollDice(_payload, callback) {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.rollDice(socket.id);
    runtime.emitRoomState(room);
    announceRollOutcomes(runtime, socket, room, result);
    reply(callback, roomVerbAck(result));
  }

  function handleCancelPlayerContract(payload, callback) {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const cached = runtime.cachedContractCancel(room, socket, payload);
    if (cached) return reply(callback, cached);
    const rejected = contractCancelRejection(room);
    if (rejected) return reply(callback, rejected);
    reply(callback, finalizeContractCancel(room, payload));
  }

  function contractCancelRejection(room) {
    const contract = room.game.pendingPlayerContract;
    if (!contract) return NO_PENDING_CONTRACT;
    const player = room.getPlayerBySocket(socket.id);
    if (!player) return NO_PENDING_CONTRACT;
    if (contract.fromPlayerId !== player.id) return NO_PENDING_CONTRACT;
    return null;
  }

  function finalizeContractCancel(room, payload) {
    const player = room.getPlayerBySocket(socket.id);
    room.game.pendingPlayerContract = null;
    room.game.feedMessage(player.nickname + ' canceled the player contract.');
    const result = { success: true };
    runtime.cacheContractCancel(room, socket, payload, result);
    runtime.emitRoomState(room);
    return result;
  }

  function handleBankLoanOffer(_payload, callback) {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const offer = room.getBankLoanOffer(socket.id);
    reply(callback, { success: offer?.available ?? false, error: offer?.reason, offer });
  }

  function handleEconomySnapshot(_payload, callback) {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const player = room.getPlayerBySocket(socket.id);
    reply(callback, economySnapshotAck(room, player));
  }

  function economySnapshotAck(room, player) {
    if (!player) return { success: false, error: 'Player not found.', economy: null };
    return { success: true, error: undefined, economy: room.game.economySnapshot(player.id) };
  }

  function handlePlaceCasinoBet(payload = {}, callback) {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.placeCasinoBet(socket.id, payload.color, payload.stake, payload.requestId);
    runtime.emitRoomState(room);
    announceCasinoSpin(runtime, socket, room, result);
    reply(callback, roomVerbAck(result, pickAckFields(['result', 'economy'])));
  }
}

function announceRollOutcomes(runtime, socket, room, result) {
  emitRollPurchaseOffer(socket, result);
  announceRollAuction(runtime, room, result);
  emitResultMessage(runtime.io, room, result);
  emitRollCardReveal(socket, result);
}

function emitRollPurchaseOffer(socket, result) {
  if (!result?.purchaseOffer) return;
  socket.emit('purchase-offer', result.purchaseOffer);
}

function announceRollAuction(runtime, room, result) {
  if (!result?.auctionStarted) return;
  runtime.scheduleAuctionFinish(room);
  runtime.io.in(room.roomCode).emit('system-message', { text: 'Auction started.' });
}

function emitRollCardReveal(socket, result) {
  if (!result?.cardReveal) return;
  socket.emit('card-reveal', result.cardReveal);
}

function announceCasinoSpin(runtime, socket, room, result) {
  if (!result?.success) return;
  const nickname = room.game.getPlayerBySocket(socket.id)?.nickname || 'Player';
  runtime.io.in(room.roomCode).emit('system-message', { text: `${nickname} settled a casino spin.` });
}

export { registerGameSocketHandlers };
