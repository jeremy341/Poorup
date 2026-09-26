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

// Contract negotiations keep the lender/borrower IDs stable while the
// responder alternates after every counter. The resulting counter depth is
// the authoritative relay direction: odd depths were proposed by the
// borrower, even depths by the lender.
function contractCounterRelayRecipient(contract) {
  return Number(contract?.counterDepth) % 2 === 0 ? 'toPlayerId' : 'fromPlayerId';
}

function contractResponseRelayRecipient(contract) {
  return Number(contract?.counterDepth) % 2 === 0 ? 'fromPlayerId' : 'toPlayerId';
}

const NO_ARGS = () => [];
const WHOLE_PAYLOAD = payload => [payload];

function recordHumanAction(room, socket, result) {
  if (result?.success !== false) room.game.recordHumanAction?.(room.getPlayerBySocket(socket.id));
}

const GAME_VERB_HANDLERS = [
  { event: 'purchase-property', verb: 'purchaseProperty', args: pickArgs(['tileIndex']), message: true },
  { event: 'decline-property', verb: 'declineProperty', args: pickArgs(['tileIndex']), auctionRefresh: r => Boolean(r?.auctionStarted), message: true },
  { event: 'auction-bid', verb: 'placeAuctionBid', args: pickArgs(['amount']), auctionRefresh: AUCTION_STILL_OPEN, message: true },
  { event: 'auction-pass', verb: 'passAuction', args: NO_ARGS, auctionRefresh: AUCTION_STILL_OPEN },
  { event: 'end-turn', verb: 'endTurn', args: NO_ARGS },
  { event: 'manage-property', verb: 'manageProperty', args: p => [{ tileIndex: p.tileIndex, action: p.action }], message: true },
  { event: 'propose-trade', verb: 'proposeTrade', args: WHOLE_PAYLOAD, relay: { event: 'trade-offer', field: 'trade', recipient: 'toPlayerId' }, ackExtras: pickAckFields(['trade']) },
  { event: 'counter-trade', verb: 'counterTrade', args: WHOLE_PAYLOAD, relay: { event: 'trade-offer', field: 'trade', recipient: 'toPlayerId' }, ackExtras: pickAckFields(['trade', 'countered']) },
  { event: 'adjust-trade', verb: 'adjustTrade', args: WHOLE_PAYLOAD, relay: { event: 'trade-offer', field: 'trade', recipient: 'toPlayerId' }, ackExtras: pickAckFields(['trade', 'adjusted']) },
  { event: 'cancel-trade', verb: 'cancelTrade', args: WHOLE_PAYLOAD, ackExtras: pickAckFields(['canceled']) },
  { event: 'respond-trade', verb: 'respondToTrade', args: WHOLE_PAYLOAD, ackExtras: pickAckFields(['accepted']) },
  { event: 'propose-player-contract', verb: 'proposePlayerContract', args: WHOLE_PAYLOAD, relay: { event: 'player-contract-offer', field: 'contract', recipient: 'toPlayerId' }, ackExtras: pickAckFields(['contract']) },
  { event: 'counter-player-contract', verb: 'counterPlayerContract', args: WHOLE_PAYLOAD, relay: { event: 'player-contract-offer', field: 'contract', recipient: contractCounterRelayRecipient }, ackExtras: pickAckFields(['contract', 'countered']) },
  { event: 'adjust-player-contract', verb: 'adjustPlayerContract', args: WHOLE_PAYLOAD, relay: { event: 'player-contract-offer', field: 'contract', recipient: 'toPlayerId' }, ackExtras: pickAckFields(['contract', 'adjusted']) },
  { event: 'respond-player-contract', verb: 'respondPlayerContract', args: p => [p.accept === true, p.requestId, p.contractId], relay: { event: 'player-contract-update', field: 'contract', recipient: contractResponseRelayRecipient }, ackExtras: pickAckFields(['contract', 'accepted']) },
  { event: 'repay-player-contract', verb: 'repayPlayerContract', args: WHOLE_PAYLOAD, ackExtras: pickAckFields(['contract']) },
  { event: 'pay-jail-fine', verb: 'payJailFine', args: NO_ARGS, message: true },
  { event: 'use-jail-free', verb: 'useJailFree', args: NO_ARGS, message: true },
  { event: 'take-bank-loan', verb: 'takeBankLoan', args: pickArgs(['requestId']), message: true, ackExtras: pickAckFields(['loan']) },
  { event: 'repay-bank-loan', verb: 'repayBankLoan', args: WHOLE_PAYLOAD, ackExtras: pickAckFields(['loan']) },
  { event: 'market-order', verb: 'tradeMarket', args: pickArgs(['instrumentId', 'side', 'quantity', 'requestId']), ackExtras: pickAckFields(['order', 'economy']) },
  { event: 'open-margin', verb: 'openMargin', args: pickArgs(['instrumentId', 'quantity', 'requestId']), ackExtras: pickAckFields(['economy']) },
  { event: 'reduce-margin', verb: 'reduceMargin', args: pickArgs(['amount', 'requestId']), ackExtras: pickAckFields(['economy']) },
  { event: 'open-short', verb: 'openShort', args: pickArgs(['instrumentId', 'quantity', 'requestId']), ackExtras: pickAckFields(['economy']) },
  { event: 'cover-short', verb: 'coverShort', args: pickArgs(['instrumentId', 'quantity', 'requestId']), ackExtras: pickAckFields(['economy']) },
  { event: 'settle-short-default', verb: 'settleShortDefault', args: pickArgs(['amount', 'requestId']), ackExtras: pickAckFields(['paid', 'remaining', 'economy']) },
  { event: 'open-option', verb: 'openOption', args: WHOLE_PAYLOAD, ackExtras: pickAckFields(['option', 'economy']) },
  { event: 'exercise-option', verb: 'exerciseOption', args: pickArgs(['optionId', 'requestId']), ackExtras: pickAckFields(['optionId', 'payout', 'economy']) },
  { event: 'close-position', verb: 'closePosition', args: pickArgs(['optionId', 'requestId']), ackExtras: pickAckFields(['optionId', 'payout', 'economy']) },
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
  on('request-sponsored-purchase', (_payload, callback) => handleSponsorship('request', {}, callback));
  on('contribute-sponsored-purchase', (payload, callback) => handleSponsorship('contribute', payload || {}, callback));
  on('withdraw-sponsored-purchase', (_payload, callback) => handleSponsorship('withdraw', {}, callback));
  on('accept-sponsored-purchase', (_payload, callback) => handleSponsorship('accept', {}, callback));
  on('decline-sponsored-purchase', (_payload, callback) => handleSponsorship('decline', {}, callback));

  function handleRollDice(_payload, callback) {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room.rollDice(socket.id);
    recordHumanAction(room, socket, result);
    runtime.emitRoomState(room);
    announceRollOutcomes(runtime, socket, room, result);
    reply(callback, roomVerbAck(result));
  }

  function handleCancelPlayerContract(payload, callback) {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const cached = runtime.cachedContractCancel(room, socket, payload);
    if (cached) return reply(callback, cached);
    const rejected = contractCancelRejection(room, payload);
    if (rejected) return reply(callback, rejected);
    const result = finalizeContractCancel(room, payload);
    recordHumanAction(room, socket, result);
    reply(callback, result);
  }

  function contractCancelRejection(room, payload = {}) {
    const contract = room.game.pendingPlayerContract;
    if (!contract) return NO_PENDING_CONTRACT;
    const player = room.getPlayerBySocket(socket.id);
    if (!player) return NO_PENDING_CONTRACT;
    if (contract.fromPlayerId !== player.id) return NO_PENDING_CONTRACT;
    if (payload.contractId && payload.contractId !== contract.id) {
      return { success: false, error: 'That contract offer is no longer current.' };
    }
    return null;
  }

  function finalizeContractCancel(room, payload) {
    const player = room.getPlayerBySocket(socket.id);
    const counterpartyId = room.game.pendingPlayerContract?.toPlayerId;
    room.game.pendingPlayerContract = null;
    room.game.feedMessage(player.nickname + ' canceled the player contract.');
    const result = { success: true };
    runtime.cacheContractCancel(room, socket, payload, result);
    // The counterparty holds a stale modal otherwise: push the cancel plus
    // a system message like every other contract transition.
    const target = counterpartyId ? room.game.getPlayerById(counterpartyId) : null;
    if (target?.socketId) runtime.io.to(target.socketId).emit('player-contract-update', { contract: null, canceled: true });
    runtime.io.in(room.roomCode).emit('system-message', { text: `${player.nickname} canceled the player contract.` });
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
    recordHumanAction(room, socket, result);
    runtime.emitRoomState(room);
    announceCasinoSpin(runtime, socket, room, result);
    reply(callback, roomVerbAck(result, pickAckFields(['result', 'economy'])));
  }

  function handleSponsorship(action, payload, callback) {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const methods = {
      request: () => room.game.requestPurchaseSponsorship(socket.id),
      contribute: () => room.game.contributeToSponsoredPurchase(socket.id, payload),
      withdraw: () => room.game.withdrawSponsoredPurchase(socket.id),
      accept: () => room.game.acceptSponsoredPurchase(socket.id),
      decline: () => room.game.declineSponsoredPurchase(socket.id)
    };
    const result = methods[action]?.() || { success: false, error: 'Unknown sponsorship action.' };
    recordHumanAction(room, socket, result);
    runtime.emitRoomState(room);
    runtime.io.in(room.roomCode).emit('sponsorship-update', { sponsorship: room.game.summarySponsoredPurchase() });
    reply(callback, result);
  }
}

function announceRollOutcomes(runtime, socket, room, result) {
  emitRollPurchaseOffer(socket, room, result);
  announceRollAuction(runtime, room, result);
  emitResultMessage(runtime.io, room, result);
  emitRollCardReveal(socket, result);
}

function emitRollPurchaseOffer(socket, room, result) {
  if (!result?.purchaseOffer) return;
  const player = room.game.getPlayerBySocket(socket.id);
  socket.emit('purchase-offer', {
    ...result.purchaseOffer,
    canAfford: Boolean(player && player.cash >= result.purchaseOffer.price),
    canSeekSponsorship: true
  });
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
