// Releasing a seat for good (leave, kick, expiry): a started seat's estate and obligations are settled, the turn passes on, and the
// table ends when no connected player is left.
import { AUCTION_DURATION_MS } from './auctionApi.js';
import { outstandingDebtFor, settleQueuedDebtsOf } from './bankruptcyLogic.js';

// A real leave releases the seat in the lobby AND mid-game, so the room
// can drain to empty and the GC can reclaim it.
export function releaseSeat(game, player) {
  const playerId = player.id;
  const wasCurrentTurn = wasCurrentTurnSeat(game, playerId);
  if (game.started) {
    const prepared = releaseStartedSeatAssets(game, player);
    if (prepared?.success === false) return prepared;
  }
  game.removePlayerByClient(player.clientId);
  if (game.started) clearStartedGameSeat(game, player, wasCurrentTurn);
  return { success: true };
}

function releaseStartedSeatAssets(game, player) {
  const prepared = game.prepareCollateralForExit?.(player);
  if (prepared?.success === false) return prepared;
  // A voluntary leave is final. Remove every reference that could otherwise
  // leave orphaned deeds/market holdings or live contracts pointing at a
  // player not present in the table.
  const creditor = pendingSeatCreditor(game, player);
  clearPendingSeatObligations(game, player);
  settleSeatExit(game, player, creditor);
  return { success: true };
}

// The creditor the leaving seat's estate settles to: its head claim, or the
// first queued claim it owes (see bankruptcyLogic.outstandingDebtFor).
function pendingSeatCreditor(game, player) {
  return outstandingDebtFor(game, player).creditor;
}

// A voluntary leave runs the same settlement ladder as a declared bankruptcy. The bank-loan line is part of that ladder: once the seat is
// bankrupt, advanceBankLoan skips it forever, so an unsettled loan would stay active after the player left, keeping principal and premium.
// Optional-call syntax because the method arrives with the bankruptcy mixin on GameState.prototype.
function settleSeatExit(game, player, creditor) {
  game.markPlayerBankrupt?.(player);
  game.liquidateMarketPositions?.(player);
  game.liquidateItems?.(player);
  game.settleBankLoanOnBankruptcy?.(player);
  game.sweepCashToCreditor?.(player, creditor);
  game.settleContractsOnBankruptcy?.(player);
  game.forfeitOrReleaseProperties?.(player, creditor);
  game.feedMessage(`${player.nickname} left the table.`);
}

function wasCurrentTurnSeat(game, playerId) {
  if (!game.started) return false;
  return game.currentPlayerId === playerId;
}

function clearStartedGameSeat(game, player, wasCurrentTurn) {
  const playerId = player.id;
  // Consecutive-doubles state belongs to the seated roller, not the seat:
  // otherwise the successor inherits the count and jails one roll early.
  if (wasCurrentTurn) game.consecutiveDoubles = 0;
  // Capture the successor BEFORE filtering: nulling the id and calling
  // nextTurn() restarts at turnOrder[0] and skips the rightful next seat.
  const successor = wasCurrentTurn ? findTurnSuccessor(game, playerId) : null;
  removeSeatFromTurnOrder(game, playerId);
  clearPendingSeatObligations(game, player);
  const survivors = game.connectedNonBankruptPlayers();
  if (survivors.length <= 1) {
    // Only a clock pointing at the departed seat (or nowhere) moves; a live seat that still holds it keeps it. The table waits on a seat
    // in reconnect grace, as nextTurn does, instead of ending without it. The inheriting seat starts a fresh turn: keeping the leaver's
    // roll state told it "already rolled" and wedged the table (concludeBankruptRound resets the same way).
    if (!game.getPlayerById(game.currentPlayerId)) {
      game.resetTurnState();
      game.hasRolled = false;
      game.currentPlayerId = survivors[0]?.id || game.waitingSeat()?.id || null;
    }
    game.finishIfNoConnectedPlayers(survivors);
    return;
  }
  if (!wasCurrentTurn) return;
  beginSeatExitTurn(game, successor);
}

function findTurnSuccessor(game, playerId) {
  const turnOrder = game.turnOrder;
  if (!Array.isArray(turnOrder)) return null;
  const oldIndex = turnOrder.indexOf(playerId);
  if (oldIndex < 0) return null;
  const wrapIndex = turnOrder.length - oldIndex - 1;
  const orderedIds = [...turnOrder.slice(oldIndex + 1), ...turnOrder.slice(0, oldIndex + 1)];
  const successorIndex = orderedIds.findIndex(id => turnCandidateIsActive(game, id, playerId));
  if (successorIndex < 0) return null;
  return { player: game.getPlayerById(orderedIds[successorIndex]), wrapped: successorIndex >= wrapIndex };
}

