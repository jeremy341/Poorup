import { playerFinanceEnabled } from './financeRules.js';
// Contract terms a bot will sign (as borrower or equity seller) or lend on (as lender). One module keeps the
// borrower gate, lender gate, AI candidate list, counter builder and proposal templates reading the same numbers.
// Gates keep lending bounded and protect construction plans. Accepted legacy debts still repay normally; new agreements need the Advanced finance module, current rule metadata and supported terms.
import { deedValue, ownedInGroup, MONOPOLY_PREMIUM_NUM, MONOPOLY_PREMIUM_DEN } from './botTradeValuation.js';

// A borrower must be able to clear what it owes from the cash it holds.
export const CONTRACT_REPAY_RATIO = 0.8;

// As a borrower a bot has no use for expensive money: it signs only interest-free
// loans, so nobody can earn interest by lending to a bot, and it wants enough
// rounds to schedule the repayment.
export const BORROW_MAX_PREMIUM_PERCENT = 0;
export const BORROW_MIN_ROUNDS = 3;
// Pledged deeds may be worth at most this multiple of the money received.
export const COLLATERAL_MAX_COVER = 1.5;

// As a lender a bot keeps its own proposals' shape: a priced, short, bounded loan.
export const LEND_MIN_PREMIUM_PERCENT = 20;
export const LEND_MAX_ROUNDS = 5;
export const LEND_MAX_PRINCIPAL = 300;

// Cash a lending bot keeps back after funding a contract.
export function contractReserve(game) {
  return Math.max(180, Number(game?.settings?.startingCash || 1500) * 0.2);
}

// The table obligations the engine refuses to work around: an open auction, purchase offer, sponsored purchase or
// another trade (contractLogic.js TABLE_OBLIGATION_FIELDS, minus the contract being answered). A pending payment is not one of them:
// the engine settles a parked debt with the money. One predicate shared by the proposal and counter builders, so a bot never offers a refused deal.
export const TABLE_OBLIGATION_FIELDS = Object.freeze([
  'auction', 'pendingPurchaseOffer', 'pendingSponsoredPurchase', 'pendingTrade'
]);

export function tableObligationOpen(game) {
  if (!game) return false;
  return TABLE_OBLIGATION_FIELDS.some(field => Boolean(game[field]));
}

// The cash a seat may actually spend: the leading bid of an open auction is
// reserved, so it is not money to promise (auctionApi.spendableCash).
function spendableOf(game, player) {
  if (!player) return 0;
  if (typeof game?.spendableCash === 'function') return Number(game.spendableCash(player)) || 0;
  return Number(player.cash) || 0;
}

// Loan-backed cash may not fund a contract (contractLogic.js).
function loanBackedCash(game, player) {
  if (!player) return false;
  if (typeof game?.hasLoanBackedCash === 'function') return Boolean(game.hasLoanBackedCash(player));
  return false;
}

// A dead seat signs nothing and receives nothing (contractLogic.js).
function seatCanReceive(player) {
  if (!player) return false;
  if (player.bankrupt) return false;
  return !player.disconnected;
}

// The engine activates a contract only when the lender can still fund it:
// alive, holding the money, not lending it twice, and not having it reserved
// by an open auction (contractLogic.js acceptContract).
function lenderCanFund(game, lender, amount) {
  if (!seatCanReceive(lender)) return false;
  if (Number(lender.cash || 0) < amount) return false;
  if (loanBackedCash(game, lender)) return false;
  return spendableOf(game, lender) >= amount;
}

