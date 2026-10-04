// Sponsored purchases: a voluntary, escrowed contribution that can only
// settle into the currently open bank purchase offer. Contributions are
// reserved immediately, then atomically returned or folded into the buyer's
// purchase; no separate debt or equity relationship is created.
import crypto from 'crypto';
import { normalizeRequestId } from './requestId.js';
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
  const buyerError = sponsorshipBuyerError(game, buyer);
  if (buyerError) return { error: buyerError };
  if (!offer || offer.playerId !== buyer.id) return { error: 'There is no open purchase to sponsor.' };
  if (game.pendingSponsoredPurchase) return { error: 'A sponsorship request is already open.' };
  const tile = game.getTile(Number(offer.tileIndex));
  const tileError = purchaseTileError(tile);
  if (tileError) return { error: tileError };
  return { tile };
}

function sponsorshipBuyerError(game, buyer) {
  if (!buyer || !livePlayer(buyer)) return 'Sponsorship is unavailable.';
  if (buyer.id !== game.currentPlayerId) return 'There is no open purchase to sponsor.';
  return '';
}

function purchaseTileError(tile) {
  if (!tile || tile.ownerId !== null) return 'That property is no longer available.';
  if (!Number.isInteger(tile.price) || tile.price < 1) return 'That property has an invalid purchase price.';
  return '';
}

function materializedEquityShare(tile) {
  return (tile.equityShares || []).reduce((sum, entry) => sum + Math.max(0, Number(entry?.share) || 0), 0);
}

function materializedContractIds(tile) {
  return new Set((tile.equityShares || []).map(entry => entry?.contractId).filter(Boolean));
}

function contractEquityShare(game, tile, materializedIds) {
  return (game.playerContracts || []).reduce((sum, contract) => {
    if (materializedIds.has(contract.id)) return sum;
    if (Number(contract.propertyIndex) !== Number(tile.index)) return sum;
    if (!isEquityContract(contract)) return sum;
    return sum + Math.max(0, Number(contract.equityShare || contract.conversionShare) || 0);
  }, 0);
}

function isEquityContract(contract) {
  return ['active', 'due', 'converted'].includes(contract.status) && ['equity', 'hybrid'].includes(contract.kind);
}

function pendingEquityShare(game, tile) {
  const pending = game.pendingPlayerContract;
  if (!pending || Number(pending.propertyIndex) !== Number(tile.index)) return 0;
  if (!['equity', 'hybrid'].includes(pending.kind)) return 0;
  return Math.max(0, Number(pending.equityShare || pending.conversionShare) || 0);
}

function equityShareTotal(game, tile) {
  const materializedIds = materializedContractIds(tile);
  return materializedEquityShare(tile)
    + contractEquityShare(game, tile, materializedIds)
    + pendingEquityShare(game, tile);
}

function normalizedEquityShare(game, tile, rawShare) {
  const sharePct = Number(rawShare);
  if (!isValidEquityShare(sharePct)) return null;
  if (equityShareTotal(game, tile) + sharePct > 100) return null;
  return sharePct;
}

function isValidEquityShare(sharePct) {
  if (!Number.isInteger(sharePct)) return false;
  return sharePct >= 5 && sharePct <= 100;
}

function contributionCheck(game, sponsor, ctx, payload) {
  const accessError = contributionAccessError(game, sponsor, ctx);
  if (accessError) return { error: accessError.error, stale: accessError.stale };
  const amount = positiveWhole(payload.amount);
  if (!amount) return { error: 'Enter a whole-dollar contribution.' };
  const contributed = ctx.sponsorship.contributions.reduce((sum, entry) => sum + entry.amount, 0);
  const needed = remainingSponsorshipNeed(ctx.tile.price, ctx.buyer.cash, contributed);
  const termsError = contributionTermsError(sponsor, amount, needed);
  if (termsError) return { error: termsError };
  return { amount };
}

