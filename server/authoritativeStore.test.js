import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMemoryAuthoritativeStore, createJsonAuthoritativeStore } from './authoritativeStore.js';

const memory = createMemoryAuthoritativeStore();
assert.equal(memory.readRoom('A').found, false);
assert.equal(memory.writeRoom('A', { cash: 10 }, 1).success, true);
assert.deepEqual(memory.readRoom('A').snapshot, { cash: 10 });
assert.equal(memory.writeRoom('A', { cash: 9 }, 1).code, 'STALE_VERSION');
assert.equal(memory.writeRoom('A', { cash: 11 }, 2).success, true);
assert.equal(memory.deleteRoom('A', 1).code, 'STALE_VERSION');
assert.equal(memory.deleteRoom('A', 2).deleted, true);
assert.equal(memory.writeRoom('../escape', {}, 1).success, false);
assert.equal(memory.writeRoom('B', { value: BigInt(1) }, 1).success, false);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-authoritative-'));
const filePath = path.join(directory, 'rooms.json');
const json = createJsonAuthoritativeStore(filePath);
assert.equal(json.writeRoom('ROOM1', { turn: 3 }, 1).success, true);
assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).ROOM1.version, 1);
const reloaded = createJsonAuthoritativeStore(filePath);
assert.deepEqual(reloaded.readRoom('ROOM1').snapshot, { turn: 3 });
assert.equal(reloaded.writeRoom('ROOM1', { turn: 2 }, 1).code, 'STALE_VERSION');
fs.rmSync(directory, { recursive: true, force: true });
console.log('authoritative store: 10 passed, 0 failed');
