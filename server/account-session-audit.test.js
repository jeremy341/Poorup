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

console.log('account session audit: 1 passed, 0 failed');