function contributionAccessError(game, sponsor, ctx) {
  const contextError = contributionContextError(ctx);
  if (contextError) return contextError;
  if (!livePlayer(sponsor)) return { error: 'Sponsorship is unavailable.' };
  if (hasLoanBackedCash(sponsor)) return { error: 'Loan-backed cash cannot fund sponsorships.' };
  if (hasTableObligation(game)) return { error: 'Resolve the table obligation before sponsoring.' };
  if (sponsor.id === ctx.buyer.id) return { error: 'The buyer cannot sponsor their own purchase.' };
  if (equitySponsorLimitReached(ctx.sponsorship)) return { error: 'Equity purchases allow one investor.' };
  if (alreadyContributed(ctx.sponsorship, sponsor.id)) return { error: 'You already contributed to this sponsorship.' };
  return null;
}

function contributionContextError(ctx) {
  if (!ctx.sponsorship) return { error: 'That sponsorship is no longer available.', stale: true };
  if (!ctx.buyer) return { error: 'That sponsorship is no longer available.', stale: true };
  if (!ctx.tile || ctx.tile.ownerId !== null) {
    return { error: 'That sponsorship is no longer available.', stale: true };
  }
  return null;
}

function hasTableObligation(game) {
  return Boolean(game.auction || game.pendingTrade || game.pendingPlayerContract);
}

function equitySponsorLimitReached(sponsorship) {
  if (sponsorship.mode !== 'equity') return false;
  return sponsorship.contributions.length > 0;
}

function alreadyContributed(sponsorship, sponsorId) {
  return sponsorship.contributions.some(entry => entry.sponsorId === sponsorId);
}

function remainingSponsorshipNeed(price, buyerCash, contributed) {
  return Math.max(0, price - buyerCash - contributed);
}

function contributionTermsError(sponsor, amount, needed) {
  if (amount > needed) return `The remaining sponsorship need is $${needed}.`;
  if (sponsor.cash < amount) return 'You do not have enough available cash.';
  return '';
}

function acceptanceOfferError(game, buyer, ctx) {
  const identityError = acceptanceBuyerError(buyer, ctx.sponsorship);
  if (identityError) return identityError;
  if (!livePlayer(buyer)) return { error: 'The sponsored purchase is no longer available.', stale: true };
  const offerError = matchingPurchaseOfferError(game, buyer, ctx.tile);
  if (offerError) return offerError;
  if (invalidSponsorshipPrice(ctx.tile, ctx.sponsorship)) {
    return { error: 'That property has an invalid or changed purchase price.', stale: true };
  }
  return null;
}

function acceptanceBuyerError(buyer, sponsorship) {
  if (!buyer) return { error: 'Only the sponsored buyer can accept this request.' };
  if (!sponsorship || sponsorship.buyerId !== buyer.id) return { error: 'Only the sponsored buyer can accept this request.' };
  return null;
}

function matchingPurchaseOfferError(game, buyer, tile) {
  if (!tile) return { error: 'That property is no longer available.', stale: true };
  if (tile.ownerId !== null) return { error: 'That property is no longer available.', stale: true };
  const offer = game.pendingPurchaseOffer;
  if (!offer) return { error: 'That property is no longer available.', stale: true };
  if (offer.playerId !== buyer.id) return { error: 'That property is no longer available.', stale: true };
  if (Number(offer.tileIndex) !== Number(tile.index)) return { error: 'That property is no longer available.', stale: true };
  return null;
}

function invalidSponsorshipPrice(tile, sponsorship) {
  if (!Number.isInteger(tile.price)) return true;
  if (tile.price < 1) return true;
  return Number(sponsorship.price) !== Number(tile.price);
}

function availableContributionsError(game, contributions) {
  if (!contributions.length) return { error: 'Wait for at least one sponsor.' };
  const unavailableSponsor = contributions.some(entry => !livePlayer(game.getPlayerById(entry.sponsorId)));
  if (unavailableSponsor) return { error: 'A sponsor is no longer available; the request was canceled.', stale: true };
  return null;
}

