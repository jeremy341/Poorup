import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';

// Account records that fail load validation are not silently erased by
// the next write. They are preserved in a sidecar before the store is rewritten,
// and a write that would shrink the record set without a purge is refused.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-account-load-'));
const file = path.join(root, 'accounts.json');
const account = (id, username) => ({ id, username, displayName: username, color: '#d74438', passwordHash: 'a'.repeat(128), passwordSalt: 'b'.repeat(32), stats: {}, history: [], achievements: [], matchHistory: [], recordedMatchIds: [], privacy: {}, createdAt: '2026-10-01T00:00:00.000Z' });
const legacy = { ...account('acct-legacy', 'Old Name!') };
const duplicate = { ...account('acct-dup', 'valid01'), passwordHash: 'c'.repeat(128) };
fs.writeFileSync(file, JSON.stringify([account('acct-1', 'valid01'), legacy, duplicate, account('acct-2', 'second02')], null, 2));
const sidecars = () => fs.readdirSync(root).filter(name => name.startsWith('accounts.json.rejected-'));

const store = new AccountStore(file);
assert.equal(store.accounts.size, 2, 'valid records load');
assert.equal(sidecars().length, 0, 'nothing is rewritten before a write is due');
store.register({ username: 'newbie01', password: 'newbie-pass-1', displayName: 'Newbie' });
assert.equal(sidecars().length, 1, 'rejected records are preserved before the store is rewritten');
const preserved = JSON.parse(fs.readFileSync(path.join(root, sidecars()[0]), 'utf8'));
assert.deepEqual(preserved.map(record => record.id), ['acct-legacy', 'acct-dup'], 'the rejected bytes are kept intact');
// Windows ignores POSIX mode bits, so the owner-only check runs where they apply.
if (process.platform !== 'win32') assert.equal((fs.statSync(path.join(root, sidecars()[0])).mode & 0o077), 0, 'the sidecar is owner-only');
const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.deepEqual(onDisk.map(record => record.id).sort(), ['acct-1', 'acct-2', store.findAccountByUsername('newbie01').id].sort());

// A later write does not add another sidecar for records already preserved.
store.persist();
assert.equal(sidecars().length, 1);

// A record set that shrinks without a purge is refused and the file is left as it was.
const before = fs.readFileSync(file, 'utf8');
const second = store.accounts.get('second02');
store.accounts.delete('second02');
assert.throws(() => store.persist(), /dropped unexpectedly/, 'an unexpected drop is refused');
assert.equal(fs.readFileSync(file, 'utf8'), before, 'the refused write leaves the store file untouched');
store.accounts.set('second02', second);

// A purge is the one allowed removal and is written.
const purged = store.purgeAccount('acct-2');
assert.equal(purged, true);
assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).some(record => record.id === 'acct-2'), false, 'a purged account is removed from disk');

fs.rmSync(root, { recursive: true, force: true });
console.log('account store load quarantine: 10 passed, 0 failed');
