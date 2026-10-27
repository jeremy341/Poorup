import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { resolveAccount } from './socketHandlerSupport.js';

const dir = os.tmpdir();
const store = new AccountStore(path.join(dir, 'poorup-session-audit-' + crypto.randomUUID() + '.json'));
const registered = store.register({ username: 'sessionaudit', displayName: 'Session Audit', password: 'long-enough-password' });
assert.equal(registered.success, true);
const socket = { data: { accountId: registered.account.id, sessionTokenHash: store.sessionTokenHashFor(registered.sessionToken) } };
assert.equal(resolveAccount(store, socket, {})?.id, registered.account.id);
store.logout(registered.sessionToken);
assert.equal(resolveAccount(store, socket, {}), null);
assert.equal(socket.data.accountId, null);
assert.equal(socket.data.sessionTokenHash, null);

const loggedIn = store.login({ username: 'sessionaudit', password: 'long-enough-password' });
assert.equal(loggedIn.success, true);
const hash = store.sessionTokenHashFor(loggedIn.sessionToken);
assert.equal(store.accountForSessionHash(hash, loggedIn.account.id)?.id, loggedIn.account.id);
store.sessionIssuedAt.set(hash, Date.now() - 91 * 24 * 3600 * 1000);
assert.equal(store.accountForSessionHash(hash, loggedIn.account.id), null, 'a stale hash session is rejected');
assert.equal(store.sessionHashes.has(hash), false, 'the stale hash is deleted');
assert.equal(store.sessionIssuedAt.has(hash), false, 'the stale issuance stamp is deleted');

console.log('account session audit: 1 passed, 0 failed');
