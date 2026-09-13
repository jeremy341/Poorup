import assert from 'node:assert/strict';
import { listMatchRecordsForAccount, mergeMatchRecords } from './matchHistoryAdapter.js';
import { createSocialApi } from './socketSocialApi.js';
import { registerSocialSocketHandlers } from './serverSocketSocial.js';

// Characterization seam: both social history entry points must continue to
// treat MatchStore as the newer source while keeping AccountStore history as
// a compatibility fallback. This test drives the public socket handler and
// records the wire-visible merge/projection behavior the adapter preserves.
function registeredHandlers({ accountStore, socialStore, matchStore, viewer = null }) {
  const handlers = new Map();
  const socket = { id: 'history-test-socket', data: {}, handshake: {} };
  const runtime = {
    accountStore,
    socialStore,
    matchStore,
    io: { in() { return { emit() {} }; }, emit() {} },
    roomManager: { getRoomBySocket() { return null; } },
    getRoomForSocket() { return null; },
    seasonStore: null,
    social: {
      accountForSocket() { return viewer; },
      allowAnonymousAction() { return true; },
      allowSocialAction() { return true; },
      chatBlockedInRoom() { return false; },
      chatRateLimited() { return false; },
      emitSocialUpdate() {},
      maxPlausiblePatrolScore() { return 100000; },
      notifyAccount() {},
      patrolAchievementCandidates() { return []; },
      patrolRunError() { return null; },
      patrolRunPlausible() { return true; },
      patrolRuns: new Map(),
      prunePatrolRuns() {},
      publicPlayerCard() { return null; },
      recentPlayers() { return []; },
      recordVerifiedAchievement() {},
      socialSummary() { return {}; }
    }
  };
  registerSocialSocketHandlers((event, handler) => handlers.set(event, handler), socket, runtime);
  return handlers;
}

const target = {
  id: 'account-target',
  privacy: { history: 'public' }
};
const historyProfiles = new Map([
  [target.id, target],
  ['legacy-player', { id: 'legacy-player', username: 'legacy', displayName: 'Legacy Player', color: '#aaa', avatarGrid: null }],
  ['stored-player', { id: 'stored-player', username: 'stored', displayName: 'Stored Player', color: '#bbb', avatarGrid: null }],
  ['newest-player', { id: 'newest-player', username: 'newest', displayName: 'Newest Player', color: '#ccc', avatarGrid: null }]
]);
const accountStore = {
  getAccountById(accountId) {
    return accountId === target.id ? target : null;
  },
  getMatchHistory() {
    return [
      {
        matchId: 'legacy-only',
        completedAt: '2026-09-10T12:00:00.000Z',
        roomVisibility: 'public',
        participants: [{ accountId: target.id, displayNameAtMatch: 'Legacy Target', finalPlacement: 1, propertyCount: 2, completedGroups: 0, bankrupt: false }]
      },
      {
        matchId: 'duplicate',
        completedAt: '2026-09-09T12:00:00.000Z',
        roomVisibility: 'public',
        participants: [{ accountId: target.id, displayNameAtMatch: 'Legacy Copy', finalPlacement: 2, propertyCount: 1, completedGroups: 0, bankrupt: false }]
      }
    ];
  },
  getRecentClearedAt() {
    return null;
  },
  getPublicAccountById(accountId) {
    return historyProfiles.get(accountId) || null;
  }
};
const socialStore = { friendshipBetween() { return null; } };
const matchStore = {
  listForAccount(accountId) {
    assert.equal(accountId, target.id);
    return [
      {
        matchId: 'private-hidden',
        completedAt: '2026-09-12T12:00:00.000Z',
        roomVisibility: 'private',
        participants: [{ accountId: target.id, displayNameAtMatch: 'Private Target', finalPlacement: 1, propertyCount: 5, completedGroups: 2, bankrupt: false }]
      },
      {
        matchId: 'duplicate',
        completedAt: '2026-09-09T12:00:00.000Z',
        roomVisibility: 'public',
        participants: [{ accountId: target.id, displayNameAtMatch: 'Stored Copy', finalPlacement: 1, propertyCount: 3, completedGroups: 1, bankrupt: false }]
      },
      {
        matchId: 'stored-newest',
        completedAt: '2026-09-11T12:00:00.000Z',
        roomVisibility: 'public',
        participants: [{ accountId: target.id, displayNameAtMatch: 'Stored Target', finalPlacement: 1, propertyCount: 4, completedGroups: 2, bankrupt: false }]
      }
    ];
  }
};

