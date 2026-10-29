import assert from 'node:assert/strict';
import { buildAnalyticsSummary, buildAnalyticsBalance, buildAnalyticsDrilldown, isAdminAccount, normalizeAdminIds, withAdminFlag } from './analyticsApi.js';
import { createMetricsRegistry } from './metricsRegistry.js';
import { createAnalyticsRollupStore } from './analyticsRollupStore.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

check('normalizes a bounded admin allow-list', () => {
  assert.deepEqual(normalizeAdminIds('acct-a, acct-b,acct-a'), ['acct-a', 'acct-b']);
  assert.deepEqual(normalizeAdminIds(['acct-c', 4, 'acct-d']), ['acct-c', 'acct-d']);
});

check('authorizes only explicit account ids', () => {
  const admins = normalizeAdminIds('acct-owner');
  assert.equal(isAdminAccount('acct-owner', admins), true);
  assert.equal(isAdminAccount('acct-other', admins), false);
  assert.equal(isAdminAccount('', admins), false);
  assert.equal(withAdminFlag({ id: 'acct-owner', username: 'owner' }, admins).isAdmin, true);
  assert.equal(withAdminFlag({ id: 'acct-other', username: 'other' }, admins).isAdmin, false);
  assert.equal(withAdminFlag(null, admins), null);
});

check('builds a safe read-only summary', () => {
  const summary = buildAnalyticsSummary({
    snapshotMetrics: () => ({ generatedAt: '2026-09-13T12:00:00.000Z', metrics: { 'active-rounds': { value: 2 } } }),
  }, 'acct-owner', ['acct-owner'], 'day');
  assert.equal(summary.success, true);
  assert.equal(summary.range, 'day');
  assert.equal(summary.metrics['active-rounds'].value, 2);
  assert.equal(summary.accountId, undefined);
});

check('rejects unauthorized summaries', () => {
  const result = buildAnalyticsSummary({ snapshotMetrics: () => ({ metrics: {} }) }, 'acct-other', ['acct-owner']);
  assert.deepEqual(result, { success: false, status: 403, error: 'Forbidden.' });
});

check('builds versioned aggregate models without identity fields', () => {
  const rollup = {
    health: () => ({ loaded: true, fresh: true }),
    query: () => ({ schemaVersion: 1, generatedAt: '2026-09-13T12:00:00.000Z', dimensions: {}, actorRollups: {}, quality: {} })
  };
  const balance = buildAnalyticsBalance({ rollup, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { range: 'day' } });
  assert.equal(balance.success, true);
  assert.equal(balance.schemaVersion, 1);
  assert.equal(balance.filters.range, 'day');
  assert.equal(JSON.stringify(balance).includes('accountId'), false);
  const drilldown = buildAnalyticsDrilldown({ rollup, accountId: 'acct-owner', adminIds: ['acct-owner'], query: {} });
  assert.equal(drilldown.breakdowns[0].suppressionReason, 'PSEUDONYM_UNAVAILABLE');
});