function equityAcceptanceError(game, tile, sponsorship, contributions) {
  if (contributions.length !== 1) return { error: 'Wait for one investor.' };
  const investor = game.getPlayerById(contributions[0].sponsorId);
  if (!livePlayer(investor)) return { error: 'The investor is no longer available; the request was canceled.', stale: true };
  if (!normalizedEquityShare(game, tile, sponsorship.sharePct)) return { error: 'That property has no remaining equity to sell.' };
  return null;
}

function requestedSponsorshipTerms(game, tile, payload) {
  if (payload.mode != null && !['gift', 'equity'].includes(payload.mode)) {
    return { error: 'Choose a supported sponsorship mode.' };
  }
  const mode = payload.mode === 'equity' ? 'equity' : 'gift';
  if (mode !== 'equity') return { mode, sharePct: null };
  if (tile.type !== 'property') return { error: 'Equity investment is available for properties only.' };
  const sharePct = normalizedEquityShare(game, tile, payload.sharePct);
  if (sharePct == null) return { error: 'That property has no remaining equity to sell.' };
  return { mode, sharePct };
}

function newSponsorshipRecord({ buyer, tile, terms, payload, roundNumber }) {
  return {
    id: crypto.randomUUID(),
    buyerId: buyer.id,
    buyerName: buyer.nickname,
    tileIndex: tile.index,
    tileName: tile.name,
    price: tile.price,
    mode: terms.mode,
    sharePct: terms.sharePct,
    requestId: normalizeRequestId(payload.requestId),
    contributions: [],
    createdAt: Date.now(),
    createdRound: roundNumber,
  };
}

function acceptanceCheck(game, buyer, ctx) {
  const offerError = acceptanceOfferError(game, buyer, ctx);
  if (offerError) return offerError;
  const contributions = ctx.sponsorship.contributions.slice();
  const contributionError = availableContributionsError(game, contributions);
  if (contributionError) return contributionError;
  const total = contributions.reduce((sum, entry) => sum + entry.amount, 0);
  if (buyer.cash + total < ctx.tile.price) return { error: 'The sponsorship is still short of the purchase price.' };
  if (ctx.sponsorship.mode === 'equity') {
    const equityError = equityAcceptanceError(game, ctx.tile, ctx.sponsorship, contributions);
    if (equityError) return equityError;
  }
  return { contributions, total };
}

function sponsoredPurchaseReplayKey(buyer, requestId) {
  if (!requestId || !buyer) return null;
  return `${buyer.id}:sponsored-purchase:${requestId}`;
}

function cachedSponsoredPurchase(game, replayKey) {
  if (!replayKey) return null;
  return game.contractTransactions?.get(replayKey) || null;
}

function prepareSponsoredAcceptance(game, buyer) {
  const ctx = sponsorshipApiContext(game);
  const check = acceptanceCheck(game, buyer, ctx);
  if (check.stale) game.cancelSponsoredPurchase();
  if (check.error) return { error: check.error };
  return { ctx, check };
}

function settlementTotals(buyer, tile, total) {
  const buyerCashBefore = Math.max(0, Math.floor(Number(buyer.cash) || 0));
  const needed = Math.max(0, Number(tile.price || 0) - buyerCashBefore);
  const excess = Math.max(0, total - needed);
  return { excess };
}

function copyContributions(game) {
  return (game.pendingSponsoredPurchase?.contributions || []).map(entry => ({ ...entry }));
}

function captureSponsoredRollback(game, buyer, tile, contributions) {
  return {
    cash: buyer.cash,
    pending: game.pendingSponsoredPurchase,
    purchaseOffer: game.pendingPurchaseOffer,
    ownerId: tile.ownerId,
    mortgaged: tile.mortgaged,
    houseCount: tile.houseCount,
    properties: [...(buyer.properties || [])],
    equityShares: [...(tile.equityShares || [])],
    playerContracts: [...(game.playerContracts || [])],
    buyerContractIds: [...(buyer.playerContractIds || [])],
    investorContractIds: contributions.map(entry => [...(game.getPlayerById(entry.sponsorId)?.playerContractIds || [])]),
  };
}