function turnCandidateIsActive(game, candidateId, playerId) {
  const candidate = game.getPlayerById(candidateId);
  if (!candidate) return false;
  if (candidate.id === playerId) return false;
  if (candidate.bankrupt) return false;
  return !candidate.disconnected;
}

function removeSeatFromTurnOrder(game, playerId) {
  if (typeof game.removePlayerFromTurnOrder === 'function') {
    game.removePlayerFromTurnOrder(playerId);
    return;
  }
  if (Array.isArray(game.turnOrder)) {
    game.turnOrder = game.turnOrder.filter(id => id !== playerId);
  }
}

function beginSeatExitTurn(game, successor) {
  if (successor) {
    if (successor.wrapped) game.advanceRound();
    // The round limit can end the table inside advanceRound.
    if (!game.started) return;
    game.resetTurnState();
    game.beginSeatTurn(successor.player);
    return;
  }
  // nextTurn() treats an unknown current id as "before the first seat"
  // and hands the dice to the next surviving player in turn order.
  game.currentPlayerId = null;
  game.nextTurn();
}

function clearPendingSeatObligations(game, player) {
  const playerId = player.id;
  clearSeatPurchaseOffer(game, playerId);
  clearSeatPendingPayment(game, player);
  clearSeatTrade(game, playerId);
  clearSeatContract(game, playerId);
  revokeAuctionLead(game, playerId);
}

function clearSeatPurchaseOffer(game, playerId) {
  game.clearSponsoredPurchaseForPlayer?.(playerId);
  if (game.pendingPurchaseOffer?.playerId === playerId) game.pendingPurchaseOffer = null;
}

function clearSeatPendingPayment(game, player) {
  // The seat's own queued claims settle against its estate before the head
  // is cancelled below: cancelling the head would promote one of them.
  settleQueuedDebtsOf(game, player, outstandingDebtFor(game, player).creditor);
  game.removeQueuedPaymentsForPlayer?.(player.id);
  if (pendingPaymentFrom(game, player.id)) {
    cancelSeatPayment(game, player);
    return;
  }
  if (seatIsPaymentCreditor(game, player.id)) {
    cancelSeatPayment(game, player, true);
  }
}

function seatIsPaymentCreditor(game, playerId) {
  const pending = game.pendingPayment;
  if (!pending) return false;
  return pending.creditorId === playerId;
}

// A pending debt cannot settle without its creditor: trySettlePendingPayment still debits the payer if the creditor is gone.
// Forgiving the debt on creditor-quit is the minimal coherent rule; bank debts (null creditor) never match a quitter. If the debtor is the roller
// whose landing created the debt, a forgiven debt must still resolve the roll (as collectPendingPayment does) or the turn wedges.
function cancelSeatPayment(game, player, forgiven = false) {
  const pending = game.pendingPayment;
  const turnOptions = game.pendingPaymentTurnOptions || {};
  const debtor = pending ? game.getPlayerById(pending.playerId) : null;
  const resolvesRoll = forgiven && Boolean(debtor) && !debtor.bankrupt
    && game.hasRolled && debtor.id === game.currentPlayerId;
  game.clearPendingPayment();
  game.feedMessage(`${player.nickname} left the table. A pending payment was cancelled.`);
  if (resolvesRoll) game.resolveTurnAfterAction(turnOptions);
}

function clearSeatTrade(game, playerId) {
  if (pendingTradeFrom(game, playerId)) game.pendingTrade = null;
}

function clearSeatContract(game, playerId) {
  if (pendingContractFrom(game, playerId)) game.pendingPlayerContract = null;
}

function pendingPaymentFrom(game, playerId) {
  const pending = game.pendingPayment;
  if (!pending) return false;
  return pending.playerId === playerId;
}

function pendingTradeFrom(game, playerId) {
  const trade = game.pendingTrade;
  if (!trade) return false;
  if (trade.fromPlayerId === playerId) return true;
  return trade.toPlayerId === playerId;
}

function pendingContractFrom(game, playerId) {
  const contract = game.pendingPlayerContract;
  if (!contract) return false;
  if (contract.fromPlayerId === playerId) return true;
  return contract.toPlayerId === playerId;
}

function revokeAuctionLead(game, playerId) {
  const auction = game.auction;
  if (!auction) return;
  if (!auction.active) return;
  if (auction.highestBidderId !== playerId) return;
  auction.highestBidderId = null;
  auction.highestBid = 0;
  auction.lastBidAt = 0;
  // A revoke in the last moments must leave a real bidding window for the
  // rivals, exactly as the disconnect path (revokeAuctionLeadIfLeader) and
  // the bankruptcy path do; without it the already-armed timer closes the
  // auction almost immediately.
  auction.endsAt = Math.max(Number(auction.endsAt) || 0, Date.now() + AUCTION_DURATION_MS);
  game.feedMessage?.('The highest bid is reset.');
}
