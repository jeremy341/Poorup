import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAccountRecovery, hashToken } from './accountRecovery.js';
import { AccountStore } from './accountStore.js';
import { createSessionStore } from './sessionStore.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-recovery-persist-'));
const filePath = path.join(root, 'recovery.json');
let now = Date.parse('2026-09-17T12:00:00.000Z');
const account = { id: 'acct-1', username: 'owner', recoveryEmail: 'owner@example.test', recoveryEmailVerified: true };
const store = {
  getAccountById: id => id === account.id ? account : null,
  findAccountByUsername: () => account,
  persist: () => {},
  verifyPassword: () => true,
  updatePassword: () => true,
  updatePasswordForRecovery: (_id, password, generation) => {
    account.passwordHash = `updated:${password}`;
    account.consumedPasswordResetGeneration = Math.max(Number(account.consumedPasswordResetGeneration) || 0, generation);
    return true;
  }
};
const mail = [];
const mailAdapter = { send: async message => { mail.push(message); return { success: true }; } };
const first = createAccountRecovery({ accountStore: store, filePath, now: () => now, publicOrigin: 'https://play.example.test', mailAdapter });
const issued = await first.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
const token = new URL(mail.at(-1).variables.actionUrl).searchParams.get('token');
assert.equal(issued.token, undefined, 'the caller never receives the token');
assert.equal(fs.readFileSync(filePath, 'utf8').includes(token), false);
const second = createAccountRecovery({ accountStore: store, filePath, now: () => now, publicOrigin: 'https://play.example.test', mailAdapter });
assert.equal(await second.consumePasswordReset(token, 'new-password'), true);
now += 31 * 60 * 1000;
assert.equal(second.prune(), 0);

