// Persistence seam characterization: the exact behaviors that used to combine
// into silent data loss are now pinned down — a corrupt store file must keep
// its bytes in a quarantine sibling, the store must open empty beside it, and
// the next successful persist() must never touch the quarantined original.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountStore } from './accountStore.js';
import { AchievementStore } from './achievementStore.js';
import { MatchStore } from './matchStore.js';
import { SocialStore } from './socialStore.js';
import { writeJson } from './storeIO.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-persist-'));
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS — ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL — ${name}: ${error.message}`);
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

fs.rmSync(tempDir, { recursive: true, force: true });
const failed = results.filter(ok => !ok).length;
console.log(`persistence tests: ${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
