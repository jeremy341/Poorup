import assert from 'node:assert/strict';
import { resolveAccount } from './socketHandlerSupport.js';

const account = { id: 'acct-cookie', username: 'cookie-user' };
const accountStore = {
  getAccountById: id => id === account.id ? account : null,
  sessionAccount: () => null,
  accountForSessionHash: () => null,
};
const socket = { data: { sessionAccountId: account.id } };

assert.equal(resolveAccount(accountStore, socket, {}), account);
assert.equal(socket.data.accountId, account.id);

assert.equal(resolveAccount(accountStore, socket, { sessionToken: 'invalid-explicit-token' }), null);
assert.equal(socket.data.accountId, null);

console.log('socket handler session resolution: 2 passed, 0 failed');
