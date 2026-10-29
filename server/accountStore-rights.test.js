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

// Reserved labels cannot be registered or worn through the username fallback.
{
  const reservedPath = path.join(os.tmpdir(), `poorup-reserved-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const reservedStore = new AccountStore(reservedPath);
  try {
    ['system', 'admin', 'server', 'SYSTEM'].forEach((name) => {
      const check = reservedStore.checkUsername(name);
      assert.equal(check.available, false, `${name} is not an available username`);
      assert.equal(check.reason, 'reserved');
      assert.equal(reservedStore.register({ username: name, displayName: 'Fine Name', password: 'long-enough-password' }).success, false);
    });
    const plain = reservedStore.register({ username: 'plainuser', displayName: 'ADMIN', password: 'long-enough-password' });
    assert.equal(plain.account.displayName, 'plainuser', 'a reserved display name falls back to the username');
    // Records stored before the rule keep loading, but never wear the reserved label.
    fs.writeFileSync(reservedPath, JSON.stringify([{ ...reservedStore.getAccountById(plain.account.id), id: 'acct_legacy', username: 'system', displayName: 'system' }]));
    const reloaded = new AccountStore(reservedPath);
    assert.notEqual(reloaded.getAccountById('acct_legacy').displayName.toLowerCase(), 'system', 'a stored reserved display name is replaced at load');
  } finally {
    fs.rmSync(reservedPath, { force: true });
  }
}

// Password reset lifts the login lock; purge and
// revocation leave no per-account or per-token bookkeeping behind.
{
  const lockPath = path.join(os.tmpdir(), `poorup-lock-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const lockStore = new AccountStore(lockPath);
  try {
    const lockRegistered = lockStore.register({ username: 'lockeduser', displayName: 'Locked', password: 'long-enough-password' });
    let locked = null;
    for (let attempt = 0; attempt < 12 && !locked; attempt += 1) {
      const result = lockStore.login({ username: 'lockeduser', password: 'wrong-password' });
      if (result.code === 'ACCOUNT_LOCKED') locked = result;
    }
    assert.ok(locked, 'repeated failures lock the account');
    assert.equal(lockStore.updatePassword(lockRegistered.account.id, 'brand-new-password'), true);
    assert.equal(lockStore.login({ username: 'lockeduser', password: 'brand-new-password' }).success, true, 'a password reset lifts the login lock');

    const first = lockStore.login({ username: 'lockeduser', password: 'brand-new-password' });
    const second = lockStore.login({ username: 'lockeduser', password: 'brand-new-password' });
    assert.equal(lockStore.sessionIssuedAt.has(first.sessionToken), false, 'a replaced session token is not kept');
    assert.equal(lockStore.sessionIssuedAt.size, 2, 'only the live session is stamped');
    lockStore.logout(second.sessionToken);
    assert.equal(lockStore.sessionIssuedAt.size, 0, 'logout forgets the session stamps');
    const third = lockStore.login({ username: 'lockeduser', password: 'brand-new-password' });
    lockStore.updatePassword(lockRegistered.account.id, 'another-new-password');
    assert.equal(lockStore.sessionIssuedAt.has(third.sessionToken), false, 'a password change forgets revoked session stamps');
    assert.equal(lockStore.sessionIssuedAt.size, 0);

    lockStore.login({ username: 'lockeduser', password: 'wrong-password' });
    assert.equal(lockStore.passwordFailures.size, 1);
    lockStore.login({ username: 'lockeduser', password: 'another-new-password' });
    lockStore.login({ username: 'lockeduser', password: 'wrong-password' });
    assert.equal(lockStore.purgeAccount(lockRegistered.account.id), true);
    assert.equal(lockStore.passwordFailures.size, 0, 'purge forgets the erased account\'s failure counters');
    assert.equal(lockStore.sessionIssuedAt.size, 0, 'purge forgets session stamps');
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}
console.log('account rights store: 10 passed, 0 failed');