function amountOf(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function tileAt(game, index) {
  return typeof game?.getTile === 'function' ? game.getTile(Number(index)) : null;
}

function pledgedTiles(game, offer) {
  const indices = Array.isArray(offer?.collateralTileIndices) && offer.collateralTileIndices.length
    ? offer.collateralTileIndices
    : offer?.collateralTileIndex != null ? [offer.collateralTileIndex] : [];
  return indices.map(index => tileAt(game, index)).filter(Boolean);
}

// A deed the bot already completes, or is one short of completing, is never
// pledged or sold into equity: losing it breaks the set it is building.
function endangersSet(game, bot, tile) {
  if (!tile?.group) return false;
  const { owned, total } = ownedInGroup(game, bot.id, tile.group);
  return total > 1 && owned >= total - 1;
}

// Equity value gate: never pledge rent equity below 2x traffic-adjusted deed
// value, pro-rated by share.
export function equityMinimumPrice(game, offer, tile) {
  const share = Math.max(5, Math.min(100, Math.floor(Number(offer?.equityShare) || 5)));
  return Math.ceil(share / 100 * deedValue(game, tile) * MONOPOLY_PREMIUM_NUM / MONOPOLY_PREMIUM_DEN);
}

function premiumPercent(offer, principal, due) {
  if (offer.premiumRate != null && Number.isFinite(Number(offer.premiumRate))) return Number(offer.premiumRate);
  return principal > 0 ? Math.max(0, (due - principal) / principal * 100) : 0;
}

// The repayment must come from cash the bot can actually spend (an open
// auction reserves the leading bid), at no premium, over enough rounds to schedule.
function loanPricingAcceptable(offer, bot, game, principal, due) {
  if (due > spendableOf(game, bot) * CONTRACT_REPAY_RATIO) return false;
  if (premiumPercent(offer, principal, due) > BORROW_MAX_PREMIUM_PERCENT) return false;
  return amountOf(offer.durationRounds, BORROW_MIN_ROUNDS) >= BORROW_MIN_ROUNDS;
}

// The lender must still be able to fund the contract when the engine
// activates it: alive, holding the money, not lending it twice, and not
// having it reserved by an open auction. The pledged deeds must not break the
// borrower's own set, and must not cover more than the money received.
function loanCollateralAcceptable(game, offer, bot, lender, principal) {
  if (!lenderCanFund(game, lender, principal)) return false;
  const pledged = pledgedTiles(game, offer);
  if (pledged.some(tile => endangersSet(game, bot, tile))) return false;
  const cover = pledged.reduce((sum, tile) => sum + deedValue(game, tile), 0);
  return cover <= principal * COLLATERAL_MAX_COVER;
}

function loanTermsAcceptable(offer, bot, { lender, game }) {
  if (!lender || lender.bankrupt || lender.disconnected) return false;
  if (!seatCanReceive(bot)) return false;
  const principal = amountOf(offer.amount);
  const due = amountOf(offer.totalDue, principal);
  if (!(principal > 0)) return false;
  if (!loanPricingAcceptable(offer, bot, game, principal, due)) return false;
  if (!game) return true;
  return loanCollateralAcceptable(game, offer, bot, lender, principal);
}

// New rent shares are finite, passive rights to rent. The owner can build
// throughout the term; a completed set alone does not make the right unsafe.
export function equityTermsAcceptable(game, offer, bot) {
  if (!seatCanReceive(bot)) return false;
  if (offer.permanent === true || offer.equityControl !== 'passive') return false;
  if (!Number.isInteger(offer.durationRounds) || offer.durationRounds < 1 || offer.durationRounds > 20) return false;
  const tile = tileAt(game, offer.propertyIndex);
  if (!tile) return false;
  return amountOf(offer.amount) >= equityMinimumPrice(game, offer, tile);
}

// The bot is the recipient of `offer` (borrower, or the owner selling equity). Equity-transfer offers ask a bot to buy an
// existing slice, which no bot code prices (the coverage table lists it as human-only), and unknown kinds are declined.
export function borrowerAcceptsContract(offer, bot, { lender = null, game = null } = {}) {
  if (game && (!playerFinanceEnabled(game) || offer?.rulesVersion !== 2)) return false;
  switch (offer?.kind) {
    case 'loan': return loanTermsAcceptable(offer, bot, { lender, game });
    case 'equity': return Boolean(game) && equityTermsAcceptable(game, offer, bot);
    default: return false;
  }
}

// The bot proposed the contract and a counter came back. Take it only when it is
// still a loan the bot would have offered: priced, short, bounded, and funded
// without touching the lending reserve.
// The counter keeps the bot's own lending shape: a bounded principal, a priced premium, and a short term.
function counterTermsAcceptable(offer) {
  const amount = amountOf(offer.amount);
  if (!(amount > 0) || amount > LEND_MAX_PRINCIPAL) return false;
  if (amountOf(offer.premiumRate) < LEND_MIN_PREMIUM_PERCENT) return false;
  const rounds = amountOf(offer.durationRounds);
  return rounds >= 1 && rounds <= LEND_MAX_ROUNDS;
}

// A borrower seat that is dead cannot receive the principal. An unknown borrower is not checked here.
function counterBorrowerSeatOpen(game, offer) {
  const borrower = typeof game?.getPlayerById === 'function' ? game.getPlayerById(offer.toPlayerId) : null;
  return !borrower || seatCanReceive(borrower);
}

export function lenderAcceptsCounter(game, bot, offer) {
  if (!playerFinanceEnabled(game) || offer?.rulesVersion !== 2 || offer.kind !== 'loan') return false;
  if (!counterTermsAcceptable(offer)) return false;
  if (!seatCanReceive(bot)) return false;
  // The engine activates the contract only from cash the bot can actually
  // spend, and never from loan-backed cash (contractLogic.js acceptContract).
  if (loanBackedCash(game, bot)) return false;
  if (!counterBorrowerSeatOpen(game, offer)) return false;
  return spendableOf(game, bot) - amountOf(offer.amount) >= contractReserve(game);
}
