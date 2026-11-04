import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { MatchStore } from './matchStore.js';
import { createAccountDeletionCoordinator } from './accountDeletion.js';
import { createSessionStore } from './sessionStore.js';

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
const sessionRevocations = [];
const coordinator = createAccountDeletionCoordinator({
  now: () => now,
  accountStore,
  sessionStore: { revokeAccountSessionsExcept: (accountId, keep) => { sessionRevocations.push([accountId, keep]); return 1; } },
  roomManager: { rooms: new Map() },
  stores: [
    { purgeAccount: id => removed.push(['social', id]) },
    { purgeAccount: id => removed.push(['matches', id]) },
    { purgeAccount: id => removed.push(['achievements', id]) },
  ],
  retiredStore: { purgeAccount: id => removed.push(['retired', id]) },
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
const requested = await coordinator.request({ accountId: 'acct-1', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'r1', sessionId: 'sess-caller' });
assert.equal(requested.state, 'pending');
assert.deepEqual(sessionRevocations.at(-1), ['acct-1', 'sess-caller'], 'every other cookie session of the account is revoked');
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

// Malformed or blocked requests are refused before any scrypt work, so
// a session holder cannot use delete requests as a password-hash load source.
let scryptCalls = 0;
const probeAccount = { id: 'acct-2', username: 'probe', passwordHash: 'hash', passwordSalt: 'salt', deletionRequestedAt: null, deletionDueAt: null, accountDeactivated: false };
const probe = createAccountDeletionCoordinator({
  now: () => now,
  accountStore: {
    getAccountById: id => id === probeAccount.id ? probeAccount : null,
    verifyPassword: () => { scryptCalls += 1; return false; },
    persist: () => {},
    setAccountDeactivated: (value, flag) => { value.accountDeactivated = flag; },
  },
  sessionStore: { revokeOthers: () => 0 },
  roomManager: { rooms: new Map() },
  mailAdapter: { send: async () => ({ success: true }) },
});
assert.equal((await probe.request({ accountId: 'acct-2', currentPassword: 'wrong', typedPhrase: 'nope' })).code, 'DELETE_PHRASE_REQUIRED');
assert.equal((await probe.request({ accountId: 'acct-2', currentPassword: 'wrong', typedPhrase: 'DELETE ACCOUNT', activeRoom: true })).code, 'LEAVE_TABLE_FIRST');
assert.equal(scryptCalls, 0, 'cheap request checks run before the password hash');
assert.equal((await probe.request({ accountId: 'acct-2', currentPassword: 'wrong', typedPhrase: 'DELETE ACCOUNT' })).code, 'ACCOUNT_CONFIRMATION_INVALID');
assert.equal(scryptCalls, 1);

// A cancel that lands while the purge awaits its notice mail must be
// refused, not reported as success followed by an irreversible delete.
let releaseMail;
const mailGate = new Promise(resolve => { releaseMail = resolve; });
const raceAccount = { id: 'acct-3', username: 'racer', passwordHash: 'hash', passwordSalt: 'salt', recoveryEmail: 'racer@example.test', recoveryEmailVerified: true, deletionRequestedAt: null, deletionDueAt: null, deletionRequestId: null, accountDeactivated: false };
const raceRemoved = [];
const racer = createAccountDeletionCoordinator({
  now: () => now,
  accountStore: {
    getAccountById: id => id === raceAccount.id ? raceAccount : null,
    verifyPassword: () => true,
    persist: () => {},
    setAccountDeactivated: (value, flag) => { value.accountDeactivated = flag; },
    purgeAccount: id => raceRemoved.push(id),
  },
  roomManager: { rooms: new Map() },
  mailAdapter: { send: async message => { if (message.template === 'account-deleted') await mailGate; return { success: true }; } },
});
await racer.request({ accountId: 'acct-3', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'race' });
now += 31 * 86400000;
const purging = racer.runDue();
await new Promise(resolve => setImmediate(resolve));
const cancelDuringPurge = await racer.cancel({ accountId: 'acct-3', currentPassword: 'pw', requestId: 'race' });
assert.equal(cancelDuringPurge.success, false);
assert.equal(cancelDuringPurge.code, 'DELETION_IN_PROGRESS');
assert.equal((await racer.request({ accountId: 'acct-3', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'race' })).code, 'DELETION_IN_PROGRESS');
releaseMail();
assert.equal((await purging).succeeded, 1);
assert.deepEqual(raceRemoved, ['acct-3']);

// Every linked store is erased, including the display name and analytics rows.
// A backup copy that cannot be reached keeps the purge pending until it can be scrubbed.
const erasureCalls = [];
let unreachableCopies = 1;
const erasureAccount = { id: 'acct-4', username: 'erased', displayName: 'Erased', passwordHash: 'hash', passwordSalt: 'salt', recoveryEmailVerified: false, deletionRequestedAt: null, deletionDueAt: null, deletionRequestId: null, accountDeactivated: false };
const erasureRemoved = [];
const erasing = createAccountDeletionCoordinator({
  now: () => now,
  accountStore: {
    getAccountById: id => (id === erasureAccount.id ? erasureAccount : null),
    verifyPassword: () => true,
    persist: () => {},
    setAccountDeactivated: (value, flag) => { value.accountDeactivated = flag; },
    purgeAccount: id => erasureRemoved.push(id),
  },
  roomManager: { rooms: new Map() },
  analyticsRollupStore: { purgeAccount: async id => { erasureCalls.push(['analytics', id]); return 1; } },
  socialStore: { purgeAccount: (id, options) => { erasureCalls.push(['social', id, options?.displayName]); return true; } },
  backupStore: { anonymizeAccount: async id => { erasureCalls.push(['backups', id]); return { scrubbed: 0, deleted: 0, skipped: unreachableCopies }; } },
  mailAdapter: { send: async () => ({ success: true }) },
});
await erasing.request({ accountId: 'acct-4', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'erase' });
now += 31 * 86400000;
const stalled = await erasing.runDue();
assert.equal(stalled.failed, 1, 'an unreachable backup copy keeps the purge pending');
assert.deepEqual(erasureRemoved, [], 'the account is not deleted while erasure is incomplete');
assert.deepEqual(erasureCalls.find(([name]) => name === 'analytics'), ['analytics', 'acct-4']);
assert.deepEqual(erasureCalls.find(([name]) => name === 'social'), ['social', 'acct-4', 'Erased']);
unreachableCopies = 0;
const completed = await erasing.runDue();
assert.equal(completed.succeeded, 1);
assert.deepEqual(erasureRemoved, ['acct-4']);
// A purge that fails after an await must not roll back unrelated
// account-store writes that landed while the linked store was busy.
{
  const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-deletion-rollback-'));
  const realStore = new AccountStore(path.join(realRoot, 'accounts.json'));
  const victim = realStore.register({ username: 'victim01', displayName: 'Victim', password: 'long-enough-password' });
  let releaseLinked;
  const linkedGate = new Promise(resolve => { releaseLinked = resolve; });
  const rolling = createAccountDeletionCoordinator({
    now: () => now,
    accountStore: realStore,
    roomManager: { rooms: new Map() },
    stores: [{ purgeAccount: async () => { await linkedGate; throw Object.assign(new Error('copy unreachable'), { reason: 'erasure-incomplete' }); } }],
    mailAdapter: { send: async () => ({ success: true }) },
  });
  assert.equal((await rolling.request({ accountId: victim.account.id, currentPassword: 'long-enough-password', typedPhrase: 'DELETE ACCOUNT', requestId: 'roll' })).state, 'pending');
  now += 31 * 86400000;
  const running = rolling.runDue();
  await new Promise(resolve => setImmediate(resolve));
  const newcomer = realStore.register({ username: 'newbie01', displayName: 'Newbie', password: 'long-enough-password' });
  assert.equal(newcomer.success, true);
  releaseLinked();
  assert.equal((await running).failed, 1, 'the failing linked store keeps the purge pending');
  assert.ok(realStore.getAccountById(newcomer.account.id), 'an account registered during the purge survives the rollback');
  assert.equal(realStore.sessionAccount(newcomer.sessionToken)?.id, newcomer.account.id, 'its session survives the rollback');
  assert.ok(realStore.getAccountById(victim.account.id)?.deletionRequestedAt, 'the failed purge leaves the request pending');
  fs.rmSync(realRoot, { recursive: true, force: true });
}
// A coordinator rollback must not restore an old whole-store snapshot
// over an unrelated write that lands while a linked store is awaiting I/O.
{
  const concurrentAccount = { id: 'acct-s11', username: 's11', passwordHash: 'hash', passwordSalt: 'salt', deletionRequestedAt: '2026-01-01T00:00:00.000Z', deletionDueAt: '2026-01-02T00:00:00.000Z', deletionRequestId: 's11', accountDeactivated: true };
  let rows = ['existing'];
  let releasePurge;
  const gate = new Promise(resolve => { releasePurge = resolve; });
  const coordinator = createAccountDeletionCoordinator({
    now: () => now,
    accountStore: { getAccountById: id => id === concurrentAccount.id ? concurrentAccount : null },
    roomManager: { rooms: new Map() },
    stores: [
      {
        snapshot: () => [...rows],
        restoreSnapshot: snapshot => { rows = [...snapshot]; },
        purgeAccount: async () => { rows = rows.filter(row => row !== 'existing'); await gate; },
      },
      { purgeAccount: async () => { throw new Error('later store failed'); } },
    ],
  });
  const running = coordinator.purge(concurrentAccount);
  await new Promise(resolve => setImmediate(resolve));
  rows.push('concurrent-write');
  releasePurge();
  assert.equal((await running).success, false);
  assert.deepEqual(rows, ['concurrent-write'], 'the concurrent store write survives failed erasure while completed erasure stays applied');
}
// A deletion request that cannot be written must not sign the other
// devices out, and must not leave the account scheduled on disk. The disk model
// below is what a restart would read back.
{
  const pending = { id: 'acct-f3', username: 'f3', passwordHash: 'hash', passwordSalt: 'salt', deletionRequestedAt: null, deletionDueAt: null, accountDeactivated: false };
  const disk = { deletionRequestedAt: null, accountDeactivated: false };
  const revoked = [];
  const coordinator = createAccountDeletionCoordinator({
    now: () => now,
    accountStore: {
      getAccountById: id => (id === pending.id ? pending : null),
      verifyPassword: () => true,
      persist: () => { throw new Error('accounts.json busy'); },
      setAccountDeactivated: (value, flag) => { value.accountDeactivated = flag; },
      snapshot: () => ({ ...pending }),
      restoreSnapshot: snapshot => Object.assign(pending, snapshot),
    },
    sessionStore: { revokeAccountSessionsExcept: (...args) => { revoked.push(args); return 1; } },
    roomManager: { rooms: new Map() },
  });
  const result = await coordinator.request({ accountId: 'acct-f3', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'f3' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'DELETION_NOT_COMPLETED');
  assert.equal(pending.deletionRequestedAt, null, 'the account is not scheduled in memory');
  assert.equal(disk.deletionRequestedAt, null, 'and not on disk');
  assert.equal(pending.accountDeactivated, false);
  assert.deepEqual(revoked, [], 'the other devices stay signed in when the request was not persisted');
}

// A session revocation that fails after the request was persisted keeps
// the scheduled deletion (it is durable) and reports the failure.
{
  const pending = { id: 'acct-f3c', username: 'f3c', passwordHash: 'hash', passwordSalt: 'salt', deletionRequestedAt: null, deletionDueAt: null, accountDeactivated: false };
  const disk = { deletionRequestedAt: null, accountDeactivated: false };
  const cookieAttempts = [];
  let failBearerRevocation = true;
  const coordinator = createAccountDeletionCoordinator({
    now: () => now,
    accountStore: {
      getAccountById: id => (id === pending.id ? pending : null),
      verifyPassword: () => true,
      persist: () => { disk.deletionRequestedAt = pending.deletionRequestedAt; disk.accountDeactivated = pending.accountDeactivated; },
      revokeSessionsForAccount: (...args) => { if (failBearerRevocation) throw new Error('accounts.json busy'); return 1; },
      setAccountDeactivated: (value, flag) => { value.accountDeactivated = flag; },
      snapshot: () => ({ ...pending }),
      restoreSnapshot: snapshot => Object.assign(pending, snapshot),
    },
    sessionStore: { revokeAccountSessionsExcept: (...args) => { cookieAttempts.push(args); return 1; } },
    roomManager: { rooms: new Map() },
  });
  const result = await coordinator.request({ accountId: 'acct-f3c', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'f3c' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'DELETION_NOT_COMPLETED');
  assert.match(result.error, /scheduled/i);
  assert.ok(disk.deletionRequestedAt, 'the durable deletion request is kept');
  assert.ok(pending.deletionRequestedAt, 'and stays pending in memory');
  assert.equal(pending.accountDeactivated, true);
  failBearerRevocation = false;
  const retried = await coordinator.request({ accountId: 'acct-f3c', currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'f3c' });
  assert.equal(retried.success, true, 'retry completes the failed bearer-session revocation');
  assert.equal(cookieAttempts.length, 2, 'retry reruns cookie-session revocation too, which is safe to repeat');
}

// A cancel whose write fails leaves the account pending instead of
// half-cancelled, and a cancel that can be written goes through.
{
  const pending = { id: 'acct-f3b', username: 'f3b', passwordHash: 'hash', passwordSalt: 'salt', deletionRequestedAt: '2027-06-01T00:00:00.000Z', deletionDueAt: '2030-01-01T00:00:00.000Z', deletionRequestId: 'r1', accountDeactivated: true };
  let failing = true;
  const coordinator = createAccountDeletionCoordinator({
    now: () => now,
    accountStore: {
      getAccountById: id => (id === pending.id ? pending : null),
      verifyPassword: () => true,
      persist: () => { if (failing) throw new Error('disk busy'); },
      setAccountDeactivated: (value, flag) => { value.accountDeactivated = flag; },
      snapshot: () => ({ ...pending }),
      restoreSnapshot: snapshot => Object.assign(pending, snapshot),
    },
    roomManager: { rooms: new Map() },
  });
  const cancelled = await coordinator.cancel({ accountId: 'acct-f3b', currentPassword: 'pw', requestId: 'r1' });
  assert.equal(cancelled.success, false);
  assert.equal(cancelled.code, 'DELETION_NOT_COMPLETED');
  assert.equal(pending.deletionRequestedAt, '2027-06-01T00:00:00.000Z', 'the account is still pending after a failed cancel');
  assert.equal(pending.deletionDueAt, '2030-01-01T00:00:00.000Z');
  assert.equal(pending.accountDeactivated, true);
  failing = false;
  assert.equal((await coordinator.cancel({ accountId: 'acct-f3b', currentPassword: 'pw', requestId: 'r1' })).state, 'active');
  assert.equal(pending.deletionRequestedAt, null);
  assert.equal(pending.accountDeactivated, false);
}

// Once the deadline has passed a purge may have erased stores that cannot
// be rolled back, so a cancel is refused and the deletion stays pending.
{
  let unreachable = 1;
  const erased = [];
  const stale = { id: 'acct-f5', username: 'f5', displayName: 'F5', passwordHash: 'hash', passwordSalt: 'salt', deletionRequestedAt: '2026-01-01T00:00:00.000Z', deletionDueAt: '2026-01-02T00:00:00.000Z', deletionRequestId: 'r1', accountDeactivated: true };
  const coordinator = createAccountDeletionCoordinator({
    now: () => now,
    accountStore: {
      getAccountById: id => (id === stale.id ? stale : null),
      verifyPassword: () => true,
      persist: () => {},
      setAccountDeactivated: (value, flag) => { value.accountDeactivated = flag; },
      snapshot: () => ({ ...stale }),
      restoreSnapshot: snapshot => Object.assign(stale, snapshot),
      purgeAccount: id => erased.push(['account', id]),
    },
    roomManager: { rooms: new Map() },
    socialStore: { purgeAccount: id => { erased.push(['social', id]); return true; } },
    backupStore: { anonymizeAccount: async () => ({ skipped: unreachable }) },
  });
  assert.equal((await coordinator.purge(stale)).success, false, 'the unreachable backup keeps the purge pending');
  assert.deepEqual(erased, [['social', 'acct-f5']], 'the social store is already erased and cannot be restored');
  const cancelled = await coordinator.cancel({ accountId: 'acct-f5', currentPassword: 'pw', requestId: 'r1' });
  assert.equal(cancelled.success, false);
  assert.equal(cancelled.code, 'DELETION_IN_PROGRESS');
  assert.equal(cancelled.error, 'Account deletion has already started and can no longer be cancelled.');
  assert.ok(stale.deletionRequestedAt, 'the deletion stays pending');
  assert.equal(stale.accountDeactivated, true);
  unreachable = 0;
  assert.equal((await coordinator.purge(stale)).success, true, 'the pending deletion is retried to completion');
}

// The session revocation and the account purge are the last steps, so a
// store that fails leaves the account signed in and undeleted.
{
  const order = [];
  const account = { id: 'acct-f4', username: 'f4', deletionRequestedAt: '2026-01-01T00:00:00.000Z', deletionDueAt: '2026-01-02T00:00:00.000Z', deletionRequestId: 'r1', accountDeactivated: true };
  const coordinator = createAccountDeletionCoordinator({
    now: () => now,
    accountStore: {
      getAccountById: id => (id === account.id ? account : null),
      verifyPassword: () => true,
      persist: () => {},
      setAccountDeactivated: (value, flag) => { value.accountDeactivated = flag; },
      purgeAccount: id => order.push(['account', id]),
    },
    sessionStore: { revokeAllForAccount: id => { order.push(['sessions', id]); return 1; } },
    roomManager: { rooms: new Map() },
    stores: [{ purgeAccount: async id => { order.push(['store', id]); throw new Error('copy unreachable'); } }],
  });
  const outcome = await coordinator.purge(account);
  assert.equal(outcome.success, false);
  assert.deepEqual(order, [['store', 'acct-f4']], 'the sessions are not revoked when a store fails');
}

// A purge that succeeds erases the stores, then revokes the sessions,
// then deletes the account.
{
  const order = [];
  const account = { id: 'acct-f4b', username: 'f4b', deletionRequestedAt: '2026-01-01T00:00:00.000Z', deletionDueAt: '2026-01-02T00:00:00.000Z', deletionRequestId: 'r1', accountDeactivated: true };
  const coordinator = createAccountDeletionCoordinator({
    now: () => now,
    accountStore: {
      getAccountById: id => (id === account.id ? account : null),
      verifyPassword: () => true,
      persist: () => {},
      setAccountDeactivated: (value, flag) => { value.accountDeactivated = flag; },
      purgeAccount: id => order.push(['account', id]),
    },
    sessionStore: { revokeAllForAccount: id => { order.push(['sessions', id]); return 1; } },
    roomManager: { rooms: new Map() },
    stores: [{ purgeAccount: async id => { order.push(['store', id]); return 1; } }],
  });
  assert.equal((await coordinator.purge(account)).success, true);
  assert.deepEqual(order, [['store', 'acct-f4b'], ['sessions', 'acct-f4b'], ['account', 'acct-f4b']]);
}

// Deletion must scrub each embedded account-history copy in the same
// durable boundary as the account purge and central MatchStore anonymization.
{
  const eraseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-account-history-erasure-'));
  const accountPath = path.join(eraseRoot, 'accounts.json');
  const matchPath = path.join(eraseRoot, 'matches.json');
  const accounts = new AccountStore(accountPath);
  const victim = accounts.register({ username: 'erasevictim', displayName: 'Victim Display', password: 'long-enough-password' });
  const survivor = accounts.register({ username: 'erasestayer', displayName: 'Survivor Display', password: 'long-enough-password' });
  const victimAccount = accounts.getAccountById(victim.account.id);
  victimAccount.consumedPasswordResetGeneration = 7;
  accounts.persist();
  const record = accounts.recordGameResults([
    { id: 'player-victim', accountId: victim.account.id, nickname: 'Victim Display', cash: 400, properties: [] },
    { id: 'player-survivor', accountId: survivor.account.id, nickname: 'Survivor Display', cash: 600, properties: [] },
  ], 'player-survivor', {
    gameId: 'privacy-erasure-match',
    casino: [{ accountId: victim.account.id, bets: 2, net: -2 }],
    market: [{ accountId: victim.account.id, positions: {} }],
    playerContracts: [{ fromAccountId: victim.account.id, toAccountId: survivor.account.id, status: 'paid' }],
  });
  const matches = new MatchStore(matchPath);
  assert.equal(matches.record(record).created, true);

  const watermarkSnapshot = accounts.snapshot();
  victimAccount.consumedPasswordResetGeneration = 0;
  accounts.restoreSnapshot(watermarkSnapshot);
  assert.equal(accounts.getAccountById(victim.account.id).consumedPasswordResetGeneration, 7, 'account snapshots preserve the internal reset watermark');
  accounts.persist();

  let clock = Date.parse('2026-10-22T10:00:00.000Z');
  const coordinator = createAccountDeletionCoordinator({
    now: () => clock,
    gracePeriodMs: 60_000,
    accountStore: accounts,
    sessionStore: { revokeAccountSessionsExcept: () => 0, revokeAllForAccount: () => 0 },
    roomManager: { rooms: new Map() },
    matchStore: matches,
    mailAdapter: { send: async () => ({ success: true }) },
  });
  assert.equal((await coordinator.request({ accountId: victim.account.id, currentPassword: 'long-enough-password', typedPhrase: 'DELETE ACCOUNT', requestId: 'erase-history' })).state, 'pending');
  clock += 60_001;

  const originalPersist = accounts.persist;
  accounts.persist = () => { throw new Error('accounts.json busy'); };
  assert.equal((await coordinator.runDue()).failed, 1, 'a failed accounts.json write keeps the erasure pending');
  accounts.persist = originalPersist;
  assert.ok(accounts.getAccountById(victim.account.id), 'the victim account remains after the account-store transaction rolls back');
  assert.equal(accounts.getAccountById(victim.account.id).consumedPasswordResetGeneration, 7, 'rollback retains the reset watermark');
  assert.equal(accounts.getAccountById(survivor.account.id).matchHistory[0].participants.find(player => player.accountId === victim.account.id).displayNameAtMatch, 'Victim Display', 'the account-store transaction rolls itself back');
  assert.equal(matches.get(record.matchId).participants.some(player => player.displayNameAtMatch === 'Victim Display'), false, 'completed linked erasure stays in place after a later account-store failure');
  assert.equal(JSON.parse(fs.readFileSync(accountPath, 'utf8')).find(row => row.id === victim.account.id).consumedPasswordResetGeneration, 7, 'the watermark remains durable after rollback');

  assert.equal((await coordinator.runDue()).succeeded, 1, 'the same pending erasure can retry');
  assert.equal(accounts.getAccountById(victim.account.id), null);
  const survivorHistory = accounts.getAccountById(survivor.account.id).matchHistory[0];
  const erasedParticipant = survivorHistory.participants.find(player => player.displayNameAtMatch === 'ACCOUNT DEACTIVATED');
  assert.equal(erasedParticipant?.accountId, null, 'surviving match history no longer retains the erased account id');
  assert.equal(survivorHistory.casino[0].accountId, null);
  assert.equal(survivorHistory.market[0].accountId, null);
  assert.equal(survivorHistory.playerContracts[0].fromAccountId, null);
  assert.equal(survivorHistory.playerContracts[0].toAccountId, survivor.account.id);
  const summary = accounts.getPublicMatchSummaries(survivor.account.id, false).at(0);
  assert.equal(summary.participants.some(player => player.displayNameAtMatch === 'Victim Display'), false, 'public summaries do not disclose the deleted display name');
  assert.equal(summary.participants.some(player => player.displayNameAtMatch === 'ACCOUNT DEACTIVATED'), true);
  const onDisk = fs.readFileSync(accountPath, 'utf8');
  assert.equal(onDisk.includes(victim.account.id), false, 'the victim id is absent from persisted surviving-account histories');
  assert.equal(onDisk.includes('Victim Display'), false, 'the victim display name is absent from persisted surviving-account histories');
  assert.equal(matches.get(record.matchId).participants.some(player => player.displayNameAtMatch === 'Victim Display'), false, 'central match data remains anonymized');
  fs.rmSync(eraseRoot, { recursive: true, force: true });
}

{
  // A deletion request signs out bearer-token devices too, not only cookie sessions; the requester keeps its own token.
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-deletion-legacy-'));
  const store = new AccountStore(path.join(legacyRoot, 'accounts.json'));
  store.register({ username: 'legacy_owner', displayName: 'Legacy', password: 'legacy-pass-123' });
  // Device A signs in and exchanges its bearer token for a cookie session; device B then signs in and keeps its bearer token.
  const loginA = store.login({ username: 'legacy_owner', password: 'legacy-pass-123' });
  const cookieSessions = createSessionStore({ filePath: '', secure: false, sweepIntervalMs: 3_600_000 });
  const exchanged = cookieSessions.exchangeLegacy(loginA.sessionToken, token => store.sessionAccount(token)?.id || null);
  store.revokeSessionToken(loginA.sessionToken);
  const deviceB = store.login({ username: 'legacy_owner', password: 'legacy-pass-123' });
  assert.equal(Boolean(store.sessionAccount(deviceB.sessionToken)), true, 'device B starts signed in');
  const legacyCoordinator = createAccountDeletionCoordinator({
    now: () => now,
    accountStore: store,
    sessionStore: cookieSessions,
    roomManager: { rooms: new Map() },
    mailAdapter: { send: async () => ({ success: true }) },
  });
  const requested = await legacyCoordinator.request({ accountId: loginA.account.id, sessionId: exchanged.sessionId, currentPassword: 'legacy-pass-123', typedPhrase: 'DELETE ACCOUNT', requestId: 'legacy-1' });
  assert.equal(requested.success, true);
  assert.equal(cookieSessions.resolve(exchanged.cookieValue) ? true : false, true, 'the requesting device keeps its cookie session');
  assert.equal(Boolean(store.sessionAccount(deviceB.sessionToken)), false, 'a bearer-token device other than the requester is signed out');
  fs.rmSync(legacyRoot, { recursive: true, force: true });
}

console.log('account deletion: 30 passed, 0 failed');

{
  const pending = { id: 'cookie-first', username: 'cookie-first', deletionRequestedAt: null, deletionDueAt: null };
  let cookieFails = true;
  const calls = [];
  const coordinator = createAccountDeletionCoordinator({
    now: () => now,
    accountStore: {
      getAccountById: () => pending, verifyPassword: () => true, persist: () => {},
      revokeSessionsForAccount: () => { calls.push('bearer'); },
    },
    sessionStore: { revokeAccountSessionsExcept: () => { calls.push('cookie'); if (cookieFails) throw new Error('cookie write failed'); } },
    roomManager: { rooms: new Map() },
  });
  const request = { accountId: pending.id, currentPassword: 'pw', typedPhrase: 'DELETE ACCOUNT', requestId: 'cookie-first' };
  assert.equal((await coordinator.request(request)).success, false);
  assert.deepEqual(calls, ['cookie', 'bearer'], 'bearer revocation is attempted even when cookie revocation fails');
  cookieFails = false;
  assert.equal((await coordinator.request(request)).success, true);
  assert.deepEqual(calls, ['cookie', 'bearer', 'cookie', 'bearer'], 'retry repeats both revocations');
}
