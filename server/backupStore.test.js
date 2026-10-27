import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backupJsonFile, backupJsonStores, eraseAccountFromBackups, restoreJsonBackup, verifyBackup, pruneBackupsByAge } from './backupStore.js';
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
// Invalid aged backups quarantine instead of lingering forever. The three
// verified copies above are all older than the cutoff, so the two older ones are
// pruned; the newest verified copy of a store is always kept (S14-3), so a long
// backup outage cannot age out the last good copy.
fs.writeFileSync(path.join(backupDir, 'tampered.json'), '{"partial":');
assert.equal(pruneBackupsByAge(backupDir, { olderThan: Date.now() + 1000 }), 2);
assert.equal(copiesIn(backupDir, 'accounts.json.').length, 1, 'the newest verified copy survives age pruning');
assert.equal(copiesIn(backupDir, 'accounts.json.')[0].includes('2026-01-03'), true);
assert.equal(fs.existsSync(path.join(backupDir, 'quarantine', 'tampered.json')), true);

// Tiered retention. Copies are written hourly for the 72 hours before T, plus
// one copy 29 days before T (two more 30 minutes apart on that same day) and
// one 31 days before T. Survivors: the newest 7 and one per UTC hour for 48
// hours (ages 0..48h), one per UTC day for 30 days. The May 29 daily copy (age
// 61h) is the only extra; May 30 and May 31 are already covered hourly.
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
// S14-2: one unreadable store does not stop the stores after it from being copied.
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

// S14-5: age is judged by the stamp in the copy's name, so a copy rewritten by
// an erasure (new mtime) still ages out on schedule.
const stampDir = path.join(dir, 'stamp-age');
const stampSource = path.join(dir, 'stamp-source.json');
fs.writeFileSync(stampSource, '[{"id":"s"}]');
const stampNow = Date.now();
backupJsonFile(stampSource, stampDir, { now: stampNow - 41 * DAY });
backupJsonFile(stampSource, stampDir, { now: stampNow - 40 * DAY });
assert.equal(pruneBackupsByAge(stampDir, { olderThan: stampNow - 30 * DAY }), 1, 'the older copy ages out although both files were written just now');
assert.equal(copiesIn(stampDir, 'stamp-source.json.').length, 1);

// S14-4: erasing an account removes its record without shifting other positions.
const nullDir = path.join(dir, 'null-slots');
const nullSource = path.join(dir, 'null-slots.json');
fs.writeFileSync(nullSource, JSON.stringify({ players: [null, { id: 'acct-z', username: 'zed' }, null, { id: 'acct-o', username: 'other' }], owners: [null, null, 'p3'] }));
backupJsonFile(nullSource, nullDir, { now: Date.UTC(2026, 0, 1) });
eraseAccountFromBackups(nullDir, 'acct-z');
const scrubbedCopy = JSON.parse(fs.readFileSync(path.join(nullDir, copiesIn(nullDir, 'null-slots.json.')[0]), 'utf8'));
assert.deepEqual(scrubbedCopy.players, [null, null, { id: 'acct-o', username: 'other' }], 'only the erased record is dropped; genuine nulls stay');
assert.deepEqual(scrubbedCopy.owners, [null, null, 'p3']);

// S12-L4: a temp file left beside a live store by a failed rename holds the whole
// store, so erasure removes it when it names the account.
const tmpStore = path.join(dir, 'tmp-store.json');
fs.writeFileSync(tmpStore, '[]');
const leftover = `${tmpStore}.1234.abcd.tmp`;
fs.writeFileSync(leftover, JSON.stringify([{ id: 'acct-tmp', username: 'tmpuser' }]));
eraseAccountFromBackups(path.join(dir, 'no-backups-here'), 'acct-tmp', { storeFiles: [tmpStore] });
assert.equal(fs.existsSync(leftover), false, 'a leftover temp copy naming the account is deleted');

// X5: the erasure removes the credentials of the account, not only its id.
// A record that belongs to the account keeps neither its name, nor its
// address, nor any hash that could be replayed against it.
{
  const credDir = path.join(dir, 'credentials');
  const credSource = path.join(dir, 'credentials.json');
  fs.writeFileSync(credSource, JSON.stringify([
    { accountId: 'acct-cred', username: 'owner', sessionTokenHash: 'session-hash', passwordHash: 'password-hash', passwordSalt: 'password-salt', recoveryEmail: 'owner@example.test', displayName: 'Owner' },
    { accountId: 'acct-other', username: 'keeper' }
  ]));
  const createdCred = backupJsonFile(credSource, credDir, { now: Date.UTC(2026, 0, 1) });
  eraseAccountFromBackups(credDir, 'acct-cred');
  const scrubbedCred = fs.readFileSync(createdCred.path, 'utf8');
  assert.equal(scrubbedCred.includes('session-hash'), false, 'the session token hash does not survive');
  assert.equal(scrubbedCred.includes('password-hash'), false, 'the password hash does not survive');
  assert.equal(scrubbedCred.includes('password-salt'), false, 'the password salt does not survive');
  assert.equal(scrubbedCred.includes('owner@example.test'), false, 'the address of the account does not survive');
  assert.equal(scrubbedCred.includes('"owner"'), false, 'the name of the account does not survive');
  assert.equal(scrubbedCred.includes('acct-cred'), false, 'the id of the account does not survive');
  assert.equal(scrubbedCred.includes('acct-other'), true, 'other accounts are untouched');
  assert.equal(verifyBackup(createdCred.path).success, true, 'the copy stays verifiable');
}

// X6: a temp file left in the backup directory holds a whole copy and is
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

// X6: a store that is not part of the erasure list still left copies of its
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

// X6: a write that cannot land leaves no temp file holding the whole store.
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

fs.rmSync(dir, { recursive: true, force: true });
console.log('backup store: 30 passed, 0 failed');
