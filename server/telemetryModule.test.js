import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TelemetryStore, sanitize } from './telemetryModule.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-telemetry-'));
const store = new TelemetryStore(path.join(dir, 'telemetry.json'));
assert.equal(store.record('match-complete', { playerCount: 2, chat: 'do not keep', hiddenCards: ['x'] }, { seasonId: 'S1', boardVariant: 'metro-52', rulesetRevision: 1, balanceRevision: 2 }).success, true);
assert.equal(store.events[0].data.chat, undefined);
assert.equal(store.events[0].data.hiddenCards, undefined);
assert.equal(store.record('unknown', {}).recorded, false);
assert.equal(store.record('match-complete', { durationSeconds: 4, unknownRawField: 'SECRET' }).recorded, false);
assert.equal(store.record('match-complete', { observations: { account_id: 'secret', client_id: 'socket-secret', room_code: 'ROOM1', safe: 1 } }).recorded, true);
assert.equal(JSON.stringify(store.events[1].data).includes('secret'), false);
assert.equal(store.events[1].data.observations.safe, 1);
assert.equal(store.summary().total, 2);
assert.deepEqual(sanitize({ text: 'secret', nested: { value: 2 } }), { nested: { value: 2 } });
let writes = 0;
const batched = new TelemetryStore(path.join(dir, 'batched.json'), { persist: () => { writes += 1; }, maxPending: 50, flushIntervalMs: 0 });
assert.equal(batched.record('bankruptcy', { count: 1 }).recorded, true);
assert.equal(batched.record('bankruptcy', { count: 1, title: 'unknown' }).recorded, false);
assert.equal(writes, 0);
batched.flush();
assert.equal(writes, 1);
batched.close();

// The shapes the game actually emits are recorded (ids are strings), while
// display names and objects in the same keys are still refused.
{
  const versions = { seasonId: 'S1', boardVariant: 'standard-40', rulesetRevision: 1, balanceRevision: 1 };
  const eligible = store.record('event-eligible', { source: 'round', chance: 0.4, candidates: ['housing-bubble', 'credit-freeze'], combination: null }, versions);
  assert.equal(eligible.recorded, true, 'event ids are valid candidates');
  assert.deepEqual(eligible.event.data.candidates, ['housing-bubble', 'credit-freeze']);
  assert.equal(store.record('market-liquidation', { actionCount: 2, actions: ['margin-liquidation', 'short-cover'] }, versions).recorded, true, 'liquidation action ids are recorded');
  const margin = store.record('market-volatility', { action: 'reduce-margin', amount: 250 }, versions);
  assert.equal(margin.recorded, true, 'a margin repayment amount is an allowed market field');
  assert.equal(margin.event.data.amount, 250);
  assert.equal(store.record('event-eligible', { candidates: ['Alice', 'Bob'] }, versions).recorded, false, 'display names are not telemetry');
  const mixed = store.record('event-eligible', { candidates: ['housing-bubble', 'Alice Smith'] }, versions);
  assert.deepEqual(mixed.event.data.candidates, ['housing-bubble'], 'only id-shaped entries survive');
  assert.equal(store.record('event-eligible', { candidates: [{ id: 'x' }] }, versions).recorded, false, 'objects are refused');
  assert.equal(store.record('market-liquidation', { actions: [{ displayName: 'Ada' }] }, versions).recorded, false);
}

