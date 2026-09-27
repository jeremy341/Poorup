import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';

const filePath = path.join(os.tmpdir(), `poorup-account-rights-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
const store = new AccountStore(filePath);
const registered = store.register({ username: 'rightsuser', displayName: 'Rights User', password: 'long-enough-password' });
const accountId = registered.account.id;
const account = store.getAccountById(accountId);
assert.equal(store.verifyPassword(account, 'long-enough-password'), true);
assert.equal(store.verifyPassword(account, 'wrong-password'), false);
assert.equal(store.listAccounts().length, 1);
store.setAccountDeactivated(account, true);
assert.equal(account.accountDeactivated, true);
assert.equal(store.getLeaderboard('wins').length, 0, 'deactivated accounts are omitted from public leaderboards');
assert.equal(store.getPublicAccountById(accountId).accountDeactivated, true, 'existing references keep a stable deactivated marker');
assert.equal(store.updatePassword(accountId, 'new-long-password'), true);
assert.equal(store.verifyPassword(account, 'new-long-password'), true);
assert.equal(store.purgeAccount(accountId), true);
assert.equal(store.getAccountById(accountId), null);
assert.equal(store.listAccounts().length, 0);
fs.rmSync(filePath, { force: true });

const cookieFilePath = path.join(os.tmpdir(), `poorup-cookie-profile-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
const cookieStore = new AccountStore(cookieFilePath);
try {
  const cookieRegistered = cookieStore.register({ username: 'cookierights', displayName: 'Cookie User', password: 'long-enough-password' });
  const cookieUpdate = cookieStore.updateProfileForAccount(cookieRegistered.account, { displayName: 'Cookie Profile' });
  assert.equal(cookieUpdate.success, true);
  assert.equal(cookieUpdate.account.id, cookieRegistered.account.id);
  assert.equal(cookieStore.getAccountById(cookieRegistered.account.id).displayName, 'Cookie Profile');
  const reloadedCookieStore = new AccountStore(cookieFilePath);
  assert.equal(
    reloadedCookieStore.getAccountById(cookieRegistered.account.id).displayName,
    'Cookie Profile',
    'cookie-authenticated profile updates persist after reopening the account store'
  );
} finally {
  fs.rmSync(cookieFilePath, { force: true });
}
console.log('account rights store: 10 passed, 0 failed');
