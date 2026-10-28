import assert from 'node:assert/strict';
import { assertPersistenceMode, persistenceMode } from './persistenceMode.js';

assert.equal(persistenceMode({}).mode, 'json-single-process');
assert.equal(persistenceMode({ POORUP_HORIZONTAL_SCALE: 'true' }).ready, false);
assert.throws(() => assertPersistenceMode({ POORUP_HORIZONTAL_SCALE: 'true' }), /POORUP_POSTGRES_URL/);
assert.equal(persistenceMode({ POORUP_HORIZONTAL_SCALE: 'true', POORUP_POSTGRES_URL: 'postgres://configured' }).ready, false);
assert.equal(persistenceMode({ POORUP_HORIZONTAL_SCALE: 'true', POORUP_POSTGRES_URL: 'postgres://configured', POORUP_PERSISTENCE_ADAPTER: 'postgres' }).ready, false);
assert.throws(() => assertPersistenceMode({ POORUP_HORIZONTAL_SCALE: 'true', POORUP_POSTGRES_URL: 'postgres://configured', POORUP_PERSISTENCE_ADAPTER: 'postgres' }), /health-checked transactional adapter/);
// The single-process guard fails closed: any value other than an explicit off value counts as a scale request.
for (const value of ['1', 'yes', 'on', ' true', 'TRUE', 'true ', 'enabled']) {
  assert.equal(persistenceMode({ POORUP_HORIZONTAL_SCALE: value }).ready, false, `"${value}" requests horizontal scale`);
  assert.throws(() => assertPersistenceMode({ POORUP_HORIZONTAL_SCALE: value }), /POORUP_POSTGRES_URL/, `"${value}" is refused without Postgres`);
}
for (const value of [undefined, '', 'false', 'FALSE', '0', 'no', 'off', '  false  ']) {
  assert.equal(persistenceMode({ POORUP_HORIZONTAL_SCALE: value }).ready, true, `${JSON.stringify(value)} stays single-process`);
}
console.log('persistence mode: 6 passed, 0 failed');
