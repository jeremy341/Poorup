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
console.log('bot market forecast: risk, fee, and event scenarios passed');
