// Contract test for the server-verified achievement event. The owner gets a
// complete, idempotent unlock receipt; the server-wide Mythical channel stays
// generic and does not reveal the title.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSocialApi } from './socketSocialApi.js';
import { AchievementStore } from './achievementStore.js';
import { AccountStore } from './accountStore.js';
import { MatchStore } from './matchStore.js';

const ownerEvents = [];
const globalEvents = [];
const ownerSocket = {
  data: { accountId: 'acct_a' },
  emit: (event, payload) => ownerEvents.push({ event, payload })
};
const notifications = [];

const api = createSocialApi({
  io: {
    sockets: { sockets: new Map([['owner', ownerSocket]]) },
    emit: (event, payload) => globalEvents.push({ event, payload })
  },
  accountStore: {
    getPublicAccountById: (accountId) => ({ id: accountId, displayName: 'Ada' }),
    recordAchievement: () => ({ success: true, created: true })
  },
  socialStore: {
    addNotification: (accountId, notification) => notifications.push({ accountId, notification }),
    listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }),
    areBlocked: () => false,
    friendshipBetween: () => null
  },
  matchStore: { listForAccount: () => [] },
  achievementStore: {
    unlock: (record) => ({
      created: true,
      record: { ...record, unlockedAt: '2026-09-07T00:00:00.000Z' }
    })
  }
});

const created = api.recordVerifiedAchievement({
  accountId: 'acct_a',
  achievementId: 'null-player',
  title: 'THE NULL PLAYER',
  rarity: 'MYTHICAL',
  body: 'Your wallet was empty.'
}, 'game-123');

assert.equal(created, true);
const ownerUnlock = ownerEvents.find(entry => entry.event === 'achievement-unlocked')?.payload;
assert.deepEqual({
  playerId: ownerUnlock.playerId,
  playerDisplayName: ownerUnlock.playerDisplayName,
  achievementId: ownerUnlock.achievementId,
  rarity: ownerUnlock.rarity,
  secret: ownerUnlock.secret,
  titleVisible: ownerUnlock.titleVisible,
  unlockedAt: ownerUnlock.unlockedAt,
  gameId: ownerUnlock.gameId,
  eventSequence: ownerUnlock.eventSequence,
  evidenceHashLength: ownerUnlock.evidenceHash?.length
}, {
  playerId: 'acct_a',
  playerDisplayName: 'Ada',
  achievementId: 'null-player',
  rarity: 'MYTHICAL',
  secret: true,
  titleVisible: true,
  unlockedAt: '2026-09-07T00:00:00.000Z',
  gameId: 'game-123',
  eventSequence: 'game-123:null-player:acct_a',
  evidenceHashLength: 64
});

const mythical = globalEvents.find(entry => entry.event === 'mythical-achievement')?.payload;
assert.deepEqual({ title: mythical.title, body: mythical.body, playerDisplayName: mythical.playerDisplayName }, {
  title: 'MYTHICAL ACHIEVEMENT',
  body: 'Ada unlocked a MYTHICAL ACHIEVEMENT.',
  playerDisplayName: 'Ada'
});
assert.equal(ownerEvents.filter(entry => entry.event === 'achievement-unlocked').length, 1);
assert.equal(notifications.filter(entry => entry.accountId === 'acct_a').length, 2);

// Achievement candidates use the server-settled score and clean-wave result.
const candidateIds = (score, result) => api.patrolAchievementCandidates({ id: 'acct_a' }, score, result).map(candidate => candidate.achievementId);
assert.deepEqual(candidateIds(9, { aceRuns: 0, cleanRun: false }), []);
assert.deepEqual(candidateIds(10, { aceRuns: 0, cleanRun: false }), ['patrol-rookie']);
assert.deepEqual(candidateIds(50, { aceRuns: 3, cleanRun: true }), ['patrol-rookie', 'patrol-regular', 'clean-run', 'patrol-ace']);
assert.deepEqual(candidateIds(50, { aceRuns: 2, cleanRun: false }), ['patrol-rookie', 'patrol-regular']);

// A store file written by an older build (or a partial write) can hold a null
// or a non-object entry. Loading it must not crash the server on startup.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-achievements-'));
  const file = path.join(dir, 'achievements.json');
  fs.writeFileSync(file, JSON.stringify([null, { accountId: 'acct_a', achievementId: 'first-deed' }, 'legacy-entry'], null, 2));
  const store = new AchievementStore(file);
  const loaded = store.listForAccount('acct_a');
  assert.equal(loaded.length, 1, 'the malformed entries are dropped and the valid record is kept');
  assert.equal(loaded[0].achievementId, 'first-deed');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('malformed achievement records are skipped on load: 1 passed, 0 failed');
}

