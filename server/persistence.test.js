// Persistence seam characterization: the behaviors that can combine into silent data loss are pinned. A corrupt store file keeps
// its bytes in a quarantine sibling, the store opens empty beside it, and the next successful persist() never touches the quarantined original.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountStore } from './accountStore.js';
import { AchievementStore } from './achievementStore.js';
import { MatchStore } from './matchStore.js';
import { SocialStore } from './socialStore.js';
import { loadJson, writeJson } from './storeIO.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-persist-'));
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

function fileFor(name) {
  return path.join(tempDir, `${name}.json`);
}

function register(store, username) {
  return store.register({ username, password: 'hunter2hunter2', displayName: username });
}

function corruptSibling(filePath) {
  return fs.readdirSync(tempDir).filter(entry => entry.startsWith(path.basename(filePath)) && entry.includes('.corrupt-'));
}

check('round-trip: persisted accounts reload identically', () => {
  const filePath = fileFor('roundtrip');
  const first = new AccountStore(filePath);
  register(first, 'roundtripper');
  const second = new AccountStore(filePath);
  assert.strictEqual(second.findAccountByUsername('roundtripper')?.username, 'roundtripper');
});

check('logout and session rotation revoke every token hash', () => {
  const filePath = fileFor('session-revocation');
  const store = new AccountStore(filePath);
  const registered = register(store, 'sessionbound');
  assert.equal(store.sessionAccount(registered.sessionToken)?.username, 'sessionbound');
  assert.deepEqual(store.logout(registered.sessionToken), { success: true });
  assert.equal(store.sessionAccount(registered.sessionToken), null);
  const loggedIn = store.login({ username: 'sessionbound', password: 'hunter2hunter2' });
  assert.equal(loggedIn.success, true);
  const rotated = store.login({ username: 'sessionbound', password: 'hunter2hunter2' });
  assert.equal(rotated.success, true);
  assert.equal(store.sessionAccount(loggedIn.sessionToken), null);
  assert.equal(store.sessionAccount(rotated.sessionToken)?.username, 'sessionbound');
});

check('corrupt file: opens empty and quarantines the bytes', () => {
  const filePath = fileFor('corrupt');
  const broken = '{"username": "truncated-no-closing-brace';
  fs.writeFileSync(filePath, broken, 'utf8');
  const store = new AccountStore(filePath);
  assert.strictEqual(store.accounts.size, 0, 'store must open empty');
  const quarantined = corruptSibling(filePath);
  assert.strictEqual(quarantined.length, 1, 'exactly one quarantine sibling');
  assert.strictEqual(fs.readFileSync(path.join(tempDir, quarantined[0]), 'utf8'), broken);
});

check('corrupt file: later persist writes fresh data without clobbering bytes', () => {
  const filePath = fileFor('noclobber');
  const broken = 'not json at all {{{';
  fs.writeFileSync(filePath, broken, 'utf8');
  const store = new AccountStore(filePath);
  register(store, 'survivor');
  const quarantined = corruptSibling(filePath)[0];
  assert.strictEqual(fs.readFileSync(path.join(tempDir, quarantined), 'utf8'), broken);
  assert.ok(fs.readFileSync(filePath, 'utf8').includes('survivor'));
});

check('atomic write: main file is always complete JSON and no temp litter', () => {
  const filePath = fileFor('atomic');
  const store = new AccountStore(filePath);
  register(store, 'atomicone');
  const text = fs.readFileSync(filePath, 'utf8');
  assert.ok(Array.isArray(JSON.parse(text)), 'store file must parse');
  const litter = fs.readdirSync(tempDir).filter(entry => entry.endsWith('.tmp'));
  assert.strictEqual(litter.length, 0, 'no temp files left behind');
});

check('missing file: clean empty start with no quarantine siblings', () => {
  const filePath = fileFor('missing');
  const store = new AccountStore(filePath);
  assert.strictEqual(store.accounts.size, 0);
  assert.strictEqual(corruptSibling(filePath).length, 0);
});

check('valid JSON with the wrong root shape is quarantined by every store', () => {
  const cases = [
    ['account-shape', AccountStore, { unexpected: true }, store => store.accounts.size],
    ['social-shape', SocialStore, [], store => store.friendships.length],
    ['match-shape', MatchStore, { unexpected: true }, store => store.matches.size],
    ['achievement-shape', AchievementStore, { unexpected: true }, store => store.records.size]
  ];
  cases.forEach(([name, Store, value, sizeOf]) => {
    const filePath = fileFor(name);
    const bytes = JSON.stringify(value);
    fs.writeFileSync(filePath, bytes, 'utf8');
    const store = new Store(filePath);
    assert.equal(sizeOf(store), 0, name);
    const quarantined = corruptSibling(filePath);
    assert.equal(quarantined.length, 1, name);
    assert.equal(fs.readFileSync(path.join(tempDir, quarantined[0]), 'utf8'), bytes, name);
  });
});

