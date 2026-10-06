import { MARKET_FEE_RATE } from './marketLogic.js';

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

function pendingEventMove(history, activeEventId, activeEventStartedRound, eventPriceMultiplier) {
  const multiplier = Number(eventPriceMultiplier);
  if (typeof activeEventId !== 'string' || !Number.isFinite(multiplier) || multiplier <= 0 || multiplier === 1) return 0;
  const startRound = Number(activeEventStartedRound);
  const applied = (Array.isArray(history) ? history : []).some(point => point?.eventId === activeEventId
    && (!Number.isFinite(startRound) || Number(point?.round) >= startRound));
  return applied ? 0 : multiplier - 1;
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
  if (!instrumentId || !quote || !quantity || !['buy', 'sell'].includes(side)) {
    return { supported: false, expectedPnl: null, fee: null, expectedMovePercent: null, volatilityPercent: null };
  }

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
    expectedPnl: Math.floor(expectedMove - riskReserve) - fee
  };
}
