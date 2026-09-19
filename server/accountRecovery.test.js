import assert from 'node:assert/strict';
import { createAccountRecovery } from './accountRecovery.js';

let now = Date.parse('2026-09-17T12:00:00.000Z');
const sent = [];
const revokedCookieAccounts = [];
const accounts = new Map([['acct-1', { id: 'acct-1', username: 'owner', passwordHash: 'x', recoveryEmail: null, recoveryEmailVerified: false }]]);
const recovery = createAccountRecovery({
  now: () => now,
  accountStore: {
    getAccountById: id => accounts.get(id) || null,
    persist: () => {},
    verifyPassword: () => true,
    updatePassword: (id, password) => {
      const account = accounts.get(id);
      if (!account || typeof password !== 'string') return false;
      account.passwordHash = `updated:${password}`;
      return true;
    },
    revokeSessionsForAccount: () => 0,
  },
  sessionStore: { revokeAllForAccount: (id) => { revokedCookieAccounts.push(id); return 1; } },
  mailAdapter: { send: async message => { sent.push(message); return { success: true }; } },
});
const requested = await recovery.requestEmailVerification({ accountId: 'acct-1', currentPassword: 'pw', email: 'owner@example.test' });
assert.equal(requested.success, true);
assert.equal(accounts.get('acct-1').recoveryEmailVerified, false);
assert.equal(sent.length, 1);
assert.equal(await recovery.consumeEmailVerification(requested.token), true);
assert.equal(accounts.get('acct-1').recoveryEmailVerified, true);
assert.equal(await recovery.consumeEmailVerification(requested.token), false, 'verification token is single use');
const reset = await recovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
assert.equal(reset.success, true);
assert.equal(await recovery.consumePasswordReset(reset.token, 'new-password'), true);
assert.equal(await recovery.consumePasswordReset(reset.token, 'another-password'), false);
const expired = await recovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
now += 31 * 60 * 1000;
assert.equal(await recovery.consumePasswordReset(expired.token, 'new-password'), false);
const firstReset = await recovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
const secondReset = await recovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
assert.equal(await recovery.consumePasswordReset(firstReset.token, 'new-password'), false, 'superseded reset token is invalid');
assert.equal(await recovery.consumePasswordReset(secondReset.token, 'new-password'), true);
assert.deepEqual(revokedCookieAccounts, ['acct-1', 'acct-1']);
console.log('account recovery: 12 passed, 0 failed');
