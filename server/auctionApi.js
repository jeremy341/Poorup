// Property auctions as a prototype mixin: the open-outcome flow that starts when a deed is declined
// (or unaffordable), the bid mini-game, and the timed close. gameLogic.js assigns this object onto
// GameState.prototype and re-exports AUCTION_DURATION_MS for server.js. server/gameLogic.test.js pins every rejection string.
import { auctionWillingness, isAuctionRaise, AUCTION_BID_INCREMENTS } from './botAuctionPolicy.js';

const AUCTION_DURATION_MS = 5000;
const AUCTION_BID_COOLDOWN_MS = 300;
export const AUCTION_COMMITTED_CASH_ERROR = 'You cannot spend cash that is committed to your leading auction bid.';

class AuctionState {
  constructor(propertyTile, startingPlayerId) {
    this.propertyTile = propertyTile;
    this.active = true;
    this.highestBid = 0;
    this.highestBidderId = null;
    this.participants = [];
    this.startingPlayerId = startingPlayerId;
    this.startedAt = Date.now();
    this.endsAt = Date.now() + AUCTION_DURATION_MS;
    this.cooldownUntil = 0;
    this.lastBidAt = 0;
  }
}

const auctionApi = {
  startAuction(tile, initiatingPlayerId) {
    if (this.auction?.active) {
      return { success: false, error: 'An auction is already active.' };
    }
    if (this.auctionPausedByEvent()) {
      this.feedMessage('The active global event pauses auctions until liquidity returns.');
      this.resolveTurnAfterAction({ allowExtraRoll: false });
      // auctionPaused: the turn is already resolved, so a caller whose own action
      // succeeded (decline, unaffordable landing) can still report success.
      return { success: false, error: 'Auctions are paused by the active Bank Run.', auctionPaused: true };
    }
    const participants = this.players.filter(player => !player.bankrupt && !player.disconnected).map(player => player.id);
    this.auction = new AuctionState(tile, initiatingPlayerId);
    this.auction.participants = participants;
    this.feedMessage(`Auction started for ${tile.name}. Players may place bids.`);
  },

  // The active global event blocks NEW auctions. An auction that is already
  // running keeps its clock and finishes normally: freezing a live
  // auction would strand the bids that are already on the table.
  auctionPausedByEvent() {
    if (this.globalEventActive('bank-run')) return true;
    return Boolean(this.activeEventEffects().auctionBlocked);
  },

  placeAuctionBid(socketId, amount) {
    const player = this.getPlayerBySocket(socketId);
    const now = Date.now();
    const rejection = this.auctionBidRejection(player, amount, now);
    if (rejection) return rejection;
    this.recordAuctionBid(player, amount, now);
    return { success: true };
  },

  auctionBidRejection(player, amount, now) {
    if (!player) return { success: false, error: 'No auction is active.' };
    if (!this.auction) return { success: false, error: 'No auction is active.' };
    if (!this.auction.active) return { success: false, error: 'No auction is active.' };
    if (player.bankrupt) return { success: false, error: 'You cannot bid right now.' };
    if (player.disconnected) return { success: false, error: 'You cannot bid right now.' };
    const rejection = this.auctionSeatRejection(player);
    if (rejection) return rejection;
    const timing = this.auctionTimingRejection(player, now);
    if (timing) return timing;
    const debt = this.auctionDebtRejection(player);
    if (debt) return debt;
    return this.auctionBidValueRejection(player, amount);
  },

  // A seat that owes money cannot bid. The cash behind a bid is the cash the
  // debt collects, so a bid the debt eats leaves the winner unable to pay and
  // voids the sale at close ("Auction ended without a valid winner").
  auctionDebtRejection(player) {
    if (this.auctionBidderDebt(player) <= 0) return null;
    return { success: false, error: 'Settle your pending payment before bidding.' };
  },

  // Everything the seat still owes: the parked claim plus the queued ones.
  auctionBidderDebt(player) {
    if (!player) return 0;
    const parked = this.pendingPayment?.playerId === player.id
      ? Number(this.pendingPayment.amountRemaining) || 0 : 0;
    const queued = (this.pendingPaymentQueue || [])
      .filter(entry => entry?.payment?.playerId === player.id)
      .reduce((sum, entry) => sum + (Number(entry.payment.amountRemaining) || 0), 0);
    return parked + queued;
  },

  auctionSeatRejection(player) {
    const auction = this.auction;
    if (!auction.participants.length) return null;
    if (!auction.participants.includes(player.id)) return { success: false, error: 'You are not part of this auction.' };
    return null;
  },

  auctionBidValueRejection(player, amount) {
    const price = this.auctionPriceRejection(player, amount);
    if (price) return price;
    if (!player.isBot) return null;
    // Bots raise with the same buttons as players (+1, +20, +100); nothing else.
    if (!isAuctionRaise(this.auction.highestBid, amount)) {
      return { success: false, error: `A bot must raise the bid by ${AUCTION_BID_INCREMENTS.map(step => '$' + step).join(', ')}.` };
    }
    const ceiling = auctionWillingness(this.auction, player, this);
    if (!Number.isFinite(ceiling) || amount > ceiling) {
      return { success: false, error: 'The bot bid exceeds its auction valuation.' };
    }
    return null;
  },

  auctionTimingRejection(player, now) {
    const auction = this.auction;
    if (Number.isFinite(Number(auction.endsAt)) && now >= Number(auction.endsAt)) {
      return { success: false, error: 'The auction has ended.' };
    }
    if (auction.cooldownUntil && now < auction.cooldownUntil) return { success: false, error: 'Please wait a moment before bidding again.' };
    return null;
  },

  auctionPriceRejection(player, amount) {
    const auction = this.auction;
    if (!Number.isFinite(amount)) return { success: false, error: 'Bid must be a whole number.' };
    if (amount % 1 !== 0) return { success: false, error: 'Bid must be a whole number.' };
    if (amount <= auction.highestBid) return { success: false, error: 'Bid must be higher than the current bid.' };
    if (amount > player.cash) return { success: false, error: 'Insufficient funds for this bid.' };
    if (auction.highestBid > 0 && auction.highestBidderId === player.id) return { success: false, error: 'Another player must raise the bid first.' };
    return null;
  },

  recordAuctionBid(player, amount, now) {
    const auction = this.auction;
    auction.highestBid = amount;
    auction.highestBidderId = player.id;
    auction.lastBidAt = now;
    auction.cooldownUntil = now + AUCTION_BID_COOLDOWN_MS;
    auction.endsAt = now + AUCTION_DURATION_MS;
    this.feedMessage(`${player.nickname} bid $${amount}.`);
  },

  // Cash the player may spend right now. The leading bid of an open auction is
  // reserved: an outflow that dips into it would void the bid at close.
  spendableCash(player) {
    const auction = this.auction;
    const leading = Boolean(auction?.active && player && auction.highestBidderId === player.id);
    const reserved = leading ? Number(auction.highestBid) || 0 : 0;
    return Number(player?.cash) - reserved;
  },

  finishAuction() {
    const auction = this.auction;
    if (!auction) return;
    if (!auction.active) return;
    auction.active = false;
    if (!auction.highestBidderId) {
      this.closeAuctionWithoutBids(auction);
      return;
    }
    const winner = this.getPlayerById(auction.highestBidderId);
    if (!this.auctionWinnerEligible(winner, auction.highestBid)) {
      this.feedMessage('Auction ended without a valid winner.');
      this.resolveAuctionTurn(auction);
      this.auction = null;
      return;
    }
    this.completeAuctionSale(auction, winner);
  },

  closeAuctionWhilePaused(auction) {
    this.feedMessage(`The auction for ${auction.propertyTile.name} was cancelled: the active global event pauses auctions until liquidity returns.`);
    this.resolveAuctionTurn(auction);
    this.auction = null;
  },

  auctionWinnerEligible(winner, amount) {
    if (!winner) return false;
    if (winner.bankrupt) return false;
    if (winner.disconnected) return false;
    if (!this.auctionWinnerCanAfford(winner, amount)) return false;
    return true;
  },

  auctionWinnerCanAfford(winner, amount) {
    if (!winner) return false;
    if (winner.cash < amount) return false;
    return true;
  },

  closeAuctionWithoutBids(auction) {
    this.feedMessage(`No bids were placed for ${auction.propertyTile.name}. The property remains unsold.`);
    this.resolveAuctionTurn(auction);
    this.auction = null;
  },

  // Only the roll that opened an auction resolves when it closes. A passed
  // purchase can open one for a successor whose roll has not happened yet;
  // closing it must leave that successor free to roll.
  resolveAuctionTurn(auction) {
    if (!this.hasRolled) return;
    if (auction.startingPlayerId !== this.currentPlayerId) return;
    this.resolveTurnAfterAction();
  },

  // The departing seat that opened an auction has no roll left to close it.
  // Cancel it before the turn advances; no cash is reserved while bidding, so
  // the deed simply stays unowned.
  cancelAuctionStartedBy(player) {
    const auction = this.auction;
    if (!auction?.active) return false;
    if (auction.startingPlayerId !== player.id || player.id !== this.currentPlayerId) return false;
    this.feedMessage(`The auction for ${auction.propertyTile.name} was cancelled because ${player.nickname} left the table.`);
    this.auction = null;
    return true;
  },

  completeAuctionSale(auction, winner) {
    if (!this.auctionWinnerCanAfford(winner, auction.highestBid)) {
      this.failAuctionForInsolventWinner(auction);
      return;
    }
    this.deductAuctionPrice(winner, auction.highestBid);
    this.transferAuctionDeed(auction, winner);
    this.recordAuctionWin(auction, winner);
    this.feedAuctionWin(auction, winner);
    this.auctionsCompleted += 1;
    this.auction = null;
    this.resolveAuctionTurn(auction);
  },

  failAuctionForInsolventWinner(auction) {
    this.feedMessage('Auction ended without a valid winner.');
    this.resolveAuctionTurn(auction);
    this.auction = null;
  },

  deductAuctionPrice(winner, price) {
    winner.cash -= price;
    if (winner.cash === 0) winner.zeroCashReached = true;
  },

  transferAuctionDeed(auction, winner) {
    this.terminateTileEquityShares?.(auction.propertyTile);
    auction.propertyTile.ownerId = winner.id;
    auction.propertyTile.purchasePricePaid = Math.max(0, Math.floor(Number(auction.highestBid) || 0));
    auction.propertyTile.mortgaged = false;
    auction.propertyTile.houseCount = 0;
    auction.propertyTile.equityShares = [];
    if (!winner.properties.includes(auction.propertyTile.index)) winner.properties.push(auction.propertyTile.index);
    // Auctions are another acquisition path: keep the same completed-group facts as direct purchases
    // and trades, or rent rules and achievements lag the visible ownership state.
    // The housing-bubble purchase fact belongs to the acquisition, not the payment route.
    if (this.globalEventActive('housing-bubble')) winner.boughtDuringHousingBubble = true;
    this.refreshPlayerGroups(winner);
  },

  recordAuctionWin(auction, winner) {
    winner.auctionWins = (winner.auctionWins || 0) + 1;
    this.recordAuctionUnderListWin(auction, winner);
  },

  recordAuctionUnderListWin(auction, winner) {
    if (auction.highestBid >= Number(auction.propertyTile.price || 0)) return;
    winner.auctionUnderListWins = (winner.auctionUnderListWins || 0) + 1;
  },

  feedAuctionWin(auction, winner) {
    this.feedMessage(`${winner.nickname} won the auction for ${auction.propertyTile.name} at $${auction.highestBid}.`);
    this.feedMessage(`${winner.nickname} paid $${auction.highestBid} for ${auction.propertyTile.name}.`);
  }
};

export { AuctionState, AUCTION_DURATION_MS, auctionApi };
