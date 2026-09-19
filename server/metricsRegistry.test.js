import assert from 'node:assert/strict';
import { createMetricsRegistry } from './metricsRegistry.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

check('records only bounded metric names and values', () => {
  const metrics = createMetricsRegistry({ now: () => 1000 });
  metrics.setMetric('active-sockets', 1, { scope: 'all' });
  metrics.recordMetric('action-latency-ms', 120, { phase: 'roll' });
  metrics.recordMetric('unknown-private-chat', 1, { text: 'secret' });
  const snapshot = metrics.snapshotMetrics('hour');
  assert.equal(snapshot.range, 'hour');
  assert.equal(snapshot.metrics['active-sockets'].value, 1);
  assert.equal(snapshot.metrics['action-latency-ms'].last, 120);
  assert.equal(snapshot.metrics['unknown-private-chat'], undefined);
});

check('sets gauges without retaining unbounded history', () => {
  const metrics = createMetricsRegistry({ maxMetrics: 3, now: () => 2000 });
  metrics.setMetric('active-rooms', 4);
  metrics.setMetric('active-rounds', 2);
  metrics.setMetric('active-sockets', 8);
  metrics.setMetric('extra', 99);
  const snapshot = metrics.snapshotMetrics();
  assert.equal(snapshot.metrics['active-rooms'].value, 4);
  assert.equal(snapshot.metrics['active-rounds'].value, 2);
  assert.equal(Object.keys(snapshot.metrics).length, 3);
  assert.equal(snapshot.metrics.extra, undefined);
});

check('keeps per-label breakdowns instead of merging', () => {
  const metrics = createMetricsRegistry({ now: () => 4000 });
  metrics.recordMetric('error-count', 1, { phase: 'roll' });
  metrics.recordMetric('error-count', 1, { phase: 'build' });
  const entry = metrics.snapshotMetrics().metrics['error-count'];
  assert.equal(entry.count, 2);
  assert.equal(entry.byLabels['{"phase":"roll"}'].count, 1);
  assert.equal(entry.byLabels['{"phase":"build"}'].count, 1);
});

check('redacts private-looking labels and clamps values', () => {
  const metrics = createMetricsRegistry({ now: () => 3000 });
  metrics.recordMetric('error-count', Number.POSITIVE_INFINITY, {
    chat: 'hidden message',
    accountId: 'private-account',
    phase: 'x'.repeat(100),
  });
  const entry = metrics.snapshotMetrics().metrics['error-count'];
  assert.equal(entry.last, 0);
  assert.deepEqual(entry.labels, { phase: 'x'.repeat(40) });
});