// A matching and a non-matching reset request do the same disk work, and a
// failed persist leaves no token in memory (nothing mailed, earlier token intact).
{
  const guardedPath = path.join(root, 'guarded.json');
  const guardedMail = [];
  const guarded = createAccountRecovery({ accountStore: store, filePath: guardedPath, now: () => now, publicOrigin: 'https://play.example.test', mailAdapter: { send: async message => { guardedMail.push(message); return { success: true }; } } });
  const realRename = fs.renameSync;
  let failing = false;
  let targetWrites = 0;
  fs.renameSync = (from, to) => {
    if (to === guardedPath) {
      if (failing) throw new Error('disk busy');
      targetWrites += 1;
    }
    return realRename(from, to);
  };
  const realError = console.error;
  console.error = () => {};
  try {
    targetWrites = 0;
    await guarded.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
    const matchingWrites = targetWrites;
    targetWrites = 0;
    await guarded.requestPasswordReset({ username: 'owner', email: 'nobody@example.test' });
    assert.equal(targetWrites, matchingWrites, 'a non-matching request costs the same synchronous disk write as a matching one');
    const firstToken = new URL(guardedMail.at(-1).variables.actionUrl).searchParams.get('token');
    const sentBefore = guardedMail.length;
    failing = true;
    const failedReset = await guarded.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
    assert.equal(failedReset.success, true, 'the response does not change when the disk fails');
    assert.equal(failedReset.sent, false);
    assert.equal(guardedMail.length, sentBefore, 'no mail for a token that was not saved');
    assert.equal(guarded.tokenCount(), 1, 'the unsaved token is not kept');
    const failedVerification = await guarded.requestEmailVerification({ accountId: 'acct-1', currentPassword: 'pw', email: 'new@example.test' });
    assert.equal(failedVerification.success, false);
    assert.equal(guarded.tokenCount(), 1);
    assert.equal(guardedMail.length, sentBefore);
    failing = false;
    assert.equal(await guarded.consumePasswordReset(firstToken, 'new-password-1'), true, 'the earlier token still works');
  } finally {
    fs.renameSync = realRename;
    console.error = realError;
  }
}
// A failed account write must leave a verification token available for retry.
{
  const retryPath = path.join(root, 'verification-retry.json');
  const retryAccount = { id: 'verify-retry', username: 'verifyretry', recoveryEmail: 'prior@example.test', recoveryEmailVerified: true };
  let failAccountPersist = false;
  const retryMessages = [];
  const retryStore = {
    getAccountById: id => id === retryAccount.id ? retryAccount : null,
    verifyPassword: () => true,
    persist: () => { if (failAccountPersist) throw new Error('accounts file busy'); },
  };
  const recovery = createAccountRecovery({ accountStore: retryStore, filePath: retryPath, now: () => now, publicOrigin: 'https://play.example.test', mailAdapter: { send: async message => { retryMessages.push(message); return { success: true }; } } });
  await recovery.requestEmailVerification({ accountId: retryAccount.id, currentPassword: 'pw', email: 'next@example.test' });
  const token = new URL(retryMessages[0].variables.actionUrl).searchParams.get('token');
  const tokenHash = hashToken(token);
  failAccountPersist = true;
  assert.equal(await recovery.consumeEmailVerification(token), false, 'a failed durable account update is not reported as successful');
  assert.equal(retryAccount.recoveryEmail, 'prior@example.test', 'the in-memory account is rolled back after a failed write');
  assert.equal(retryAccount.recoveryEmailVerified, true);
  assert.equal(retryAccount.pendingRecoveryEmail, 'next@example.test');
  assert.equal(recovery.tokenCount(), 1, 'the token remains available for a retry');
  assert.equal(JSON.parse(fs.readFileSync(retryPath, 'utf8')).some(entry => entry.tokenHash === tokenHash), true, 'the token remains durable after account persistence fails');
  failAccountPersist = false;
  assert.equal(await recovery.consumeEmailVerification(token), true, 'the same verification link succeeds after the store recovers');
  assert.equal(retryAccount.recoveryEmail, 'next@example.test');
  assert.equal(retryAccount.recoveryEmailVerified, true);
}
// A recovery generation stored with the password makes token consumption
// durable even if cleanup of the separate token file cannot be written.
{
  const revokePath = path.join(root, 'revoke.json');
  const revokeMail = [];
  const revokedSessions = [];
  const revokedAccounts = [];
  const flakyStore = {
    getAccountById: id => (id === account.id ? account : null),
    findAccountByUsername: () => account,
    persist: () => {},
    verifyPassword: () => true,
    updatePassword: () => true,
    updatePasswordForRecovery: (_id, password, generation) => {
      account.passwordHash = `updated:${password}`;
      account.consumedPasswordResetGeneration = Math.max(Number(account.consumedPasswordResetGeneration) || 0, generation);
      revokedAccounts.push(_id);
      return true;
    },
    revokeSessionsForAccount: id => { revokedAccounts.push(id); return 1; },
  };
  const flaky = createAccountRecovery({
    accountStore: flakyStore,
    sessionStore: { revokeAllForAccount: id => { revokedSessions.push(id); return 1; } },
    filePath: revokePath,
    now: () => now,
    publicOrigin: 'https://play.example.test',
    mailAdapter: { send: async message => { revokeMail.push(message); return { success: true }; } },
  });
  await flaky.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
  const resetToken = new URL(revokeMail.at(-1).variables.actionUrl).searchParams.get('token');
  const realRename = fs.renameSync;
  let failing = false;
  fs.renameSync = (from, to) => {
    if (failing && to === revokePath) throw new Error('disk busy');
    return realRename(from, to);
  };
  const realError = console.error;
  console.error = () => {};
  try {
    failing = true;
    const consumed = await flaky.consumePasswordReset(resetToken, 'new-password-2');
    assert.equal(consumed, true, 'the password and durable generation watermark complete the reset');
    assert.deepEqual(revokedAccounts, [account.id], 'the live sessions are revoked even when the token write failed');
    assert.deepEqual(revokedSessions, [account.id], 'the cookie sessions are revoked even when the token write failed');
    const restarted = createAccountRecovery({ accountStore: flakyStore, filePath: revokePath, now: () => now, publicOrigin: 'https://play.example.test', mailAdapter: { send: async () => ({ success: true }) } });
    assert.equal(await restarted.consumePasswordReset(resetToken, 'replayed-password'), false, 'the durable account watermark rejects the stale file entry after restart');
  } finally {
    fs.renameSync = realRename;
    console.error = realError;
  }
}