console.log('social achievement event contract: 1 passed, 0 failed');

// A store failure while an unlock is rolled back must not escape the settlement: it would abort the caller's candidate loop and cost
// the remaining candidates their unlocks, the match telemetry and the account sync. The rollback is best-effort; its failure is reported
// rather than swallowed.
{
  const rollbackAttempts = [];
  const reported = [];
  const originalError = console.error;
  console.error = (...args) => { reported.push(args.map(entry => String(entry?.message || entry)).join(' ')); };
  try {
    const failingApi = createSocialApi({
      io: { sockets: { sockets: new Map() }, emit() {} },
      accountStore: {
        getPublicAccountById: (accountId) => ({ id: accountId, displayName: 'Ada' }),
        recordAchievement: () => { throw new Error('account store offline'); }
      },
      socialStore: {
        addNotification() {},
        listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }),
        areBlocked: () => false,
        friendshipBetween: () => null
      },
      matchStore: { listForAccount: () => [] },
      achievementStore: {
        unlock: (record) => ({
          created: true,
          record: { ...record, unlockedAt: '2026-09-07T00:00:00.000Z' }
        }),
        remove: (accountId, achievementId) => {
          rollbackAttempts.push({ accountId, achievementId });
          throw new Error('achievement store offline');
        }
      }
    });

    let outcome = 'not-called';
    assert.doesNotThrow(() => {
      outcome = failingApi.recordVerifiedAchievement({
        accountId: 'acct_a',
        achievementId: 'first-deed',
        title: 'FIRST DEED',
        rarity: 'COMMON',
        body: 'You owned the first tile.'
      }, 'game-rollback');
    }, 'a failing rollback must not escape the settlement');
    assert.equal(outcome, false, 'an unlock the account store could not record is not reported as a success');
    assert.deepEqual(rollbackAttempts, [{ accountId: 'acct_a', achievementId: 'first-deed' }], 'the unlock is rolled back');
    assert.ok(reported.some(entry => /rollback/i.test(entry)), 'the failed rollback is reported');
  } finally {
    console.error = originalError;
  }
  console.log('social achievement rollback failure stays contained: 1 passed, 0 failed');
}

// If the account mirror write and the best-effort unlock rollback both fail,
// a later settlement must repair the account mirror from the durable unlock.
{
  let unlockExists = false;
  let accountMirrorExists = false;
  let accountWrites = 0;
  const ownerEvents = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    const recoveryApi = createSocialApi({
      io: {
        sockets: { sockets: new Map([['owner', { data: { accountId: 'acct_recovery' }, emit: (event, payload) => ownerEvents.push({ event, payload }) }]]) },
        emit() {}
      },
      accountStore: {
        getPublicAccountById: id => ({ id, displayName: 'Ada' }),
        recordAchievement: () => {
          accountWrites += 1;
          if (accountWrites === 1) throw new Error('account store offline');
          accountMirrorExists = true;
          return { success: true, created: true };
        }
      },
      socialStore: {
        addNotification() {},
        listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }),
        areBlocked: () => false,
        friendshipBetween: () => null
      },
      matchStore: { listForAccount: () => [] },
      achievementStore: {
        unlock: record => {
          const created = !unlockExists;
          unlockExists = true;
          return { created, record: { ...record, unlockedAt: '2026-09-07T00:00:00.000Z' } };
        },
        remove: () => { throw new Error('achievement store offline'); }
      }
    });
    const candidate = { accountId: 'acct_recovery', achievementId: 'recovery-award', title: 'RECOVERY AWARD', rarity: 'COMMON', body: 'Recovered.' };
    assert.equal(recoveryApi.recordVerifiedAchievement(candidate, 'game-recovery'), false, 'the first account mirror write fails');
    assert.equal(unlockExists, true, 'the failed rollback leaves the durable unlock');
    assert.equal(accountMirrorExists, false);
    assert.equal(recoveryApi.recordVerifiedAchievement(candidate, 'game-recovery'), false, 'a duplicate unlock is reconciled without reporting a second unlock');
    assert.equal(accountWrites, 2, 'the account mirror is retried from the existing unlock');
    assert.equal(accountMirrorExists, true, 'the account store is repaired');
    assert.equal(ownerEvents.filter(entry => entry.event === 'achievement-unlocked').length, 1, 'the recovered unlock is announced once');
  } finally {
    console.error = originalError;
  }
}

