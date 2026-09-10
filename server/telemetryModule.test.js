import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TelemetryStore, sanitize } from './telemetryModule.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-telemetry-'));
const store = new TelemetryStore(path.join(dir, 'telemetry.json'));
assert.equal(store.record('match-complete', { players: 2, chat: 'do not keep', hiddenCards: ['x'] }, { seasonId: 'S1', boardVariant: 'metro-52', rulesetRevision: 1, balanceRevision: 2 }).success, true);
assert.equal(store.events[0].data.chat, undefined);
assert.equal(store.events[0].data.hiddenCards, undefined);
assert.equal(store.record('unknown', {}).recorded, false);
assert.equal(store.summary().total, 1);
assert.deepEqual(sanitize({ text: 'secret', nested: { value: 2 } }), { nested: { value: 2 } });
fs.rmSync(dir, { recursive: true, force: true });
console.log('telemetry module: 6 passed, 0 failed');