// A consumed watermark survives a restart alongside the password, rejects an
// old token left in recovery-tokens.json, and allows the next reset link.
{
  const durableRoot = path.join(root, 'watermark');
  fs.mkdirSync(durableRoot, { recursive: true });
  const accountPath = path.join(durableRoot, 'accounts.json');
  const tokenPath = path.join(durableRoot, 'recovery.json');
  const sessionPath = path.join(durableRoot, 'sessions.json');
  let clock = Date.parse('2026-10-22T10:00:00.000Z');
  const accounts = new AccountStore(accountPath);
  const registered = accounts.register({ username: 'resetprobe', displayName: 'Reset Probe', password: 'old-password-123' });
  const stored = accounts.getAccountById(registered.account.id);
  stored.recoveryEmail = 'reset@example.test';
  stored.recoveryEmailVerified = true;
  accounts.persist();
  const sessions = createSessionStore({ filePath: sessionPath, now: () => clock });
  const cookie = sessions.issue(stored.id);
  const messages = [];
  const mailAdapter = { send: async message => { messages.push(message); return { success: true }; } };
  const recovery = createAccountRecovery({ accountStore: accounts, sessionStore: sessions, filePath: tokenPath, now: () => clock, publicOrigin: 'https://play.example.test', mailAdapter });
  await recovery.requestPasswordReset({ username: stored.username, email: stored.recoveryEmail });
  const token = new URL(messages.at(-1).variables.actionUrl).searchParams.get('token');
  const realRename = fs.renameSync;
  let failTokenWrite = true;
  const quiet = console.error;
  console.error = () => {};
  fs.renameSync = (from, to) => {
    if (failTokenWrite && to === tokenPath) throw new Error('recovery file busy');
    return realRename(from, to);
  };
  try {
    assert.equal(await recovery.consumePasswordReset(token, 'new-password-123'), true, 'reset completion is durable with the account watermark');
  } finally {
    fs.renameSync = realRename;
    console.error = quiet;
  }
  const watermark = accounts.getAccountById(stored.id).consumedPasswordResetGeneration;
  assert.ok(Number.isSafeInteger(watermark) && watermark > 0);
  assert.equal(sessions.resolve(cookie.cookieValue), null, 'the pre-reset cookie session is revoked');
  assert.equal(Object.hasOwn(accounts.getAccountSnapshot(stored.id), 'consumedPasswordResetGeneration'), false, 'the internal watermark is not returned in public account data');
  sessions.close();

  const reloadedAccounts = new AccountStore(accountPath);
  assert.equal(reloadedAccounts.getAccountById(stored.id).consumedPasswordResetGeneration, watermark, 'the watermark reloads with the password');
  const reloadedSessions = createSessionStore({ filePath: sessionPath, now: () => clock });
  assert.equal(reloadedSessions.resolve(cookie.cookieValue), null, 'the revoked session stays invalid after restart');
  const reloadedRecovery = createAccountRecovery({ accountStore: reloadedAccounts, sessionStore: reloadedSessions, filePath: tokenPath, now: () => clock, publicOrigin: 'https://play.example.test', mailAdapter });
  assert.equal(await reloadedRecovery.consumePasswordReset(token, 'replay-password-123'), false, 'an old reset token remains invalid after restart');

  await reloadedRecovery.requestPasswordReset({ username: stored.username, email: stored.recoveryEmail });
  const nextToken = new URL(messages.at(-1).variables.actionUrl).searchParams.get('token');
  assert.notEqual(nextToken, token);
  assert.equal(await reloadedRecovery.consumePasswordReset(nextToken, 'next-password-123'), true, 'a new reset after restart remains usable');
  assert.ok(reloadedAccounts.getAccountById(stored.id).consumedPasswordResetGeneration > watermark, 'new reset generations advance past the persisted watermark');
  reloadedSessions.close();
}

