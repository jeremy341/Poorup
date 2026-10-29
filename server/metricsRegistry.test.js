import assert from 'node:assert/strict';
import { createMetricsRegistry, instrumentHandler, METRIC_TYPES, MIN_PERCENTILE_SAMPLES, summarizeRuntimeMetrics } from './metricsRegistry.js';

async function check(name, run) {
  try {
    await run();
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

check('no longer allows the retired manual-codescene-runs metric but keeps handshake rejections', () => {
  const metrics = createMetricsRegistry({ now: () => 1000 });
  assert.equal(metrics.recordMetric('manual-codescene-runs', 1), null);
  assert.equal(metrics.incrementMetric('socket-admission-rejections', { scope: 'handshake' }).count, 1);
  assert.equal(Object.hasOwn(METRIC_TYPES, 'manual-codescene-runs'), false);
});

check('snapshots accept the month range and map season to it', () => {
  const metrics = createMetricsRegistry({ now: () => 1000 });
  assert.equal(metrics.snapshotMetrics('month').range, 'month');
  assert.equal(metrics.snapshotMetrics('season').range, 'month');
  assert.equal(metrics.snapshotMetrics('year').range, 'hour');
});

check('reports a latency percentile only from recorded samples', () => {
  const metrics = createMetricsRegistry({ now: () => 1000 });
  assert.deepEqual(metrics.quantile('action-latency-ms', 0.95), { value: null, sampleSize: 0 });
  for (let value = 1; value <= 100; value += 1) metrics.recordMetric('action-latency-ms', value, { scope: 'socket' });
  assert.deepEqual(metrics.quantile('action-latency-ms', 0.95), { value: 95, sampleSize: 100 });
  // The ring is bounded: only the newest 1024 values are kept.
  for (let value = 0; value < 2000; value += 1) metrics.recordMetric('action-latency-ms', 7, { scope: 'socket' });
  assert.deepEqual(metrics.quantile('action-latency-ms', 0.5), { value: 7, sampleSize: 1024 });
  // Other counters never grow a sample ring.
  metrics.incrementMetric('error-count');
  assert.equal(metrics.quantile('error-count', 0.95).sampleSize, 0);
  metrics.reset();
  assert.equal(metrics.quantile('action-latency-ms', 0.95).sampleSize, 0);
});

check('keeps the connection peak for 24 hourly bins and then forgets it', () => {
  let clock = Date.parse('2026-09-13T10:30:00.000Z');
  const metrics = createMetricsRegistry({ now: () => clock });
  assert.equal(metrics.peak('active-sockets'), null);
  metrics.setMetric('active-sockets', 4);
  metrics.setMetric('active-sockets', 9);
  metrics.setMetric('active-sockets', 2);
  assert.equal(metrics.peak('active-sockets'), 9);
  clock += 23 * 3_600_000;
  metrics.setMetric('active-sockets', 3);
  assert.equal(metrics.peak('active-sockets'), 9);
  clock += 2 * 3_600_000;
  assert.equal(metrics.peak('active-sockets'), 3);
  // Gauges outside the peak list keep no history.
  metrics.setMetric('active-rooms', 5);
  assert.equal(metrics.peak('active-rooms'), null);
});

await check('instrumentHandler times calls, counts throws and preserves results', async () => {
  let tick = 0;
  const metrics = createMetricsRegistry({ now: () => 1000 });
  const clock = () => { tick += 5; return tick; };
  const ok = instrumentHandler(metrics, (a, b) => a + b, clock);
  assert.equal(ok(2, 3), 5);
  const boom = instrumentHandler(metrics, () => { throw new Error('sync'); }, clock);
  assert.throws(() => boom(), /sync/);
  const later = instrumentHandler(metrics, async () => 'done', clock);
  assert.equal(await later(), 'done');
  const rejected = instrumentHandler(metrics, async () => { throw new Error('async'); }, clock);
  await assert.rejects(() => rejected(), /async/);
  const snapshot = metrics.snapshotMetrics('hour').metrics;
  assert.equal(snapshot['action-latency-ms'].count, 4);
  assert.equal(snapshot['error-count'].count, 2);
  assert.equal(metrics.quantile('action-latency-ms', 0.95).sampleSize, 4);
});

// Status reads restoreFailures from the registry. The server initialises the counter at boot, so Status
// must say zero rather than "not recorded" until a restore actually fails.
check('restore-failures reads zero after boot and counts real failures', () => {
  const metrics = createMetricsRegistry({ now: () => 1000 });
  metrics.initializeCounter('restore-failures', { source: 'room-session' });
  assert.equal(summarizeRuntimeMetrics(metrics).restoreFailures, 0);
  metrics.incrementMetric('restore-failures', { source: 'room-session' });
  assert.equal(summarizeRuntimeMetrics(metrics).restoreFailures, 1);
});

check('summarizes runtime numbers and keeps unknowns null', () => {
  const empty = createMetricsRegistry({ now: () => 1000 });
  const blank = summarizeRuntimeMetrics(empty);
  assert.equal(blank.activeSockets, null);
  assert.equal(blank.restoreFailures, null);
  assert.equal(blank.latencyP95Ms, null);
  assert.equal(blank.errorCount, 0);
  assert.equal(summarizeRuntimeMetrics(null), null);
  const metrics = createMetricsRegistry({ now: () => 1000 });
  metrics.setMetric('active-sockets', 6);
  for (let index = 0; index < MIN_PERCENTILE_SAMPLES - 1; index += 1) metrics.recordMetric('action-latency-ms', 10);
  assert.equal(summarizeRuntimeMetrics(metrics).latencyP95Ms, null);
  metrics.recordMetric('action-latency-ms', 10);
  metrics.incrementMetric('error-count');
  const summary = summarizeRuntimeMetrics(metrics);
  assert.equal(summary.latencyP95Ms, 10);
  assert.equal(summary.actionCount, MIN_PERCENTILE_SAMPLES);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.activeSockets, 6);
  assert.equal(summary.peakSockets24h, 6);
});

check('N11c: HTTP failures are counted apart from socket action failures', () => {
  const metrics = createMetricsRegistry({ now: () => 1000 });
  for (let index = 0; index < 20; index += 1) metrics.recordMetric('action-latency-ms', 10, { scope: 'socket' });
  metrics.incrementMetric('error-count', { source: 'socket' });
  metrics.incrementMetric('error-count', { source: 'http' });
  metrics.incrementMetric('error-count', { source: 'http' });
  const summary = summarizeRuntimeMetrics(metrics);
  assert.equal(summary.actionCount, 20);
  assert.equal(summary.socketErrorCount, 1, 'a failed HTTP request is not a failed player action');
  assert.equal(summary.httpErrorCount, 2);
  assert.equal(summary.errorCount, 3, 'the unfiltered total is still visible');
});

check('reconnect and bot-fallback counters read null until the first event, then count', () => {
  const metrics = createMetricsRegistry({ now: () => 1000 });
  assert.equal(summarizeRuntimeMetrics(metrics).roomReconnects, null);
  assert.equal(summarizeRuntimeMetrics(metrics).botFallbacks, null);
  metrics.incrementMetric('room-reconnects', { scope: 'seat' });
  metrics.incrementMetric('room-reconnects', { scope: 'seat' });
  metrics.incrementMetric('bot-fallbacks', { scope: 'ai' });
  const summary = summarizeRuntimeMetrics(metrics);
  assert.equal(summary.roomReconnects, 2);
  assert.equal(summary.botFallbacks, 1);
  assert.equal(METRIC_TYPES['room-reconnects'], 'counter');
  assert.equal(METRIC_TYPES['bot-fallbacks'], 'counter');
});
