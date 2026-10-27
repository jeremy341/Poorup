// Planner accounting for the staged-complexity market positions (margin longs
// and shorts). The planner scores an action by the mark-to-market net worth it
// changes, so each position is carried exactly as the engine carries it
// (marketExpansion.js): a short keeps its collateral, owes its units at the
// quote and owes the borrow fee; a margin long keeps its units, its collateral
// and its loan. Opening either one therefore moves net worth only by the fees
// it pays, instead of booking the short's sale proceeds as profit (the old
// +48 an open-short scored at a $100 quote, whose real value is about -5).
//
// Everything here is pure over the planner's cloned state; the market rules
// themselves (rates, guards, forced liquidation) are owned by marketExpansion.js.
import { MARKET_FEE_RATE } from './marketLogic.js';
import {
  MARGIN_COLLATERAL_RATE,
  MARGIN_MAINTENANCE_RATE,
  SHORT_BORROW_FEE_RATE,
  SHORT_COLLATERAL_RATE
} from './marketExpansion.js';
import { SHORT_HOLD_CHARGE_RATE, SHORT_TAIL_RESERVE_RATE } from './botMarketForecast.js';

// The engine force-buys-in a short once the quote passes entry x 1.5.
const FORCED_BUY_IN_RATIO = 1.5;
// Held positions this close to a forced exit are charged as if it had happened.
const NEAR_FORCED_RATIO = 1.35;
// Share of an unrealised short loss charged on top of the mark: the loss is
// still open-ended until the short is covered.
const UNDERWATER_CHARGE_RATE = 0.25;
// Forced liquidation sells margin units at 98% (marketExpansion.js).
const LIQUIDATION_HAIRCUT = 0.02;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value) {
  return Math.max(0, Math.floor(number(value)));
}

function quoteOf(quotes, id, fallback) {
  const quote = Number(quotes?.[id]);
  if (Number.isFinite(quote) && quote > 0) return quote;
  const spare = Number(fallback);
  return Number.isFinite(spare) && spare > 0 ? spare : 0;
}

function shortFee(gross) {
  return Math.max(1, Math.ceil(gross * SHORT_BORROW_FEE_RATE));
}

// A forced buy-in debt freezes new positions (marketExpansion.positionDebtRejection).
function openBlockedByDebt(state) {
  return nonNegative(state.shortDefaultDebt) > 0;
}

export function applyOpenMargin(state, candidate, context) {
  if (!candidate.instrumentId || openBlockedByDebt(state)) return false;
  const gross = context.projectionQuote * context.quantity;
  const collateral = Math.ceil(gross * MARGIN_COLLATERAL_RATE);
  if (state.cash < context.fee + collateral) return false;
  state.cash -= context.fee + collateral;
  context.margin.collateral = number(context.margin.collateral) + collateral;
  const position = context.margin.positions[candidate.instrumentId] || { quantity: 0, averageCost: 0 };
  const oldQuantity = nonNegative(position.quantity);
  // The engine capitalises the opening fee into the basis (marketExpansion.js
  // openMargin), so a sale or a forced liquidation reports it as realized P&L.
  // The projection has to carry the same basis, or it values the position
  // higher than the engine holds it.
  position.averageCost = ((number(position.averageCost) * oldQuantity) + gross + number(context.fee)) / Math.max(1, oldQuantity + context.quantity);
  position.quantity = oldQuantity + context.quantity;
  context.margin.positions[candidate.instrumentId] = position;
  context.margin.balance = number(context.margin.balance) + gross;
  context.margin.maintenance = number(context.margin.maintenance) + gross * MARGIN_MAINTENANCE_RATE;
  return true;
}

// A fully repaid margin loan leaves the units owned outright: they move to spot.
function convertRepaidMarginToSpot(state, margin) {
  Object.entries(margin.positions || {}).forEach(([id, position]) => {
    const quantity = nonNegative(position?.quantity);
    if (!quantity) return;
    const spot = state.marketPositions[id] || { quantity: 0, averageCost: 0, realizedPnl: 0 };
    const cost = number(spot.averageCost) * nonNegative(spot.quantity) + number(position.averageCost) * quantity;
    spot.quantity = nonNegative(spot.quantity) + quantity;
    spot.averageCost = cost / spot.quantity;
    state.marketPositions[id] = spot;
  });
  margin.positions = {};
}

export function applyReduceMargin(state, candidate, context) {
  const margin = context.margin;
  const balance = number(margin.balance);
  if (balance <= 0) return false;
  const repayment = Math.min(balance, nonNegative(candidate.amount));
  if (repayment <= 0 || state.cash < repayment) return false;
  const collateral = number(margin.collateral);
  const released = repayment >= balance
    ? collateral
    : Math.min(collateral, Math.ceil(collateral * (repayment / balance)));
  state.cash += released - repayment;
  margin.collateral = Math.max(0, collateral - released);
  margin.maintenance = Math.max(0, number(margin.maintenance) * (1 - repayment / balance));
  margin.balance = balance - repayment;
  if (margin.balance <= 0) convertRepaidMarginToSpot(state, margin);
  return true;
}

