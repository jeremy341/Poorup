// Sponsorship domain policy: who may fund a pending sponsored purchase, when
// a request is dead, which seat owns the reaction, and the room action each
// seat takes. Pure decisions plus the injected room seam - botLogic.js owns the
// phase state machine and candidate plumbing around it. Every gate here is a
// verbatim move of the original inline chain (anti-farm rounds, one unreciprocated
// human gift, bots-only immediate cancel), so bot balance is unchanged.
// The one added gate is the loan-taint check in sponsorshipContributionAmount,
// which every funder, actor-seat, and counterpart decision reads through.
import { hasLoanBackedCash } from './loanLogic.js';

// A sponsor keeps this much cash in reserve before gifting.
export const SPONSORSHIP_RESERVE_CASH = 180;

export function sponsorshipContributed(sponsorship) {
  return (sponsorship.contributions || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

// Cash still missing after the buyer's own cash and every reserved contribution.
export function sponsorshipShortfall(game, sponsorship, cash) {
  const tile = typeof game.getTile === 'function' ? game.getTile(Number(sponsorship.tileIndex)) : null;
  return Math.max(0, Number(tile?.price || sponsorship.price || 0) - Number(cash || 0) - sponsorshipContributed(sponsorship));
}

function alreadyContributed(sponsorship, sponsorId) {
  return (sponsorship.contributions || []).some(entry => entry.sponsorId === sponsorId);
}

function sponsorshipRoundGated(game, bot) {
  return Number.isFinite(Number(game?.roundNumber)) && bot.lastSponsorRound === game.roundNumber;
}

// One gift per human buyer ever, unless that buyer has funded back.
function sponsorshipGiftGated(bot, buyer) {
  if (!buyer || buyer.isBot) return false;
  const giftedBefore = (bot.sponsorLedger || {})[buyer.id] > 0;
  const reciprocated = (bot.sponsoredBy || {})[buyer.id] > 0;
  return giftedBefore && !reciprocated;
}

function sponsorshipBuyerCash(buyer, sponsorship) {
  return buyer ? Number(buyer.cash || 0) : Number(sponsorship.buyerCash || 0);
}

export function sponsorshipContributionAmount(game, bot) {
  const sponsorship = game?.pendingSponsoredPurchase;
  if (!sponsorship || !bot || bot.id === sponsorship.buyerId) return 0;
  if (alreadyContributed(sponsorship, bot.id)) return 0;
  const buyer = typeof game.getPlayerById === 'function' ? game.getPlayerById(sponsorship.buyerId) : null;
  if (sponsorshipRoundGated(game, bot)) return 0;
  if (sponsorshipGiftGated(bot, buyer)) return 0;
  // The server rejects loan-backed sponsorship cash (sponsorshipApi.js), so a
  // loaned bot must never be sized as a funder: it would burn every turn on a
  // guaranteed rejection, never advance lastSponsorRound, and be counted as a
  // live funder that can keep a dead request alive forever. The casino,
  // contract, and market collectors apply this same guard.
  if (hasLoanBackedCash(bot)) return 0;
  const needed = sponsorshipShortfall(game, sponsorship, sponsorshipBuyerCash(buyer, sponsorship));
  const available = Math.max(0, Math.floor(Number(bot.cash || 0) - SPONSORSHIP_RESERVE_CASH));
  return Math.min(needed, available);
}

function sponsorshipAgedOneRound(game, sponsorship) {
  const createdRound = Number(sponsorship.createdRound);
  return Number.isFinite(createdRound) && Number(game?.roundNumber) > createdRound + 1;
}

// A sponsorship request is dead when the shortfall persists, a full round
// has passed (humans had their chance), and no live bot can fund it.
// Canceling refunds contributors and unblocks the purchase resolution.
export function sponsorshipDead(game, bot, sponsorship) {
  if (!sponsorship || sponsorship.buyerId !== bot?.id) return false;
  if (sponsorshipShortfall(game, sponsorship, bot.cash) <= 0) return false;
  if (!sponsorshipAgedOneRound(game, sponsorship)) return false;
  return sponsorshipFunders(game, sponsorship).length === 0;
}

function isLivePlayer(player) {
  if (!player) return false;
  if (player.bankrupt) return false;
  return !player.disconnected;
}

function livePlayers(game) {
  return Array.isArray(game?.players) ? game.players.filter(isLivePlayer) : [];
}

function sponsorshipFunderCandidate(game, sponsorship, player) {
  if (!player?.isBot) return false;
  if (!isLivePlayer(player)) return false;
  if (alreadyContributed(sponsorship, player.id)) return false;
  // A loan-tainted seat fails the amount gate above, so it can never be counted
  // as the live funder that keeps a request alive.
  return sponsorshipContributionAmount(game, player) > 0;
}

function sponsorshipFunders(game, sponsorship) {
  return (game.players || []).filter(player => sponsorshipFunderCandidate(game, sponsorship, player));
}

function botCanFundSponsorship(game, sponsorship, bot, live) {
  return live.some(player => player.id !== bot.id && sponsorshipFunderCandidate(game, sponsorship, player));
}

// Buyer-side cancel policy shared by dispatch, actor gating, and both
// executors: covered requests accept; dead or funderless ones are declined
// so the purchase resolves. Humans always get a full round to fund first;
// bots-only tables cancel immediately since waiting is pointless.
export function sponsorshipBuyerShouldCancel(game, bot, sponsorship, needed = null) {
  if (!sponsorship || sponsorship.buyerId !== bot?.id) return false;
  const shortfall = needed ?? sponsorshipShortfall(game, sponsorship, bot.cash);
  if (shortfall <= 0) return false;
  if (sponsorshipDead(game, bot, sponsorship)) return true;
  const live = livePlayers(game);
  if (live.some(player => !player.isBot)) return false;
  return !botCanFundSponsorship(game, sponsorship, bot, live);
}

function sponsorshipBuyerActor(game, bot, sponsorship) {
  const needed = sponsorshipShortfall(game, sponsorship, bot.cash);
  if (sponsorship.contributions?.length && needed <= 0) return true;
  return sponsorshipBuyerShouldCancel(game, bot, sponsorship, needed);
}

function actorEligible(bot) {
  if (bot.bankrupt) return false;
  return !bot.disconnected;
}

export function isSponsorshipActor(game, bot) {
  const sponsorship = game.pendingSponsoredPurchase;
  if (!sponsorship) return false;
  if (!bot) return false;
  if (!actorEligible(bot)) return false;
  if (sponsorship.buyerId === bot.id) return sponsorshipBuyerActor(game, bot, sponsorship);
  // Gated sponsors (round-capped, unreciprocated) must not claim the seat:
  // a zero-amount contributor would no-op forever without changing state.
  return !alreadyContributed(sponsorship, bot.id) && sponsorshipContributionAmount(game, bot) > 0;
}

function sponsorshipContributionsSorted(request) {
  return (request.contributions || []).map(entry => ({
    sponsorId: entry.sponsorId || null,
    amount: Math.max(0, Number(entry.amount) || 0)
  })).sort((left, right) => String(left.sponsorId).localeCompare(String(right.sponsorId)) || left.amount - right.amount);
}

// Key order is part of the identity string: request keys, then actor keys,
// then the live purchase offer, so a reshuffle would revalidate every turn.
function sponsorshipRequestIdentity(request, buyer, tile) {
  return {
    id: request.id ?? null,
    createdAt: request.createdAt ?? null,
    createdRound: request.createdRound ?? null,
    buyerId: request.buyerId,
    buyerCash: buyer ? Number(buyer.cash) || 0 : Number(request.buyerCash) || 0,
    buyerLive: buyer ? !buyer.bankrupt && !buyer.disconnected : false,
    tileIndex: request.tileIndex,
    price: Number(request.price) || 0,
    tilePrice: Number(tile?.price) || 0,
    contributions: sponsorshipContributionsSorted(request)
  };
}

function sponsorshipActorIdentity(game, bot, request) {
  return {
    roundNumber: Number(game.roundNumber) || 0,
    actorId: bot.id,
    actorCash: Number(bot.cash) || 0,
    actorLastSponsorRound: bot.lastSponsorRound ?? null,
    actorSponsorLedger: Number(bot.sponsorLedger?.[request.buyerId]) || 0,
    actorSponsoredBy: Number(bot.sponsoredBy?.[request.buyerId]) || 0,
    actorLive: !bot.bankrupt && !bot.disconnected
  };
}

function purchaseOfferIdentity(purchaseOffer) {
  return {
    purchaseOffer: purchaseOffer ? {
      playerId: purchaseOffer.playerId ?? null,
      tileIndex: purchaseOffer.tileIndex ?? null,
      price: Number(purchaseOffer.price) || 0
    } : null
  };
}

export function sponsorshipChoiceIdentity(game, bot) {
  const request = game?.pendingSponsoredPurchase;
  if (!request) return null;
  const buyer = typeof game.getPlayerById === 'function' ? game.getPlayerById(request.buyerId) : null;
  const tile = typeof game.getTile === 'function' ? game.getTile(Number(request.tileIndex)) : null;
  return JSON.stringify({
    ...sponsorshipRequestIdentity(request, buyer, tile),
    ...sponsorshipActorIdentity(game, bot, request),
    ...purchaseOfferIdentity(game.pendingPurchaseOffer)
  });
}

function recordSponsorGifts(bot, incoming) {
  bot.sponsoredBy = bot.sponsoredBy || {};
  for (const entry of incoming) {
    bot.sponsoredBy[entry.sponsorId] = (bot.sponsoredBy[entry.sponsorId] || 0) + Math.max(0, Number(entry.amount) || 0);
  }
}

function acceptSponsoredPurchase(room, bot, game) {
  // Record who funded me before the accept clears the request: future
  // gifts to them are reciprocated, not farmed.
  const incoming = (game.pendingSponsoredPurchase?.contributions || []).slice();
  const result = room.runBotAction(bot.id, actor => room.game.acceptSponsoredPurchase(actor));
  if (result?.success !== false) recordSponsorGifts(bot, incoming);
  return result;
}

function recordSponsorLedger(bot, game, sponsorship, amount) {
  bot.sponsorLedger = bot.sponsorLedger || {};
  bot.sponsorLedger[sponsorship.buyerId] = (bot.sponsorLedger[sponsorship.buyerId] || 0) + amount;
  if (Number.isFinite(Number(game?.roundNumber))) bot.lastSponsorRound = game.roundNumber;
}

function contributeAsSponsor(room, bot, game) {
  const sponsorship = game.pendingSponsoredPurchase;
  const amount = sponsorshipContributionAmount(game, bot);
  const result = room.runBotAction(bot.id, actor => room.game.contributeToSponsoredPurchase(actor, { amount }));
  if (result?.success !== false && sponsorship) recordSponsorLedger(bot, game, sponsorship, amount);
  return result;
}

function declineSponsorship(room, bot) {
  return room.runBotAction(bot.id, actor => room.game.declineSponsoredPurchase(actor));
}

export function runSponsorshipChoice(room, bot, game, candidate) {
  const sponsorship = game.pendingSponsoredPurchase;
  if (sponsorship?.buyerId === bot.id && sponsorshipBuyerShouldCancel(game, bot, sponsorship)) {
    return declineSponsorship(room, bot);
  }
  if (candidate.choiceId === 'accept') return acceptSponsoredPurchase(room, bot, game);
  if (candidate.choiceId === 'contribute') return contributeAsSponsor(room, bot, game);
  return { success: true, noEmit: true, botDecision: { reasonCode: 'sponsorship-wait' } };
}

function runBuyerSponsorshipPhase(room, bot, game, sponsorship) {
  if (sponsorshipBuyerShouldCancel(game, bot, sponsorship)) return declineSponsorship(room, bot);
  const needed = sponsorshipShortfall(game, sponsorship, bot.cash);
  if (sponsorship.contributions?.length && needed <= 0) return acceptSponsoredPurchase(room, bot, game);
  return { success: true, noEmit: true };
}

function runSponsorContributionPhase(room, bot, game, sponsorship) {
  const amount = sponsorshipContributionAmount(game, bot);
  if (!(amount > 0)) return { success: true, noEmit: true };
  const result = room.runBotAction(bot.id, actor => room.game.contributeToSponsoredPurchase(actor, { amount }));
  if (result?.success !== false && sponsorship) recordSponsorLedger(bot, game, sponsorship, amount);
  return result;
}

export function runSponsorshipPhase(room, bot, game) {
  const sponsorship = game.pendingSponsoredPurchase;
  if (sponsorship?.buyerId === bot.id) return runBuyerSponsorshipPhase(room, bot, game, sponsorship);
  return runSponsorContributionPhase(room, bot, game, sponsorship);
}
