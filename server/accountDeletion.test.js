import assert from 'node:assert/strict';
import { createAccountDeletionCoordinator } from './accountDeletion.js';

let now = Date.parse('2026-09-17T12:00:00.000Z');
let persistCount = 0;
const account = { id: 'acct-1', username: 'owner', passwordHash: 'hash', passwordSalt: 'salt', deletionRequestedAt: null, deletionDueAt: null, accountDeactivated: false };
const removed = [];
const accountStore = {
  getAccountById: id => id === account.id ? account : null,
  verifyPassword: () => true,
  persist: () => { persistCount += 1; },
  isUsernameConfirmation: (value, expected) => value === expected,
  setAccountDeactivated: (value, flag) => { value.accountDeactivated = flag; },
  purgeAccount: id => removed.push(['account', id]),
  snapshot: () => ({ ...account }),
  restoreSnapshot: snapshot => Object.assign(account, snapshot)
};
const coordinator = createAccountDeletionCoordinator({
  now: () => now,
  accountStore,
  sessionStore: { revokeOthers: () => 1 },
  roomManager: { rooms: new Map() },
  stores: [
    { purgeAccount: id => removed.push(['social', id]) },
    { purgeAccount: id => removed.push(['matches', id]) },
    { purgeAccount: id => removed.push(['achievements', id]) },
  ],
  mailAdapter: { send: async () => ({ success: true }) },
});
const blocked = await coordinator.request({ accountId: 'acct-1', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'r1', activeRoom: true });
assert.equal(blocked.code, 'LEAVE_TABLE_FIRST');
const originalPersist = accountStore.persist;
accountStore.persist = () => { throw new Error('disk busy'); };
const failedSchedule = await coordinator.request({ accountId: 'acct-1', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'failed' });
assert.equal(failedSchedule.code, 'DELETION_NOT_COMPLETED');
assert.equal(account.deletionRequestedAt, null);
accountStore.persist = originalPersist;
const requested = await coordinator.request({ accountId: 'acct-1', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'r1' });
assert.equal(requested.state, 'pending');
assert.equal(account.accountDeactivated, true);
assert.equal((await coordinator.request({ accountId: 'acct-1', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'different' })).code, 'DELETION_REQUEST_STALE');
assert.equal((await coordinator.request({ accountId: 'acct-1', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'r1' })).state, 'pending');
assert.equal((await coordinator.cancel({ accountId: 'acct-1', currentPassword: 'pw', requestId: 'r1' })).state, 'active');
assert.equal(account.accountDeactivated, false);
await coordinator.request({ accountId: 'acct-1', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'r2' });
now += 31 * 86400000;
const due = await coordinator.runDue();
assert.equal(due.succeeded, 1);
assert.equal(removed.length >= 4, true);
assert.equal(persistCount > 0, true);
console.log('account deletion: 8 passed, 0 failed');
