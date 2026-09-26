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
  if (!Number.isInteger(tile.price) || tile.price < 1) return { error: 'That property has an invalid purchase price.' };
  return { tile };
}

function equityShareTotal(game, tile) {
  const materializedIds = new Set((tile.equityShares || []).map(entry => entry?.contractId).filter(Boolean));
  const materialized = (tile.equityShares || []).reduce((sum, entry) => sum + Math.max(0, Number(entry?.share) || 0), 0);
  const contracts = (game.playerContracts || []).reduce((sum, contract) => {
    if (materializedIds.has(contract.id) || Number(contract.propertyIndex) !== Number(tile.index)) return sum;
    if (!['active', 'due', 'converted'].includes(contract.status) || !['equity', 'hybrid'].includes(contract.kind)) return sum;
    return sum + Math.max(0, Number(contract.equityShare || contract.conversionShare) || 0);
  }, 0);
  const pending = game.pendingPlayerContract
    && Number(game.pendingPlayerContract.propertyIndex) === Number(tile.index)
    && ['equity', 'hybrid'].includes(game.pendingPlayerContract.kind)
    ? Math.max(0, Number(game.pendingPlayerContract.equityShare || game.pendingPlayerContract.conversionShare) || 0)
    : 0;
  return materialized + contracts + pending;
}

function normalizedEquityShare(game, tile, rawShare) {
  const sharePct = Number(rawShare);
  if (!Number.isInteger(sharePct) || sharePct < 5 || sharePct > 100) return null;
  if (equityShareTotal(game, tile) + sharePct > 100) return null;
  return sharePct;
}

function contributionCheck(game, sponsor, ctx, payload) {
  if (!ctx.sponsorship || !ctx.buyer || !ctx.tile || ctx.tile.ownerId !== null) return { error: 'That sponsorship is no longer available.', stale: true };
  if (!livePlayer(sponsor)) return { error: 'Sponsorship is unavailable.' };
  if (hasLoanBackedCash(sponsor)) return { error: 'Loan-backed cash cannot fund sponsorships.' };
  if (game.auction || game.pendingTrade || game.pendingPlayerContract) {
    return { error: 'Resolve the table obligation before sponsoring.' };
  }
  if (sponsor.id === ctx.buyer.id) return { error: 'The buyer cannot sponsor their own purchase.' };
  if (ctx.sponsorship.mode === 'equity' && ctx.sponsorship.contributions.length) return { error: 'Equity purchases allow one investor.' };
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
  if (!livePlayer(buyer)) return { error: 'The sponsored purchase is no longer available.', stale: true };
  if (!ctx.tile || ctx.tile.ownerId !== null || !game.pendingPurchaseOffer || game.pendingPurchaseOffer.playerId !== buyer.id
      || Number(game.pendingPurchaseOffer.tileIndex) !== Number(ctx.tile.index)) return { error: 'That property is no longer available.', stale: true };
  if (!Number.isInteger(ctx.tile.price) || ctx.tile.price < 1 || Number(ctx.sponsorship.price) !== Number(ctx.tile.price)) {
    return { error: 'That property has an invalid or changed purchase price.', stale: true };
  }
  const contributions = ctx.sponsorship.contributions.slice();
  if (!contributions.length) return { error: 'Wait for at least one sponsor.' };
  if (contributions.some(entry => !livePlayer(game.getPlayerById(entry.sponsorId)))) return { error: 'A sponsor is no longer available; the request was canceled.', stale: true };
  const total = contributions.reduce((sum, entry) => sum + entry.amount, 0);
  if (buyer.cash + total < ctx.tile.price) return { error: 'The sponsorship is still short of the purchase price.' };
  if (ctx.sponsorship.mode === 'equity') {
    if (contributions.length !== 1) return { error: 'Wait for one investor.' };
    const investor = game.getPlayerById(contributions[0].sponsorId);
    if (!livePlayer(investor)) return { error: 'The investor is no longer available; the request was canceled.', stale: true };
    if (!normalizedEquityShare(game, ctx.tile, ctx.sponsorship.sharePct)) return { error: 'That property has no remaining equity to sell.' };
  }
  return { contributions, total };
}

