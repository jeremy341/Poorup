// Contract test for the server-verified achievement event. The owner gets a
// complete, idempotent unlock receipt; the server-wide Mythical channel stays
// generic and does not reveal the title.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSocialApi } from './socketSocialApi.js';
import { AchievementStore } from './achievementStore.js';

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

// Parlor Patrol is switched off (F-059): no patrol achievement is awarded,
// whatever the submitted score or ace-run count.
assert.deepEqual(api.patrolAchievementCandidates({ id: 'acct_a' }, 50, { aceRuns: 0 }), []);
assert.deepEqual(api.patrolAchievementCandidates({ id: 'acct_a' }, 50, 0, { aceRuns: 0 }), []);
assert.deepEqual(api.patrolAchievementCandidates({ id: 'acct_a' }, 50, { aceRuns: 3 }), []);

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

// A store failure while an unlock is rolled back must not escape the
// settlement: it would abort the caller's candidate loop and cost the
// remaining candidates their unlocks, the match telemetry and the account
// sync. The rollback is best-effort, and its own failure is reported rather
// than swallowed.
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
