// Pending-counterpart resolution, debt-ladder candidates, and counteroffer construction, shared by deterministic
// and advisor-selected bots. Auction willingness is shared with the game API, so provider choices cannot
// bypass the server-enforced bid cap.
import {
  sponsorshipShortfall,
  sponsorshipContributionAmount,
  sponsorshipBuyerShouldCancel
} from './sponsorshipLogic.js';
import { playerFinanceEnabled } from './financeRules.js';
import { contractResponderId } from './contractLogic.js';
import { groupTiles, ownedCount } from './botAuctionPolicy.js';
import { vetoTrade, tradeSetChanges } from './botTradeValuation.js';
import {
  BORROW_MAX_PREMIUM_PERCENT,
  BORROW_MIN_ROUNDS,
  LEND_MAX_PRINCIPAL,
  LEND_MAX_ROUNDS,
  LEND_MIN_PREMIUM_PERCENT,
  borrowerAcceptsContract,
  contractReserve,
  lenderAcceptsCounter,
  tableObligationOpen
} from './botContractPolicy.js';

export { contractResponderId };
export { auctionWillingness } from './botAuctionPolicy.js';

function sponsorshipBuyerCounterpart(game, buyer, sponsorship, needed) {
  if (!buyer?.isBot) return null;
  // Let the buyer finish first once at least one sponsor has reserved cash.
  const coveredWithReserve = Boolean(sponsorship.contributions?.length) && needed <= 0;
  if (coveredWithReserve) return buyer;
  // A short buyer with nothing coming must kill its own dead request
  // instead of stranding the table (humans get a full round first).
  if (sponsorshipBuyerShouldCancel(game, buyer, sponsorship, needed)) return buyer;
  return null;
}

function eligibleSponsor(game, sponsorship, player) {
  if (!player.isBot) return false;
  if (player.id === sponsorship.buyerId) return false;
  if (player.bankrupt || player.disconnected) return false;
  const backed = (sponsorship.contributions || []).some(entry => entry.sponsorId === player.id);
  if (backed) return false;
  return sponsorshipContributionAmount(game, player) > 0;
}

// A sponsorship stays open for the buyer once covered, for the buyer to kill
// its own dead request, and for the next live bot sponsor.
function findSponsorshipCounterpart(game) {
  const sponsorship = game.pendingSponsoredPurchase;
  if (!sponsorship) return null;
  const buyer = game.getPlayerById(sponsorship.buyerId);
  const needed = sponsorshipShortfall(game, sponsorship, buyer?.cash);
  const buyerCounterpart = sponsorshipBuyerCounterpart(game, buyer, sponsorship, needed);
  if (buyerCounterpart) return buyerCounterpart;
  return game.players.find(player => eligibleSponsor(game, sponsorship, player)) || null;
}

function pendingOfferCounterpart(game) {
  if (game.pendingTrade) return game.getPlayerById(game.pendingTrade.toPlayerId) || null;
  if (game.pendingPlayerContract) return game.getPlayerById(contractResponderId(game.pendingPlayerContract)) || null;
  if (game.pendingPayment?.playerId) return game.getPlayerById(game.pendingPayment.playerId) || null;
  return null;
}

export function findPendingCounterpart(game) {
  return findSponsorshipCounterpart(game) || pendingOfferCounterpart(game);
}

// Decline an affordable deed to force a cheap auction win: only when the
// deed is not my completer and every live opponent is too broke to contest.
function activeRivals(game, bot) {
  return game.players.filter(player => player.id !== bot?.id && isLiveRival(player));
}

function isLiveRival(player) {
  if (player.bankrupt) return false;
  return !player.disconnected;
}

function rivalsAllBroke(game, bot, tile) {
  const rivals = activeRivals(game, bot);
  if (!rivals.length) return false;
  const price = Number(tile.price) || 0;
  return rivals.every(player => Number(player.cash || 0) < price);
}

// Declining only makes sense when an auction will actually follow; with auctions
// off or paused a declined deed simply stays unowned.
function auctionWillFollow(game) {
  if (game?.settings?.auction === false) return false;
  if (typeof game?.globalEventActive === 'function' && game.globalEventActive('bank-run')) return false;
  return !game?.activeEventEffects?.().auctionBlocked;
}

export function declineForCheapAuction(game, bot, tile) {
  if (!tile?.group || !Array.isArray(game?.players)) return false;
  if (!auctionWillFollow(game)) return false;
  const tiles = groupTiles(game, tile);
  if (!tiles) return false;
  const owned = ownedCount(tiles, bot);
  if (owned + 1 >= tiles.length) return false;
  return rivalsAllBroke(game, bot, tile);
}

function mortgageValueMultiplier(game) {
  const multiplier = Number(game.activeEventEffects?.().propertyValueMultiplier);
  if (Number.isFinite(multiplier) && multiplier > 0) return multiplier;
  return 1;
}

function mortgageCandidateEntry(game, tile, valueMultiplier) {
  const proceeds = Math.floor((Number(tile.price) || 0) / 2 * valueMultiplier);
  const rentLoss = typeof game.calculateRent === 'function'
    ? Math.max(0, Number(game.calculateRent(tile)) || 0)
    : Math.max(0, Number(tile.rent) || 0);
  return { tile, proceeds, rentLoss };
}

