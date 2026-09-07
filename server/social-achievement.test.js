// Contract test for the server-verified achievement event. The owner gets a
// complete, idempotent unlock receipt; the server-wide Mythical channel stays
// generic and does not reveal the title.
import assert from 'node:assert/strict';
import { createSocialApi } from './socketSocialApi.js';

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
console.log('social achievement event contract: 1 passed, 0 failed');
