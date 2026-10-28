// One net-worth definition for the whole server. The round-limit winner
// (gameLogic.endForRoundLimit), the per-round net-worth chart series and the
// bot table brain all call netWorth() so a player is ranked, charted and read
// by bots on the same number. Pure functions over the live game object; every
// field is optional so unit-test stubs keep working. Whole dollars throughout.
//
// What counts (all marked to the current market quote where one applies):
//   cash                      free cash only. Margin and short collateral is
//                             deducted from cash by the engine, so it is added
//                             back below as an asset held against its debt.
//   deeds                     face value; a mortgaged deed counts at half face
//                             (face minus the mortgage it carries).
//   houses                    resale value (building sale multiplier x cost).
//   spot units                quantity x quote (average cost if unquoted).
//   margin                    units at quote + held collateral - margin balance.
//   shorts                    held collateral - units owed x quote - the borrow
//                             fee still to be charged at cover. Opening a short
//                             therefore changes net worth only by its fees.
//   options                   open, unexpired holder options at intrinsic value.
//   bank loan / short default debt   owed, negative.
//   pending payments          rent, tax and defaulted-loan balances still parked
//                             in the payment queue (head or queued), negative.
//   loan and hybrid contracts owed (borrower, negative) or receivable (lender,
//                             positive only while the borrower is solvent).
//                             Equity contracts carry no principal and are not
//                             valued.
//   default claims            open defaulted-loan principal still owed
//                             (borrower, negative) or collectable (lender, as
//                             above). The defaulted contract itself is left out
//                             so its remaining principal is never counted twice.

import { inventoryValue } from './itemApi.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function whole(value) {
  return Math.floor(number(value));
}

function nonNegative(value) {
  return Math.max(0, whole(value));
}

function safeHouseCost(game, tile) {
  try {
    return game.getPropertyHouseCost(tile);
  } catch {
    return 100;
  }
}

function houseSaleRate(game) {
  if (typeof game?.buildingSaleMultiplier !== 'function') return 0.5;
  try {
    const rate = Number(game.buildingSaleMultiplier());
    return Number.isFinite(rate) && rate >= 0 ? rate : 0.5;
  } catch {
    return 0.5;
  }
}

function houseValueOf(game, tile, rate) {
  const count = Math.max(0, Math.min(5, whole(tile.houseCount)));
  if (count <= 0) return 0;
  const unit = typeof game?.getPropertyHouseCost === 'function' ? nonNegative(safeHouseCost(game, tile)) : 100;
  return Math.floor(count * unit * rate);
}

function deedAndHouseValue(game, player) {
  let deeds = 0;
  let houses = 0;
  const rate = houseSaleRate(game);
  for (const index of player.properties || []) {
    const tile = typeof game?.getTile === 'function' ? game.getTile(index) : null;
    if (!tile) continue;
    const face = nonNegative(tile.price);
    if (tile.mortgaged) {
      deeds += Math.floor(face / 2);
      continue;
    }
    deeds += face;
    houses += houseValueOf(game, tile, rate);
  }
  return { deeds, houses };
}

function quoteOf(game, instrumentId, fallback) {
  const quote = Number(game?.marketQuotes?.[instrumentId]);
  if (Number.isFinite(quote) && quote > 0) return quote;
  const spare = Number(fallback);
  return Number.isFinite(spare) && spare > 0 ? spare : 0;
}

function spotValue(game, player) {
  return Object.entries(player.marketPositions || {}).reduce((sum, [id, position]) => (
    sum + nonNegative(position?.quantity) * quoteOf(game, id, position?.averageCost)
  ), 0);
}

function marginEquity(game, player) {
  const units = Object.entries(player.marginPositions || {}).reduce((sum, [id, position]) => (
    sum + nonNegative(position?.quantity) * quoteOf(game, id, position?.averageCost)
  ), 0);
  return units + nonNegative(player.marginCollateral) - nonNegative(player.marginBalance);
}

function shortEquity(game, player) {
  return Object.entries(player.shortPositions || {}).reduce((sum, [id, position]) => {
    const owed = nonNegative(position?.quantity) * quoteOf(game, id, position?.entryQuote);
    return sum + nonNegative(position?.collateral) - owed - nonNegative(position?.borrowFee);
  }, 0);
}

