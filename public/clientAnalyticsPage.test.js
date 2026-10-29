import assert from 'node:assert/strict';

const {
  ANALYTICS_PAGES,
  normalizeAnalyticsPage,
  nextAnalyticsPage,
  previousAnalyticsPage
} = await import('./clientAnalyticsPage.js');

assert.deepEqual(ANALYTICS_PAGES, ['overview', 'match-health', 'rulesets', 'economy', 'events', 'bots', 'quality']);
assert.equal(normalizeAnalyticsPage('unknown'), 'overview');
assert.equal(normalizeAnalyticsPage('ECONOMY'), 'economy');
assert.equal(nextAnalyticsPage('overview'), 'match-health');
assert.equal(nextAnalyticsPage('quality'), 'overview');
assert.equal(previousAnalyticsPage('overview'), 'quality');
assert.equal(previousAnalyticsPage('match-health'), 'overview');

console.log('analytics page model: expected page and wrap contracts are present');