// The durable achievement store is the recovery source after process restart
// if both account mirroring and the best-effort unlock rollback fail.
{
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-achievement-reconcile-'));
  const accountsPath = path.join(dir, 'accounts.json');
  const achievementsPath = path.join(dir, 'achievements.json');
  const accountStore = new AccountStore(accountsPath);
  const registered = accountStore.register({ username: 'recoverable', displayName: 'Recoverable', password: 'recoverable-pass-1' });
  assert.equal(registered.success, true);
  const deleting = accountStore.register({ username: 'deleting', displayName: 'Deleting', password: 'deleting-pass-1' });
  assert.equal(deleting.success, true);
  accountStore.getAccountById(deleting.account.id).accountDeactivated = true;
  accountStore.persist();
  const achievementStore = new AchievementStore(achievementsPath);
  achievementStore.unlock({ accountId: deleting.account.id, achievementId: 'deleted-source-award', gameId: 'old-game' });
  accountStore.persist = () => { throw new Error('account store offline'); };
  achievementStore.remove = () => { throw new Error('achievement rollback offline'); };
  const interruptedApi = createSocialApi({
    io: { sockets: { sockets: new Map() }, emit() {} },
    accountStore,
    socialStore: { addNotification() {}, listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }), areBlocked: () => false, friendshipBetween: () => null },
    matchStore: { listForAccount: () => [] },
    achievementStore
  });
  assert.equal(interruptedApi.recordVerifiedAchievement({
    accountId: registered.account.id, achievementId: 'durable-recovery', title: 'DURABLE RECOVERY', rarity: 'COMMON', body: 'Recovered after restart.'
  }, 'game-durable-recovery'), false);
  assert.equal(achievementStore.listForAccount(registered.account.id).length, 1, 'the source unlock reached durable storage');
  interruptedApi.dispose();

  const restartedAccounts = new AccountStore(accountsPath);
  const restartedAchievements = new AchievementStore(achievementsPath);
  const restartedApi = createSocialApi({
    io: { sockets: { sockets: new Map() }, emit() {} },
    accountStore: restartedAccounts,
    socialStore: { addNotification() {}, listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }), areBlocked: () => false, friendshipBetween: () => null },
    matchStore: { listForAccount: () => [] },
    achievementStore: restartedAchievements
  });
  assert.equal(restartedAccounts.getAccountById(registered.account.id).achievements.length, 0, 'the account mirror is absent before reconciliation');
  assert.deepEqual(restartedApi.reconcileAchievementMirrors(), { scanned: 1, repaired: 1, failed: 0 });
  assert.equal(restartedAccounts.getAccountById(registered.account.id).achievements[0].id, 'durable-recovery');
  assert.equal(restartedAccounts.getAccountById(deleting.account.id).achievements.some(entry => entry.id === 'deleted-source-award'), false, 'a deletion-pending account is never rehydrated from stale source records');
  restartedApi.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
}