function restoreSponsoredRollback({ game, buyer, tile, contributions, rollback }) {
  buyer.cash = rollback.cash;
  game.pendingSponsoredPurchase = rollback.pending;
  game.pendingPurchaseOffer = rollback.purchaseOffer;
  tile.ownerId = rollback.ownerId;
  tile.mortgaged = rollback.mortgaged;
  tile.houseCount = rollback.houseCount;
  buyer.properties = rollback.properties;
  tile.equityShares = rollback.equityShares;
  game.playerContracts = rollback.playerContracts;
  buyer.playerContractIds = rollback.buyerContractIds;
  contributions.forEach((entry, index) => restoreInvestorContractIds({ game, contribution: entry, contractIds: rollback.investorContractIds[index] }));
}

function restoreInvestorContractIds({ game, contribution, contractIds }) {
  const investor = game.getPlayerById(contribution.sponsorId);
  if (investor) investor.playerContractIds = contractIds;
}

function createSponsoredEquityContract({ game, buyer, tile, rollback, contributions }) {
  const investor = game.getPlayerById(contributions[0].sponsorId);
  const sharePct = normalizedEquityShare(game, tile, rollback.pending.sharePct);
  if (!investor || !sharePct) throw new Error('Equity terms changed before settlement.');
  const contract = {
    id: crypto.randomUUID(), kind: 'equity', fromPlayerId: investor.id, toPlayerId: buyer.id,
    amount: contributions[0].amount, propertyIndex: tile.index, equityShare: sharePct,
    equityControl: 'passive', permanent: true, expiresRound: null,
    durationRounds: 0, createdRound: game.roundNumber, acceptedRound: game.roundNumber, status: 'active'
  };
  game.playerContracts.push(contract);
  investor.playerContractIds.push(contract.id);
  buyer.playerContractIds.push(contract.id);
  tile.equityShares = [...(tile.equityShares || []), {
    holderId: investor.id, share: sharePct, contractId: contract.id, control: 'passive'
  }];
}

function settleSponsoredPurchase({ game, buyer, ctx, contributions, rollback }) {
  game.acceptPurchaseOffer(buyer, ctx.tile);
  const pendingIsEquity = game.pendingSponsoredPurchase?.mode === 'equity';
  const savedIsEquity = rollback.pending?.mode === 'equity';
  if (pendingIsEquity || savedIsEquity) createSponsoredEquityContract({ game, buyer, tile: ctx.tile, rollback, contributions });
}

function settleSponsoredPurchaseAtomically({ game, buyer, ctx, contributions, rollback }) {
  try {
    settleSponsoredPurchase({ game, buyer, ctx, contributions, rollback });
    return true;
  } catch (error) {
    restoreSponsoredRollback({ game, buyer, tile: ctx.tile, contributions, rollback });
    return false;
  }
}