const sponsorshipApi = {
  requestPurchaseSponsorship(socketId, payload = {}) {
    const buyer = this.getPlayerBySocket(socketId);
    const offer = this.pendingPurchaseOffer;
    const check = sponsorshipRequestCheck(this, buyer, offer);
    if (check.error) return { success: false, error: check.error };
    const { tile } = check;
    if (payload.mode != null && !['gift', 'equity'].includes(payload.mode)) {
      return { success: false, error: 'Choose a supported sponsorship mode.' };
    }
    const mode = payload.mode === 'equity' ? 'equity' : 'gift';
    if (mode === 'equity' && tile.type !== 'property') return { success: false, error: 'Equity investment is available for properties only.' };
    const sharePct = mode === 'equity' ? normalizedEquityShare(this, tile, payload.sharePct) : null;
    if (mode === 'equity' && sharePct == null) return { success: false, error: 'That property has no remaining equity to sell.' };
    this.pendingSponsoredPurchase = {
      id: crypto.randomUUID(),
      buyerId: buyer.id,
      buyerName: buyer.nickname,
      tileIndex: tile.index,
      tileName: tile.name,
      price: tile.price,
      mode,
      sharePct,
      requestId: String(payload.requestId || '').trim().slice(0, 100),
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

  acceptSponsoredPurchase(socketId, payload = {}) {
    const buyer = this.getPlayerBySocket(socketId);
    const requestId = String(payload.requestId || '').trim().slice(0, 100);
    const replayKey = requestId && buyer ? `${buyer.id}:sponsored-purchase:${requestId}` : null;
    const cached = replayKey ? this.contractTransactions?.get(replayKey) : null;
    if (cached) return cached;
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
      equityShares: [...(ctx.tile.equityShares || [])],
      playerContracts: [...(this.playerContracts || [])],
      buyerContractIds: [...(buyer.playerContractIds || [])],
      investorContractIds: check.contributions.map(entry => [...(this.getPlayerById(entry.sponsorId)?.playerContractIds || [])]),
    };
    buyer.cash += total - excess;
    this.pendingSponsoredPurchase = null;
    try {
      this.acceptPurchaseOffer(buyer, ctx.tile);
      if (this.pendingSponsoredPurchase?.mode === 'equity' || rollback.pending?.mode === 'equity') {
        const investment = check.contributions[0];
        const investor = this.getPlayerById(investment.sponsorId);
        const sharePct = normalizedEquityShare(this, ctx.tile, rollback.pending.sharePct);
        if (!investor || !sharePct) throw new Error('Equity terms changed before settlement.');
        const contract = {
          id: crypto.randomUUID(), kind: 'equity', fromPlayerId: investor.id, toPlayerId: buyer.id,
          amount: investment.amount, propertyIndex: ctx.tile.index, equityShare: sharePct,
          equityControl: 'passive', permanent: true, expiresRound: null,
          durationRounds: 0, createdRound: this.roundNumber, acceptedRound: this.roundNumber, status: 'active'
        };
        this.playerContracts.push(contract);
        investor.playerContractIds.push(contract.id);
        buyer.playerContractIds.push(contract.id);
        ctx.tile.equityShares = [...(ctx.tile.equityShares || []), {
          holderId: investor.id, share: sharePct, contractId: contract.id, control: 'passive'
        }];
      }
    } catch (error) {
      buyer.cash = rollback.cash;
      this.pendingSponsoredPurchase = rollback.pending;
      this.pendingPurchaseOffer = rollback.purchaseOffer;
      ctx.tile.ownerId = rollback.ownerId;
      ctx.tile.mortgaged = rollback.mortgaged;
      ctx.tile.houseCount = rollback.houseCount;
      buyer.properties = rollback.properties;
      ctx.tile.equityShares = rollback.equityShares;
      this.playerContracts = rollback.playerContracts;
      buyer.playerContractIds = rollback.buyerContractIds;
      check.contributions.forEach((entry, index) => {
        const investor = this.getPlayerById(entry.sponsorId);
        if (investor) investor.playerContractIds = rollback.investorContractIds[index];
      });
      return { success: false, error: 'Sponsored purchase failed; contributions remain reserved.' };
    }
    let refunded = 0;
    for (const entry of contributions) {
      const share = total > 0 ? Math.floor(Number(entry.amount || 0) * excess / total) : 0;
      const sponsor = this.getPlayerById(entry.sponsorId);
      if (share > 0 && sponsor && !sponsor.bankrupt) {
        sponsor.cash = Math.max(0, Number(sponsor.cash) || 0) + share;
        refunded += share;
      }
    }
    buyer.cash += Math.max(0, excess - refunded);
    this.feedMessage(`${buyer.nickname} completed a sponsored purchase of ${ctx.tile.name}.`);
    const result = { success: true, purchased: true, contributionTotal: total };
    if (replayKey && this.contractTransactions instanceof Map) {
      this.contractTransactions.set(replayKey, result);
      while (this.contractTransactions.size > 1_000) this.contractTransactions.delete(this.contractTransactions.keys().next().value);
    }
    return result;
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
      mode: sponsorship.mode || 'gift',
      sharePct: sponsorship.mode === 'equity' ? sponsorship.sharePct : null,
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