check('keeps explicit nulls in versioned tab data', () => {
  const rollup = {
    health: () => ({ loaded: true, fresh: true }),
    query: () => ({ schemaVersion: 1, generatedAt: '2026-09-13T12:00:00.000Z', dimensions: { 's|1|1|standard-40|classic|basic': { seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', started: 1, completed: 1, outcomes: { x: 1 } } }, actorRollups: {}, quality: {} })
  };
  const result = buildAnalyticsBalance({ rollup, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { tab: 'rulesets', rulesetRevision: 1, balanceRevision: 1 } });
  assert.equal(result.breakdowns[0].rows[0].medianDuration.value, null);
  assert.equal(result.breakdowns[0].rows[0].completionRate.value, 1);
});

check('filters drilldown actors by requested dimension and preserves association deltas', () => {
  const rollup = { health: () => ({ loaded: true, fresh: true }), query: () => ({ schemaVersion: 1, generatedAt: '2026-09-13T12:00:00.000Z', dimensions: {}, actorRollups: { one: { pseudonymId: 'P-SERVER', pseudonymVersion: 'hmac-v1', observations: 5, scope: { seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', botMode: 'ai' } } }, quality: {} }) };
  const previous = process.env.POORUP_ANALYTICS_PSEUDONYM_KEY;
  process.env.POORUP_ANALYTICS_PSEUDONYM_KEY = 'test-key';
  const result = buildAnalyticsDrilldown({ rollup, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { dimension: 'bot', metric: 'fallback', botMode: 'ai', seasonId: 's', rulesetRevision: 1, balanceRevision: 1 } });
  assert.equal(result.breakdowns.length, 1);
  assert.equal(result.breakdowns[0].pseudonymId, 'P-SERVER');
  if (previous === undefined) delete process.env.POORUP_ANALYTICS_PSEUDONYM_KEY; else process.env.POORUP_ANALYTICS_PSEUDONYM_KEY = previous;
});

const KPI_ORDER = ['online-now', 'error-rate', 'p95-action-latency', 'completion-rate', 'started', 'peak-24h'];

check('emits the six console KPIs in contract order with live numbers from the registry', () => {
  const rollup = {
    health: () => ({ loaded: true, fresh: true }),
    query: () => ({ schemaVersion: 1, generatedAt: '2026-09-13T12:00:00.000Z', dimensions: { 's|1|1|standard-40|classic|basic': { seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', started: 10, completed: 8 } }, actorRollups: {}, quality: { fresh: true } })
  };
  const registry = createMetricsRegistry({ now: () => Date.parse('2026-09-13T12:00:00.000Z') });
  registry.setMetric('active-sockets', 12, { scope: 'all' });
  registry.setMetric('active-sockets', 5, { scope: 'all' });
  for (let index = 0; index < 40; index += 1) registry.recordMetric('action-latency-ms', 20, { scope: 'socket' });
  registry.incrementMetric('error-count', { source: 'socket' });
  const balance = buildAnalyticsBalance({ rollup, registry, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { range: 'day' } });
  assert.deepEqual(balance.overview.kpis.map(item => item.id), KPI_ORDER);
  const byId = Object.fromEntries(balance.overview.kpis.map(item => [item.id, item]));
  assert.equal(byId['online-now'].value, 5);
  assert.equal(byId['peak-24h'].value, 12);
  assert.equal(byId['error-rate'].value, 1 / 40);
  assert.equal(byId['p95-action-latency'].value, 20);
  assert.equal(byId['started'].value, 10);
  assert.equal(byId['completion-rate'].value, 0.8);
  balance.overview.kpis.forEach((item) => {
    assert.equal(typeof item.label, 'string');
    assert.equal(typeof item.unit, 'string');
    assert.equal(typeof item.definition, 'string');
  });
});

check('leaves live tiles null when no registry is wired', () => {
  const rollup = { health: () => ({ loaded: true, fresh: true }), query: () => ({ schemaVersion: 1, generatedAt: '2026-09-13T12:00:00.000Z', dimensions: {}, quality: { fresh: true } }) };
  const kpis = buildAnalyticsBalance({ rollup, accountId: 'acct-owner', adminIds: ['acct-owner'], query: {} }).overview.kpis;
  ['online-now', 'error-rate', 'p95-action-latency', 'peak-24h'].forEach(id => assert.equal(kpis.find(item => item.id === id).value, null, id));
});

check('accepts the month range, maps season to it, and echoes month back', () => {
  const calls = [];
  const rollup = { health: () => ({ loaded: true, fresh: true }), query: (query) => { calls.push(query.range); return { schemaVersion: 1, generatedAt: '2026-09-13T12:00:00.000Z', dimensions: {}, quality: { fresh: true } }; } };
  assert.equal(buildAnalyticsBalance({ rollup, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { range: 'month' } }).filters.range, 'month');
  assert.equal(buildAnalyticsBalance({ rollup, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { range: 'season' } }).filters.range, 'month');
  assert.deepEqual(calls.slice(0, 2), ['month', 'month']);
  assert.equal(buildAnalyticsSummary(createMetricsRegistry(), 'acct-owner', ['acct-owner'], 'month').range, 'month');
  assert.equal(buildAnalyticsSummary(createMetricsRegistry(), 'acct-owner', ['acct-owner'], 'season').range, 'month');
});

check('a stale rollup still serves live Status tiles but no other tab', () => {
  const stale = { health: () => ({ loaded: true, fresh: false }), query: () => ({ schemaVersion: 1, generatedAt: '2026-09-13T12:00:00.000Z', dimensions: {}, quality: { fresh: false } }) };
  const registry = createMetricsRegistry({ now: () => 1000 });
  registry.setMetric('active-sockets', 3);
  const status = buildAnalyticsBalance({ rollup: stale, registry, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { range: 'day' } });
  assert.equal(status.success, true);
  assert.equal(status.overview.kpis.find(item => item.id === 'online-now').value, 3);
  assert.equal(status.overview.kpis.find(item => item.id === 'started').value, null);
  assert.equal(buildAnalyticsBalance({ rollup: stale, registry, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { tab: 'match-health' } }).status, 503);
  assert.equal(buildAnalyticsBalance({ rollup: { health: () => ({ loaded: false }), query: () => ({}) }, registry, accountId: 'acct-owner', adminIds: ['acct-owner'], query: {} }).status, 503);
});

check('builds the activity series and a previous-period delta from a real rollup', () => {
  let clock = Date.parse('2026-09-13T12:30:00.000Z');
  const rollup = createAnalyticsRollupStore({ now: () => clock });
  const at = (offsetHours, kind) => ({ kind, createdAt: new Date(Date.parse('2026-09-13T12:30:00.000Z') - offsetHours * 3_600_000).toISOString(), seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', data: {} });
  // 3 starts in the last day, 1 start the day before, history reaches back 3 days.
  [70, 30, 3, 2, 1].forEach(hours => rollup.record(at(hours, 'match-start')));
  clock = Date.parse('2026-09-13T12:30:00.000Z');
  const result = buildAnalyticsBalance({ rollup, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { range: 'day' } });
  assert.equal(result.overview.kpis.find(item => item.id === 'started').value, 3);
  assert.deepEqual(result.overview.kpis.find(item => item.id === 'started').comparison, { value: 1, delta: 2, period: 'previous day' });
  assert.equal(result.series.reduce((sum, point) => sum + point.value, 0), 3);
  assert.equal(result.series.every(point => point.unit === 'matches' && typeof point.label === 'string'), true);
  // No previous window when the history is shorter than two windows.
  const young = createAnalyticsRollupStore({ now: () => clock });
  young.record(at(1, 'match-start'));
  const noComparison = buildAnalyticsBalance({ rollup: young, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { range: 'day' } });
  assert.equal(Object.hasOwn(noComparison.overview.kpis.find(item => item.id === 'started'), 'comparison'), false);
});

check('S15-02: an hour straddling the window start is counted in the current window only', () => {
  const clock = Date.parse('2026-09-13T12:30:00.000Z');
  const rollup = createAnalyticsRollupStore({ now: () => clock });
  const at = hours => ({ kind: 'match-start', createdAt: new Date(clock - hours * 3_600_000).toISOString(), seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', data: {} });
  // 24h15m ago sits in the 12:00 bucket that straddles the start of the last day.
  [70, 30, 24.25, 1].forEach(hours => rollup.record(at(hours)));
  const result = buildAnalyticsBalance({ rollup, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { range: 'day' } });
  const started = result.overview.kpis.find(item => item.id === 'started');
  assert.equal(started.value, 2, 'the straddling hour counts now');
  assert.deepEqual(started.comparison, { value: 1, delta: 1, period: 'previous day' }, 'and not in the previous window as well');
});

check('a rollup that has never recorded a match answers an empty snapshot on every tab, not a 503', () => {
  const rollup = createAnalyticsRollupStore({ now: () => Date.parse('2026-09-13T12:30:00.000Z') });
  const admin = { rollup, accountId: 'acct-owner', adminIds: ['acct-owner'] };
  ['overview', 'match-health', 'economy'].forEach((tab) => {
    const result = buildAnalyticsBalance({ ...admin, query: { range: 'day', tab } });
    assert.equal(result.success, true, tab);
    assert.equal(result.dataQuality.empty, true, tab);
    // Nothing recorded is not stale: the chip must not claim the data is old.
    assert.equal(result.dataQuality.stale, false, tab);
    assert.equal(result.dataQuality.fresh, true, tab);
    assert.deepEqual(result.series, [], tab);
  });
  const kpis = buildAnalyticsBalance({ ...admin, query: { range: 'day' } }).overview.kpis;
  assert.equal(kpis.find(item => item.id === 'started').value, 0);
  assert.equal(kpis.find(item => item.id === 'completion-rate').value, null);
  const matches = buildAnalyticsBalance({ ...admin, query: { range: 'day', tab: 'match-health' } }).breakdowns[0];
  assert.equal(matches.starts, 0);
  assert.equal(matches.completions, 0);
});

check('an empty rollup is only "empty" until a match is recorded, and a failing store still answers 503', () => {
  const clock = Date.parse('2026-09-13T12:30:00.000Z');
  const rollup = createAnalyticsRollupStore({ now: () => clock });
  rollup.record({ kind: 'match-start', createdAt: new Date(clock).toISOString(), seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', data: {} });
  const result = buildAnalyticsBalance({ rollup, accountId: 'acct-owner', adminIds: ['acct-owner'], query: { range: 'day', tab: 'match-health' } });
  assert.equal(result.success, true);
  assert.equal(result.dataQuality.empty, false);
  assert.equal(result.breakdowns[0].starts, 1);
  const admin = { accountId: 'acct-owner', adminIds: ['acct-owner'], query: { tab: 'economy' } };
  // A store that failed to load, or one whose query yields nothing, is a real fault.
  assert.equal(buildAnalyticsBalance({ ...admin, rollup: { health: () => ({ loaded: false, empty: true }), query: () => ({}) } }).status, 503);
  assert.equal(buildAnalyticsBalance({ ...admin, rollup: { health: () => ({ loaded: true, fresh: false, empty: true }), query: () => null } }).status, 503);
});