{
  const versions = { seasonId: 'S1', boardVariant: 'standard-40', rulesetRevision: 1, balanceRevision: 1 };
  const accepted = store.record('airport-flight', { fare: 100, basis: 'default' }, versions);
  assert.equal(accepted.recorded, true, 'the airport producer payload is accepted');
  assert.deepEqual(accepted.event.data, { fare: 100, basis: 'default' });
  assert.equal(store.record('airport-flight', { fare: 100, basis: 'arrival', displayName: 'Ada' }, versions).recorded, false, 'identity fields invalidate this exact schema');
  assert.equal(store.record('airport-flight', { fare: 100, basis: 'arrival', unexpected: true }, versions).recorded, false, 'unexpected fields are rejected');
  assert.equal(store.record('airport-flight', { fare: 100, basis: 'unknown' }, versions).recorded, false, 'basis is a closed enum');
  assert.equal(store.record('airport-flight', { fare: -1, basis: 'departure' }, versions).recorded, false, 'fares must be non-negative integers');
  assert.equal(store.record('airport-flight', { basis: 'default' }, versions).recorded, false, 'fare is required');
}
// p01-2: a match end records ~200 bot-outcome events in one synchronous loop. With the
// default settings that burst must coalesce into the single timer/explicit flush instead
// of rewriting the whole log (and the rollup) every 64 events.
{
  let burstWrites = 0;
  const burst = new TelemetryStore(path.join(dir, 'burst.json'), { persist: () => { burstWrites += 1; } });
  for (let i = 0; i < 200; i += 1) {
    assert.equal(burst.record('bot-outcome', { provider: 'deterministic', botMode: 'no-ai', botOnly: true, fallback: false, success: true, phase: 'turn', actionId: 'roll', decisions: 1 }).recorded, true);
  }
  assert.equal(burstWrites, 0, 'a match-end burst does not force a write per 64 events');
  burst.flush();
  assert.equal(burstWrites, 1, 'one flush persists the whole burst');
  assert.equal(burst.events.length, 200, 'no event is dropped by coalescing');
  assert.equal(burst.pendingEvents.length, 0);
  burst.close();
}

// A failed retention write remains dirty and is retried by the next flush,
// even when pruning removed every pending event.
{
  let fail = false;
  const snapshots = [];
  const retained = new TelemetryStore(path.join(dir, 'retention-retry.json'), {
    persist: snapshot => {
      snapshots.push(snapshot);
      if (fail) throw new Error('disk busy');
    },
    flushIntervalMs: 0,
  });
  retained.record('bankruptcy', { count: 1 });
  retained.flush();
  snapshots.length = 0;
  fail = true;
  assert.throws(() => retained.prune(Date.now() + 1), /disk busy/);
  fail = false;
  retained.flush();
  assert.equal(snapshots.length, 2, 'the failed prune snapshot is retried');
  assert.deepEqual(snapshots[1], [], 'the pruned state reaches durable storage');
  retained.close();
}

// A transient rollup failure retries without needing another telemetry event.
{
  let rollupFlushes = 0;
  const rollupStore = {
    record: () => ({ accepted: true }),
    flush: () => {
      rollupFlushes += 1;
      return rollupFlushes === 1 ? Promise.reject(new Error('rollup unavailable')) : Promise.resolve({ flushed: true });
    },
  };
  const retrying = new TelemetryStore(path.join(dir, 'rollup-retry.json'), {
    rollupStore,
    persist: () => {},
    flushIntervalMs: 5,
  });
  retrying.record('bankruptcy', { count: 1 });
  await assert.rejects(retrying.flush(), /rollup unavailable/);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(rollupFlushes >= 2, true, 'the failed rollup write is retried by the timer');
  await retrying.close();
}

// A prune that lands during an asynchronous write stays dirty through close.
{
  let release;
  let writes = 0;
  const snapshots = [];
  const gate = new Promise(resolve => { release = resolve; });
  const closing = new TelemetryStore('', {
    persist: snapshot => {
      writes += 1;
      snapshots.push(snapshot);
      return writes === 1 ? gate : undefined;
    },
    flushIntervalMs: 0,
  });
  closing.record('bankruptcy', { count: 1 });
  const closePromise = closing.close();
  const prunePromise = closing.prune(Date.now() + 1);
  release();
  assert.equal(await prunePromise, 1);
  await closePromise;
  assert.equal(writes, 2, 'close retries the pruned snapshot after the earlier write settles');
  assert.deepEqual(snapshots[1], [], 'the final persisted snapshot reflects the prune');
}

store.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('telemetry module: all checks passed');