export function applyOpenShort(state, candidate, context) {
  if (!candidate.instrumentId || openBlockedByDebt(state)) return false;
  // The borrowable pool is table-wide; a missing entry means the table has not
  // drawn on it yet (the engine seeds it lazily), so only a known shortfall refuses.
  const pooled = context.pool?.[candidate.instrumentId];
  if (pooled !== undefined && nonNegative(pooled) < context.quantity) return false;
  const gross = context.projectionQuote * context.quantity;
  const collateral = Math.ceil(gross * SHORT_COLLATERAL_RATE);
  if (state.cash < collateral) return false;
  state.cash = state.cash - collateral + Math.max(0, gross - context.fee);
  context.shorts.reservedCash = number(context.shorts.reservedCash) + collateral;
  const position = context.shortPositions[candidate.instrumentId] || { quantity: 0, entryQuote: 0, collateral: 0, borrowFee: 0 };
  const oldQuantity = nonNegative(position.quantity);
  position.entryQuote = ((number(position.entryQuote) * oldQuantity) + gross) / Math.max(1, oldQuantity + context.quantity);
  position.quantity = oldQuantity + context.quantity;
  position.collateral = number(position.collateral) + collateral;
  position.borrowFee = number(position.borrowFee) + shortFee(gross);
  context.shortPositions[candidate.instrumentId] = position;
  return true;
}

export function applyCoverShort(state, candidate, context) {
  const position = context.shortPositions[candidate.instrumentId];
  if (!position || !candidate.instrumentId) return false;
  const held = nonNegative(position.quantity);
  if (!held || held < context.quantity) return false;
  const gross = context.projectionQuote * context.quantity;
  const released = Math.ceil((number(position.collateral) / held) * context.quantity);
  const feePortion = Math.ceil(number(position.borrowFee) * (context.quantity / held));
  const total = gross + context.fee + feePortion;
  if (state.cash + released < total) return false;
  state.cash = state.cash + released - total;
  context.shorts.reservedCash = Math.max(0, number(context.shorts.reservedCash) - released);
  position.collateral = Math.max(0, number(position.collateral) - released);
  position.borrowFee = Math.max(0, number(position.borrowFee) - feePortion);
  position.quantity = held - context.quantity;
  if (!position.quantity) delete context.shortPositions[candidate.instrumentId];
  return true;
}

// Paying forced buy-in debt moves cash against the debt one for one.
export function applySettleShortDefault(state, candidate) {
  const debt = nonNegative(state.shortDefaultDebt);
  const paid = Math.min(nonNegative(state.cash), debt, nonNegative(candidate.amount));
  if (paid <= 0) return false;
  state.cash -= paid;
  state.shortDefaultDebt = debt - paid;
  return true;
}

// Net worth carried by margin and short books at the projected quotes:
// margin units + held collateral - the loan; short collateral - units owed at
// the quote (plus the cover fee a forced or voluntary exit must pay) - the
// borrow fee still to be charged.
export function leveragedNetWorth(state) {
  const expansion = state.marketExpansion || {};
  const quotes = state.marketQuotes;
  const margin = expansion.margin || {};
  const units = Object.entries(margin.positions || {}).reduce((sum, [id, position]) => (
    sum + nonNegative(position?.quantity) * quoteOf(quotes, id, position?.averageCost)
  ), 0);
  const marginEquity = units + nonNegative(margin.collateral) - nonNegative(margin.balance);
  const shortBook = Object.entries(expansion.shorts?.positions || {}).reduce((sum, [id, position]) => {
    const owed = nonNegative(position?.quantity) * quoteOf(quotes, id, position?.entryQuote);
    return sum + nonNegative(position?.collateral) - Math.ceil(owed * (1 + MARKET_FEE_RATE)) - nonNegative(position?.borrowFee);
  }, 0);
  return marginEquity + shortBook;
}

function marginHoldingCost(state, reserveFor) {
  const margin = state.marketExpansion?.margin || {};
  let cost = 0;
  let value = 0;
  Object.entries(margin.positions || {}).forEach(([id, position]) => {
    const quantity = nonNegative(position?.quantity);
    value += quantity * quoteOf(state.marketQuotes, id, position?.averageCost);
    cost += reserveFor(id, quantity);
  });
  if (value <= 0 || number(margin.maintenance) <= 0) return cost;
  const equity = value + nonNegative(margin.collateral) - nonNegative(margin.balance);
  // Below maintenance the engine liquidates at the next round step (2% haircut);
  // within 10% of it a routine dip does the same.
  if (equity < number(margin.maintenance)) cost += value * LIQUIDATION_HAIRCUT;
  else if (equity < number(margin.maintenance) * 1.1) cost += value * LIQUIDATION_HAIRCUT * 0.5;
  return cost;
}

function shortHoldingCost(state, reserveFor) {
  const book = state.marketExpansion?.shorts?.positions || {};
  let cost = 0;
  Object.entries(book).forEach(([id, position]) => {
    const quantity = nonNegative(position?.quantity);
    if (!quantity) return;
    const entry = number(position.entryQuote);
    const quote = quoteOf(state.marketQuotes, id, entry);
    const notional = quote * quantity;
    cost += reserveFor(id, quantity);
    cost += notional * (SHORT_TAIL_RESERVE_RATE + SHORT_HOLD_CHARGE_RATE);
    if (entry > 0 && quote > entry) cost += (quote - entry) * quantity * UNDERWATER_CHARGE_RATE;
    if (entry > 0 && quote >= entry * NEAR_FORCED_RATIO) cost += notional * 0.5;
    // A forced buy-in that the seat cannot fund becomes shortDefaultDebt.
    const needed = Math.ceil(entry * FORCED_BUY_IN_RATIO * quantity * (1 + MARKET_FEE_RATE)) + nonNegative(position.borrowFee);
    const funded = nonNegative(state.cash) + nonNegative(position.collateral);
    if (needed > funded) cost += (needed - funded) * 0.5;
  });
  return cost;
}

// Exposure the projected margin and short books carry: the volatility reserve of
// every unit held, a short's tail, hold charge, unrealised loss and buy-in risk,
// and a margin loan's liquidation risk. Charged to the baseline too, so exiting a
// position (cover, repay) earns exactly the cost it removes.
export function leveragedHoldingCost(state, reserveFor) {
  return marginHoldingCost(state, reserveFor) + shortHoldingCost(state, reserveFor);
}
