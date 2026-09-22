// Sponsored purchases: a voluntary, escrowed contribution that can only
// settle into the currently open bank purchase offer. Contributions are
// reserved immediately, then atomically returned or folded into the buyer's
// purchase; no separate debt or equity relationship is created.
import crypto from 'crypto';
import { hasLoanBackedCash } from './loanLogic.js';

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

function sponsorshipRequestCheck(game, buyer, offer) {
  if (!buyer || !livePlayer(buyer)) return { error: 'Sponsorship is unavailable.' };
  if (buyer.id !== game.currentPlayerId || !offer || offer.playerId !== buyer.id) return { error: 'There is no open purchase to sponsor.' };
  if (game.pendingSponsoredPurchase) return { error: 'A sponsorship request is already open.' };
  const tile = game.getTile(Number(offer.tileIndex));
  if (!tile || tile.ownerId !== null) return { error: 'That property is no longer available.' };
  return { tile };
}

function contributionCheck(game, sponsor, ctx, payload) {
  if (!ctx.sponsorship || !ctx.buyer || !ctx.tile || ctx.tile.ownerId !== null) return { error: 'That sponsorship is no longer available.', stale: true };
  if (!livePlayer(sponsor)) return { error: 'Sponsorship is unavailable.' };
  if (hasLoanBackedCash(sponsor)) return { error: 'Loan-backed cash cannot fund sponsorships.' };
  if (game.auction || game.pendingTrade || game.pendingPlayerContract) {
    return { error: 'Resolve the table obligation before sponsoring.' };
  }
  if (sponsor.id === ctx.buyer.id) return { error: 'The buyer cannot sponsor their own purchase.' };
  if (ctx.sponsorship.contributions.some(entry => entry.sponsorId === sponsor.id)) return { error: 'You already contributed to this sponsorship.' };
  const amount = positiveWhole(payload.amount);
  if (!amount) return { error: 'Enter a whole-dollar contribution.' };
  const contributed = ctx.sponsorship.contributions.reduce((sum, entry) => sum + entry.amount, 0);
  const needed = Math.max(0, ctx.tile.price - ctx.buyer.cash - contributed);
  if (amount > needed) return { error: `The remaining sponsorship need is $${needed}.` };
  if (sponsor.cash < amount) return { error: 'You do not have enough available cash.' };
  return { amount };
}

function acceptanceCheck(game, buyer, ctx) {
  if (!buyer || !ctx.sponsorship || ctx.sponsorship.buyerId !== buyer.id) return { error: 'Only the sponsored buyer can accept this request.' };
  if (!ctx.tile || ctx.tile.ownerId !== null || !game.pendingPurchaseOffer || game.pendingPurchaseOffer.playerId !== buyer.id) return { error: 'That property is no longer available.', stale: true };
  const contributions = ctx.sponsorship.contributions.slice();
  if (!contributions.length) return { error: 'Wait for at least one sponsor.' };
  if (contributions.some(entry => !livePlayer(game.getPlayerById(entry.sponsorId)))) return { error: 'A sponsor is no longer available; the request was canceled.', stale: true };
  const total = contributions.reduce((sum, entry) => sum + entry.amount, 0);
  if (buyer.cash + total < ctx.tile.price) return { error: 'The sponsorship is still short of the purchase price.' };
  return { contributions, total };
}

