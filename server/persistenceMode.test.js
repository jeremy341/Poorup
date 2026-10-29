import assert from 'node:assert/strict';
import { assertPersistenceMode, persistenceMode } from './persistenceMode.js';

assert.equal(persistenceMode({}).mode, 'json-single-process');
assert.equal(persistenceMode({ POORUP_HORIZONTAL_SCALE: 'true' }).ready, false);
assert.throws(() => assertPersistenceMode({ POORUP_HORIZONTAL_SCALE: 'true' }), /POORUP_POSTGRES_URL/);
assert.equal(persistenceMode({ POORUP_HORIZONTAL_SCALE: 'true', POORUP_POSTGRES_URL: 'postgres://configured' }).ready, false);
assert.equal(persistenceMode({ POORUP_HORIZONTAL_SCALE: 'true', POORUP_POSTGRES_URL: 'postgres://configured', POORUP_PERSISTENCE_ADAPTER: 'postgres' }).ready, false);
assert.throws(() => assertPersistenceMode({ POORUP_HORIZONTAL_SCALE: 'true', POORUP_POSTGRES_URL: 'postgres://configured', POORUP_PERSISTENCE_ADAPTER: 'postgres' }), /health-checked transactional adapter/);
console.log('persistence mode: 4 passed, 0 failed');
