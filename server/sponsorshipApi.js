// Sponsored purchases: a voluntary, escrowed contribution that can only
// settle into the currently open bank purchase offer. Contributions are
// reserved immediately, then atomically returned or folded into the buyer's
// purchase; no separate debt or equity relationship is created.
import crypto from 'crypto';

function positiveWhole(value) {
  const amount = Math.floor(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function livePlayer(player) {
  return Boolean(player) && !player.bankrupt && !player.disconnected;
}

function sponsorshipApiContext(game, sponsorship = game.pendingSponsoredPurchase) {
  if (!sponsorship) return { sponsorship: null, buyer: null, tile: null };
  return {
    sponsorship,
    buyer: game.getPlayerById(sponsorship.buyerId),
    tile: game.getTile(Number(sponsorship.tileIndex))
  };
}

const sponsorshipApi = {
  requestPurchaseSponsorship(socketId) {
    const buyer = this.getPlayerBySocket(socketId);
    const offer = this.pendingPurchaseOffer;
    if (!buyer || !livePlayer(buyer)) return { success: false, error: 'Sponsorship is unavailable.' };
    if (buyer.id !== this.currentPlayerId || !offer || offer.playerId !== buyer.id) {
      return { success: false, error: 'There is no open purchase to sponsor.' };
    }
    if (this.pendingSponsoredPurchase) return { success: false, error: 'A sponsorship request is already open.' };
    const tile = this.getTile(Number(offer.tileIndex));
    if (!tile || tile.ownerId !== null) return { success: false, error: 'That property is no longer available.' };
    this.pendingSponsoredPurchase = {
      id: crypto.randomUUID(),
      buyerId: buyer.id,
      buyerName: buyer.nickname,
      tileIndex: tile.index,
      tileName: tile.name,
      price: tile.price,
      contributions: [],
      createdAt: Date.now()
    };
    this.feedMessage(`${buyer.nickname} is seeking sponsors for ${tile.name}.`);
    return { success: true, sponsorship: this.summarySponsoredPurchase() };
  },

  contributeToSponsoredPurchase(socketId, payload = {}) {
    const sponsor = this.getPlayerBySocket(socketId);
    const ctx = sponsorshipApiContext(this);
    if (!ctx.sponsorship || !ctx.buyer || !ctx.tile || ctx.tile.ownerId !== null) {
      this.cancelSponsoredPurchase();
      return { success: false, error: 'That sponsorship is no longer available.' };
    }
    if (!livePlayer(sponsor)) return { success: false, error: 'Sponsorship is unavailable.' };
    if (sponsor.id === ctx.buyer.id) return { success: false, error: 'The buyer cannot sponsor their own purchase.' };
    if (ctx.sponsorship.contributions.some(entry => entry.sponsorId === sponsor.id)) {
      return { success: false, error: 'You already contributed to this sponsorship.' };
    }
    const amount = positiveWhole(payload.amount);
    if (!amount) return { success: false, error: 'Enter a whole-dollar contribution.' };
    const contributed = ctx.sponsorship.contributions.reduce((sum, entry) => sum + entry.amount, 0);
    const needed = Math.max(0, ctx.tile.price - ctx.buyer.cash - contributed);
    if (amount > needed) return { success: false, error: `The remaining sponsorship need is $${needed}.` };
    if (sponsor.cash < amount) return { success: false, error: 'You do not have enough available cash.' };
    sponsor.cash -= amount;
    ctx.sponsorship.contributions.push({ sponsorId: sponsor.id, sponsorName: sponsor.nickname, amount });
    this.feedMessage(`${sponsor.nickname} reserved $${amount} toward ${ctx.tile.name}.`);
    return { success: true, sponsorship: this.summarySponsoredPurchase() };
  },

  withdrawSponsoredPurchase(socketId) {
    const sponsor = this.getPlayerBySocket(socketId);
    const sponsorship = this.pendingSponsoredPurchase;
    if (!sponsor || !sponsorship) return { success: false, error: 'That sponsorship is no longer available.' };
    const index = sponsorship.contributions.findIndex(entry => entry.sponsorId === sponsor.id);
    if (index < 0) return { success: false, error: 'You have no contribution in this sponsorship.' };
    const [entry] = sponsorship.contributions.splice(index, 1);
    sponsor.cash += entry.amount;
    this.feedMessage(`${sponsor.nickname} withdrew their sponsorship.`);
    return { success: true, sponsorship: this.summarySponsoredPurchase() };
  },

  acceptSponsoredPurchase(socketId) {
    const buyer = this.getPlayerBySocket(socketId);
    const ctx = sponsorshipApiContext(this);
    if (!buyer || !ctx.sponsorship || ctx.sponsorship.buyerId !== buyer.id) {
      return { success: false, error: 'Only the sponsored buyer can accept this request.' };
    }
    if (!ctx.tile || ctx.tile.ownerId !== null || !this.pendingPurchaseOffer || this.pendingPurchaseOffer.playerId !== buyer.id) {
      this.cancelSponsoredPurchase();
      return { success: false, error: 'That property is no longer available.' };
    }
    const contributions = ctx.sponsorship.contributions.slice();
    if (!contributions.length) return { success: false, error: 'Wait for at least one sponsor.' };
    const missingSponsor = contributions.some(entry => !livePlayer(this.getPlayerById(entry.sponsorId)));
    if (missingSponsor) {
      this.cancelSponsoredPurchase();
      return { success: false, error: 'A sponsor is no longer available; the request was canceled.' };
    }
    const total = contributions.reduce((sum, entry) => sum + entry.amount, 0);
    if (buyer.cash + total < ctx.tile.price) return { success: false, error: 'The sponsorship is still short of the purchase price.' };
    buyer.cash += total;
    this.pendingSponsoredPurchase = null;
    this.acceptPurchaseOffer(buyer, ctx.tile);
    this.feedMessage(`${buyer.nickname} completed a sponsored purchase of ${ctx.tile.name}.`);
    return { success: true, purchased: true, contributionTotal: total };
  },

  declineSponsoredPurchase(socketId) {
    const buyer = this.getPlayerBySocket(socketId);
    if (!buyer || !this.pendingSponsoredPurchase || this.pendingSponsoredPurchase.buyerId !== buyer.id) {
      return { success: false, error: 'Only the sponsored buyer can cancel this request.' };
    }
    this.cancelSponsoredPurchase();
    this.feedMessage(`${buyer.nickname} canceled the sponsorship request.`);
    return { success: true, canceled: true };
  },

  cancelSponsoredPurchase() {
    const sponsorship = this.pendingSponsoredPurchase;
    if (!sponsorship) return false;
    sponsorship.contributions.forEach(entry => {
      const sponsor = this.getPlayerById(entry.sponsorId);
      if (sponsor) sponsor.cash += entry.amount;
    });
    this.pendingSponsoredPurchase = null;
    return true;
  },

  clearSponsoredPurchaseForPlayer(playerId) {
    const sponsorship = this.pendingSponsoredPurchase;
    if (!sponsorship) return false;
    if (sponsorship.buyerId === playerId) return this.cancelSponsoredPurchase();
    const index = sponsorship.contributions.findIndex(entry => entry.sponsorId === playerId);
    if (index < 0) return false;
    const [entry] = sponsorship.contributions.splice(index, 1);
    const sponsor = this.getPlayerById(playerId);
    if (sponsor) sponsor.cash += entry.amount;
    return true;
  },

  summarySponsoredPurchase() {
    const sponsorship = this.pendingSponsoredPurchase;
    if (!sponsorship) return null;
    const buyer = this.getPlayerById(sponsorship.buyerId);
    const tile = this.getTile(Number(sponsorship.tileIndex));
    if (!buyer || !tile) return null;
    const contributions = sponsorship.contributions.map(entry => ({
      sponsorId: entry.sponsorId,
      sponsorName: entry.sponsorName || this.getPlayerById(entry.sponsorId)?.nickname || 'PLAYER',
      amount: Math.max(0, Math.floor(Number(entry.amount) || 0))
    }));
    const total = contributions.reduce((sum, entry) => sum + entry.amount, 0);
    return {
      id: sponsorship.id,
      buyerId: buyer.id,
      buyerName: buyer.nickname,
      tileIndex: tile.index,
      tileName: tile.name,
      price: tile.price,
      buyerCash: Math.max(0, Math.floor(Number(buyer.cash) || 0)),
      totalContributed: total,
      amountNeeded: Math.max(0, tile.price - buyer.cash - total),
      contributions,
      createdAt: sponsorship.createdAt
    };
  }
};

export { sponsorshipApi };
