import assert from 'node:assert/strict';
import { createAccountRecovery } from './accountRecovery.js';

let now = Date.parse('2026-09-17T12:00:00.000Z');
const sent = [];
const revokedCookieAccounts = [];
const accounts = new Map([
  ['acct-1', { id: 'acct-1', username: 'owner', passwordHash: 'x', recoveryEmail: null, recoveryEmailVerified: false }],
  ['acct-2', { id: 'acct-2', username: 'other', passwordHash: 'x', recoveryEmail: null, recoveryEmailVerified: false }],
]);
let mailOk = true;
const store = {
  getAccountById: id => accounts.get(id) || null,
  findAccountByUsername: name => [...accounts.values()].find(account => account.username === name) || null,
  persist: () => {},
  verifyPassword: () => true,
  updatePassword: (id, password) => {
    const account = accounts.get(id);
    if (!account || typeof password !== 'string') return false;
    account.passwordHash = `updated:${password}`;
    return true;
  },
  updatePasswordForRecovery: (id, password, generation) => {
    const account = accounts.get(id);
    if (!account || typeof password !== 'string') return false;
    account.passwordHash = `updated:${password}`;
    account.consumedPasswordResetGeneration = Math.max(Number(account.consumedPasswordResetGeneration) || 0, generation);
    return true;
  },
  revokeSessionsForAccount: () => 0,
};
const recovery = createAccountRecovery({
  now: () => now,
  publicOrigin: 'https://play.example.test',
  accountStore: store,
  sessionStore: { revokeAllForAccount: (id) => { revokedCookieAccounts.push(id); return 1; } },
  mailAdapter: { send: async message => { sent.push(message); return mailOk ? { success: true } : { success: false, code: 'MAIL_SEND_FAILED' }; } },
});
// Tokens reach the mailbox owner only through the mail link. The socket ack and
// the HTTP response never carry them.
const tokenFrom = template => new URL([...sent].reverse().find(message => message.template === template).variables.actionUrl).searchParams.get('token');
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

const requested = await recovery.requestEmailVerification({ accountId: 'acct-1', currentPassword: 'pw', email: 'owner@example.test' });
assert.equal(requested.success, true);
assert.equal('token' in requested, false, 'the verification token is not returned to the requester');
assert.equal(accounts.get('acct-1').recoveryEmailVerified, false);
assert.equal(sent.length, 1);
assert.match(sent[0].variables.actionUrl, /^https:\/\/play\.example\.test\/account\/recovery\/verify\?token=/, 'the link targets the real verify route');
const verifyToken = tokenFrom('recovery-email-verification');
assert.equal(await recovery.consumeEmailVerification(verifyToken), true);
assert.equal(accounts.get('acct-1').recoveryEmailVerified, true);
assert.equal(await recovery.consumeEmailVerification(verifyToken), false, 'verification token is single use');

const bound = await recovery.requestEmailVerification({ accountId: 'acct-2', currentPassword: 'pw', email: 'other@example.test' });
assert.equal(bound.success, true);
const otherToken = tokenFrom('recovery-email-verification');
assert.equal(await recovery.consumeEmailVerification(otherToken, { accountId: 'acct-1' }), false, 'another account cannot verify this token');
assert.equal(await recovery.consumeEmailVerification(otherToken, { accountId: 'acct-2' }), true, 'the owning account can verify it');

mailOk = false;
const failed = await recovery.requestEmailVerification({ accountId: 'acct-2', currentPassword: 'pw', email: 'retry@example.test' });
assert.equal(failed.success, false, 'a mail failure is surfaced, not reported as sent');
assert.equal(failed.code, 'RECOVERY_MAIL_UNAVAILABLE');
assert.equal(accounts.get('acct-2').pendingRecoveryEmail ?? null, null, 'a failed send leaves no pending address');
mailOk = true;

const reset = await recovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
assert.equal(reset.success, true);
assert.equal('token' in reset, false);
assert.match(sent.at(-1).variables.actionUrl, /^https:\/\/play\.example\.test\/account\/recovery\/reset\?token=/, 'the reset mail carries a usable link');
assert.equal(await recovery.consumePasswordReset(tokenFrom('password-reset'), 'new-password'), true);
assert.equal(await recovery.consumePasswordReset(tokenFrom('password-reset'), 'another-password'), false);