// A persisted annotated match is the durable source for a failed match award.
// Recovery stays account-bound and does not broadcast private match data.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-match-award-recovery-'));
  const accountsPath = path.join(dir, 'accounts.json');
  const achievementsPath = path.join(dir, 'achievements.json');
  const matchesPath = path.join(dir, 'matches.json');
  const accountStore = new AccountStore(accountsPath);
  const owner = accountStore.register({ username: 'matchowner', displayName: 'Match Owner', password: 'match-owner-pass-1' });
  const deleting = accountStore.register({ username: 'matchdeleting', displayName: 'Match Deleting', password: 'match-deleting-pass-1' });
  accountStore.getAccountById(deleting.account.id).accountDeactivated = true;
  accountStore.persist();
  const matchStore = new MatchStore(matchesPath);
  const completedAt = '2026-10-01T12:00:00.000Z';
  matchStore.record({
    matchId: 'match-recovery', roomVisibility: 'private', completedAt,
    participants: [
      { accountId: owner.account.id, displayNameAtMatch: 'Match Owner', achievementsUnlocked: ['first-deed', 'null-player'] },
      { accountId: deleting.account.id, displayNameAtMatch: 'Match Deleting', achievementsUnlocked: ['first-deed'] },
      { accountId: 'acct-purged', displayNameAtMatch: 'ACCOUNT DEACTIVATED', achievementsUnlocked: ['first-deed'] }
    ]
  });
  const achievementStore = new AchievementStore(achievementsPath);
  achievementStore.unlock = () => { throw new Error('achievement store unavailable'); };
  const ownerEvents = [];
  const globalEvents = [];
  const failedApi = createSocialApi({
    io: {
      sockets: { sockets: new Map([['owner', { data: { accountId: owner.account.id }, emit: (event, payload) => ownerEvents.push({ event, payload }) }]]) },
      emit: (event, payload) => globalEvents.push({ event, payload })
    },
    accountStore,
    socialStore: { addNotification() {}, listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }), areBlocked: () => false, friendshipBetween: () => null },
    matchStore,
    achievementStore
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(failedApi.recordVerifiedAchievement({
      accountId: owner.account.id, achievementId: 'first-deed', title: 'FIRST DEED', rarity: 'COMMON', body: 'You bought your first property.'
    }, 'match-recovery'), false, 'the original unlock write failed');
  } finally {
    console.error = originalError;
  }
  assert.equal(achievementStore.listForAccount(owner.account.id).length, 0);
  failedApi.dispose();

  const restartedAccounts = new AccountStore(accountsPath);
  const restartedAchievements = new AchievementStore(achievementsPath);
  const restartedMatches = new MatchStore(matchesPath);
  const restartedApi = createSocialApi({
    io: {
      sockets: { sockets: new Map([['owner', { data: { accountId: owner.account.id }, emit: (event, payload) => ownerEvents.push({ event, payload }) }]]) },
      emit: (event, payload) => globalEvents.push({ event, payload })
    },
    accountStore: restartedAccounts,
    socialStore: { addNotification() {}, listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }), areBlocked: () => false, friendshipBetween: () => null },
    matchStore: restartedMatches,
    achievementStore: restartedAchievements
  });
  const recovery = restartedApi.reconcileAchievementMirrors();
  assert.equal(recovery.failed, 0);
  assert.deepEqual(restartedAchievements.listForAccount(owner.account.id).map(entry => entry.achievementId).sort(), ['first-deed', 'null-player'], 'the annotated record recreates missing source unlocks');
  assert.equal(restartedAchievements.listForAccount(deleting.account.id).length, 0, 'deletion-pending accounts are not recreated');
  assert.equal(restartedAchievements.listForAccount('acct-purged').length, 0, 'purged account IDs are ignored');
  assert.deepEqual(restartedAccounts.getAccountById(owner.account.id).achievements.map(entry => entry.id).sort(), ['first-deed', 'null-player']);
  assert.equal(restartedAccounts.getAccountById(deleting.account.id).achievements.some(entry => entry.id === 'first-deed'), false);
  assert.equal(restartedAchievements.listForAccount(owner.account.id)[0].unlockedAt, completedAt, 'recovery preserves the match completion time');
  assert.equal(globalEvents.length, 0, 'private match recovery does not broadcast match details');
  assert.deepEqual(ownerEvents.filter(entry => entry.event === 'achievement-unlocked').map(entry => entry.payload.achievementId).sort(), ['first-deed', 'null-player'], 'only the award owner receives recovered unlocks');
  restartedApi.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
}

// A periodic pass must retry durable intent after an outage even without a
// second player action or server restart.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-award-periodic-'));
  const accounts = new AccountStore(path.join(dir, 'accounts.json'));
  const owner = accounts.register({ username: 'periodicaward', displayName: 'Periodic', password: 'periodic-award-pass' });
  accounts.recordPatrolResult(owner.account.id, { score: 125, settlementId: 'periodic-run' });
  const awards = new AchievementStore(path.join(dir, 'awards.json'));
  const originalUnlock = awards.unlock.bind(awards);
  awards.unlock = () => { throw new Error('store offline'); };
  let interval;
  let stopped = false;
  const api = createSocialApi({
    io: { sockets: { sockets: new Map() }, emit() {} }, accountStore: accounts, achievementStore: awards,
    socialStore: { addNotification() {}, listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }), areBlocked: () => false, friendshipBetween: () => null },
    matchStore: {}, setIntervalFn: fn => { interval = fn; return { unref() {} }; }, clearIntervalFn: () => { stopped = true; }
  });
  const originalError = console.error;
  console.error = () => {};
  try { api.reconcileAchievementMirrors(); } finally { console.error = originalError; }
  assert.equal(accounts.getPendingPatrolAchievementSettlements(owner.account.id).length, 1);
  awards.unlock = originalUnlock;
  assert.equal(api.startAchievementReconciliation(), true);
  interval();
  assert.equal(accounts.getPendingPatrolAchievementSettlements(owner.account.id).length, 0);
  assert.deepEqual(awards.listForAccount(owner.account.id).map(entry => entry.achievementId).sort(), ['patrol-regular', 'patrol-rookie']);
  api.dispose();
  assert.equal(stopped, true);
  fs.rmSync(dir, { recursive: true, force: true });
}