// Pre-watermark account rows and recovery tokens without generations remain
// compatible once, then the new durable marker prevents their replay.
{
  const legacyRoot = path.join(root, 'legacy-generation');
  fs.mkdirSync(legacyRoot, { recursive: true });
  const accountPath = path.join(legacyRoot, 'accounts.json');
  const tokenPath = path.join(legacyRoot, 'recovery.json');
  const writer = new AccountStore(accountPath);
  const registered = writer.register({ username: 'legacyprobe', displayName: 'Legacy Probe', password: 'old-password-123' });
  const oldAccountRow = JSON.parse(fs.readFileSync(accountPath, 'utf8'));
  delete oldAccountRow[0].consumedPasswordResetGeneration;
  fs.writeFileSync(accountPath, JSON.stringify(oldAccountRow));
  const accounts = new AccountStore(accountPath);
  const account = accounts.getAccountById(registered.account.id);
  assert.equal(account.consumedPasswordResetGeneration, 0, 'an old account row loads with a zero watermark');
  account.recoveryEmail = 'legacy@example.test';
  account.recoveryEmailVerified = true;
  accounts.persist();

  const legacyToken = 'legacy-reset-token-without-generation';
  const clock = Date.parse('2026-10-22T10:00:00.000Z');
  fs.writeFileSync(tokenPath, JSON.stringify([{
    tokenHash: hashToken(legacyToken),
    accountId: account.id,
    kind: 'password-reset',
    issuedAt: clock,
    expiresAt: clock + 30 * 60 * 1000,
  }]));
  const recovery = createAccountRecovery({ accountStore: accounts, filePath: tokenPath, now: () => clock, publicOrigin: 'https://play.example.test', mailAdapter: { send: async () => ({ success: true }) } });
  assert.equal(recovery.tokenCount(), 1, 'a pre-generation token remains usable when no reset watermark exists');
  assert.equal(await recovery.consumePasswordReset(legacyToken, 'new-password-123'), true);
  const watermark = accounts.getAccountById(account.id).consumedPasswordResetGeneration;
  assert.ok(watermark > 0, 'consuming a legacy token writes a generation watermark');

  fs.writeFileSync(tokenPath, JSON.stringify([{
    tokenHash: hashToken(legacyToken),
    accountId: account.id,
    kind: 'password-reset',
    issuedAt: clock,
    expiresAt: clock + 30 * 60 * 1000,
  }]));
  const restarted = createAccountRecovery({ accountStore: new AccountStore(accountPath), filePath: tokenPath, now: () => clock, publicOrigin: 'https://play.example.test', mailAdapter: { send: async () => ({ success: true }) } });
  assert.equal(restarted.tokenCount(), 0, 'a stale pre-generation token is rejected once the account has a watermark');
  assert.equal(await restarted.consumePasswordReset(legacyToken, 'replayed-password-123'), false);
}

// A failed cookie-session revocation is a failed reset; the password and reset
// token stay usable so a retry can finish once the session store is writable.
{
  const retryRoot = path.join(root, 'retry');
  fs.mkdirSync(retryRoot, { recursive: true });
  const accountPath = path.join(retryRoot, 'accounts.json');
  const tokenPath = path.join(retryRoot, 'recovery.json');
  const sessionPath = path.join(retryRoot, 'sessions.json');
  let clock = Date.parse('2026-10-22T10:00:00.000Z');
  const accounts = new AccountStore(accountPath);
  const registered = accounts.register({ username: 'retryprobe', displayName: 'Retry Probe', password: 'old-password-123' });
  const stored = accounts.getAccountById(registered.account.id);
  stored.recoveryEmail = 'retry@example.test';
  stored.recoveryEmailVerified = true;
  accounts.persist();
  const sessions = createSessionStore({ filePath: sessionPath, now: () => clock });
  const cookie = sessions.issue(stored.id);
  const messages = [];
  const recovery = createAccountRecovery({ accountStore: accounts, sessionStore: sessions, filePath: tokenPath, now: () => clock, publicOrigin: 'https://play.example.test', mailAdapter: { send: async message => { messages.push(message); return { success: true }; } } });
  await recovery.requestPasswordReset({ username: stored.username, email: stored.recoveryEmail });
  const token = new URL(messages.at(-1).variables.actionUrl).searchParams.get('token');
  const realRename = fs.renameSync;
  let failSessionWrite = true;
  fs.renameSync = (from, to) => {
    if (failSessionWrite && to === sessionPath) throw new Error('sessions file busy');
    return realRename(from, to);
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(await recovery.consumePasswordReset(token, 'new-password-123'), false, 'a reset cannot report success while cookie revocation failed');
  } finally {
    fs.renameSync = realRename;
    console.error = quiet;
  }
  assert.equal(accounts.verifyPassword(stored, 'old-password-123'), true, 'the old password remains valid after a failed revocation');
  assert.equal(sessions.resolve(cookie.cookieValue).accountId, stored.id, 'the failed session write restores the old cookie');
  assert.equal(Number(stored.consumedPasswordResetGeneration) || 0, 0, 'the token is not durably consumed before session revocation');

  failSessionWrite = false;
  assert.equal(await recovery.consumePasswordReset(token, 'new-password-123'), true, 'the same reset link succeeds on retry');
  assert.equal(sessions.resolve(cookie.cookieValue), null, 'the retry revokes the old cookie');
  assert.equal(accounts.verifyPassword(stored, 'new-password-123'), true);
  sessions.close();
}
fs.rmSync(root, { recursive: true, force: true });
console.log('account recovery persistence: durability, generation and retry scenarios passed');

