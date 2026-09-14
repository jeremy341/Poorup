import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAnalyticsRollupStore } from './analyticsRollupStore.js';

async function check(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-analytics-rollup-'));
let clock = Date.parse('2026-09-13T12:34:00.000Z');
const event = (overrides = {}) => ({
  kind: 'match-complete',
  createdAt: new Date(clock).toISOString(),
  seasonId: 'season-01', rulesetRevision: 1, balanceRevision: 2,
  boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic',
  data: { durationSeconds: 120, botOnly: false, ...overrides }
});

await check('merges events into bounded hourly dimensions', () => {
  const store = createAnalyticsRollupStore({ filePath: path.join(root, 'rollup.json'), now: () => clock });
  assert.equal(store.record(event()).accepted, true);
  assert.equal(store.record(event({ durationSeconds: 240 })).accepted, true);
  const result = store.query({ seasonId: 'season-01', boardVariant: 'standard-40' });
  const dimension = Object.values(result.dimensions)[0];
  assert.equal(dimension.completed, 2);
  assert.equal(dimension.durationSeconds.count, 2);
  assert.equal(result.schemaVersion, 1);
  store.close();
});

await check('rejects unknown kinds and dimensions without mutating state', () => {
  const store = createAnalyticsRollupStore({ now: () => clock });
  assert.equal(store.record({ ...event(), kind: 'raw-export' }).accepted, false);
  assert.equal(store.record({ ...event(), unknownDimension: 'x' }).accepted, false);
  assert.equal(Object.keys(store.query({}).dimensions).length, 0);
  store.close();
});

await check('prunes old buckets and retries failed persistence', async () => {
  let persistCalls = 0;
  let fail = true;
  const store = createAnalyticsRollupStore({
    now: () => clock,
    retentionDays: 1,
    persist: () => { persistCalls += 1; if (fail) throw new Error('disk busy'); }
  });
  store.record(event());
  await assert.rejects(() => store.flush(), /disk busy/);
  assert.equal(store.health().pendingWrites > 0, true);
  fail = false;
  await store.flush();
  assert.equal(persistCalls, 2);
  clock += 3 * 86400000;
  store.record(event());
  assert.equal(Object.keys(store.query({}).dimensions).length, 1);
  store.close();
});

await check('retains no raw identity fields in rollup serialization', () => {
  const store = createAnalyticsRollupStore({ now: () => clock });
  assert.equal(store.record({ ...event(), data: { accountId: 'acct-raw', displayName: 'Ada', durationSeconds: 10 } }).accepted, true);
  assert.equal(JSON.stringify(store.query({}).dimensions).includes('acct-raw'), false);
  assert.equal(JSON.stringify(store.query({}).dimensions).includes('Ada'), false);
  store.close();
});

fs.rmSync(root, { recursive: true, force: true });