function mortgageCandidateOrder(a, b) {
  return a.rentLoss - b.rentLoss || b.proceeds - a.proceeds || a.tile.index - b.tile.index;
}

// A deed named by an open trade or contract is refused by the server
// (propertyOpenOfferRejection), so it can never be offered as a rescue.
function openOfferFree(game, tile) {
  if (typeof game.propertyOpenOfferRejection !== 'function') return true;
  return !game.propertyOpenOfferRejection(tile);
}

// Mortgage ladder for debt: bare deeds at 10% interest before houses at
// 50% loss. Sorted by income preserved (lowest rent first), then proceeds.
// Exported for unit tests; pure besides the game rules lookups.
export function debtMortgageCandidates(game, bot) {
  if (typeof game?.getTile !== 'function' || typeof game?.canMortgageTile !== 'function') return [];
  const valueMultiplier = mortgageValueMultiplier(game);
  return (bot?.properties || [])
    .map(index => game.getTile(index))
    .filter(tile => tile && game.canMortgageTile(bot, tile) && openOfferFree(game, tile))
    .map(tile => mortgageCandidateEntry(game, tile, valueMultiplier))
    .sort(mortgageCandidateOrder);
}

function saleProceeds(game, tile) {
  const cost = typeof game.getPropertyHouseCost === 'function' ? game.getPropertyHouseCost(tile) : 0;
  const multiplier = typeof game.buildingSaleMultiplier === 'function' ? game.buildingSaleMultiplier() : 0.5;
  return Math.max(0, Math.floor(cost * multiplier));
}

function saleRentLoss(game, tile) {
  const builtRent = typeof game.calculateRent === 'function' ? game.calculateRent(tile) : Number(tile.rent) || 0;
  return Math.max(0, builtRent - (Number(tile.rent) || 0));
}

function saleCandidateEntry(game, tile) {
  const proceeds = saleProceeds(game, tile);
  const rentLoss = saleRentLoss(game, tile);
  return { tile, proceeds, score: proceeds - rentLoss * 0.2 };
}

function saleCandidateOrder(a, b) {
  return b.score - a.score || b.proceeds - a.proceeds || a.tile.index - b.tile.index;
}

export function debtSellCandidates(game, bot) {
  if (typeof game.getTile !== 'function' || typeof game.canSellFromTile !== 'function') return [];
  return (bot.properties || [])
    .map(index => game.getTile(index))
    .filter(tile => tile && tile.houseCount > 0 && game.canSellFromTile(bot, tile) && openOfferFree(game, tile))
    .map(tile => saleCandidateEntry(game, tile))
    .sort(saleCandidateOrder);
}

const COUNTER_BLOCKING_STATES = Object.freeze([
  'auction', 'pendingPurchaseOffer', 'pendingSponsoredPurchase', 'pendingPlayerContract'
]);

// Countering opens a replacement offer, which the table-obligation gate forbids while an auction, purchase,
// sponsorship or contract is pending. A pending payment is not one of them: the engine settles a parked debt
// with the money and keeps debt-rescue deals legal (tradeApi.js). Countering into a blocked table restores the offer.
export function tradeCounterBlocked(game) {
  if (!game) return false;
  return COUNTER_BLOCKING_STATES.some(key => Boolean(game[key]));
}

function counterableTrade(game, bot) {
  const trade = game.pendingTrade;
  if (!trade) return null;
  if (trade.toPlayerId !== bot.id) return null;
  if (Number(trade.counterDepth) >= 2) return null;
  return trade;
}

function tradeCounterOfferBody(trade, bot, extraCash = null) {
  const givePropertyIndexes = (trade.requestPropertyIndexes || [])
    .map(Number)
    .filter(index => (bot.properties || []).includes(index));
  const requestPropertyIndexes = (trade.givePropertyIndexes || []).map(Number);
  const requestedCash = Math.max(0, Math.floor(Number(trade.giveCash) || 0));
  const premium = extraCash == null ? Math.max(10, Math.ceil(requestedCash * 0.1)) : Math.max(1, Math.floor(Number(extraCash)));
  return {
    givePropertyIndexes,
    requestPropertyIndexes,
    giveCash: Math.max(0, Math.floor(Number(trade.requestCash) || 0)),
    requestCash: requestedCash + premium,
    counterDepth: Math.min(2, (trade.counterDepth || 0) + 1)
  };
}

// The server refuses a counter when either side lacks the cash it names
// (tradeApi 'no longer has enough cash'), so a counter the proposer cannot pay
// is never built: it would only burn the bot's action and decline instead.
function counterIsAffordable(game, bot, trade, body) {
  const proposer = typeof game.getPlayerById === 'function' ? game.getPlayerById(trade.fromPlayerId) : null;
  const lacks = (seat, amount) => Number.isFinite(Number(seat?.cash)) && Number(seat.cash) < amount;
  return !lacks(proposer, body.requestCash) && !lacks(bot, body.giveCash);
}

