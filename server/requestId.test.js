import assert from 'node:assert/strict';
import { normalizeRequestId } from './requestId.js';

assert.equal(normalizeRequestId('  abc '), 'abc');
assert.equal(normalizeRequestId(42), '42');
assert.equal(normalizeRequestId('x'.repeat(300)).length, 100);
assert.equal(normalizeRequestId(undefined), '');
assert.equal(normalizeRequestId(null), '');
// S09-7: non-scalar ids used to collapse to one shared key ('[object Object]',
// '1'), so two different requests replayed each other's cached result.
assert.equal(normalizeRequestId({ id: 1 }), '');
assert.equal(normalizeRequestId({ id: 2 }), '');
assert.equal(normalizeRequestId([1]), '');
assert.equal(normalizeRequestId(true), '');

console.log('request id normalisation: 9 passed, 0 failed');
