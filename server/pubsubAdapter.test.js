import assert from 'node:assert/strict';
import { createPubSubAdapter, MAX_TOPIC_LENGTH } from './pubsubAdapter.js';

const bus = createPubSubAdapter();
const messages = [];
const unsubscribe = bus.subscribe('room-state', payload => messages.push(payload));
assert.equal(bus.publish('room-state', { roomCode: 'ABC', version: 1 }).delivered, 1);
assert.deepEqual(messages, [{ roomCode: 'ABC', version: 1 }]);
unsubscribe();
assert.equal(bus.publish('room-state', { version: 2 }).delivered, 0);
assert.equal(bus.subscribe('../secret', () => true) instanceof Function, true);
assert.equal(bus.publish('room-state', { value: BigInt(1) }).success, false);
bus.close();
assert.equal(bus.publish('room-state', {}).success, false);

// S12-L1: a repeated unsubscribe must not remove a topic another subscriber re-created.
{
  const adapter = createPubSubAdapter();
  const stale = adapter.subscribe('lobby', () => {});
  stale();
  const live = [];
  adapter.subscribe('lobby', payload => live.push(payload));
  stale();
  assert.equal(adapter.publish('lobby', { n: 1 }).delivered, 1, 'the live subscriber survives a stale second unsubscribe');
  assert.deepEqual(live, [{ n: 1 }]);
  assert.equal(adapter.topicCount(), 1);
}

// S12-L2: null is a valid payload, and a topic over the limit is rejected, not truncated into another topic.
{
  const adapter = createPubSubAdapter();
  const seen = [];
  adapter.subscribe('nulls', payload => seen.push(payload));
  assert.equal(adapter.publish('nulls', null).success, true);
  assert.equal(adapter.publish('nulls', undefined).delivered, 1);
  assert.deepEqual(seen, [null, null]);
  const prefix = 'a'.repeat(MAX_TOPIC_LENGTH);
  adapter.subscribe(prefix, () => {});
  assert.equal(adapter.publish(`${prefix}-other`, {}).delivered, 0, 'a longer topic does not collide with its prefix');
  assert.equal(adapter.publish(`${prefix}-other`, {}).success, false);
  assert.equal(adapter.subscribe(`${prefix}-other`, () => {}) instanceof Function, true);
  assert.equal(adapter.topicCount(), 2, 'an over-long subscription registers nothing');
}
console.log('pubsub adapter: 5 passed, 0 failed');
