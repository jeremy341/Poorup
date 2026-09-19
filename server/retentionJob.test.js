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
console.log('retention job: 4 passed, 0 failed');
