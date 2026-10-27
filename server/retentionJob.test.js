import assert from 'node:assert/strict';
import { createRetentionJob } from './retentionJob.js';

let calls = 0;
const job = createRetentionJob({
  now: () => Date.parse('2026-09-17T12:00:00.000Z'),
  deletionCoordinator: { runDue: async () => ({ processed: 2, succeeded: 2, failed: 0 }) },
  analyticsRollupStore: { prune: () => { calls += 1; return 4; } },
  backupStore: { pruneByAge: () => { calls += 1; return 3; } },
});
const result = await job.runOnce();
assert.deepEqual(result, { deletions: { processed: 2, succeeded: 2, failed: 0 }, analyticsPruned: 4, backupsPruned: 3, telemetryPruned: 0, failures: 0 });
assert.equal(calls, 2);

// N11a: Node clamps a delay above 2^31-1 ms to 1 ms, so a long configured
// interval would otherwise become a hot loop instead of a daily job.
{
  const MAX_TIMER_MS = 2 ** 31 - 1;
  const realSetInterval = globalThis.setInterval;
  const delays = [];
  globalThis.setInterval = (_callback, delay) => { delays.push(delay); return { unref() {} }; };
  try {
    createRetentionJob({ intervalMs: 30 * 24 * 60 * 60 * 1000 }).start();
    createRetentionJob({ intervalMs: 5_000 }).start();
  } finally {
    globalThis.setInterval = realSetInterval;
  }
  assert.equal(delays[0], MAX_TIMER_MS, 'an interval over the timer maximum is clamped, not left to become a 1 ms loop');
  assert.equal(delays[1], 60_000, 'below the floor it still runs at the one minute minimum');
}

// N11b: a quiet retention run must persist its prune, not leave it in memory.
{
  let pruneOptions = null;
  const job = createRetentionJob({
    now: () => Date.parse('2026-09-17T12:00:00.000Z'),
    analyticsRollupStore: { prune: (options) => { pruneOptions = options; return 0; } },
  });
  await job.runOnce();
  assert.equal(pruneOptions.flush, true, 'the retention run asks the store to flush the prune');
}

// N11d: an overlapping run answers with the same shape as a completed run.
{
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const job = createRetentionJob({
    now: () => Date.parse('2026-09-17T12:00:00.000Z'),
    deletionCoordinator: { runDue: () => gate.then(() => ({ processed: 0, succeeded: 0, failed: 0 })) },
  });
  const first = job.runOnce();
  const overlapping = await job.runOnce();
  release();
  const finished = await first;
  assert.equal(overlapping.skipped, true);
  assert.deepEqual(Object.keys(overlapping).sort(), [...Object.keys(finished), 'skipped'].sort(), 'both results expose the same counters');
  assert.equal(overlapping.telemetryPruned, 0);
}

// S12-M4: an empty, zero or non-numeric retention setting means "default", not
// "delete everything older than now".
{
  const DAY = 24 * 60 * 60 * 1000;
  const at = Date.parse('2026-09-17T12:00:00.000Z');
  const cutoffs = [];
  const run = async (analyticsRetentionMs, backupRetentionMs) => {
    const seen = {};
    await createRetentionJob({
      now: () => at,
      analyticsRollupStore: { prune: ({ olderThan }) => { seen.analytics = at - olderThan; return 0; } },
      backupStore: { pruneByAge: ({ olderThan }) => { seen.backups = at - olderThan; return 0; } },
      analyticsRetentionMs,
      backupRetentionMs,
    }).runOnce();
    cutoffs.push(seen);
    return seen;
  };
  for (const bad of ['', '0', '-5', 'abc', 0, 60_000]) {
    const seen = await run(bad, bad);
    assert.equal(seen.analytics, 365 * DAY, `analytics retention ${JSON.stringify(bad)} falls back to the default`);
    assert.equal(seen.backups, 30 * DAY, `backup retention ${JSON.stringify(bad)} falls back to the default`);
  }
  const honoured = await run(String(90 * DAY), String(45 * DAY));
  assert.equal(honoured.analytics, 90 * DAY);
  assert.equal(honoured.backups, 45 * DAY);
}

// S12-L3: one failing step does not skip the rest, and the failure is counted.
{
  const originalError = console.error;
  console.error = () => {};
  let ran = [];
  try {
    const job = createRetentionJob({
      now: () => Date.parse('2026-09-17T12:00:00.000Z'),
      deletionCoordinator: { runDue: async () => ({ processed: 1, succeeded: 1, failed: 0 }) },
      recovery: { prune: () => { throw new Error('recovery file locked'); } },
      analyticsRollupStore: { prune: () => { ran.push('analytics'); throw new Error('analytics busy'); } },
      backupStore: { pruneByAge: () => { ran.push('backups'); return 2; } },
      telemetryStore: { prune: () => { ran.push('telemetry'); return 5; } },
    });
    const outcome = await job.runOnce();
    assert.deepEqual(ran, ['analytics', 'backups', 'telemetry'], 'later steps still run');
    assert.equal(outcome.backupsPruned, 2);
    assert.equal(outcome.telemetryPruned, 5);
    assert.equal(outcome.failures, 2, 'both failed steps are counted');
    assert.ok(job.status().lastRunAt === null || typeof job.status().lastRunAt === 'string');
  } finally {
    console.error = originalError;
  }
}
console.log('retention job: 4 passed, 0 failed');