check('rename failure: old store stays intact instead of direct truncation', () => {
  const filePath = fileFor('rename-failure');
  fs.writeFileSync(filePath, JSON.stringify(['old']), 'utf8');
  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('rename unavailable'); };
  try {
    assert.throws(() => writeJson(filePath, ['new']), /Atomic store write failed/);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), ['old']);
    assert.ok(fs.readdirSync(tempDir).some(entry => entry.startsWith('rename-failure.json.') && entry.endsWith('.tmp')));
  } finally {
    fs.renameSync = originalRename;
    fs.readdirSync(tempDir).filter(entry => entry.startsWith('rename-failure.json.') && entry.endsWith('.tmp')).forEach(entry => fs.rmSync(path.join(tempDir, entry), { force: true }));
  }
});

check('unreadable file: non-missing read errors fail closed', () => {
  const original = fs.readFileSync;
  const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  fs.readFileSync = () => { throw error; };
  try {
    assert.throws(() => new AccountStore(fileFor('unreadable')), /permission denied/);
  } finally {
    fs.readFileSync = original;
  }
});

check('malformed social records are filtered instead of crashing the store', () => {
  const filePath = fileFor('social-malformed');
  fs.writeFileSync(filePath, JSON.stringify({
    friendships: [null, 'bad', { id: 'friend-1', requesterId: 'a', addresseeId: 'b', status: 'accepted' }],
    blocks: [null, { blockerId: 'a', blockedId: 'b' }],
    invites: [null, { id: 'invite-1', recipientId: 'b', status: 'pending' }],
    reports: [null, { id: 'report-1', reporterId: 'a', reportedId: 'b' }],
    notifications: { a: [null, { id: 'notice-1', title: 'HELLO' }] }
  }), 'utf8');
  const store = new SocialStore(filePath);
  assert.equal(store.friendships.length, 1);
  assert.equal(store.blocks.length, 1);
  assert.equal(store.invites.length, 1);
  assert.equal(store.reports.length, 1);
  assert.equal(store.listFor('a').friends.length, 1);
  assert.equal(store.listFor('a').notifications.length, 1);
});

check('login rejects oversized passwords before running scrypt', () => {
  const filePath = fileFor('login-size');
  const store = new AccountStore(filePath);
  register(store, 'loginbound');
  const result = store.login({ username: 'loginbound', password: 'x'.repeat(73) });
  assert.deepEqual(result, { success: false, error: 'Username or password is incorrect.' });
});

check('malformed account match history is sanitized before profile reads', () => {
  const filePath = fileFor('history-malformed');
  const store = new AccountStore(filePath);
  const registered = register(store, 'historybound');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  raw[0].matchHistory = [{ matchId: 'bad-match', participants: null, globalEvents: 'not-an-array' }];
  fs.writeFileSync(filePath, JSON.stringify(raw), 'utf8');
  const reloaded = new AccountStore(filePath);
  assert.deepEqual(reloaded.getPublicMatchSummaries(registered.account.id), [{
    matchId: 'bad-match', completedAt: reloaded.getMatchHistory(registered.account.id)[0].completedAt,
    roundCount: 0, roomVisibility: 'public', participants: [], globalEvents: [], eventCombinations: [],
    tradesCompleted: 0, auctionsCompleted: 0
  }]);
});

check('friends-only achievements stay hidden from outsider cards', () => {
  const filePath = fileFor('achievement-privacy');
  const store = new AccountStore(filePath);
  const registered = register(store, 'achievementowner');
  const account = store.getAccountById(registered.account.id);
  account.privacy.achievements = 'friends';
  account.achievements = [{ id: 'full-street', unlockedAt: '2026-01-01T00:00:00.000Z' }];
  account.stats.gamesPlayed = 10;
  account.stats.wins = 6;
  account.stats.casinoNet = 9001;
  account.stats.bankLoanDefaults = 4;
  const publicCard = store.getPublicPlayerCard(account.id);
  assert.deepStrictEqual(publicCard.achievements, []);
  assert.deepStrictEqual(store.getPublicPlayerCard(account.id, { includeAchievements: true }).achievements, account.achievements);
  assert.equal(store.getPublicPlayerCard(account.id, { includeAchievements: true }).achievementsFriendsOnly, false);
  assert.equal(publicCard.achievementsFriendsOnly, true);
  assert.deepStrictEqual(publicCard.stats, { gamesPlayed: 10, wins: 6, winRate: 60, eventSurvival: 0 });
});

