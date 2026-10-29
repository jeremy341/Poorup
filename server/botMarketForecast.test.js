import assert from 'node:assert/strict';
import { forecastMarketOrder } from './botMarketForecast.js';

const quotes = values => values.map((value, index) => ({
  round: index,
  eventId: null,
  quotes: { brazil: value }
}));

const missing = forecastMarketOrder({ instrumentId: 'brazil', quote: null, quantity: 1 });
assert.equal(missing.supported, false);
assert.equal(missing.expectedPnl, null);
for (const invalidOrder of [
  { instrumentId: '', quote: 100, quantity: 1 },
  { instrumentId: 'brazil', quote: 100, quantity: 0 },
  { instrumentId: 'brazil', quote: 100, quantity: 1, side: 'hold' }
]) {
  assert.deepEqual(forecastMarketOrder(invalidOrder), missing, 'invalid orders keep the unsupported result shape');
}

const noSignal = forecastMarketOrder({ instrumentId: 'brazil', quote: 100, quantity: 1, history: quotes([100]) });
assert.equal(noSignal.supported, true);
assert.equal(noSignal.expectedMovePercent, 0);
assert.equal(noSignal.fee, 2);
assert.equal(noSignal.expectedPnl, -2);

const rising = forecastMarketOrder({ instrumentId: 'brazil', quote: 121, quantity: 2, side: 'buy', history: quotes([100, 110, 121]) });
assert.ok(rising.expectedMovePercent > 0);
assert.ok(rising.expectedMovePercent <= 0.05, 'momentum estimate is bounded');

const calm = forecastMarketOrder({ instrumentId: 'brazil', quote: 100, quantity: 2, history: quotes([100, 104, 100]), marketVolatility: 1 });
const volatile = forecastMarketOrder({ instrumentId: 'brazil', quote: 100, quantity: 2, history: quotes([100, 104, 100]), marketVolatility: 3 });
assert.ok(volatile.expectedPnl < calm.expectedPnl, 'higher global volatility reduces risk-adjusted value');

const sell = forecastMarketOrder({ instrumentId: 'brazil', quote: 90, quantity: 2, side: 'sell', history: quotes([100, 95, 90]) });
assert.ok(sell.expectedPnl > -sell.fee, 'a falling price makes selling preferable to holding');

// Risk is a cost of holding exposure: a buy adds it, a sale sheds it, so the
// reserve is charged to buys only and the planner prices held units.
const volatileHistory = quotes([100, 140, 100, 140, 100, 140, 100]);
const volatileBuy = forecastMarketOrder({ instrumentId: 'brazil', quote: 100, quantity: 2, side: 'buy', history: volatileHistory });
const volatileSell = forecastMarketOrder({ instrumentId: 'brazil', quote: 100, quantity: 2, side: 'sell', history: volatileHistory });
assert.ok(volatileBuy.riskReserve > 0, 'the volatile history carries an exposure reserve');
assert.equal(volatileSell.riskReserve, volatileBuy.riskReserve, 'the same exposure is measured on both sides');
assert.equal(volatileSell.expectedPnl, Math.floor(volatileSell.expectedMove) - volatileSell.fee, 'a sale is not charged the risk reserve');
assert.equal(volatileBuy.expectedPnl, Math.floor(volatileBuy.expectedMove - volatileBuy.riskReserve) - volatileBuy.fee, 'a buy is charged the risk reserve');

const eventMove = forecastMarketOrder({
  instrumentId: 'brazil', quote: 100, quantity: 1, side: 'buy', history: quotes([100]),
  activeEventId: 'market-boom', activeEventStartedRound: 4, eventPriceMultiplier: 1.5
});
assert.ok(eventMove.expectedMovePercent > 0.45, 'a pending global market shock informs the forecast');
const eventAlreadyApplied = forecastMarketOrder({
  instrumentId: 'brazil', quote: 150, quantity: 1, side: 'buy',
  history: [{ round: 4, eventId: 'market-boom', quotes: { brazil: 150 } }],
  activeEventId: 'market-boom', activeEventStartedRound: 4, eventPriceMultiplier: 1.5
});
assert.equal(eventAlreadyApplied.expectedMovePercent, 0, 'a market shock already recorded in the quote history is not applied twice');
// The engine labels the activation point with marketRound (roundNumber - 1), one below startedRound.
const engineLabelled = forecastMarketOrder({
  instrumentId: 'brazil', quote: 150, quantity: 1, side: 'buy',
  history: [{ round: 3, eventId: 'market-boom', quotes: { brazil: 150 } }],
  activeEventId: 'market-boom', activeEventStartedRound: 4, eventPriceMultiplier: 1.5
});
assert.equal(engineLabelled.expectedMovePercent, 0, 'the shock is not applied twice in the round it activates');
const earlierOccurrence = forecastMarketOrder({
  instrumentId: 'brazil', quote: 100, quantity: 1, side: 'buy',
  history: [{ round: 1, eventId: 'market-boom', quotes: { brazil: 100 } }],
  activeEventId: 'market-boom', activeEventStartedRound: 9, eventPriceMultiplier: 1.5
});
assert.ok(earlierOccurrence.expectedMovePercent > 0.45, 'a previous occurrence of the same event does not hide a pending one');
console.log('bot market forecast: risk, fee, and event scenarios passed');
