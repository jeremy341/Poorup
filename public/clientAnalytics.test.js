/* global process */
import assert from 'node:assert/strict';

globalThis.window = { matchMedia: () => ({ matches: false }), location: { pathname: '/' } };
globalThis.document = { querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { normalizeAnalyticsSnapshot, metricValue, isAnalyticsPath } = await import('./clientAnalytics.js');

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

check('accepts only the internal analytics path', () => {
  assert.equal(isAnalyticsPath('/admin/analytics'), true);
  assert.equal(isAnalyticsPath('/analytics'), false);
  assert.equal(isAnalyticsPath('/admin/analytics?range=day'), true);
});

check('normalizes malformed metrics without leaking fields', () => {
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

check('reads gauge and counter values consistently', () => {
  assert.equal(metricValue({ value: 4, last: 2 }), 4);
  assert.equal(metricValue({ last: 3, total: 7 }), 3);
  assert.equal(metricValue(null), 0);
});