check('legacy sessions expire absolutely and revoke singly', () => {
  const filePath = fileFor('session-ttl');
  const store = new AccountStore(filePath);
  const registered = register(store, 'ttlbound');
  assert.equal(store.sessionAccount(registered.sessionToken)?.username, 'ttlbound');
  // Backdate past the 90-day absolute window: the token dies.
  store.sessionIssuedAt.set(registered.sessionToken, Date.now() - 91 * 24 * 3600 * 1000);
  assert.equal(store.sessionAccount(registered.sessionToken), null);
  const fresh = store.login({ username: 'ttlbound', password: 'hunter2hunter2' });
  assert.equal(fresh.success, true);
  assert.equal(store.sessionAccount(fresh.sessionToken)?.username, 'ttlbound');
  assert.equal(store.revokeSessionToken(fresh.sessionToken), true);
  assert.equal(store.sessionAccount(fresh.sessionToken), null);
  assert.equal(store.revokeSessionToken('nope'), false);
});

check('restarted legacy hashes are not rehydrated', () => {
  const filePath = fileFor('session-cutover');
  const first = new AccountStore(filePath);
  const registered = register(first, 'cutoverbound');
  assert.equal(first.sessionAccount(registered.sessionToken)?.username, 'cutoverbound');
  const second = new AccountStore(filePath);
  assert.equal(second.sessionAccount(registered.sessionToken), null);
});

check('load: a UTF-8 byte order mark is not corruption (S12-M6)', () => {
  const filePath = fileFor('bom');
  fs.writeFileSync(filePath, '\ufeff[{"id":"a"}]', 'utf8');
  const loaded = loadJson(filePath, value => Array.isArray(value));
  assert.equal(loaded.corrupt, false);
  assert.deepEqual(loaded.value, [{ id: 'a' }]);
  assert.strictEqual(corruptSibling(filePath).length, 0, 'a BOM file is not moved aside');
});

check('quarantine: a failed copy falls back to moving the original aside (S12-M5)', () => {
  const filePath = fileFor('quarantine-copy-fails');
  const broken = 'not json {{{';
  fs.writeFileSync(filePath, broken, 'utf8');
  const originalWrite = fs.writeFileSync;
  const originalError = console.error;
  fs.writeFileSync = (target, ...rest) => {
    if (String(target).includes('.corrupt-')) throw new Error('disk full');
    return originalWrite(target, ...rest);
  };
  console.error = () => {};
  try {
    assert.equal(loadJson(filePath, value => Array.isArray(value)).corrupt, true);
  } finally {
    fs.writeFileSync = originalWrite;
    console.error = originalError;
  }
  const moved = corruptSibling(filePath);
  assert.equal(moved.length, 1, 'the corrupt bytes are preserved beside the store');
  assert.equal(fs.readFileSync(path.join(tempDir, moved[0]), 'utf8'), broken);
});

check('quarantine: when the bytes cannot be preserved the load fails instead of clobbering them (S12-M5)', () => {
  const filePath = fileFor('quarantine-all-fails');
  const broken = 'not json {{{';
  fs.writeFileSync(filePath, broken, 'utf8');
  const originalWrite = fs.writeFileSync;
  const originalRename = fs.renameSync;
  const originalError = console.error;
  fs.writeFileSync = (target, ...rest) => {
    if (String(target).includes('.corrupt-')) throw new Error('disk full');
    return originalWrite(target, ...rest);
  };
  fs.renameSync = () => { throw new Error('rename unavailable'); };
  console.error = () => {};
  try {
    assert.throws(() => loadJson(filePath, value => Array.isArray(value)));
  } finally {
    fs.writeFileSync = originalWrite;
    fs.renameSync = originalRename;
    console.error = originalError;
  }
  assert.equal(fs.readFileSync(filePath, 'utf8'), broken, 'the only copy of the bytes is untouched');
});

check('atomic write: stale temp files of the same store are swept (S12-L4)', () => {
  const filePath = fileFor('tmp-sweep');
  const stale = `${filePath}.4242.stale-id.tmp`;
  const fresh = `${filePath}.4242.fresh-id.tmp`;
  const other = fileFor('tmp-sweep-other') + '.4242.other-id.tmp';
  [stale, fresh, other].forEach(file => fs.writeFileSync(file, '[]'));
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  fs.utimesSync(stale, old, old);
  fs.utimesSync(other, old, old);
  writeJson(filePath, ['x']);
  assert.equal(fs.existsSync(stale), false, 'an hours-old temp file is removed');
  assert.equal(fs.existsSync(fresh), true, 'a recent temp file may belong to a write in flight');
  assert.equal(fs.existsSync(other), true, 'another store\'s temp files are not touched');
  fs.rmSync(fresh, { force: true });
  fs.rmSync(other, { force: true });
});