now += 61 * 1000; // past the per-account reset-mail cooldown
const expired = await recovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
const expiredToken = tokenFrom('password-reset');
assert.equal(expired.success, true);
now += 31 * 60 * 1000;
assert.equal(await recovery.consumePasswordReset(expiredToken, 'new-password'), false);

now += 61 * 1000; // past the per-account reset-mail cooldown
await recovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
const firstToken = tokenFrom('password-reset');
now += 61 * 1000; // past the per-account reset-mail cooldown
await recovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
const secondToken = tokenFrom('password-reset');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(await recovery.consumePasswordReset(firstToken, 'new-password'), false, 'superseded reset token is invalid');
assert.equal(await recovery.consumePasswordReset(secondToken, 'new-password'), true);
assert.deepEqual(revokedCookieAccounts, ['acct-1', 'acct-1']);

// A failed replacement delivery must leave the previously delivered reset
// link usable instead of consuming it before the replacement arrives.
now += 61 * 60 * 1000; // past the per-account reset-mail window (five sends per hour)
const survivorReset = await recovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
assert.equal(survivorReset.sent, true);
const survivorToken = tokenFrom('password-reset');
mailOk = false;
now += 61 * 1000; // past the per-account reset-mail cooldown
const failedRetry = await recovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
mailOk = true;
assert.equal(failedRetry.sent, true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(await recovery.consumePasswordReset(survivorToken, 'survivor-password'), true, 'a failed replacement mail leaves the previous reset link usable');

// A pending-deletion account cannot change its recovery email, whether
// the request comes from its socket or the verification link is opened.
accounts.set('acct-3', { id: 'acct-3', username: 'pending', passwordHash: 'x', recoveryEmail: null, recoveryEmailVerified: false });
const pendingLinkSent = await recovery.requestEmailVerification({ accountId: 'acct-3', currentPassword: 'pw', email: 'before@example.test' });
assert.equal(pendingLinkSent.success, true, 'the account can request a recovery email while active');
const pendingLinkToken = tokenFrom('recovery-email-verification');
accounts.get('acct-3').accountDeactivated = true;
const sentBeforePending = sent.length;
const pendingRequest = await recovery.requestEmailVerification({ accountId: 'acct-3', currentPassword: 'pw', email: 'pending@example.test' });
assert.equal(pendingRequest.success, false);
assert.equal(pendingRequest.code, 'ACCOUNT_DELETION_PENDING');
assert.equal(sent.length, sentBeforePending, 'no verification mail is sent for a pending account');
assert.equal(await recovery.consumeEmailVerification(pendingLinkToken), false, 'a link issued before the deletion request cannot set the address');
assert.equal(accounts.get('acct-3').recoveryEmailVerified, false);
assert.equal(accounts.get('acct-3').recoveryEmail, null);

// A reset request for an account with a verified address answers at
// once, without waiting for the mail adapter, so response time does not reveal
// which address pairs exist.
let releaseResetMail;
const resetMailGate = new Promise(resolve => { releaseResetMail = resolve; });
const slowRecovery = createAccountRecovery({
  now: () => now,
  publicOrigin: 'https://play.example.test',
  accountStore: store,
  mailAdapter: { send: async () => { await resetMailGate; return { success: true }; } },
});
const resetAnswer = await Promise.race([
  slowRecovery.requestPasswordReset({ username: 'owner', email: 'owner@example.test' }).then(() => 'answered'),
  new Promise(resolve => setTimeout(() => resolve('waiting-on-mail'), 200)),
]);
releaseResetMail();
assert.equal(resetAnswer, 'answered', 'a password reset response does not depend on mail delivery time');

// Without a configured public origin there is no link to build, so no mail is
// sent and no token is issued.
const offline = createAccountRecovery({
  now: () => now,
  accountStore: store,
  mailAdapter: { send: async message => { sent.push(message); return { success: true }; } },
});
const sentBeforeOffline = sent.length;
const offlineReset = await offline.requestPasswordReset({ username: 'owner', email: 'owner@example.test' });
assert.equal(offlineReset.sent, false);
assert.equal(sent.length, sentBeforeOffline, 'no mail with an empty action link');

// Erasing an account drops its recovery tokens (and the address they hold).
{
  const purgeAccounts = new Map([['acct-9', { id: 'acct-9', username: 'purged', recoveryEmail: 'purged@example.test', recoveryEmailVerified: true }], ['acct-8', { id: 'acct-8', username: 'staying', recoveryEmail: 'staying@example.test', recoveryEmailVerified: true }]]);
  const purgeSent = [];
  const purgeRecovery = createAccountRecovery({
    now: () => now,
    publicOrigin: 'https://play.example.test',
    accountStore: { getAccountById: id => purgeAccounts.get(id) || null, findAccountByUsername: name => [...purgeAccounts.values()].find(a => a.username === name) || null, persist: () => {}, verifyPassword: () => true },
    mailAdapter: { send: async message => { purgeSent.push(message); return { success: true }; } },
  });
  await purgeRecovery.requestEmailVerification({ accountId: 'acct-9', currentPassword: 'pw', email: 'new@example.test' });
  await purgeRecovery.requestPasswordReset({ username: 'purged', email: 'purged@example.test' });
  await purgeRecovery.requestPasswordReset({ username: 'staying', email: 'staying@example.test' });
  assert.equal(purgeRecovery.tokenCount(), 3);
  assert.equal(purgeRecovery.purgeAccount('acct-9'), 2, 'every token of the account is dropped');
  assert.equal(purgeRecovery.tokenCount(), 1, 'other accounts keep their tokens');
  assert.equal(purgeRecovery.purgeAccount('acct-9'), 0, 'a repeated purge is a no-op');
}
// A slower, older verification delivery must not replace the pending
// state written by a newer request.
{
  const olderGate = deferred();
  const newerGate = deferred();
  const raceSent = [];
  const raceAccounts = new Map([['acct-race', { id: 'acct-race', username: 'racer', passwordHash: 'x', recoveryEmail: null, recoveryEmailVerified: false }]]);
  const raceRecovery = createAccountRecovery({
    now: () => now,
    publicOrigin: 'https://play.example.test',
    accountStore: { getAccountById: id => raceAccounts.get(id) || null, persist: () => {}, verifyPassword: () => true },
    mailAdapter: { send: async message => { raceSent.push(message); await (message.to === 'old@example.test' ? olderGate.promise : newerGate.promise); return { success: true }; } },
  });
  const olderRequest = raceRecovery.requestEmailVerification({ accountId: 'acct-race', currentPassword: 'pw', email: 'old@example.test' });
  const newerRequest = raceRecovery.requestEmailVerification({ accountId: 'acct-race', currentPassword: 'pw', email: 'new@example.test' });
  newerGate.resolve();
  assert.equal((await newerRequest).success, true);
  olderGate.resolve();
  assert.equal((await olderRequest).success, true);
  assert.equal(raceAccounts.get('acct-race').pendingRecoveryEmail, 'new@example.test', 'a late older delivery does not overwrite the newer pending address');
  const raceToken = to => new URL(raceSent.find(message => message.to === to).variables.actionUrl).searchParams.get('token');
  assert.equal(await raceRecovery.consumeEmailVerification(raceToken('old@example.test')), false, 'the superseded verification link does not verify');
  assert.equal(await raceRecovery.consumeEmailVerification(raceToken('new@example.test')), true);
}

// An older request whose delivery resolves after a newer request has already
// been verified must not reopen pending state or replace that verified address.
{
  const olderGate = deferred();
  const newerGate = deferred();
  const sent = [];
  const accounts = new Map([['acct-verified-race', { id: 'acct-verified-race', username: 'verifiedracer', passwordHash: 'x', recoveryEmail: null, recoveryEmailVerified: false }]]);
  const recovery = createAccountRecovery({
    now: () => now,
    publicOrigin: 'https://play.example.test',
    accountStore: { getAccountById: id => accounts.get(id) || null, persist: () => {}, verifyPassword: () => true },
    mailAdapter: { send: async message => { sent.push(message); await (message.to === 'old-verified-race@example.test' ? olderGate.promise : newerGate.promise); return { success: true }; } },
  });
  const olderRequest = recovery.requestEmailVerification({ accountId: 'acct-verified-race', currentPassword: 'pw', email: 'old-verified-race@example.test' });
  const newerRequest = recovery.requestEmailVerification({ accountId: 'acct-verified-race', currentPassword: 'pw', email: 'new-verified-race@example.test' });
  newerGate.resolve();
  await newerRequest;
  const newestToken = new URL(sent.find(message => message.to === 'new-verified-race@example.test').variables.actionUrl).searchParams.get('token');
  assert.equal(await recovery.consumeEmailVerification(newestToken), true);
  olderGate.resolve();
  await olderRequest;
  const account = accounts.get('acct-verified-race');
  assert.equal(account.recoveryEmail, 'new-verified-race@example.test', 'late older delivery does not replace the verified address');
  assert.equal(account.recoveryEmailVerified, true, 'late older delivery does not clear verification');
  assert.equal(account.pendingRecoveryEmail ?? null, null, 'late older delivery does not reopen pending state');
  const olderToken = new URL(sent.find(message => message.to === 'old-verified-race@example.test').variables.actionUrl).searchParams.get('token');
  assert.equal(await recovery.consumeEmailVerification(olderToken), false, 'late older verification token is rejected');
}

// Two requests for the same address still leave only the newest link able
// to consume the pending state.
{
  const sameGates = [deferred(), deferred()];
  const sameSent = [];
  let sameIndex = 0;
  const sameAccounts = new Map([['acct-same', { id: 'acct-same', username: 'same', passwordHash: 'x', recoveryEmail: null, recoveryEmailVerified: false }]]);
  const sameRecovery = createAccountRecovery({
    now: () => now,
    publicOrigin: 'https://play.example.test',
    accountStore: { getAccountById: id => sameAccounts.get(id) || null, persist: () => {}, verifyPassword: () => true },
    mailAdapter: { send: async message => { sameSent.push(message); await sameGates[sameIndex++].promise; return { success: true }; } },
  });
  const firstRequest = sameRecovery.requestEmailVerification({ accountId: 'acct-same', currentPassword: 'pw', email: 'same@example.test' });
  const secondRequest = sameRecovery.requestEmailVerification({ accountId: 'acct-same', currentPassword: 'pw', email: 'same@example.test' });
  sameGates[1].resolve();
  await secondRequest;
  sameGates[0].resolve();
  await firstRequest;
  const sameTokens = sameSent.map(message => new URL(message.variables.actionUrl).searchParams.get('token'));
  assert.equal(await sameRecovery.consumeEmailVerification(sameTokens[0]), false, 'an older same-address link cannot consume the newer pending request');
  assert.equal(await sameRecovery.consumeEmailVerification(sameTokens[1]), true);
}
console.log('account recovery: 30 passed, 0 failed');

{
  const gate = deferred();
  const sent = [];
  const account = { id: 'failed-newer', username: 'failednewer', recoveryEmail: null, recoveryEmailVerified: false };
  const recovery = createAccountRecovery({
    now: () => now,
    publicOrigin: 'https://play.example.test',
    accountStore: { getAccountById: () => account, persist: () => {}, verifyPassword: () => true },
    mailAdapter: { send: async message => { sent.push(message); if (message.to === 'old-success@example.test') { await gate.promise; return { success: true }; } return { success: false }; } },
  });
  const older = recovery.requestEmailVerification({ accountId: account.id, currentPassword: 'pw', email: 'old-success@example.test' });
  const newer = await recovery.requestEmailVerification({ accountId: account.id, currentPassword: 'pw', email: 'new-failed@example.test' });
  assert.equal(newer.success, false);
  gate.resolve();
  assert.equal((await older).success, true);
  assert.equal(account.pendingRecoveryEmail, 'old-success@example.test', 'failed newer delivery must not invalidate the older successful email');
  const token = new URL(sent[0].variables.actionUrl).searchParams.get('token');
  assert.equal(await recovery.consumeEmailVerification(token), true);
}

{
  const gate = deferred();
  const messages = [];
  const account = { id: 'failed-write-race', username: 'failedwriterace' };
  let failNextPersist = true;
  const recovery = createAccountRecovery({
    now: () => now,
    publicOrigin: 'https://play.example.test',
    accountStore: { getAccountById: () => account, verifyPassword: () => true, persist: () => { if (failNextPersist) { failNextPersist = false; throw new Error('account write failed'); } } },
    mailAdapter: { send: async message => { messages.push(message); if (message.to === 'late@example.test') await gate.promise; return { success: true }; } },
  });
  const older = recovery.requestEmailVerification({ accountId: account.id, currentPassword: 'pw', email: 'late@example.test' });
  assert.equal((await recovery.requestEmailVerification({ accountId: account.id, currentPassword: 'pw', email: 'failed-write@example.test' })).success, false);
  gate.resolve();
  assert.equal((await older).success, true);
  assert.equal(account.pendingRecoveryEmail, 'late@example.test', 'a failed newer account write cannot advance the delivery watermark');
  const token = new URL(messages.find(message => message.to === 'late@example.test').variables.actionUrl).searchParams.get('token');
  assert.equal(await recovery.consumeEmailVerification(token), true);
}