// Account history can be the only durable annotated copy when the subsequent
// MatchStore write fails. Distinct annotations for the same match must merge.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-match-history-recovery-'));
  const accountsPath = path.join(dir, 'accounts.json');
  const accounts = new AccountStore(accountsPath);
  const owner = accounts.register({ username: 'historyrecover', displayName: 'History', password: 'history-recovery-pass' });
  const account = accounts.getAccountById(owner.account.id);
  account.matchHistory = [{ matchId: 'history-only', roomVisibility: 'private', completedAt: '2026-10-01T12:00:00.000Z', participants: [{ accountId: account.id, achievementsUnlocked: ['null-player'] }] }];
  accounts.persist();
  const restored = new AccountStore(accountsPath);
  const awards = new AchievementStore(path.join(dir, 'awards.json'));
  const api = createSocialApi({
    io: { sockets: { sockets: new Map() }, emit() { throw new Error('private recovery must not broadcast'); } },
    accountStore: restored,
    socialStore: { addNotification() {}, listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }), areBlocked: () => false, friendshipBetween: () => null },
    matchStore: { listAll: () => [{ matchId: 'history-only', roomVisibility: 'private', participants: [{ accountId: account.id, achievementsUnlocked: ['first-deed'] }] }] },
    achievementStore: awards
  });
  assert.equal(api.reconcileAchievementMirrors().failed, 0);
  assert.deepEqual(awards.listForAccount(account.id).map(entry => entry.achievementId).sort(), ['first-deed', 'null-player']);
  api.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
}

// If the achievement-store write fails before any unlock is durable, the
// account-store patrol journal still lets startup recreate the awards.
{
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-patrol-journal-recovery-'));
  const accountsPath = path.join(dir, 'accounts.json');
  const achievementsPath = path.join(dir, 'achievements.json');
  const accountStore = new AccountStore(accountsPath);
  const registered = accountStore.register({ username: 'journaluser', displayName: 'Journal User', password: 'journal-user-pass-1' });
  assert.equal(registered.success, true);
  const settled = accountStore.recordPatrolResult(registered.account.id, {
    score: 125, misses: 0, settlementId: 'patrol-journal-run', cleanRun: false
  });
  assert.equal(settled.success, true);
  const achievementStore = new AchievementStore(achievementsPath);
  achievementStore.unlock = () => { throw new Error('achievement store unavailable'); };
  const failingApi = createSocialApi({
    io: { sockets: { sockets: new Map() }, emit() {} },
    accountStore,
    socialStore: { addNotification() {}, listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }), areBlocked: () => false, friendshipBetween: () => null },
    matchStore: { listForAccount: () => [] },
    achievementStore
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(failingApi.recordVerifiedAchievement({
      accountId: registered.account.id, achievementId: 'patrol-rookie', title: 'PATROL ROOKIE', rarity: 'COMMON', body: 'You scored 10 in Parlor Patrol.'
    }, 'patrol_patrol-journal-run'), false);
  } finally {
    console.error = originalError;
  }
  assert.equal(achievementStore.listForAccount(registered.account.id).length, 0, 'the award has not reached the achievement store');
  assert.equal(accountStore.getPendingPatrolAchievementSettlements(registered.account.id).length, 1, 'the durable account journal holds the intent');
  failingApi.dispose();

  const restartedAccounts = new AccountStore(accountsPath);
  const restartedAchievements = new AchievementStore(achievementsPath);
  const restartedApi = createSocialApi({
    io: { sockets: { sockets: new Map() }, emit() {} },
    accountStore: restartedAccounts,
    socialStore: { addNotification() {}, listFor: () => ({ friends: [], requests: [], outgoing: [], invites: [], notifications: [] }), areBlocked: () => false, friendshipBetween: () => null },
    matchStore: { listForAccount: () => [] },
    achievementStore: restartedAchievements
  });
  const reconciliation = restartedApi.reconcileAchievementMirrors();
  assert.equal(reconciliation.failed, 0);
  assert.deepEqual(restartedAchievements.listForAccount(registered.account.id).map(entry => entry.achievementId).sort(), ['patrol-regular', 'patrol-rookie']);
  assert.deepEqual(restartedAccounts.getAccountById(registered.account.id).achievements.map(entry => entry.id).sort(), ['patrol-regular', 'patrol-rookie']);
  assert.deepEqual(restartedAccounts.getPendingPatrolAchievementSettlements(registered.account.id), [], 'the durable journal clears only after both stores agree');
  restartedApi.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
}