// Replacing a pending address must be atomic from the link owner's perspective.
{
  const requestPath = path.join(root, 'verification-request-rollback.json');
  const account = { id: 'request-rollback', username: 'requestrollback' };
  let failAccountWrite = false;
  let failTokenCleanup = false;
  const messages = [];
  const accountStore = {
    getAccountById: () => account,
    verifyPassword: () => true,
    persist: () => { if (failAccountWrite) { failTokenCleanup = true; throw new Error('account write failed'); } },
  };
  const recovery = createAccountRecovery({ accountStore, filePath: requestPath, now: () => now, publicOrigin: 'https://play.example.test', mailAdapter: { send: async message => { messages.push(message); return { success: true }; } } });
  const request = email => recovery.requestEmailVerification({ accountId: account.id, currentPassword: 'pw', email });
  assert.equal((await request('previous@example.test')).success, true);
  const previousToken = new URL(messages[0].variables.actionUrl).searchParams.get('token');
  const previousHash = account.pendingRecoveryEmailTokenHash;
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === requestPath && failTokenCleanup) throw new Error('token cleanup failed'); return rename(from, to); };
  const consoleError = console.error;
  console.error = () => {};
  try {
    failAccountWrite = true;
    const failed = await request('previous@example.test');
    assert.equal(failed.success, false, 'a sent email is not reported as successful when account persistence fails');
    const orphanToken = new URL(messages[1].variables.actionUrl).searchParams.get('token');
    assert.equal(account.pendingRecoveryEmail, 'previous@example.test');
    assert.equal(account.pendingRecoveryEmailTokenHash, previousHash);
    assert.equal(await recovery.consumeEmailVerification(orphanToken), false, 'orphan link is unusable in memory');
    failAccountWrite = false;
    failTokenCleanup = false;
    const restarted = createAccountRecovery({ accountStore, filePath: requestPath, now: () => now, publicOrigin: 'https://play.example.test', mailAdapter: { send: async () => ({ success: true }) } });
    assert.equal(await restarted.consumeEmailVerification(orphanToken), false, 'orphan left on disk is unusable after restart');
    assert.equal(await restarted.consumeEmailVerification(previousToken), true, 'previous pending link survives restart and failed cleanup');
    assert.equal((await request('retry@example.test')).success, true, 'a fresh request works after storage recovers');
  } finally { fs.renameSync = rename; console.error = consoleError; }
}

// A cleanup write failure after the account commit cannot revive the old link.
{
  const file = path.join(root, 'verification-cleanup.json');
  const account = { id: 'cleanup', username: 'cleanup' };
  const sent = [];
  const accountStore = { getAccountById: () => account, verifyPassword: () => true, persist: () => {} };
  const recovery = createAccountRecovery({ accountStore, filePath: file, now: () => now, publicOrigin: 'https://play.example.test', mailAdapter: { send: async message => { sent.push(message); return { success: true }; } } });
  const request = email => recovery.requestEmailVerification({ accountId: account.id, currentPassword: 'pw', email });
  assert.equal((await request('same@example.test')).success, true);
  let writes = 0;
  const rename = fs.renameSync;
  const consoleError = console.error;
  fs.renameSync = (from, to) => { if (to === file && ++writes === 2) throw new Error('cleanup write failed'); return rename(from, to); };
  console.error = () => {};
  try {
    assert.equal((await request('same@example.test')).success, true, 'committed pending state remains valid if token cleanup fails');
  } finally { fs.renameSync = rename; console.error = consoleError; }
  const oldToken = new URL(sent[0].variables.actionUrl).searchParams.get('token');
  const newToken = new URL(sent[1].variables.actionUrl).searchParams.get('token');
  const restarted = createAccountRecovery({ accountStore, filePath: file, now: () => now, publicOrigin: 'https://play.example.test', mailAdapter: { send: async () => ({ success: true }) } });
  assert.equal(await restarted.consumeEmailVerification(oldToken), false, 'old token left on disk cannot verify after restart');
  assert.equal(await restarted.consumeEmailVerification(newToken), true, 'durable pending token remains usable');
}