check('achievement store: a failed persist leaves memory and disk agreeing (S12-M2, S12-M1)', () => {
  const filePath = fileFor('achievement-rollback');
  const store = new AchievementStore(filePath);
  const realPersist = store.persist;
  const failing = () => { throw new Error('disk busy'); };
  const grant = { accountId: 'acct_a', achievementId: 'first-deed', gameId: 'g1' };
  store.persist = failing;
  assert.throws(() => store.unlock(grant), /disk busy/);
  assert.equal(store.records.size, 0, 'a failed unlock is not kept in memory');
  store.persist = realPersist;
  assert.equal(store.unlock(grant).created, true, 'the retry unlocks and persists');
  store.persist = failing;
  assert.throws(() => store.remove('acct_a', 'first-deed'), /disk busy/);
  assert.equal(store.records.size, 1, 'a failed remove is rolled back');
  assert.throws(() => store.purgeAccount('acct_a'), /disk busy/);
  assert.equal(store.records.size, 1, 'a failed purge is rolled back, so the retry still has work to do');
  store.persist = realPersist;
  assert.equal(store.purgeAccount('acct_a'), 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), [], 'the retried purge reaches the disk');
});

check('achievement store: only real negative headlines grant crisis manager (S12-L6)', () => {
  const store = new AchievementStore(fileFor('crisis-manager'));
  const grantsFor = headline => store.evaluateMatch({
    participants: [{ accountId: 'acct_c', finalPlacement: 2, globalEventsExperienced: 1, bankrupt: false }],
    globalEvents: [headline]
  }).some(entry => entry.achievementId === 'crisis-manager');
  ['', ' ', 'A', 'TA', 'BAN', 'LAB', 'HOUSING BUBB'].forEach(headline => assert.equal(grantsFor(headline), false, `"${headline}" is not a headline`));
  ['housing-bubble', 'HOUSING BUBBLE POP', 'HOUSING BUBBLE', 'bank-run', 'TAX SCANDAL AUDIT'].forEach(headline => assert.equal(grantsFor(headline), true, headline));
});

check('match store: a failed persist is rolled back in record and anonymizeAccount (S12-M1, S12-M2)', () => {
  const filePath = fileFor('match-rollback');
  const store = new MatchStore(filePath);
  const realPersist = store.persist;
  const failing = () => { throw new Error('disk busy'); };
  const match = { matchId: 'm1', completedAt: '2026-09-01T00:00:00.000Z', participants: [{ accountId: 'acct_gone', displayNameAtMatch: 'Gone' }] };
  store.persist = failing;
  assert.throws(() => store.record(match), /disk busy/);
  assert.equal(store.get('m1'), null, 'a match that was not persisted is not kept');
  store.persist = realPersist;
  assert.equal(store.record(match).created, true, 'the retry records and persists it');
  assert.ok(fs.readFileSync(filePath, 'utf8').includes('acct_gone'));
  store.persist = failing;
  assert.throws(() => store.anonymizeAccount('acct_gone'), /disk busy/);
  assert.equal(store.get('m1').participants[0].accountId, 'acct_gone', 'a failed scrub is rolled back');
  store.persist = realPersist;
  assert.equal(store.anonymizeAccount('acct_gone'), 1, 'the retry still finds work to do');
  assert.equal(fs.readFileSync(filePath, 'utf8').includes('acct_gone'), false, 'and reaches the disk');
});

check('match store: records without a time are oldest, and created reflects what was kept (S12-L7)', () => {
  const store = new MatchStore(fileFor('match-order'));
  for (let index = 0; index < 500; index += 1) {
    store.matches.set(`m${index}`, { matchId: `m${index}`, roomVisibility: 'public', completedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() });
  }
  const undated = store.record({ matchId: 'undated', participants: [] });
  assert.equal(undated.created, false, 'an undated record does not displace dated matches');
  assert.equal(store.get('undated'), null);
  assert.equal(store.get('m499') !== null, true);
  const ancient = store.record({ matchId: 'ancient', completedAt: '1999-01-01T00:00:00.000Z' });
  assert.equal(ancient.created, false, 'a match older than the retained 500 is not reported as created');
  assert.equal(store.record({ matchId: 'fresh', completedAt: '2027-01-01T00:00:00.000Z' }).created, true);
  assert.equal(store.get('m0'), null, 'the oldest retained match is evicted');
});

fs.rmSync(tempDir, { recursive: true, force: true });
const failed = results.filter(ok => !ok).length;
console.log(`persistence tests: ${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
