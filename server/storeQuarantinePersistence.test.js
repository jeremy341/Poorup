// A quarantine must survive a restart. Held only in process memory, the
// empty stand-in would look like a healthy store after one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearQuarantineMarker, isQuarantinedStore, loadJson, readQuarantineMarker, writeJson } from './storeIO.js';

function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-quarantine-persist-'));
const silence = fn => {
  const original = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = original; }
};

check('a corrupt store leaves a marker beside it, and the corrupt bytes are preserved', () => {
  const file = path.join(dir, 'a.json');
  fs.writeFileSync(file, '{broken');
  const result = silence(() => loadJson(file));
  assert.equal(result.corrupt, true);
  const marker = readQuarantineMarker(file);
  assert.ok(marker, 'a marker record exists');
  assert.equal(marker.store, 'a.json');
  assert.equal(fs.readFileSync(path.join(dir, marker.preservedAs), 'utf8'), '{broken');
});

check('the quarantine is still reported by a new process that never saw the corruption', () => {
  const file = path.join(dir, 'b.json');
  fs.writeFileSync(file, '[[[');
  silence(() => loadJson(file));
  // Simulate a restart: the replacement store is empty and valid on disk.
  writeJson(file, { accounts: [] });
  const fresh = silence(() => loadJson(file));
  assert.equal(fresh.corrupt, false, 'the stand-in parses cleanly, which is exactly why it looks healthy');
  assert.equal(isQuarantinedStore(file), true, 'but it is still reported as quarantined');
  assert.ok(readQuarantineMarker(file));
});

check('a store that was never corrupt is not reported as quarantined', () => {
  const file = path.join(dir, 'c.json');
  writeJson(file, { ok: true });
  silence(() => loadJson(file));
  assert.equal(isQuarantinedStore(file), false);
  assert.equal(readQuarantineMarker(file), null);
});

check('two quarantines in the same millisecond never overwrite each other', () => {
  const file = path.join(dir, 'd.json');
  const RealDate = Date;
  class FrozenDate extends RealDate { constructor(...args) { super(...(args.length ? args : [1_800_000_000_000])); } }
  globalThis.Date = FrozenDate;
  try {
    fs.writeFileSync(file, 'first-bad');
    silence(() => loadJson(file));
    fs.writeFileSync(file, 'second-bad');
    silence(() => loadJson(file));
  } finally { globalThis.Date = RealDate; }
  const copies = fs.readdirSync(dir).filter(name => name.startsWith('d.json.corrupt-')).map(name => fs.readFileSync(path.join(dir, name), 'utf8')).sort();
  assert.deepEqual(copies, ['first-bad', 'second-bad']);
});

check('an operator can clear the marker once the store has been dealt with', () => {
  const file = path.join(dir, 'e.json');
  fs.writeFileSync(file, 'nope');
  silence(() => loadJson(file));
  assert.equal(isQuarantinedStore(file), true);
  clearQuarantineMarker(file);
  assert.equal(isQuarantinedStore(file), false);
  assert.equal(readQuarantineMarker(file), null);
});

fs.rmSync(dir, { recursive: true, force: true });
