// getAccountById sits on the cookie-session fallback and in recordGameResults per
// participant. It used to copy the whole account map into an array on every call.
// The id index must stay correct through purge, rollback and re-registration, and
// must make a lookup independent of the account count.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-account-id-lookup-'));
const store = new AccountStore(path.join(dir, 'accounts.json'));
const register = name => store.register({ username: name, displayName: name, password: 'long-enough-password' }).account;

const alice = register('idalice');
const bob = register('idbob');
assert.equal(store.getAccountById(alice.id), store.findAccountByUsername('idalice'));
assert.equal(store.getAccountById(bob.id), store.findAccountByUsername('idbob'));
assert.equal(store.getAccountById(alice.id), store.findAccountByUsername('idalice'), 'a repeated lookup returns the same live object');
assert.equal(store.getAccountById('missing'), null);
assert.equal(store.getAccountById(undefined), null);

// An account that was looked up and then purged must not be served from the index.
assert.equal(store.purgeAccount(alice.id), true);
assert.equal(store.getAccountById(alice.id), null, 'a purged account is gone');
assert.equal(store.getAccountById(bob.id)?.username, 'idbob');

// A rolled-back snapshot removes an account created after it; a miss is never cached.
const snapshot = store.snapshot();
const carol = register('idcarol');
assert.equal(store.getAccountById(carol.id)?.username, 'idcarol');
assert.equal(store.restoreSnapshot(snapshot), true);
assert.equal(store.getAccountById(carol.id), null, 'an account removed by restoring a snapshot is gone');
const carolAgain = register('idcarol');
assert.equal(store.getAccountById(carolAgain.id)?.username, 'idcarol', 'a later registration is found after an earlier miss');

// The id index must also see an account replaced under the same username.
const replacement = { ...store.findAccountByUsername('idbob'), id: 'replacement-id' };
store.accounts.set('idbob', replacement);
assert.equal(store.getAccountById(bob.id), null, 'the replaced account id no longer resolves');
assert.equal(store.getAccountById('replacement-id'), replacement);

// Cost: lookups do not scale with the account count (the scan took ~40 us per call at 5,000
// accounts, so 10,000 lookups took ~400 ms; the index answers in well under a microsecond).
for (let index = 0; index < 5000; index += 1) store.accounts.set(`bulk${index}`, { id: `bulk-id-${index}`, username: `bulk${index}`, stats: {} });
const started = process.hrtime.bigint();
let found = 0;
for (let round = 0; round < 10000; round += 1) if (store.getAccountById(`bulk-id-${(round * 7919) % 5000}`)) found += 1;
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
assert.equal(found, 10000);
assert.ok(elapsedMs < 120, `10,000 lookups at 5,000 accounts took ${elapsedMs.toFixed(1)} ms`);

fs.rmSync(dir, { recursive: true, force: true });
console.log('account store id lookup: 6 passed, 0 failed');
