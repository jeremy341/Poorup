/* global process */
import assert from 'node:assert/strict';

globalThis.window = { matchMedia: () => ({ matches: false }), location: { pathname: '/' } };
globalThis.document = { querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { normalizeAnalyticsSnapshot, normalizeAnalyticsQuery, metricValue, isAnalyticsPath, createAnalyticsController } = await import('./clientAnalytics.js');
const { renderAnalyticsChart } = await import('./clientAnalyticsCharts.js');

async function check(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

await check('accepts only the internal analytics path', () => {
  assert.equal(isAnalyticsPath('/admin/analytics'), true);
  assert.equal(isAnalyticsPath('/analytics'), false);
  assert.equal(isAnalyticsPath('/admin/analytics?range=day'), true);
});

await check('normalizes malformed metrics without leaking fields', () => {
  const snapshot = normalizeAnalyticsSnapshot({
    metrics: {
      'active-rounds': { value: '2', privateChat: 'secret' },
      'unknown': { value: 99 },
    },
  });
  assert.equal(snapshot.metrics['active-rounds'].value, 2);
  assert.equal(snapshot.metrics['active-rounds'].privateChat, undefined);
  assert.equal(snapshot.metrics.unknown, undefined);
});

await check('reads gauge and counter values consistently', () => {
  assert.equal(metricValue({ value: 4, last: 2 }), 4);
  assert.equal(metricValue({ last: 3, total: 7 }), 3);
  assert.equal(metricValue(null), 0);
});

await check('normalizes versioned aggregate snapshots without raw identity fields', () => {
  const snapshot = normalizeAnalyticsSnapshot({
    schemaVersion: 1,
    filters: { range: 'day', seasonId: 'season-01', accountId: 'do-not-keep' },
    overview: { kpis: [{ id: 'completed-rounds', value: 8, denominator: 10, accountId: 'raw' }] },
    breakdowns: [{ pseudonymId: 'P-ABC', observations: 5, displayName: 'Ada', username: 'ada', accountId: 'raw' }],
    dataQuality: { stale: false }
  });
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.overview.kpis[0].value, 8);
  assert.equal(snapshot.breakdowns[0].pseudonymId, 'P-ABC');
  assert.equal(serialized.includes('Ada'), false);
  assert.equal(serialized.includes('accountId'), false);
});

await check('normalizes filters to fixed allow-lists and minimum cohort', () => {
  const query = normalizeAnalyticsQuery({ range: 'season', boardVariant: 'METRO-52', botMode: 'AI', minimumCohort: 1, accountId: 'raw' });
  assert.deepEqual(query, { range: 'season', seasonId: '', rulesetRevision: '', balanceRevision: '', boardVariant: 'metro-52', rulesetPreset: 'all', marketComplexity: 'all', botMode: 'ai', eventId: '', minimumCohort: 5, tab: 'overview' });
  assert.equal(normalizeAnalyticsQuery({ rulesetRevision: 'abc', balanceRevision: 'NaN' }).rulesetRevision, '');
});

await check('retains version dimensions and strips unknown aggregate fields', () => {
  const snapshot = normalizeAnalyticsSnapshot({ schemaVersion: 1, pseudonymVersion: 'hmac-v1', seasonId: 's', rulesetRevision: 2, balanceRevision: 3, boardVariant: 'metro-52', overview: { unknownField: 'drop', kpis: [] } });
  assert.equal(snapshot.pseudonymVersion, 'hmac-v1');
  assert.equal(snapshot.seasonId, 's');
  assert.equal(snapshot.rulesetRevision, 2);
  assert.equal(snapshot.overview.unknownField, undefined);
});

await check('chart hook keeps an accessible table fallback and bounded points', () => {
  const fallback = renderAnalyticsChart(null, Array.from({ length: 200 }, (_, index) => ({ label: `<${index}>`, value: index })), { title: 'Completion', unit: 'rounds', mode: 'bar' });
  assert.equal(fallback.values.length, 168);
  assert.equal(fallback.table, true);
});

await check('controller suppresses duplicate loads and exposes tab/filter hooks', async () => {
  let calls = 0;
  const controller = createAnalyticsController({ fetcher: async () => { calls += 1; return { success: true, schemaVersion: 1, overview: { kpis: [] } }; } });
  const first = controller.load({ range: 'day' });
  const second = controller.load({ range: 'day' });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(controller.setTab('economy').tab, 'economy');
  assert.equal(controller.setFilters({ botMode: 'AI' }).botMode, 'ai');
  controller.destroy();
});