// The counter is priced at face value plus a premium, so it must not be the
// way a bot gives up its own set or finishes the proposer's set cheaply: the
// deeds it would hand over are checked against both rules.
function counterKeepsBotSets(game, bot, trade, body) {
  const sets = tradeSetChanges(game, bot.id, body.givePropertyIndexes, body.requestPropertyIndexes);
  if (sets.breaks.length > sets.completes.length) return false;
  const asProposal = { fromPlayerId: bot.id, toPlayerId: trade.fromPlayerId, ...body };
  return !vetoTrade(game, asProposal, bot.id).vetoed;
}

// Why a counter could not be built, so the advisor can judge whether a higher premium is worth trying:
// 'no-trade' (nothing to counter) never is; 'unaffordable' means cash the proposer or bot lacks; 'set-veto' is a
// counter that breaks the bot's own set or underprices the proposer's completion, which a bigger premium can clear.
export function counterTradeOfferOutcome(game, bot, extraCash = null) {
  const trade = counterableTrade(game, bot);
  if (!trade) return { offer: null, reason: 'no-trade' };
  const body = tradeCounterOfferBody(trade, bot, extraCash);
  if (!counterIsAffordable(game, bot, trade, body)) return { offer: null, reason: 'unaffordable' };
  if (!counterKeepsBotSets(game, bot, trade, body)) return { offer: null, reason: 'set-veto' };
  return { offer: { toPlayerId: trade.fromPlayerId, ...body }, reason: null };
}

export function counterTradeOffer(game, bot, extraCash = null) {
  return counterTradeOfferOutcome(game, bot, extraCash).offer;
}

// A counter is a proposal the other seat can simply accept, so it carries only terms the bot would stand behind.
// As a borrower it asks for the terms its own gate signs (interest-free, long enough to schedule). As a lender it
// asks for a priced, short, bounded loan.
function counterContractPremium(contract, lenderResponding) {
  if (!lenderResponding) return BORROW_MAX_PREMIUM_PERCENT;
  const raised = Math.floor(Number(contract.premiumRate || 0) + 10);
  return Math.max(LEND_MIN_PREMIUM_PERCENT, Math.min(100, raised));
}

function counterContractDuration(contract, lenderResponding) {
  const rounds = Math.floor(Number(contract.durationRounds) || 3);
  if (lenderResponding) return Math.min(LEND_MAX_ROUNDS, Math.max(1, rounds - 1));
  return Math.min(20, Math.max(BORROW_MIN_ROUNDS, rounds + 1));
}

function counterContractAmount(game, bot, contract, lenderResponding) {
  const asked = Math.max(1, Math.floor(Number(contract.amount) || 1));
  if (!lenderResponding) return asked;
  const fundable = Math.floor(Number(bot.cash || 0) - contractReserve(game));
  return Math.min(asked, LEND_MAX_PRINCIPAL, fundable);
}

function counterContractTerms(contract, lenderResponding) {
  return {
    premiumRate: counterContractPremium(contract, lenderResponding),
    durationRounds: counterContractDuration(contract, lenderResponding)
  };
}

function contractCollateralFields(contract) {
  return {
    propertyIndex: contract.propertyIndex ?? null,
    collateralTileIndex: contract.collateralTileIndex ?? null,
    equityShare: contract.equityShare || 0,
    equityControl: contract.equityControl || 'passive',
    conversionShare: contract.conversionShare || 25,
    permanent: false
  };
}

function counterIsSound(game, bot, contract, counter, lenderResponding) {
  const totalDue = counter.amount + Math.ceil(counter.amount * counter.premiumRate / 100);
  const terms = { ...contract, ...counter, totalDue };
  if (lenderResponding) return lenderAcceptsCounter(game, bot, terms);
  const lender = typeof game.getPlayerById === 'function' ? game.getPlayerById(contract.fromPlayerId) : null;
  return borrowerAcceptsContract(terms, bot, { lender, game });
}

// A contract counter replaces the offer on the table, so the engine refuses it while another obligation is open
// (contractLogic.js: 'Resolve the current table obligation first.'). The answered contract and a pending payment
// are both allowed: a payment never blocks a deal.
export function contractCounterBlocked(game) {
  return tableObligationOpen(game);
}

export function counterContractOffer(game, bot) {
  if (!playerFinanceEnabled(game)) return null;
  const contract = game.pendingPlayerContract;
  if (!contract) return null;
  if (contractCounterBlocked(game)) return null;
  if (contract.kind !== 'loan' || contract.rulesVersion !== 2) return null;
  if (contractResponderId(contract) !== bot.id) return null;
  if (Number(contract.counterDepth) >= 2) return null;
  const lenderResponding = contract.fromPlayerId === bot.id;
  const counter = {
    contractId: contract.id,
    kind: contract.kind,
    amount: counterContractAmount(game, bot, contract, lenderResponding),
    ...counterContractTerms(contract, lenderResponding),
    ...contractCollateralFields(contract)
  };
  if (!(counter.amount > 0)) return null;
  return counterIsSound(game, bot, contract, counter, lenderResponding) ? counter : null;
}
