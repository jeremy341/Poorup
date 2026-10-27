import { MARKET_FEE_RATE } from './marketLogic.js';
import { SHORT_BORROW_FEE_RATE } from './marketExpansion.js';

// Bot-side pricing of the staged-complexity orders (margin long, short). These
// are planner and candidate-gate constants, not market rules: the rules (fees,
// collateral, borrow fee, forced buy-in) live in marketExpansion.js.
// A short's loss is unbounded and ends in a forced buy-in at +50%; reserve a
// slice of the notional for that tail.
export const SHORT_TAIL_RESERVE_RATE = 0.02;
// An open short borrows from a pool shared by the whole table and pays no
// yield, so holding one is charged this share of its notional until it is
// covered. Without it a flat short is never worth the cover fee and the pool
// drains.
export const SHORT_HOLD_CHARGE_RATE = 0.04;
// "Clearly positive": expected value after every cost must also clear this share
// of the notional (and at least LEVERAGED_MIN_EDGE dollars) before a bot opens.
export const LEVERAGED_EDGE_HURDLE_RATE = 0.01;
export const LEVERAGED_MIN_EDGE = 3;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function quoteSeries(history, instrumentId, currentQuote) {
  const series = (Array.isArray(history) ? history : [])
    .map(point => positiveInteger(point?.quotes?.[instrumentId]))
    .filter(value => value !== null)
    .slice(-6);
  if (series.at(-1) !== currentQuote) series.push(currentQuote);
  return series.slice(-7);
}

function returnsFor(series) {
  const returns = [];
  for (let index = 1; index < series.length; index += 1) {
    returns.push((series[index] - series[index - 1]) / series[index - 1]);
  }
  return returns;
}

function weightedMomentum(returns) {
  if (!returns.length) return 0;
  const recent = returns.slice(-5);
  let weightTotal = 0;
  let weightedTotal = 0;
  recent.forEach((value, index) => {
    const weight = index + 1;
    weightTotal += weight;
    weightedTotal += value * weight;
  });
  return clamp((weightedTotal / weightTotal) * 0.35, -0.05, 0.05);
}

function volatilityOf(returns) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / returns.length;
  return Math.sqrt(variance);
}

function eventWasApplied(history, activeEventId, startRound) {
  return (Array.isArray(history) ? history : []).some(point => {
    if (point?.eventId !== activeEventId) return false;
    if (!Number.isFinite(startRound)) return true;
    // A history point is labelled with marketRound, which trails the event's
    // startedRound (roundNumber) by one, so the activation point sits at startRound - 1.
    return Number(point?.round) >= startRound - 1;
  });
}

function pendingEventMove(history, activeEventId, activeEventStartedRound, eventPriceMultiplier) {
  const multiplier = Number(eventPriceMultiplier);
  if (typeof activeEventId !== 'string') return 0;
  if (!Number.isFinite(multiplier)) return 0;
  if (multiplier <= 0) return 0;
  if (multiplier === 1) return 0;
  const startRound = Number(activeEventStartedRound);
  if (eventWasApplied(history, activeEventId, startRound)) return 0;
  return multiplier - 1;
}

function unsupportedForecast() {
  return { supported: false, expectedPnl: null, expectedMove: null, fee: null, expectedMovePercent: null, volatilityPercent: null };
}

function orderFee(gross) {
  return Math.max(1, Math.ceil(gross * MARKET_FEE_RATE));
}

// Expected value of opening a margin long ('open-margin') or a short
// ('open-short') and later closing it, after the opening fee, the closing fee,
// a short's borrow fee and tail reserve, and the volatility reserve. clear is
// true only when that value beats the hurdle, so a bot never opens a position
// whose edge is the fee schedule's loss.
export function forecastLeveragedOpen({ kind, quote: rawQuote, quantity: rawQuantity = 1, ...rest } = {}) {
  const short = kind === 'open-short';
  if (!short && kind !== 'open-margin') return { supported: false, expectedValue: null, clear: false };
  const forecast = forecastMarketOrder({ ...rest, quote: rawQuote, quantity: rawQuantity, side: short ? 'sell' : 'buy' });
  if (!forecast.supported) return { supported: false, expectedValue: null, clear: false };
  const gross = Number(rawQuote) * Number(rawQuantity);
  const fees = orderFee(gross) * 2 + (short ? Math.max(1, Math.ceil(gross * SHORT_BORROW_FEE_RATE)) : 0);
  const tail = short ? Math.ceil(gross * SHORT_TAIL_RESERVE_RATE) : 0;
  const expectedValue = forecast.expectedMove - forecast.riskReserve - tail - fees;
  const hurdle = Math.max(LEVERAGED_MIN_EDGE, Math.ceil(gross * LEVERAGED_EDGE_HURDLE_RATE));
  return { supported: true, expectedValue, hurdle, fees, clear: expectedValue >= hurdle, forecast };
}

export function forecastMarketOrder({
  instrumentId,
  quote: rawQuote,
  quantity: rawQuantity = 1,
  side = 'buy',
  history = [],
  marketVolatility: rawMarketVolatility = 1,
  feeRate = MARKET_FEE_RATE,
  activeEventId = null,
  activeEventStartedRound = null,
  eventPriceMultiplier = 1
} = {}) {
  const quote = positiveInteger(rawQuote);
  const quantity = positiveInteger(rawQuantity);
  if (!instrumentId) return unsupportedForecast();
  if (!quote) return unsupportedForecast();
  if (!quantity) return unsupportedForecast();
  if (side !== 'buy' && side !== 'sell') return unsupportedForecast();

  const series = quoteSeries(history, instrumentId, quote);
  const returns = returnsFor(series);
  const expectedMovePercent = clamp(weightedMomentum(returns), -0.05, 0.05)
    + pendingEventMove(history, activeEventId, activeEventStartedRound, eventPriceMultiplier);
  const volatilityPercent = volatilityOf(returns);
  const fee = Math.max(1, Math.ceil(quote * quantity * Math.max(0, Number(feeRate) || 0)));
  const marketVolatility = Number.isFinite(Number(rawMarketVolatility)) ? Math.max(1, Number(rawMarketVolatility)) : 1;
  const expectedMove = quote * quantity * expectedMovePercent * (side === 'buy' ? 1 : -1);
  const historyRisk = quote * quantity * volatilityPercent * 0.25;
  const eventRisk = quote * quantity * Math.max(0, marketVolatility - 1) * 0.01;
  const riskReserve = Math.ceil(historyRisk + eventRisk);
  return {
    supported: true,
    expectedMovePercent,
    volatilityPercent,
    fee,
    riskReserve,
    expectedMove: Math.floor(expectedMove),
    // A buy adds exposure and pays its reserve; a sale sheds exposure, so it is
    // not charged one (the planner charges every held unit in the baseline).
    expectedPnl: Math.floor(expectedMove - (side === 'buy' ? riskReserve : 0)) - fee
  };
}
