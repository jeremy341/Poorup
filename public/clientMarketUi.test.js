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
const { selectedMarketPoints, marketPreview, personalMarketMarkers } = marketUiApi;
delete globalThis.window;

function test(name, assertion) {
  try { assertion(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}

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