function optionValue(game, player) {
  const round = number(game?.roundNumber, 0);
  return (player.optionPositions || []).reduce((sum, option) => {
    if (!option || option.status !== 'open' || option.role === 'writer') return sum;
    if (Number.isFinite(Number(option.expiryRound)) && round > Number(option.expiryRound)) return sum;
    const quote = quoteOf(game, option.instrumentId, option.strike);
    const strike = number(option.strike);
    const intrinsic = option.side === 'put' ? Math.max(0, strike - quote) : Math.max(0, quote - strike);
    return sum + Math.min(Math.floor(intrinsic * nonNegative(option.quantity)), nonNegative(option.reserveHeld));
  }, 0);
}

// Debts a seat still owes in the payment queue: the head claim and every queued one.
function pendingDebtOf(game, player) {
  let owed = game?.pendingPayment?.playerId === player.id ? nonNegative(game.pendingPayment.amountRemaining) : 0;
  (Array.isArray(game?.pendingPaymentQueue) ? game.pendingPaymentQueue : []).forEach(entry => {
    if (entry?.payment?.playerId === player.id) owed += nonNegative(entry.payment.amountRemaining);
  });
  return owed;
}

function counterpartySolvent(game, id) {
  const other = typeof game?.getPlayerById === 'function' ? game.getPlayerById(id) : null;
  if (!other) return false;
  return !other.bankrupt && !other.inDebt && pendingDebtOf(game, other) === 0;
}

// A claim owed by the debtor is negative for them; the creditor holds it as a receivable only while the debtor is solvent.
function claimValueFor(game, player, remaining, debtorId, creditorId) {
  if (!remaining) return 0;
  if (debtorId === player.id) return -remaining;
  if (creditorId === player.id && counterpartySolvent(game, debtorId)) return remaining;
  return 0;
}

function contractValue(game, player) {
  return (Array.isArray(game?.playerContracts) ? game.playerContracts : []).reduce((sum, contract) => {
    if (!contract || !['loan', 'hybrid'].includes(contract.kind)) return sum;
    if (!['active', 'due'].includes(contract.status)) return sum;
    return sum + claimValueFor(game, player, nonNegative(contract.remaining), contract.toPlayerId, contract.fromPlayerId);
  }, 0);
}

function bankLoanDebt(player) {
  // Default moves the remaining balance into pending payments; the loan record
  // mirrors that claim until its payment hook closes the ledger balance.
  if (!player.bankLoan || ['paid', 'defaulted'].includes(player.bankLoan.status)) return 0;
  return nonNegative(player.bankLoan.remaining);
}

// Defaulted contracts leave contractValue (their status is terminal), but the claim ledger keeps the unpaid principal collectable
// through bankruptcyLogic.settleDefaultClaim. Each open claim is counted once, on the side that moves cash: the borrower owes it,
// and the lender holds it only while the borrower can still be made to pay.
function defaultClaimValue(game, player) {
  return (Array.isArray(game?.defaultClaims) ? game.defaultClaims : []).reduce((sum, claim) => {
    if (!claim || claim.status !== 'open') return sum;
    return sum + claimValueFor(game, player, nonNegative(claim.remaining), claim.borrowerId, claim.lenderId);
  }, 0);
}

// Itemised net worth, unclamped. Exposed for tests and diagnostics.
export function netWorthBreakdown(game, player) {
  if (!player) return null;
  const { deeds, houses } = deedAndHouseValue(game, player);
  const parts = {
    cash: nonNegative(player.cash),
    deeds,
    houses,
    spot: Math.floor(spotValue(game, player)),
    margin: Math.floor(marginEquity(game, player)),
    shorts: Math.floor(shortEquity(game, player)),
    options: optionValue(game, player),
    items: inventoryValue(game, player),
    bankLoan: -bankLoanDebt(player),
    shortDefaultDebt: -nonNegative(player.shortDefaultDebt),
    pendingDebt: -pendingDebtOf(game, player),
    contracts: contractValue(game, player),
    defaultClaims: defaultClaimValue(game, player)
  };
  return { ...parts, total: Object.values(parts).reduce((sum, value) => sum + value, 0) };
}

export function netWorth(game, player) {
  if (!player) return 0;
  return Math.max(0, netWorthBreakdown(game, player).total);
}
