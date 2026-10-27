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

await check('aggregates airport flight counts, fares and fare basis', () => {
  const store = createAnalyticsRollupStore({ now: () => clock });
  const createdAt = new Date(clock).toISOString();
  const base = { kind: 'airport-flight', createdAt, seasonId: 'season-01', rulesetRevision: 1, balanceRevision: 2, boardVariant: 'standard-40', data: {} };
  assert.equal(store.record({ ...base, data: { fare: 100, basis: 'default' } }).accepted, true);
  assert.equal(store.record({ ...base, data: { fare: 130, basis: 'arrival' } }).accepted, true);
  const dimension = Object.values(store.query({}).dimensions)[0];
  assert.deepEqual(dimension.airportFlights, {
    count: 2,
    fareTotal: 230,
    byBasis: { default: 1, arrival: 1, departure: 0 },
  });
  store.close();
});

await check('adds airport counters to existing schema-v1 dimensions', async () => {
  const filePath = path.join(root, 'legacy-airport-rollup.json');
  const original = createAnalyticsRollupStore({ filePath, now: () => clock });
  assert.equal(original.record(event()).accepted, true);
  await original.flush();
  await original.close();
  const legacy = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  Object.values(legacy.buckets).forEach(bucket => Object.values(bucket.dimensions).forEach(dimension => { delete dimension.airportFlights; }));
  fs.writeFileSync(filePath, JSON.stringify(legacy));

  const reopened = createAnalyticsRollupStore({ filePath, now: () => clock });
  const airportEvent = { ...event(), kind: 'airport-flight', data: { fare: 100, basis: 'arrival' } };
  assert.equal(reopened.record(airportEvent).accepted, true, 'an existing dimension remains writable after upgrade');
  await reopened.flush();
  const dimension = Object.values(reopened.query({}).dimensions)[0];
  assert.deepEqual(dimension.airportFlights, { count: 1, fareTotal: 100, byBasis: { default: 0, arrival: 1, departure: 0 } });
  await reopened.close();
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

await check('persists a prune when the caller asks it to flush', async () => {
  let storeClock = Date.parse('2026-09-13T12:34:00.000Z');
  const writes = [];
  const store = createAnalyticsRollupStore({
    now: () => storeClock,
    retentionDays: 1,
    persist: snapshot => { writes.push(snapshot); }
  });
  store.record({ ...event(), createdAt: new Date(storeClock).toISOString() });
  await store.flush();
  writes.length = 0;
  storeClock += 3 * 86400000;
  const removed = await store.prune({ flush: true });
  assert.equal(removed, 1);
  assert.equal(writes.length, 1, 'the quiet prune is written out without another record');
  assert.deepEqual(writes[0].buckets, {});
  assert.equal(store.health().pendingWrites, 0);
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

await check('validates versions and bounds nested rollup maps', () => {
  const store = createAnalyticsRollupStore({ now: () => clock, maxFeaturesPerDimension: 2, maxCombinationsPerEvent: 2 });
  assert.equal(store.record({ kind: 'match-complete', createdAt: new Date(clock).toISOString(), boardVariant: 'invalid-board', data: {} }).accepted, false);
  for (let index = 0; index < 10; index += 1) store.record({ kind: 'event-recovered', createdAt: new Date(clock).toISOString(), eventId: 'event-a', data: { combination: `combo-${index}` } });
  const event = Object.values(store.query({}).dimensions)[0]?.events?.['event-a'];
  assert.equal(Object.keys(event.combinations).length <= 2, true);
  store.close();
});

await check('keeps 30 days of hourly history by default and answers the month window', () => {
  const origin = Date.parse('2026-09-13T12:00:00.000Z');
  const store = createAnalyticsRollupStore({ now: () => origin });
  const startAt = hoursAgo => ({ kind: 'match-start', createdAt: new Date(origin - hoursAgo * 3_600_000).toISOString(), data: {} });
  // One start every day for 35 days, oldest first.
  for (let day = 35; day >= 0; day -= 1) store.record(startAt(day * 24 + 1));
  const total = range => Object.values(store.query({ range }).dimensions).reduce((sum, dimension) => sum + dimension.started, 0);
  assert.equal(total('day'), 1);
  assert.equal(total('week'), 7);
  assert.equal(total('month'), 30);
  // 'season' is the retired alias for the same 30 days.
  assert.equal(total('season'), 30);
  // The default bucket limit holds a full month plus slack, so nothing inside 30 days was pruned.
  assert.equal(store.query({ range: 'month' }).series.length, 30);
});

await check('returns an hourly activity series and the oldest stored hour', () => {
  const origin = Date.parse('2026-09-13T12:30:00.000Z');
  const store = createAnalyticsRollupStore({ now: () => origin });
  const entry = (hoursAgo, kind, dims = {}) => ({ kind, createdAt: new Date(origin - hoursAgo * 3_600_000).toISOString(), ...dims, data: {} });
  store.record(entry(5, 'match-start'));
  store.record(entry(2, 'match-start'));
  store.record(entry(2, 'match-complete'));
  store.record(entry(2, 'match-stalled', { rulesetPreset: 'custom' }));
  const result = store.query({ range: 'day' });
  assert.equal(result.series.length, 2);
  assert.deepEqual(result.series.map(point => point.at), ['2026-09-13T07:00:00.000Z', '2026-09-13T10:00:00.000Z']);
  assert.deepEqual(result.series[1], { at: '2026-09-13T10:00:00.000Z', started: 2, completed: 1, stalled: 1 });
  assert.equal(result.quality.oldestAt, '2026-09-13T07:00:00.000Z');
  // Series honour the same dimension filters as the totals.
  const custom = store.query({ range: 'day', rulesetPreset: 'custom' });
  assert.deepEqual(custom.series.map(point => point.stalled), [1]);
  assert.equal(createAnalyticsRollupStore({ now: () => origin }).query({}).quality.oldestAt, null);
});

const sumStarted = result => Object.values(result.dimensions).reduce((sum, dimension) => sum + dimension.started, 0);

await check('S15-01: distinct bot action ids do not each take a dimension slot', () => {
  const store = createAnalyticsRollupStore({ now: () => clock, maxDimensionsPerBucket: 8 });
  for (let index = 0; index < 40; index += 1) {
    const result = store.record({ kind: 'bot-outcome', createdAt: new Date(clock).toISOString(), botMode: 'ai', provider: 'ai', actionId: `buy:${index}`, data: { decisions: 1 } });
    assert.equal(result.accepted, true, `action ${index} is accepted`);
  }
  assert.equal(Object.keys(store.query({}).dimensions).length, 1, 'one bot row, not one per action');
  assert.equal(store.record({ kind: 'match-start', createdAt: new Date(clock).toISOString(), rulesetPreset: 'after-hours', data: {} }).accepted, true, 'a new preset still gets a slot');
  const bots = Object.values(store.query({}).dimensions).find(dimension => dimension.bots['ai|ai']).bots['ai|ai'];
  assert.equal(Object.keys(bots.actions).length, 40, 'the budgeted action map still counts every action');
  assert.equal(store.health().rejectedEvents, 0);
  store.close();
});

await check('S15-02: the window includes the partial hour at its start', () => {
  const origin = Date.parse('2026-09-13T10:10:00.000Z');
  const store = createAnalyticsRollupStore({ now: () => origin });
  const at = iso => ({ kind: 'match-start', createdAt: iso, data: {} });
  store.record(at('2026-09-13T09:40:00.000Z'));
  store.record(at('2026-09-13T10:05:00.000Z'));
  store.record(at('2026-09-12T10:30:00.000Z'));
  store.record(at('2026-09-12T09:50:00.000Z'));
  assert.equal(sumStarted(store.query({ range: 'hour' })), 2, 'both starts of the last hour are counted');
  assert.equal(sumStarted(store.query({ range: 'day' })), 3, 'the 23h40 event is in the last day; the 24h20 event is not');
  store.close();
});

await check('S15-04: prototype-like names are counted as ordinary keys', () => {
  const store = createAnalyticsRollupStore({ now: () => clock });
  const stamp = new Date(clock).toISOString();
  try {
    store.record({ kind: 'match-complete', createdAt: stamp, data: { feature: '__proto__', used: true } });
    store.record({ kind: 'match-complete', createdAt: stamp, data: { feature: 'constructor', used: true } });
    store.record({ kind: 'event-triggered', createdAt: stamp, eventId: '__proto__', data: {} });
    store.record({ kind: 'event-triggered', createdAt: stamp, eventId: 'toString', data: { combination: 'constructor' } });
    store.record({ kind: 'match-complete', createdAt: stamp, data: { outcome: 'constructor' } });
    assert.equal(Object.prototype.eligible, undefined, 'Object.prototype is untouched');
    assert.equal(Object.prototype.used, undefined);
    assert.equal(Object.prototype.active, undefined);
    const merged = Object.values(store.query({}).dimensions);
    const features = Object.assign({}, ...merged.map(dimension => dimension.features));
    assert.equal(features.constructor.observations, 1, 'constructor is a normal feature name');
    const outcomes = Object.assign({}, ...merged.map(dimension => dimension.outcomes));
    assert.equal(outcomes.constructor, 1, 'an outcome named constructor counts as a number');
  } finally {
    ['eligible', 'used', 'observations', 'active', 'warnings', 'choices', 'voters', 'recovered', 'durationSeconds', 'combinations'].forEach(name => { delete Object.prototype[name]; });
  }
  store.close();
});

await check('S15-06: a full actor table does not drop the aggregate counters', async () => {
  const { createPseudonymizer } = await import('./analyticsPrivacy.js');
  const store = createAnalyticsRollupStore({ now: () => clock, maxActorsPerBucket: 1, pseudonymizer: createPseudonymizer({ key: 'actor-cap-test-key-0123456789' }) });
  const stamp = new Date(clock).toISOString();
  assert.equal(store.record({ kind: 'match-complete', createdAt: stamp, accountId: 'acct-1', data: { botOnly: false } }).accepted, true);
  assert.equal(store.record({ kind: 'match-complete', createdAt: stamp, accountId: 'acct-2', data: { botOnly: false } }).accepted, true, 'the second account still counts in the aggregate');
  const result = store.query({});
  assert.equal(Object.values(result.dimensions)[0].completed, 2);
  assert.equal(Object.keys(result.actorRollups).length, 1, 'only one actor row fits');
  store.close();
});

await check('S15-07: event times are validated and the caller\'s Date is left alone', () => {
  const store = createAnalyticsRollupStore({ now: () => clock });
  const created = new Date('2026-09-13T12:34:56.789Z');
  assert.equal(store.record({ kind: 'match-start', createdAt: created, data: {} }).accepted, true);
  assert.equal(created.toISOString(), '2026-09-13T12:34:56.789Z', 'the Date passed in is not rounded to the hour');
  assert.equal(store.record({ kind: 'match-start', createdAt: 'garbage', data: {} }).accepted, false, 'an unparseable time is rejected, not filed under 1970');
  assert.equal(store.record({ kind: 'match-start', createdAt: '9999-01-01T00:00:00.000Z', data: {} }).accepted, false, 'a far-future time cannot pin freshness');
  store.record({ kind: 'match-start', createdAt: new Date(created.getTime() - 3 * 3_600_000).toISOString(), data: {} });
  assert.equal(store.query({}).quality.latestAt, '2026-09-13T12:34:56.789Z', 'a back-dated event does not move latestAt backwards');
  store.close();
});

await check('S15-08: a schema mismatch is quarantined and damaged buckets are dropped', () => {
  const schemaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-analytics-schema-'));
  const mismatched = path.join(schemaRoot, 'schema-mismatch.json');
  const original = JSON.stringify({ schemaVersion: 99, buckets: { '2026-09-13T12:00:00.000Z': { dimensions: {}, actorRollups: {} } } });
  fs.writeFileSync(mismatched, original);
  const store = createAnalyticsRollupStore({ filePath: mismatched, now: () => clock });
  assert.equal(Object.keys(store.query({}).dimensions).length, 0);
  const kept = fs.readdirSync(schemaRoot).filter(name => name.startsWith('schema-mismatch.json.corrupt-'));
  assert.equal(kept.length, 1, 'the unreadable-schema bytes are kept beside the store');
  assert.equal(fs.readFileSync(path.join(schemaRoot, kept[0]), 'utf8'), original);
  store.close();

  const damaged = path.join(schemaRoot, 'damaged.json');
  fs.writeFileSync(damaged, JSON.stringify({ schemaVersion: 1, buckets: { '2026-09-13T12:00:00.000Z': null, '2026-09-13T11:00:00.000Z': 'x' } }));
  const damagedStore = createAnalyticsRollupStore({ filePath: damaged, now: () => clock });
  assert.doesNotThrow(() => damagedStore.query({}), 'a damaged bucket does not break every query');
  damagedStore.close();
  fs.rmSync(schemaRoot, { recursive: true, force: true });
});

await check('N12: non-object dimension and actor entries are skipped by queries', () => {
  const damagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-analytics-entries-'));
  const damaged = path.join(damagedRoot, 'damaged-entries.json');
  const bucket = {
    dimensions: {
      's|1|1|standard-40|classic|basic': { seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic', started: 2, completed: 1 },
      nullDimension: null,
      textDimension: 'not-a-dimension',
      arrayDimension: [1, 2]
    },
    actorRollups: {
      'P-1|s|1|1|standard-40|classic|basic': { pseudonymId: 'P-1', observations: 1, completed: 0, wins: 0, scope: { seasonId: 's', rulesetRevision: 1, balanceRevision: 1, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic' } },
      nullActor: null,
      textActor: 'not-an-actor'
    }
  };
  fs.writeFileSync(damaged, JSON.stringify({ schemaVersion: 1, buckets: { '2026-09-13T12:00:00.000Z': bucket } }));
  const store = createAnalyticsRollupStore({ filePath: damaged, now: () => clock });
  let result;
  assert.doesNotThrow(() => { result = store.query({ boardVariant: 'standard-40' }); }, 'a damaged entry does not break every query');
  assert.equal(Object.keys(result.dimensions).length, 1, 'only the object dimension is counted');
  assert.equal(result.dimensions['s|1|1|standard-40|classic|basic'].started, 2);
  assert.equal(Object.keys(result.actorRollups).length, 1, 'only the object actor is counted');
  store.close();
  fs.rmSync(damagedRoot, { recursive: true, force: true });
});

await check('reports an empty store as empty rather than only not fresh, and stops once a match is recorded', () => {
  const store = createAnalyticsRollupStore({ now: () => clock });
  assert.deepEqual([store.health().loaded, store.health().empty, store.health().fresh], [true, true, false]);
  assert.equal(store.query({}).quality.empty, true);
  store.record(event());
  assert.deepEqual([store.health().empty, store.health().fresh], [false, true]);
  assert.equal(store.query({}).quality.empty, false);
  // A store that has data but has gone quiet is stale, not empty.
  clock += 3 * 3_600_000;
  assert.deepEqual([store.health().empty, store.health().fresh], [false, false]);
  store.close();
});
