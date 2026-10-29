import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backupJsonFile, backupJsonStores, eraseAccountFromBackups, isBackupStoreCandidate, restoreJsonBackup, verifyBackup, pruneBackupsByAge } from './backupStore.js';
import { AccountStore } from './accountStore.js';
import { loadJson, writeJson } from './storeIO.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const copiesIn = (directory, prefix) => (fs.existsSync(directory) ? fs.readdirSync(directory) : [])
  .filter(name => name.startsWith(prefix) && name.endsWith('.json'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-backup-'));
const source = path.join(dir, 'accounts.json');
const backupDir = path.join(dir, 'backups');
fs.writeFileSync(source, '[{"id":"a"}]');
const result = backupJsonFile(source, backupDir, { now: Date.UTC(2026, 0, 1) });
assert.equal(result.success, true);
assert.equal(verifyBackup(result.path).success, true);
const destination = path.join(dir, 'restored.json');
assert.equal(restoreJsonBackup(result.path, destination).success, true);
assert.equal(fs.readFileSync(destination, 'utf8'), '[{"id":"a"}]');
assert.equal(backupJsonStores({ accounts: source, missing: path.join(dir, 'missing.json') }, backupDir, { now: Date.UTC(2026, 0, 1) }).results.length, 2);
assert.equal(backupJsonStores({}, backupDir).success, false);
assert.match(backupJsonStores({}, backupDir).error, /source stores/i);
backupJsonFile(source, backupDir, { retention: 1, now: Date.UTC(2026, 0, 2) });
backupJsonFile(source, backupDir, { retention: 1, now: Date.UTC(2026, 0, 3) });
// The newest-N floor is 1, but the Jan 1 and Jan 2 copies are still the daily
// representatives inside the 30-day window, so tiered retention keeps all three.
const retained = fs.readdirSync(backupDir);
assert.equal(retained.filter(name => name.endsWith('.json')).length, 3);
assert.equal(retained.filter(name => name.endsWith('.sha256')).length, 3);
// Destinations with .. segments and unlisted absolute roots are rejected.
const retainedPath = path.join(backupDir, retained.find(name => name.endsWith('.json')));
assert.equal(restoreJsonBackup(retainedPath, `${backupDir}/../escape.json`).success, false);
assert.equal(restoreJsonBackup(retainedPath, path.join(dir, 'ok.json'), { allowDirs: [backupDir] }).success, false);
assert.equal(restoreJsonBackup(retainedPath, path.join(dir, 'ok.json'), { allowDirs: [dir] }).success, true);
// Invalid aged backups are quarantined instead of lingering forever. The three verified copies above
// are all older than the cutoff, so the two older ones are pruned. The newest verified copy of a store
// is always kept, so a long backup outage cannot age out the last good copy.
fs.writeFileSync(path.join(backupDir, 'tampered.json'), '{"partial":');
assert.equal(pruneBackupsByAge(backupDir, { olderThan: Date.now() + 1000 }), 2);
assert.equal(copiesIn(backupDir, 'accounts.json.').length, 1, 'the newest verified copy survives age pruning');
assert.equal(copiesIn(backupDir, 'accounts.json.')[0].includes('2026-01-03'), true);
assert.equal(fs.existsSync(path.join(backupDir, 'quarantine', 'tampered.json')), true);

// Tiered retention. Copies are written hourly for the 72 hours before T, plus one 29 days before T
// (two more 30 minutes apart that day) and one 31 days before T. Survivors: the newest 7, one per UTC
// hour for 48 hours, and one per UTC day for 30 days. The May 29 daily copy (age 61h) is the only extra.
const tierDir = path.join(dir, 'tiers');
const tierSource = path.join(dir, 'tier-source.json');
const tierNow = Date.UTC(2026, 5, 1, 12);
fs.writeFileSync(tierSource, '[{"id":"t"}]');
const ages = [31 * DAY, 29 * DAY + 30 * 60 * 1000, 29 * DAY];
for (let hours = 71; hours >= 0; hours -= 1) ages.push(hours * HOUR);
for (const age of ages) backupJsonFile(tierSource, tierDir, { now: tierNow - age });
const stampOf = ms => `tier-source.json.${new Date(ms).toISOString().replace(/[:.]/g, '-')}.json`;
const tierKept = new Set(copiesIn(tierDir, 'tier-source.json.'));
const expectedKept = [];
for (let hours = 0; hours <= 48; hours += 1) expectedKept.push(tierNow - hours * HOUR);
expectedKept.push(tierNow - 61 * HOUR, tierNow - 29 * DAY);
assert.equal(tierKept.size, expectedKept.length, 'tiered retention keeps 51 copies');
for (const ms of expectedKept) assert.equal(tierKept.has(stampOf(ms)), true, `retained ${new Date(ms).toISOString()}`);
assert.equal(tierKept.has(stampOf(tierNow - 49 * HOUR)), false, 'a 49h-old copy is not hourly and shares its day with a kept copy');
assert.equal(tierKept.has(stampOf(tierNow - 29 * DAY - 30 * 60 * 1000)), false, 'only the newest copy per UTC day survives');
assert.equal(tierKept.has(stampOf(tierNow - 31 * DAY)), false, 'copies older than 30 days are rotated out');

// Shrink guard. A store that suddenly holds far less than its recent copies
// keeps every older verified copy. The pause ends once those copies are older
// than the 48-hour window, so an intentional large purge is accepted later.
const guardDir = path.join(dir, 'guard');
const guardSource = path.join(dir, 'guard-source.json');
const guardStart = Date.UTC(2026, 0, 1);
fs.writeFileSync(guardSource, JSON.stringify(Array.from({ length: 200 }, (_value, id) => ({ id }))));
backupJsonFile(guardSource, guardDir, { now: guardStart });
backupJsonFile(guardSource, guardDir, { now: guardStart + 15 * 60 * 1000 });
fs.writeFileSync(guardSource, '[]');
const shrinkWarnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { shrinkWarnings.push(args.join(' ')); };
try {
  for (const minutes of [30, 45, 60]) {
    const shrunk = backupJsonFile(guardSource, guardDir, { now: guardStart + minutes * 60 * 1000, retention: 1 });
    assert.equal(shrunk.success, true);
    assert.equal(shrunk.rotationSkipped, true, 'a shrunken candidate pauses rotation');
  }
} finally {
  console.warn = originalWarn;
}
assert.equal(copiesIn(guardDir, 'guard-source.json.').length, 5, 'both large copies and every shrunken candidate are kept');
assert.equal(shrinkWarnings.length, 1, 'the shrink warning is logged once');
const resumed = backupJsonFile(guardSource, guardDir, { now: guardStart + 50 * HOUR, retention: 1 });
assert.equal(resumed.rotationSkipped, false, 'rotation resumes once the large copies leave the 48-hour window');
assert.equal(copiesIn(guardDir, 'guard-source.json.').length, 2, 'only the newest copy per hour and day survives');

// Quarantined at load: the empty in-memory replacement must not be backed up,
// otherwise its tiny copies rotate the good ones out.
const brokenDir = path.join(dir, 'quarantined');
const brokenBackups = path.join(dir, 'quarantined-backups');
fs.mkdirSync(brokenDir);
const brokenStore = path.join(brokenDir, 'matches.json');
fs.writeFileSync(brokenStore, '{"partial":');
assert.equal(loadJson(brokenStore, value => Array.isArray(value)).corrupt, true);
assert.equal(isBackupStoreCandidate(brokenStore), true, 'a quarantined store stays in backup selection after its live file disappears');
fs.unlinkSync(brokenStore);
assert.equal(isBackupStoreCandidate(brokenStore), true, 'a missing quarantined store still blocks a fresh backup readiness result');
const missingQuarantineCycle = backupJsonStores({ matches: brokenStore }, brokenBackups);
assert.equal(missingQuarantineCycle.success, false, 'a missing quarantined store cannot make the backup cycle look fresh');
assert.equal(missingQuarantineCycle.results[0].skipped, true, 'the missing quarantined store is reported as skipped');
const skipErrors = [];
const originalError = console.error;
console.error = (...args) => { skipErrors.push(args.join(' ')); };
let skipped;
try {
  writeJson(brokenStore, []);
  skipped = backupJsonStores({ matches: brokenStore }, brokenBackups);
} finally {
  console.error = originalError;
}
assert.equal(skipped.success, false, 'a quarantined required store makes the aggregate backup stale');
assert.equal(skipped.results[0].skipped, true);
assert.equal(copiesIn(brokenBackups, 'matches.json.').length, 0, 'a quarantined store is not copied until restart');
assert.equal(skipErrors.some(line => /matches\.json/.test(line) && /quarantin/i.test(line)), true, 'the skip is logged');
// One unreadable store does not stop the stores after it from being copied.
const mixedSources = path.join(dir, 'mixed-sources');
fs.mkdirSync(path.join(mixedSources, 'bad.json'), { recursive: true });
fs.writeFileSync(path.join(mixedSources, 'good.json'), '[{"id":"g"}]');
const mixedBackups = path.join(dir, 'mixed-backups');
const mixed = backupJsonStores({ bad: path.join(mixedSources, 'bad.json'), good: path.join(mixedSources, 'good.json') }, mixedBackups, { now: Date.UTC(2026, 0, 1) });
assert.equal(mixed.success, false, 'the failure is still reported');
assert.equal(mixed.results.find(result => result.key === 'bad').success, false);
assert.equal(typeof mixed.results.find(result => result.key === 'bad').error, 'string');
assert.equal(copiesIn(mixedBackups, 'good.json.').length, 1, 'the healthy store after the failing one is backed up');
const quarantinedAndHealthy = backupJsonStores({ matches: brokenStore, accounts: path.join(mixedSources, 'good.json') }, brokenBackups, { now: Date.UTC(2026, 0, 2) });
assert.equal(quarantinedAndHealthy.success, false, 'one skipped required store keeps the cycle stale');
assert.equal(quarantinedAndHealthy.results.find(result => result.key === 'matches').skipped, true);
assert.equal(copiesIn(brokenBackups, 'good.json.').length, 1, 'healthy stores are still copied after a quarantined store');

// Age is judged by the stamp in the copy's name, so a copy rewritten by
// an erasure (new mtime) still ages out on schedule.
const stampDir = path.join(dir, 'stamp-age');
const stampSource = path.join(dir, 'stamp-source.json');
fs.writeFileSync(stampSource, '[{"id":"s"}]');
const stampNow = Date.now();
backupJsonFile(stampSource, stampDir, { now: stampNow - 41 * DAY });
backupJsonFile(stampSource, stampDir, { now: stampNow - 40 * DAY });
assert.equal(pruneBackupsByAge(stampDir, { olderThan: stampNow - 30 * DAY }), 1, 'the older copy ages out although both files were written just now');
assert.equal(copiesIn(stampDir, 'stamp-source.json.').length, 1);

// Erasing an account removes its record without shifting other positions.
const nullDir = path.join(dir, 'null-slots');
const nullSource = path.join(dir, 'null-slots.json');
fs.writeFileSync(nullSource, JSON.stringify({ players: [null, { id: 'acct-z', username: 'zed' }, null, { id: 'acct-o', username: 'other' }], owners: [null, null, 'p3'] }));
backupJsonFile(nullSource, nullDir, { now: Date.UTC(2026, 0, 1) });
eraseAccountFromBackups(nullDir, 'acct-z');
const scrubbedCopy = JSON.parse(fs.readFileSync(path.join(nullDir, copiesIn(nullDir, 'null-slots.json.')[0]), 'utf8'));
assert.deepEqual(scrubbedCopy.players, [null, null, { id: 'acct-o', username: 'other' }], 'only the erased record is dropped; genuine nulls stay');
assert.deepEqual(scrubbedCopy.owners, [null, null, 'p3']);

// A temp file left beside a live store by a failed rename holds the whole
// store, so erasure removes it when it names the account.
const tmpStore = path.join(dir, 'tmp-store.json');
fs.writeFileSync(tmpStore, '[]');
const leftover = `${tmpStore}.1234.abcd.tmp`;
fs.writeFileSync(leftover, JSON.stringify([{ id: 'acct-tmp', username: 'tmpuser' }]));
eraseAccountFromBackups(path.join(dir, 'no-backups-here'), 'acct-tmp', { storeFiles: [tmpStore] });
assert.equal(fs.existsSync(leftover), false, 'a leftover temp copy naming the account is deleted');

// The erasure removes the credentials of the account, not only its id.
// A record that belongs to the account keeps neither its name, nor its
// address, nor any hash that could be replayed against it.
{
  const credDir = path.join(dir, 'credentials');
  const credSource = path.join(dir, 'credentials.json');
  fs.writeFileSync(credSource, JSON.stringify([
    { accountId: 'acct-cred', username: 'owner', sessionTokenHash: 'session-hash', passwordHash: 'password-hash', passwordSalt: 'password-salt', recoveryEmail: 'owner@example.test', displayName: 'Owner', auth: { sessionTokenHash: 'nested-session-secret', recovery: { tokenHash: 'nested-recovery-secret', pendingRecoveryEmailTokenHash: 'nested-pending-secret' } }, relatedAccount: { accountId: 'acct-other', username: 'keeper', passwordHash: 'nested-keeper-password-proof', auth: { tokenHash: 'nested-keeper-token-proof' } } },
    { accountId: 'acct-other', username: 'keeper', sessionTokenHash: 'keeper-session-proof', passwordHash: 'keeper-password-proof', passwordSalt: 'keeper-salt-proof', auth: { sessionTokenHash: 'keeper-nested-session-proof', recovery: { tokenHash: 'keeper-nested-recovery-proof' } } }
  ]));
  const createdCred = backupJsonFile(credSource, credDir, { now: Date.UTC(2026, 0, 1) });
  eraseAccountFromBackups(credDir, 'acct-cred');
  const scrubbedCred = fs.readFileSync(createdCred.path, 'utf8');
  assert.equal(scrubbedCred.includes('session-hash'), false, 'the session token hash does not survive');
  assert.equal(scrubbedCred.includes('password-hash'), false, 'the password hash does not survive');
  assert.equal(scrubbedCred.includes('password-salt'), false, 'the password salt does not survive');
  assert.equal(scrubbedCred.includes('nested-session-secret'), false, 'nested session credentials of the erased account do not survive');
  assert.equal(scrubbedCred.includes('nested-recovery-secret'), false, 'nested recovery credentials of the erased account do not survive');
  assert.equal(scrubbedCred.includes('nested-pending-secret'), false, 'nested pending recovery credentials of the erased account do not survive');
  assert.equal(scrubbedCred.includes('owner@example.test'), false, 'the address of the account does not survive');
  assert.equal(scrubbedCred.includes('"owner"'), false, 'the name of the account does not survive');
  assert.equal(scrubbedCred.includes('acct-cred'), false, 'the id of the account does not survive');
  assert.equal(scrubbedCred.includes('acct-other'), true, 'other accounts are untouched');
  assert.equal(scrubbedCred.includes('keeper-session-proof'), true, 'another account session hash is untouched');
  assert.equal(scrubbedCred.includes('keeper-password-proof'), true, 'another account password hash is untouched');
  assert.equal(scrubbedCred.includes('keeper-salt-proof'), true, 'another account password salt is untouched');
  assert.equal(scrubbedCred.includes('nested-keeper-password-proof'), true, 'an explicitly other-owned nested password hash is untouched');
  assert.equal(scrubbedCred.includes('nested-keeper-token-proof'), true, 'an explicitly other-owned nested token hash is untouched');
  assert.equal(verifyBackup(createdCred.path).success, true, 'the copy stays verifiable');
  const restoredCredPath = path.join(dir, 'credentials-restored.json');
  assert.equal(restoreJsonBackup(createdCred.path, restoredCredPath, { allowDirs: [dir] }).success, true, 'the scrubbed copy restores successfully');
  const restoredCred = JSON.parse(fs.readFileSync(restoredCredPath, 'utf8'));
  assert.deepEqual(restoredCred[0].auth, { recovery: {} }, 'the erased account retains no nested credentials');
  assert.deepEqual(restoredCred[1], {
    accountId: 'acct-other', username: 'keeper', sessionTokenHash: 'keeper-session-proof', passwordHash: 'keeper-password-proof', passwordSalt: 'keeper-salt-proof',
    auth: { sessionTokenHash: 'keeper-nested-session-proof', recovery: { tokenHash: 'keeper-nested-recovery-proof' } }
  }, 'the unrelated account restores with its login credentials intact');
  assert.deepEqual(restoredCred[0].relatedAccount, {
    accountId: 'acct-other', username: 'keeper', passwordHash: 'nested-keeper-password-proof', auth: { tokenHash: 'nested-keeper-token-proof' }
  }, 'explicit nested ownership by a different account resets the scrub scope');
}

// Login verification after restoring the scrubbed backup uses only temporary synthetic accounts.
{
  const loginSource = path.join(dir, 'login-accounts.json');
  const loginBackups = path.join(dir, 'login-backups');
  const createdAccounts = new AccountStore(loginSource);
  const erasedLogin = createdAccounts.register({ username: 'erasedlogin', password: 'erased-password-123' });
  const keeperLogin = createdAccounts.register({ username: 'keeperlogin', password: 'keeper-password-123' });
  assert.equal(erasedLogin.success, true);
  assert.equal(keeperLogin.success, true);
  const loginBackup = backupJsonFile(loginSource, loginBackups, { now: Date.UTC(2026, 0, 1) });
  eraseAccountFromBackups(loginBackups, erasedLogin.account.id);
  const restoredLoginPath = path.join(dir, 'login-accounts-restored.json');
  assert.equal(restoreJsonBackup(loginBackup.path, restoredLoginPath, { allowDirs: [dir] }).success, true);
  const restoredAccounts = new AccountStore(restoredLoginPath);
  assert.equal(restoredAccounts.login({ username: 'keeperlogin', password: 'keeper-password-123' }).success, true, 'the unrelated account can log in after restore');
  assert.equal(restoredAccounts.login({ username: 'erasedlogin', password: 'erased-password-123' }).success, false, 'the erased account cannot log in after restore');
}

// Fail closed when an unrecognized field still carries the erased account ID.
{
  const failClosedDir = path.join(dir, 'fail-closed-erasure');
  const failClosedSource = path.join(dir, 'fail-closed-erasure.json');
  fs.writeFileSync(failClosedSource, JSON.stringify([
    { accountId: 'acct-fail-closed', username: 'owner', opaqueReference: 'acct-fail-closed' }
  ]));
  const createdFailClosed = backupJsonFile(failClosedSource, failClosedDir, { now: Date.UTC(2026, 0, 1) });
  const failClosedCounts = eraseAccountFromBackups(failClosedDir, 'acct-fail-closed');
  assert.equal(failClosedCounts.deleted, 1, 'a copy with an ID that survives scrubbing is deleted');
  assert.equal(failClosedCounts.scrubbed, 0);
  assert.equal(fs.existsSync(createdFailClosed.path), false, 'the potentially identifying copy is not retained');
  assert.equal(fs.existsSync(`${createdFailClosed.path}.sha256`), false, 'the deleted copy sidecar is removed too');
}

// A temp file left in the backup directory holds a whole copy and is
// never rotated, so the erasure removes it when it names the account.
{
  const tempDir = path.join(dir, 'temp-copy');
  const tempSource = path.join(dir, 'temp-copy.json');
  fs.writeFileSync(tempSource, JSON.stringify([{ id: 'acct-tempcopy', username: 'tempuser' }]));
  const createdTemp = backupJsonFile(tempSource, tempDir, { now: Date.UTC(2026, 0, 1) });
  const leftover = path.join(tempDir, `${path.basename(createdTemp.path)}.9999.leftover.tmp`);
  fs.writeFileSync(leftover, JSON.stringify([{ id: 'acct-tempcopy', username: 'tempuser' }]));
  eraseAccountFromBackups(tempDir, 'acct-tempcopy');
  assert.equal(fs.existsSync(leftover), false, 'the leftover temp copy that names the account is deleted');
}

// A store that is not part of the erasure list still left copies of its
// bytes behind, and those copies still name the account.
{
  const sharedDir = path.join(dir, 'shared-data');
  fs.mkdirSync(sharedDir, { recursive: true });
  const listed = path.join(sharedDir, 'accounts.json');
  const excluded = path.join(sharedDir, 'recovery-tokens.json');
  fs.writeFileSync(listed, '[]');
  fs.writeFileSync(excluded, '[]');
  const corrupt = path.join(sharedDir, 'recovery-tokens.json.corrupt-2026-01-01T00-00-00-000Z');
  fs.writeFileSync(corrupt, JSON.stringify([{ accountId: 'acct-excluded', tokenHash: 'token-hash' }]));
  const leftover = path.join(sharedDir, 'recovery-tokens.json.4242.leftover.tmp');
  fs.writeFileSync(leftover, JSON.stringify([{ accountId: 'acct-excluded', tokenHash: 'token-hash' }]));
  eraseAccountFromBackups(path.join(dir, 'no-backups-here'), 'acct-excluded', { storeFiles: [listed] });
  assert.equal(fs.existsSync(corrupt), false, 'the corrupt copy of an excluded store is deleted');
  assert.equal(fs.existsSync(leftover), false, 'the leftover temp copy of an excluded store is deleted');
}

// A write that cannot land leaves no temp file holding the whole store.
{
  const failDir = path.join(dir, 'failed-write');
  const failBackups = path.join(dir, 'failed-write-backups');
  fs.mkdirSync(failDir, { recursive: true });
  const failSource = path.join(failDir, 'accounts.json');
  fs.writeFileSync(failSource, '[{"id":"acct-x"}]');
  const stamp = new Date(Date.UTC(2026, 0, 1)).toISOString().replace(/[:.]/g, '-');
  // A directory in the way of the copy makes the atomic rename fail.
  fs.mkdirSync(path.join(failBackups, `accounts.json.${stamp}.json`), { recursive: true });
  assert.throws(() => backupJsonFile(failSource, failBackups, { now: Date.UTC(2026, 0, 1) }));
  assert.deepEqual(fs.readdirSync(failBackups).filter(name => name.endsWith('.tmp')), [], 'no temp file holding the store is left behind');
}

{
  // Erasing one account scrubs a social backup in place: its friendship, block, invite and report rows go,
  // everyone else's rows stay, and the copy is kept (not deleted) so other players' history survives.
  const socialDir = path.join(dir, 'social-erase');
  const socialLive = path.join(socialDir, 'social.json');
  const socialBackups = path.join(socialDir, 'backups');
  fs.mkdirSync(socialDir, { recursive: true });
  fs.writeFileSync(socialLive, JSON.stringify({
    friendships: [
      { requesterId: 'acct-ALICE', addresseeId: 'acct-BOB', status: 'accepted' },
      { requesterId: 'acct-CARA', addresseeId: 'acct-BOB', status: 'accepted' },
    ],
    blocks: [{ blockerId: 'acct-BOB', blockedId: 'acct-ALICE' }],
    invites: [{ id: 'i1', senderId: 'acct-ALICE', recipientId: 'acct-CARA' }],
    reports: [{ reporterId: 'acct-CARA', reportedId: 'acct-ALICE' }],
  }, null, 2));
  const first = backupJsonFile(socialLive, socialBackups, { now: Date.UTC(2026, 9, 25, 12) });
  assert.equal(first.success, true);
  const counts = eraseAccountFromBackups(socialBackups, 'acct-ALICE', { storeFiles: [socialLive] });
  assert.equal(counts.deleted, 0, 'the social copy is scrubbed, not deleted');
  assert.equal(counts.scrubbed, 1);
  const kept = copiesIn(socialBackups, 'social.json');
  assert.equal(kept.length, 1, 'the verified copy survives');
  assert.equal(verifyBackup(path.join(socialBackups, kept[0])).success, true, 'and still verifies after the scrub');
  const scrubbed = JSON.parse(fs.readFileSync(path.join(socialBackups, kept[0]), 'utf8'));
  assert.deepEqual(scrubbed.friendships, [{ requesterId: 'acct-CARA', addresseeId: 'acct-BOB', status: 'accepted' }], 'other players\' friendships remain');
  assert.deepEqual([scrubbed.blocks, scrubbed.invites, scrubbed.reports], [[], [], []]);
  assert.equal(JSON.stringify(scrubbed).includes('acct-ALICE'), false);
}

{
  // A temp file left by a crash during a backup write is swept on the next backup; a recent one is not touched.
  const tempDir = path.join(dir, 'temp-sweep');
  const tempLive = path.join(tempDir, 'accounts.json');
  const tempBackups = path.join(tempDir, 'backups');
  fs.mkdirSync(tempBackups, { recursive: true });
  fs.writeFileSync(tempLive, '[{"id":"a"}]');
  const stale = path.join(tempBackups, 'accounts.json.2026-10-20T10-00-00-000Z.4242.dead-beef.tmp');
  const fresh = path.join(tempBackups, 'accounts.json.2026-10-27T10-00-00-000Z.4343.live-beef.tmp');
  fs.writeFileSync(stale, '[{"id":"half"}]');
  fs.writeFileSync(fresh, '[{"id":"being-written"}]');
  const hourAgo = new Date(Date.now() - HOUR);
  fs.utimesSync(stale, hourAgo, hourAgo);
  assert.equal(backupJsonFile(tempLive, tempBackups, { now: Date.now() }).success, true);
  assert.equal(fs.existsSync(stale), false, 'the stale temp copy is removed');
  assert.equal(fs.existsSync(fresh), true, 'a temp file inside the write window is left alone');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('backup store: 31 passed, 0 failed');
