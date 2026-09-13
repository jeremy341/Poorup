import assert from 'node:assert/strict';
import { createPubSubAdapter } from './pubsubAdapter.js';

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
console.log('pubsub adapter: 5 passed, 0 failed');
