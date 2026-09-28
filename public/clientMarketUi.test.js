import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';

const marketUi = fs.readFileSync(new URL('./clientMarketUi.js', import.meta.url), 'utf8');
const railRender = fs.readFileSync(new URL('./clientRailRender.js', import.meta.url), 'utf8');
const railEvents = fs.readFileSync(new URL('./clientRailEvents.js', import.meta.url), 'utf8');
const stateSync = fs.readFileSync(new URL('./clientStateSync.js', import.meta.url), 'utf8');
const adapter = fs.readFileSync(new URL('./clientAnalyticsChartAdapter.js', import.meta.url), 'utf8');
globalThis.window = { matchMedia: () => ({ matches: false }) };
const marketUiApi = await import('./clientMarketUi.js');
const { selectedMarketPoints, marketPreview, personalMarketMarkers, marketQuoteSummary } = marketUiApi;
const { MARKET_INSTRUMENTS } = await import('../server/marketLogic.js');
delete globalThis.window;

function test(name, assertion) {
  try { assertion(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}

test('marketSectorLabelsReplaceGeographyAndMatchServerInstrumentNames', () => {
  const expected = {
    brazil: 'HOUSING MARKET',
    ghana: 'AGRICULTURE',
    thailand: 'CONSUMER GOODS',
    japan: 'TECHNOLOGY',
    netherlands: 'TRADE & LOGISTICS',
    canada: 'ENERGY & RESOURCES',
    switzerland: 'FINANCIAL SERVICES',
    singapore: 'TOURISM & HOSPITALITY',
    airports: 'AIR TRANSPORT',
    utilities: 'PUBLIC UTILITIES',
    property: 'CONSTRUCTION & MATERIALS',
  };
  assert.deepEqual(marketUiApi.MARKET_LABELS, expected);
  assert.deepEqual(MARKET_INSTRUMENTS.map(({ id, name }) => [id, name]), Object.entries(expected));
});

test('selectedIndexUsesSharedQuotesAndHistory', () => {
  assert.ok(/quoteHistory/.test(marketUi));
  assert.ok(/selectedIndex/.test(marketUi));
  assert.ok(/createPoorupChartOptions|renderAnalyticsChart/.test(marketUi));
  assert.ok(/quotes\?\./.test(marketUi));
  const shared = { quotes: { brazil: 120 }, quoteHistory: [{ round: 0, quotes: { brazil: 100 } }, { round: 1, quotes: { brazil: 120 }, eventId: 'market-shock' }] };
  assert.deepEqual(selectedMarketPoints(shared, 'brazil'), [
    { round: 0, value: 100, eventId: null },
    { round: 1, value: 120, eventId: 'market-shock' },
  ]);
});

test('tabletChartRangeUsesOnlyTheMostRecentRequestedRounds', () => {
  const marketState = {
    quoteHistory: Array.from({ length: 21 }, (_, round) => ({ round, quotes: { brazil: 100 + round } })),
  };
  assert.deepEqual(selectedMarketPoints(marketState, 'brazil', 3), [
    { round: 18, value: 118, eventId: null },
    { round: 19, value: 119, eventId: null },
    { round: 20, value: 120, eventId: null },
  ]);
});

test('selectedQuoteSummaryUsesTheCurrentSharedQuoteAndPreviousRound', () => {
  assert.equal(typeof marketQuoteSummary, 'function');
  assert.deepEqual(marketQuoteSummary({
    round: 2,
    quotes: { brazil: 113 },
    quoteHistory: [
      { round: 0, quotes: { brazil: 100 } },
      { round: 1, quotes: { brazil: 104 } },
      { round: 2, quotes: { brazil: 113 }, eventId: 'market-rush' },
    ],
  }, 'brazil'), {
    quote: 113,
    round: 2,
    change: 9,
    percentChange: 8.7,
    previousQuote: 104,
    previousRound: 1,
    eventId: 'market-rush',
  });
});

test('selectedQuoteSummaryDoesNotInventMovementWithoutPriorHistory', () => {
  assert.deepEqual(marketQuoteSummary({ round: 0, quotes: { ghana: 100 }, quoteHistory: [] }, 'ghana'), {
    quote: 100,
    round: 0,
    change: null,
    percentChange: null,
    previousQuote: null,
    previousRound: null,
    eventId: null,
  });
});

test('selectedQuoteSummaryTreatsNullQuotesAsUnavailableInsteadOfZero', () => {
  assert.deepEqual(marketQuoteSummary({ round: 1, quotes: { brazil: null }, quoteHistory: [] }, 'brazil'), {
    quote: null,
    round: 1,
    change: null,
    percentChange: null,
    previousQuote: null,
    previousRound: null,
    eventId: null,
  });
});

test('selectedQuoteSummaryNamesThePriorRecordedRoundWhenHistoryHasAGap', () => {
  assert.deepEqual(marketQuoteSummary({
    round: 4,
    quotes: { japan: 125 },
    quoteHistory: [
      { round: 0, quotes: { japan: 100 } },
      { round: 2, quotes: { japan: 120 } },
    ],
  }, 'japan'), {
    quote: 125,
    round: 4,
    change: 5,
    percentChange: 4.2,
    previousQuote: 120,
    previousRound: 2,
    eventId: null,
  });
});

test('buyAndSellPreviewMatchesServerFeeRounding', () => {
  assert.ok(/Math\.ceil\([^)]*0\.02/.test(marketUi));
  assert.ok(/gross\s*\+\s*fee/.test(marketUi));
  assert.ok(/gross\s*-\s*fee/.test(marketUi));
  assert.ok(/data-market-basic-order/.test(marketUi));
  assert.deepEqual(marketPreview({ quotes: { brazil: 125 } }, 'brazil', 2, 'buy'), { quote: 125, gross: 250, fee: 5, net: 255 });
  assert.deepEqual(marketPreview({ quotes: { brazil: 125 } }, 'brazil', 2, 'sell'), { quote: 125, gross: 250, fee: 5, net: 245 });
  assert.equal(marketPreview({ quotes: { brazil: 1 } }, 'brazil', 1, 'buy').fee, 1);
});

test('tradeMarkersUseOnlyViewerLedger', () => {
  assert.ok(/marketState\.personalTrades/.test(marketUi));
  assert.ok(!/allPlayers|playersLedger|sharedLedger/.test(marketUi));
  const marketState = { personalTrades: [{ instrumentId: 'brazil', side: 'buy', roundNumber: 2 }, { instrumentId: 'japan', side: 'sell', roundNumber: 3 }] };
  assert.deepEqual(personalMarketMarkers(marketState, 'brazil'), [{ instrumentId: 'brazil', side: 'buy', roundNumber: 2 }]);
});

test('marketTradeHistoryRetainsNewest128', () => {
  assert.ok(/\.slice\(0, 128\)/.test(stateSync));
  assert.ok(/\.slice\(0, 128\)/.test(fs.readFileSync(new URL('../server/economyApi.js', import.meta.url), 'utf8')));
});

test('positionShowsPerUnitCostAndUnrealizedPnl', () => {
  const summary = marketUiApi.marketPositionSummary;
  assert.equal(typeof summary, 'function');
  assert.deepEqual(summary({
    quotes: { brazil: 130 },
    positions: { brazil: { quantity: 3, averageCost: 110, realizedPnl: 12 } },
  }, 'brazil'), {
    quantity: 3,
    averageCostPerUnit: 110,
    unrealizedPnl: 60,
    realizedPnl: 12,
  });
  assert.equal(summary({ quotes: { brazil: 95 }, positions: { brazil: { quantity: 3, averageCost: 100 } } }, 'brazil').unrealizedPnl, -15);
  assert.equal(summary({ quotes: { brazil: 100 }, positions: { brazil: { quantity: 3, averageCost: 100 } } }, 'brazil').unrealizedPnl, 0);
  assert.ok(/AVERAGE COST PER UNIT/.test(marketUi));
  assert.ok(/UNREALIZED P\\?&?amp;?L|UNREALIZED P&L/.test(marketUi));
});

test('derivativesControlsAreUnavailableWithoutServerPolicy', () => {
  assert.ok(/pricingPolicy/.test(marketUi));
  assert.ok(/UNAVAILABLE|unavailable/i.test(marketUi));
  assert.ok(!/enabled: rank >= 3, action: "open-option"/.test(marketUi));
});

test('chartHandlesEmptyStateResizeAndClose', () => {
  assert.ok(/hydrateAnalyticsChart|mountAnalyticsChart/.test(marketUi));
  assert.ok(/disposeAnalyticsChart/.test(marketUi));
  assert.ok(/if \(!container \|\| !points\.length\)/.test(marketUi));
  assert.ok(/observeChartSize/.test(adapter));
  assert.ok(/export function disposeAnalyticsChart/.test(adapter));
});

test('marketDeskHasOneEntryAndViewerScopedRefresh', () => {
  assert.ok(/data-market-desk/.test(railRender));
  assert.ok(!/data-market-order/.test(railRender));
  assert.ok(/openMarketDesk/.test(railEvents));
  assert.ok(/const market = incoming\.market/.test(stateSync));
});

if (process.exitCode) process.exit(process.exitCode);
console.log('market desk: selected history, exact preview, private markers, derivative gate, lifecycle pass');
