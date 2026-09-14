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

await check('keeps omitted revisions unfiltered and retains event/bot/provider dimensions', () => {
  const store = createAnalyticsRollupStore({ now: () => clock });
  const base = { createdAt: new Date(clock).toISOString(), seasonId: 'season-01', rulesetRevision: 1, balanceRevision: 2, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic' };
  assert.equal(store.record({ ...base, kind: 'event-eligible', eventId: 'event-a', botMode: 'ai', provider: 'deepseek', data: {} }).accepted, true);
  assert.equal(Object.keys(store.query({}).dimensions).length, 1);
  assert.equal(Object.keys(store.query({ eventId: 'event-a' }).dimensions).length, 1);
  const dimension = Object.values(store.query({}).dimensions)[0];
  assert.equal(dimension.eventId, 'event-a');
  assert.equal(dimension.botMode, 'ai');
  assert.equal(dimension.provider, 'deepseek');
  store.close();
});

await check('does not double count a started match and never accepts fake actor pseudonyms', () => {
  const store = createAnalyticsRollupStore({ now: () => clock });
  const base = { createdAt: new Date(clock).toISOString(), seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic' };
  store.record({ ...base, kind: 'match-start', data: {} });
  store.record({ ...base, kind: 'match-complete', accountId: 'acct-raw', pseudonymId: 'P-FAKE', data: { durationSeconds: 60, botOnly: false } });
  const result = store.query({});
  const dimension = Object.values(result.dimensions)[0];
  assert.equal(dimension.started, 1);
  assert.equal(dimension.completed, 1);
  assert.equal(Object.keys(result.actorRollups).length, 0);
  store.close();
});

await check('bounds dimensions per bucket', () => {
  const store = createAnalyticsRollupStore({ now: () => clock, maxDimensionsPerBucket: 3 });
  for (let index = 0; index < 10; index += 1) store.record({ kind: 'event-eligible', createdAt: new Date(clock).toISOString(), eventId: `event-${index}`, boardVariant: 'standard-40', data: {} });
  assert.equal(Object.keys(store.query({}).dimensions).length <= 3, true);
  assert.equal(store.health().rejectedEvents >= 7, true);
  store.close();
});

await check('keeps writes recorded during an async flush pending for retry', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createAnalyticsRollupStore({ now: () => clock, persist: async () => gate });
  const base = { kind: 'match-complete', createdAt: new Date(clock).toISOString(), data: { durationSeconds: 1 } };
  store.record(base);
  const pendingFlush = store.flush();
  store.record({ ...base, data: { durationSeconds: 2 } });
  release();
  await pendingFlush;
  assert.equal(store.health().pendingWrites, 1);
  store.close();
});