const sponsorshipApi = {
  requestPurchaseSponsorship(socketId) {
    const buyer = this.getPlayerBySocket(socketId);
    const offer = this.pendingPurchaseOffer;
    const check = sponsorshipRequestCheck(this, buyer, offer);
    if (check.error) return { success: false, error: check.error };
    const { tile } = check;
    this.pendingSponsoredPurchase = {
      id: crypto.randomUUID(),
      buyerId: buyer.id,
      buyerName: buyer.nickname,
      tileIndex: tile.index,
      tileName: tile.name,
      price: tile.price,
      contributions: [],
      createdAt: Date.now(),
      createdRound: this.roundNumber,
    };
    this.feedMessage(`${buyer.nickname} is seeking sponsors for ${tile.name}.`);
    return { success: true, sponsorship: this.summarySponsoredPurchase() };
  },

  contributeToSponsoredPurchase(socketId, payload = {}) {
    const sponsor = this.getPlayerBySocket(socketId);
    const ctx = sponsorshipApiContext(this);
    const check = contributionCheck(this, sponsor, ctx, payload);
    if (check.stale) this.cancelSponsoredPurchase();
    if (check.error) return { success: false, error: check.error };
    const { amount } = check;
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
    const check = acceptanceCheck(this, buyer, ctx);
    if (check.stale) this.cancelSponsoredPurchase();
    if (check.error) return { success: false, error: check.error };
    const { total } = check;
    // Excess escrow returns to sponsors pro-rata: a buyer whose cash rose
    // after sponsoring must not pocket the overfund.
    const buyerCashBefore = Math.max(0, Math.floor(Number(buyer.cash) || 0));
    const needed = Math.max(0, Number(ctx.tile.price || 0) - buyerCashBefore);
    const excess = Math.max(0, total - needed);
    const contributions = (this.pendingSponsoredPurchase?.contributions || []).map(entry => ({ ...entry }));
    // Atomic settlement: snapshot everything the purchase can mutate, so a
    // mid-settlement throw restores the exact prior state (buyer cash,
    // escrow record, deed, portfolio) instead of crediting the buyer while
    // sponsors lose their refund path.
    const rollback = {
      cash: buyer.cash,
      pending: this.pendingSponsoredPurchase,
      purchaseOffer: this.pendingPurchaseOffer,
      ownerId: ctx.tile.ownerId,
      mortgaged: ctx.tile.mortgaged,
      houseCount: ctx.tile.houseCount,
      properties: [...(buyer.properties || [])],
      boughtDuringHousingBubble: buyer.boughtDuringHousingBubble,
      currentPlayerId: this.currentPlayerId,
      hasRolled: this.hasRolled,
      extraRollPending: this.extraRollPending,
      turnAllowsExtraRoll: this.turnAllowsExtraRoll,
      awaitingEndTurn: this.awaitingEndTurn,
      feed: Array.isArray(this.feed) ? [...this.feed] : this.feed,
    };
    buyer.cash += total - excess;
    this.pendingSponsoredPurchase = null;
    try {
      this.acceptPurchaseOffer(buyer, ctx.tile);
    } catch (error) {
      buyer.cash = rollback.cash;
      this.pendingSponsoredPurchase = rollback.pending;
      this.pendingPurchaseOffer = rollback.purchaseOffer;
      ctx.tile.ownerId = rollback.ownerId;
      ctx.tile.mortgaged = rollback.mortgaged;
      ctx.tile.houseCount = rollback.houseCount;
      buyer.properties = rollback.properties;
      buyer.boughtDuringHousingBubble = rollback.boughtDuringHousingBubble;
      this.currentPlayerId = rollback.currentPlayerId;
      this.hasRolled = rollback.hasRolled;
      this.extraRollPending = rollback.extraRollPending;
      this.turnAllowsExtraRoll = rollback.turnAllowsExtraRoll;
      this.awaitingEndTurn = rollback.awaitingEndTurn;
      if (Array.isArray(rollback.feed)) this.feed = rollback.feed;
      return { success: false, error: 'Sponsored purchase failed; contributions remain reserved.' };
    }
    const refunds = contributions.map((entry, index) => {
      const sponsor = this.getPlayerById(entry.sponsorId);
      const amount = Math.max(0, Number(entry.amount) || 0);
      const numerator = total > 0 ? amount * excess : 0;
      return { entry, sponsor, index, share: Math.floor(numerator / Math.max(1, total)), remainder: numerator % Math.max(1, total) };
    }).filter(refund => refund.sponsor && !refund.sponsor.bankrupt);
    let refunded = refunds.reduce((sum, refund) => sum + refund.share, 0);
    let remainder = Math.max(0, excess - refunded);
    refunds.sort((left, right) => right.remainder - left.remainder || left.index - right.index);
    for (const refund of refunds) {
      if (remainder <= 0) break;
      refund.share += 1;
      remainder -= 1;
    }
    refunds.forEach(({ sponsor, share }) => {
      if (share > 0) sponsor.cash = Math.max(0, Number(sponsor.cash) || 0) + share;
    });
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