// Pro-rata refunds of the escrow excess on a largest-remainder basis: every
// sponsor takes the floor of their exact share and the leftover dollars go to
// the largest fractional parts, so the sponsors absorb the rounding instead of
// the buyer. Integer arithmetic throughout, and the shares always sum to
// `excess` - the escrow can neither mint nor destroy a dollar.
function sponsorRefundShares(contributions, total, excess) {
  if (!(total > 0) || !(excess > 0)) return contributions.map(() => 0);
  const shares = contributions.map(entry => Math.floor((Number(entry.amount) || 0) * excess / total));
  const remainder = excess - shares.reduce((sum, share) => sum + share, 0);
  if (!(remainder > 0)) return shares;
  const ranked = contributions
    .map((entry, index) => ({ index, fraction: (Number(entry.amount) || 0) * excess % total }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let rank = 0; rank < remainder; rank += 1) shares[ranked[rank].index] += 1;
  return shares;
}

function refundSponsoredExcess({ game, buyer, contributions, total, excess }) {
  const shares = sponsorRefundShares(contributions, total, excess);
  const refunded = contributions.reduce((sum, entry, index) => sum + refundSponsorContribution({ game, entry, share: shares[index] }), 0);
  // A share the escrow cannot deliver (departed or bankrupt sponsor) falls to
  // the buyer, exactly as before; a fully payable escrow refunds every dollar
  // and leaves the buyer nothing.
  buyer.cash += Math.max(0, excess - refunded);
}

function refundSponsorContribution({ game, entry, share }) {
  if (share <= 0) return 0;
  const sponsor = game.getPlayerById(entry.sponsorId);
  if (!sponsor) return 0;
  if (sponsor.bankrupt) return 0;
  sponsor.cash = Math.max(0, Number(sponsor.cash) || 0) + share;
  return share;
}

function rememberSponsoredResult(game, replayKey, result) {
  if (!replayKey || !(game.contractTransactions instanceof Map)) return;
  game.contractTransactions.set(replayKey, result);
  while (game.contractTransactions.size > 1_000) {
    game.contractTransactions.delete(game.contractTransactions.keys().next().value);
  }
}

const sponsorshipApi = {
  requestPurchaseSponsorship(socketId, payload = {}) {
    const buyer = this.getPlayerBySocket(socketId);
    const offer = this.pendingPurchaseOffer;
    const check = sponsorshipRequestCheck(this, buyer, offer);
    if (check.error) return { success: false, error: check.error };
    const { tile } = check;
    const terms = requestedSponsorshipTerms(this, tile, payload);
    if (terms.error) return { success: false, error: terms.error };
    this.pendingSponsoredPurchase = newSponsorshipRecord({ buyer, tile, terms, payload, roundNumber: this.roundNumber });
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
    const requestId = normalizeRequestId(payload.requestId);
    const replayKey = sponsoredPurchaseReplayKey(buyer, requestId);
    const cached = cachedSponsoredPurchase(this, replayKey);
    if (cached) return cached;
    const setup = prepareSponsoredAcceptance(this, buyer);
    if (setup.error) return { success: false, error: setup.error };
    const { ctx, check } = setup;
    const { total } = check;
    const { excess } = settlementTotals(buyer, ctx.tile, total);
    const contributions = copyContributions(this);
    const rollback = captureSponsoredRollback(this, buyer, ctx.tile, check.contributions);
    buyer.cash += total - excess;
    this.pendingSponsoredPurchase = null;
    const settled = settleSponsoredPurchaseAtomically({ game: this, buyer, ctx, contributions: check.contributions, rollback });
    if (!settled) {
      return { success: false, error: 'Sponsored purchase failed; contributions remain reserved.' };
    }
    refundSponsoredExcess({ game: this, buyer, contributions, total, excess });
    this.feedMessage(`${buyer.nickname} completed a sponsored purchase of ${ctx.tile.name}.`);
    const result = { success: true, purchased: true, contributionTotal: total };
    rememberSponsoredResult(this, replayKey, result);
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
    const ctx = sponsorshipApiContext(this);
    if (!ctx.sponsorship) return null;
    if (!ctx.buyer) return null;
    if (!ctx.tile) return null;
    return sponsorshipSummary(this, ctx);
  },
};

function sponsorshipSummary(game, ctx) {
  const { sponsorship, buyer, tile } = ctx;
  const contributions = sponsorship.contributions.map(entry => ({
    sponsorId: entry.sponsorId,
    sponsorName: sponsorNameFor(game, entry),
    amount: Math.max(0, Math.floor(Number(entry.amount) || 0))
  }));
  const total = contributions.reduce((sum, entry) => sum + entry.amount, 0);
  return {
    id: sponsorship.id,
    mode: sponsorship.mode || 'gift',
    sharePct: sponsorshipSharePct(sponsorship),
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

function sponsorNameFor(game, entry) {
  if (entry.sponsorName) return entry.sponsorName;
  const sponsor = game.getPlayerById(entry.sponsorId);
  if (sponsor?.nickname) return sponsor.nickname;
  return 'PLAYER';
}

function sponsorshipSharePct(sponsorship) {
  if (sponsorship.mode !== 'equity') return null;
  return sponsorship.sharePct;
}

export { sponsorshipApi };
