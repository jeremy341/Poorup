// Property auctions as a prototype mixin: the open-outcome flow that starts
// when a deed is declined (or unaffordable), the bid/pass mini-game, and the
// timed close. gameLogic.js assigns this object onto GameState.prototype and
// re-exports AUCTION_DURATION_MS for server.js; server/gameLogic.test.js pins
// every rejection string and precedence.

const AUCTION_DURATION_MS = 5000;
const AUCTION_BID_COOLDOWN_MS = 300;

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
    this.passedPlayerIds = [];
  }
}

const auctionApi = {
  startAuction(tile, initiatingPlayerId) {
    if (this.globalEventActive('bank-run') || this.activeEventEffects().auctionBlocked) {
      this.feedMessage('The active global event pauses auctions until liquidity returns.');
      this.resolveTurnAfterAction({ allowExtraRoll: false });
      return { success: false, error: 'Auctions are paused by the active Bank Run.' };
    }
    const participants = this.players.filter(player => !player.bankrupt && !player.disconnected).map(player => player.id);
    this.auction = new AuctionState(tile, initiatingPlayerId);
    this.auction.participants = participants;
    this.feedMessage(`Auction started for ${tile.name}. Players may place bids.`);
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
    return this.auctionBidValueRejection(player, amount, now);
  },

  auctionSeatRejection(player) {
    const auction = this.auction;
    if (!auction.participants.length) return null;
    if (!auction.participants.includes(player.id)) return { success: false, error: 'You are not part of this auction.' };
    return null;
  },

  auctionBidValueRejection(player, amount, now) {
    const timing = this.auctionTimingRejection(player, now);
    if (timing) return timing;
    return this.auctionPriceRejection(player, amount);
  },

  auctionTimingRejection(player, now) {
    const auction = this.auction;
    if (auction.passedPlayerIds.includes(player.id)) return { success: false, error: 'You have passed on this auction.' };
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

  passAuction(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const rejection = this.auctionPassRejection(player);
    if (rejection) return rejection;
    return this.recordAuctionPass(player);
  },

  auctionPassRejection(player) {
    if (!player) return { success: false, error: 'No auction is active.' };
    if (!this.auction) return { success: false, error: 'No auction is active.' };
    if (!this.auction.active) return { success: false, error: 'No auction is active.' };
    const auction = this.auction;
    if (auction.participants.length && !auction.participants.includes(player.id)) return { success: false, error: 'You are not part of this auction.' };
    if (auction.highestBidderId === player.id) return { success: false, error: 'The current high bidder cannot pass.' };
    return null;
  },

  recordAuctionPass(player) {
    const auction = this.auction;
    if (!auction.passedPlayerIds.includes(player.id)) {
      auction.passedPlayerIds.push(player.id);
      this.feedMessage(`${player.nickname} passed on the auction.`);
    }
    const remaining = auction.participants.filter(id => !auction.passedPlayerIds.includes(id));
    if (auction.highestBidderId && remaining.length <= 1) {
      this.finishAuction();
      return { success: true, finished: true };
    }
    return { success: true };
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
    if (!this.auctionWinnerEligible(winner)) {
      this.feedMessage('Auction ended without a valid winner.');
      this.resolveTurnAfterAction();
      this.auction = null;
      return;
    }
    this.completeAuctionSale(auction, winner);
  },

  auctionWinnerEligible(winner) {
    if (!winner) return false;
    if (winner.bankrupt) return false;
    return !winner.disconnected;
  },

  closeAuctionWithoutBids(auction) {
    this.feedMessage(`No bids were placed for ${auction.propertyTile.name}. The property remains unsold.`);
    this.resolveTurnAfterAction();
    this.auction = null;
  },

  completeAuctionSale(auction, winner) {
    auction.propertyTile.ownerId = winner.id;
    auction.propertyTile.mortgaged = false;
    auction.propertyTile.houseCount = 0;
    winner.properties.push(auction.propertyTile.index);
    winner.auctionWins = (winner.auctionWins || 0) + 1;
    if (auction.highestBid < Number(auction.propertyTile.price || 0)) winner.auctionUnderListWins = (winner.auctionUnderListWins || 0) + 1;
    this.feedMessage(`${winner.nickname} won the auction for ${auction.propertyTile.name} at $${auction.highestBid}.`);
    this.chargePlayer({
      player: winner,
      amount: auction.highestBid,
      message: `${winner.nickname} paid $${auction.highestBid} for ${auction.propertyTile.name}.`,
      turnOptions: {}
    });
    this.auctionsCompleted += 1;
    this.auction = null;
  }
};

export { AuctionState, AUCTION_DURATION_MS, auctionApi };
