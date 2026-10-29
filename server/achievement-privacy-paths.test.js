// Friends-only and private achievements never reach a viewer
// who is not allowed to see them, on every path that returns achievements
// (player card, social summary, leaderboard board, leaderboard snapshot).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { SocialStore } from './socialStore.js';
import { createSocialApi } from './socketSocialApi.js';
import { registerSocialSocketHandlers } from './serverSocketSocial.js';

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`FAIL ${name}\n  ${error.message}`); }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-achievement-privacy-'));
const accountStore = new AccountStore(path.join(root, 'accounts.json'));
const socialStore = new SocialStore(path.join(root, 'social.json'));

function seed(username, privacy) {
  const registered = accountStore.register({ username, displayName: username.toUpperCase(), password: `${username}-pass-123` });
  const account = accountStore.getAccountById(registered.account.id);
  account.privacy.achievements = privacy;
  account.achievements = [{ id: '41st-tile', unlockedAt: '2026-01-01T00:00:00.000Z' }, { id: 'full-street', unlockedAt: '2026-01-02T00:00:00.000Z' }];
  account.stats.gamesPlayed = 10;
  account.stats.wins = 5;
  return account;
}
const friendsOnly = seed('friendsonly', 'friends');
const privateOwner = seed('privateowner', 'private');
const friend = seed('thefriend', 'friends');
const stranger = seed('thestranger', 'friends');
const pending = seed('thepending', 'friends');
const stamp = '2026-01-01T00:00:00.000Z';
[friendsOnly, privateOwner].forEach(owner => {
  socialStore.friendships.push({ id: `f-${owner.id}`, requesterId: friend.id, addresseeId: owner.id, status: 'accepted', createdAt: stamp, updatedAt: stamp });
});
socialStore.friendships.push({ id: 'f-pending', requesterId: pending.id, addresseeId: friendsOnly.id, status: 'requested', createdAt: stamp, updatedAt: stamp });

const io = { sockets: { sockets: new Map() }, in() { return { emit() {} }; }, emit() {} };
const api = createSocialApi({ io, accountStore, socialStore, matchStore: { listForAccount: () => [] }, achievementStore: {} });

function ids(card) { return (card.achievements || []).map(entry => entry.id); }
const cardIds = (ownerId, viewerId) => ids(api.publicPlayerCard(ownerId, viewerId));

check('player card: a non-friend does not receive friends-only achievements', () => {
  assert.deepEqual(cardIds(friendsOnly.id, stranger.id), []);
  assert.deepEqual(cardIds(friendsOnly.id, null), []);
  assert.deepEqual(cardIds(friendsOnly.id, pending.id), [], 'a pending request is not a friendship');
  assert.equal(cardIds(friendsOnly.id, friend.id).length, 2, 'an accepted friend sees them');
  assert.equal(cardIds(friendsOnly.id, friendsOnly.id).length, 2, 'the owner sees them');
});

check('player card: private achievements reach nobody but the owner, even a friend', () => {
  assert.deepEqual(cardIds(privateOwner.id, friend.id), []);
  assert.deepEqual(cardIds(privateOwner.id, stranger.id), []);
  assert.equal(cardIds(privateOwner.id, privateOwner.id).length, 2);
});

check('store card: includeAchievements alone cannot unlock a private account', () => {
  assert.deepEqual(accountStore.getPublicPlayerCard(privateOwner.id, { includeAchievements: true }).achievements, []);
  assert.equal(accountStore.getPublicPlayerCard(privateOwner.id, { includeAchievements: true, owner: true }).achievements.length, 2);
  assert.equal(accountStore.getPublicPlayerCard(friendsOnly.id, { includeAchievements: true }).achievements.length, 2, 'friend-level reveal still works for friends-only');
});

check('social summary: a pending requester card carries no friends-only achievements', () => {
  const summary = api.socialSummary(friendsOnly.id);
  assert.equal(summary.requests.length, 1);
  assert.deepEqual(ids(summary.requests[0].from), []);
});

// leaderboard handlers
// The social-handler dependencies for a socket whose account is the viewer.
function socialDeps(viewer) {
  return {
    accountForSocket: () => viewer, allowAnonymousAction: () => true, allowSocialAction: () => true,
    chatBlockedInRoom: () => false, chatRateLimited: () => false, emitSocialUpdate() {}, maxPlausiblePatrolScore: () => 0,
    notifyAccount() {}, patrolAchievementCandidates: () => [], patrolRunError: () => null, patrolRunPlausible: () => true,
    prunePatrolRuns() {}, patrolRuns: new Map(), publicPlayerCard: () => ({}), recentPlayers: () => [],
    recordVerifiedAchievement: () => false, socialSummary: () => ({})
  };
}

function boards(viewer) {
  const handlers = new Map();
  const socket = { id: 'sock', handshake: { address: '127.0.0.1' }, request: { socket: { remoteAddress: '127.0.0.1' } } };
  registerSocialSocketHandlers((event, handler) => handlers.set(event, handler), socket, {
    accountStore, socialStore, matchStore: { listForAccount: () => [] },
    social: socialDeps(viewer),
    roomManager: { getRoomBySocket: () => null }, io
  });
  return (event, payload) => { let ack; handlers.get(event)(payload, value => { ack = value; }); return ack; };
}
const rowFor = (rows, username) => (rows || []).find(row => row.username === username);

check('leaderboard: a non-friend sees no achievement figures or ranking for a friends-only account', () => {
  const ask = boards({ id: stranger.id });
  const wins = ask('get-leaderboard', { metric: 'wins', scope: 'all' });
  const row = rowFor(wins.rows, 'friendsonly');
  assert.ok(row, 'the account is still ranked by non-achievement metrics');
  ['achievements', 'achievementScore', 'mythical'].forEach(field => assert.equal(Object.hasOwn(row, field), false, `${field} is hidden`));
  for (const metric of ['achievements', 'mythical']) {
    assert.equal(rowFor(ask('get-leaderboard', { metric, scope: 'all' }).rows, 'friendsonly'), undefined, `${metric} board omits it`);
  }
});

check('leaderboard snapshot: a non-friend sees no achievement figures for a friends-only account', () => {
  const snapshot = boards(null)('get-leaderboard-snapshot', { scope: 'all' });
  assert.equal(rowFor(snapshot.metrics.achievements, 'friendsonly'), undefined);
  assert.equal(rowFor(snapshot.metrics.mythical, 'friendsonly'), undefined);
  const row = rowFor(snapshot.metrics.wins, 'friendsonly');
  assert.ok(row);
  assert.equal(Object.hasOwn(row, 'achievementScore'), false);
});

check('leaderboard: an accepted friend and the owner still see friends-only figures; private hides from a friend', () => {
  const ask = boards({ id: friend.id });
  const rows = ask('get-leaderboard', { metric: 'wins', scope: 'all' }).rows;
  assert.equal(rowFor(rows, 'friendsonly').achievements, 2);
  assert.equal(rowFor(rows, 'privateowner').achievements, undefined, 'private hides even from a friend');
  const owner = boards({ id: friendsOnly.id });
  assert.equal(rowFor(owner('get-leaderboard', { metric: 'achievements', scope: 'all' }).rows, 'friendsonly')?.achievements, 2, 'the owner still sees themselves');
});

const failed = results.filter(result => !result.ok).length;
console.log(`achievement privacy path tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