const handler = registeredHandlers({ accountStore, socialStore, matchStore }).get('get-match-history');
let ack;
handler({ accountId: target.id }, payload => { ack = payload; });

assert.equal(ack.success, true);
assert.deepEqual(ack.history.map(record => record.matchId), ['stored-newest', 'legacy-only', 'duplicate']);
assert.equal(ack.history.some(record => record.matchId === 'private-hidden'), false);
assert.equal(ack.history.find(record => record.matchId === 'duplicate').participants[0].displayNameAtMatch, 'Stored Copy');
assert.equal(ack.history.find(record => record.matchId === 'duplicate').participants[0].completedGroups, 1);
assert.equal(ack.history.find(record => record.matchId === 'legacy-only').participants[0].isViewedPlayer, true);

// Adapter contract: callers get the exact same precedence and ordering when
// they read through the shared account-history seam.
const merged = mergeMatchRecords(
  [{ matchId: 'legacy', completedAt: '2026-09-01T00:00:00.000Z' }, { matchId: 'same', completedAt: '2026-09-02T00:00:00.000Z', source: 'legacy' }],
  [{ matchId: 'same', completedAt: '2026-09-02T00:00:00.000Z', source: 'stored' }, { matchId: 'new', completedAt: '2026-09-03T00:00:00.000Z' }]
);
assert.deepEqual(merged.map(record => record.matchId), ['new', 'same', 'legacy']);
assert.equal(merged.find(record => record.matchId === 'same').source, 'stored');
assert.deepEqual(listMatchRecordsForAccount({ accountId: target.id, accountStore, matchStore }).map(record => record.matchId), ['private-hidden', 'stored-newest', 'legacy-only', 'duplicate']);

// The second reader (recent-player suggestions) uses the same compatibility
// seam and must observe the same stored-over-legacy winner.
const recentNow = Date.now();
const recentAccountStore = {
  getRecentClearedAt() { return null; },
  getMatchHistory() {
    return [
      { matchId: 'recent-legacy', completedAt: new Date(recentNow - 3_000).toISOString(), participants: [{ accountId: target.id }, { accountId: 'legacy-player' }] },
      { matchId: 'recent-duplicate', completedAt: new Date(recentNow - 2_000).toISOString(), participants: [{ accountId: target.id }, { accountId: 'legacy-player' }] }
    ];
  },
  getPublicAccountById(accountId) { return historyProfiles.get(accountId) || null; }
};
const recentMatchStore = {
  listForAccount(accountId, limit) {
    assert.equal(accountId, target.id);
    assert.equal(limit, 50);
    return [
      { matchId: 'recent-duplicate', completedAt: new Date(recentNow - 2_000).toISOString(), participants: [{ accountId: target.id }, { accountId: 'stored-player' }] },
      { matchId: 'recent-newest', completedAt: new Date(recentNow - 1_000).toISOString(), participants: [{ accountId: target.id }, { accountId: 'newest-player' }] }
    ];
  }
};
const socialApi = createSocialApi({
  io: { sockets: { sockets: new Map() }, emit() {} },
  accountStore: recentAccountStore,
  socialStore: {},
  matchStore: recentMatchStore,
  achievementStore: {}
});
assert.deepEqual(socialApi.recentPlayers(target.id).map(player => [player.id, player.matchId]), [
  ['newest-player', 'recent-newest'],
  ['stored-player', 'recent-duplicate'],
  ['legacy-player', 'recent-legacy']
]);
console.log('match history adapter characterization: 11 passed, 0 failed');
