// Persistence seam characterization: the exact behaviors that used to combine
// into silent data loss are now pinned down — a corrupt store file must keep
// its bytes in a quarantine sibling, the store must open empty beside it, and
// the next successful persist() must never touch the quarantined original.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountStore } from './accountStore.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-persist-'));
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS — ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL — ${name}: ${error.message}`);
  }
}

function fileFor(name) {
  return path.join(tempDir, `${name}.json`);
}

function register(store, username) {
  return store.register({ username, password: 'hunter2hunter2', displayName: username });
}

function corruptSibling(filePath) {
  return fs.readdirSync(tempDir).filter(entry => entry.startsWith(path.basename(filePath)) && entry.includes('.corrupt-'));
}

check('round-trip: persisted accounts reload identically', () => {
  const filePath = fileFor('roundtrip');
  const first = new AccountStore(filePath);
  register(first, 'roundtripper');
  const second = new AccountStore(filePath);
  assert.strictEqual(second.findAccountByUsername('roundtripper')?.username, 'roundtripper');
});

check('corrupt file: opens empty and quarantines the bytes', () => {
  const filePath = fileFor('corrupt');
  const broken = '{"username": "truncated-no-closing-brace';
  fs.writeFileSync(filePath, broken, 'utf8');
  const store = new AccountStore(filePath);
  assert.strictEqual(store.accounts.size, 0, 'store must open empty');
  const quarantined = corruptSibling(filePath);
  assert.strictEqual(quarantined.length, 1, 'exactly one quarantine sibling');
  assert.strictEqual(fs.readFileSync(path.join(tempDir, quarantined[0]), 'utf8'), broken);
});

check('corrupt file: later persist writes fresh data without clobbering bytes', () => {
  const filePath = fileFor('noclobber');
  const broken = 'not json at all {{{';
  fs.writeFileSync(filePath, broken, 'utf8');
  const store = new AccountStore(filePath);
  register(store, 'survivor');
  const quarantined = corruptSibling(filePath)[0];
  assert.strictEqual(fs.readFileSync(path.join(tempDir, quarantined), 'utf8'), broken);
  assert.ok(fs.readFileSync(filePath, 'utf8').includes('survivor'));
});

check('atomic write: main file is always complete JSON and no temp litter', () => {
  const filePath = fileFor('atomic');
  const store = new AccountStore(filePath);
  register(store, 'atomicone');
  const text = fs.readFileSync(filePath, 'utf8');
  assert.ok(Array.isArray(JSON.parse(text)), 'store file must parse');
  const litter = fs.readdirSync(tempDir).filter(entry => entry.endsWith('.tmp'));
  assert.strictEqual(litter.length, 0, 'no temp files left behind');
});

check('missing file: clean empty start with no quarantine siblings', () => {
  const filePath = fileFor('missing');
  const store = new AccountStore(filePath);
  assert.strictEqual(store.accounts.size, 0);
  assert.strictEqual(corruptSibling(filePath).length, 0);
});

fs.rmSync(tempDir, { recursive: true, force: true });
const failed = results.filter(ok => !ok).length;
console.log(`persistence tests: ${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
