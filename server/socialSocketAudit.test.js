// Social socket layer fixes from the s10 / s12 / s17 audit reports: the shared
// rate buckets, live-socket re-validation, leaderboard cost and privacy, and
// the deactivation / history-privacy gates on the public handlers.
import assert from 'node:assert/strict';
import { createSocialApi } from './socketSocialApi.js';
import { registerSocialSocketHandlers } from './serverSocketSocial.js';

const realNow = Date.now;
function withClock(start, run) {
  let clock = start;
  Date.now = () => clock;
  try { return run(value => { clock = value; }); } finally { Date.now = realNow; }
}

// S10-10 / S17-05: rate buckets of accounts and addresses that went quiet are swept.
withClock(1_000_000, setClock => {
  const api = createSocialApi({ io: { sockets: { sockets: new Map() } }, accountStore: {}, socialStore: {}, matchStore: {}, achievementStore: {} });
  for (let index = 0; index < 3000; index += 1) api.allowSocialAction(`acct-${index}`, 'friend-request');
  setClock(1_000_000 + 10 * 60_000);
  api.allowSocialAction('acct-late', 'friend-request');
  assert.equal(api.socialRateBucketCount() <= 2, true, 'expired buckets are swept, not kept for the process lifetime');
  assert.equal(api.allowSocialAction('acct-late', 'friend-request'), true, 'a live bucket still counts');
  for (let index = 0; index < 40; index += 1) api.allowSocialAction('acct-busy', 'friend-request');
  assert.equal(api.allowSocialAction('acct-busy', 'friend-request'), false, 'the 30 per minute limit still holds');
  console.log('PASS social rate buckets are swept once their window has passed');
});

// S10-04: a socket whose session was revoked stops receiving private pushes.
{
  const live = new Set(['hash-live']);
  const sessions = new Set(['sess-live']);
  const mk = (id, data) => ({ id, data, emitted: [], emit(event) { this.emitted.push(event); } });
  const sockets = new Map([
    ['bearer-live', mk('bearer-live', { accountId: 'acct-1', sessionTokenHash: 'hash-live' })],
    ['bearer-revoked', mk('bearer-revoked', { accountId: 'acct-1', sessionTokenHash: 'hash-revoked' })],
    ['cookie-live', mk('cookie-live', { accountId: 'acct-1', sessionId: 'sess-live' })],
    ['cookie-revoked', mk('cookie-revoked', { accountId: 'acct-1', sessionId: 'sess-gone' })],
    ['cookie-revoked-bearer-live', mk('cookie-revoked-bearer-live', { accountId: 'acct-1', sessionId: 'sess-gone', sessionTokenHash: 'hash-live' })],
    ['bare', mk('bare', { accountId: 'acct-1' })],
    ['other-account', mk('other-account', { accountId: 'acct-2', sessionTokenHash: 'hash-live' })]
  ]);
  const api = createSocialApi({
    io: { sockets: { sockets } },
    accountStore: { accountForSessionHash: (hash, accountId) => (live.has(hash) && accountId === 'acct-1' ? { id: accountId } : null) },
    socialStore: { addNotification() {} },
    sessionStore: { hasSession: (sessionId, accountId) => sessions.has(sessionId) && accountId === 'acct-1' },
    matchStore: {}, achievementStore: {}
  });
  const ids = api.socketsForAccount('acct-1').map(socket => socket.id).sort();
  assert.deepEqual(ids, ['bare', 'bearer-live', 'cookie-live', 'cookie-revoked-bearer-live']);
  assert.equal(sockets.get('bearer-revoked').data.accountId, null, 'the revoked socket is signed out');
  assert.equal(sockets.get('cookie-revoked').data.accountId, null);
  assert.equal(sockets.get('bearer-live').data.accountId, 'acct-1');
  api.notifyAccount('acct-1', { kind: 'test' });
  assert.equal(sockets.get('bearer-revoked').emitted.length, 0, 'no private notification reaches a revoked socket');
  console.log('PASS social pushes skip and sign out sockets whose session was revoked');
}

// s12 M2: a failing achievement write is handled instead of escaping into the settlement.
{
  const api = createSocialApi({
    io: { emit() {}, sockets: { sockets: new Map() } },
    accountStore: {}, socialStore: {}, matchStore: {},
    achievementStore: { unlock() { throw new Error('Atomic store write failed for achievements.json.'); } }
  });
  assert.equal(api.recordVerifiedAchievement({ accountId: 'acct-1', achievementId: 'first-win' }, 'game-1'), false);
  console.log('PASS a failed achievement persist does not escape the settlement');
}

// H3: a notification persist failure after a verified unlock is best-effort;
// it must not escape into the settlement loop.
{
  const api = createSocialApi({
    io: { emit() {}, sockets: { sockets: new Map() } },
    accountStore: { getPublicAccountById: id => ({ id, displayName: 'Ada' }), recordAchievement: () => ({ success: true, created: true }) },
    socialStore: { addNotification() { throw new Error('Atomic store write failed for social.json.'); } },
    matchStore: {},
    achievementStore: { unlock: record => ({ created: true, record: { ...record, unlockedAt: '2026-09-07T00:00:00.000Z' } }) }
  });
  let created;
  assert.doesNotThrow(() => {
    created = api.recordVerifiedAchievement({ accountId: 'acct-1', achievementId: 'first-win', title: 'FIRST WIN', rarity: 'COMMON', body: 'x' }, 'game-1');
  }, 'a failing notification does not escape the achievement settlement');
  assert.equal(created, true, 'the achievement stays recorded when the follow-up notification fails');
  console.log('PASS a notification persist failure does not abort achievement settlement');
}

// H4: a legacy match record without a participants array is ignored.
{
  const api = createSocialApi({
    io: { sockets: { sockets: new Map() }, emit() {} },
    accountStore: { getMatchHistory: () => [{ matchId: 'm1', completedAt: new Date().toISOString(), participants: null }], getRecentClearedAt: () => null, getPublicAccountById: () => null },
    socialStore: { areBlocked: () => false },
    matchStore: {}, achievementStore: {}
  });
  assert.deepEqual(api.recentPlayers('acct-me'), []);
  console.log('PASS a legacy record without participants does not crash recent players');
}

// H5: deactivated and blocked accounts never become recent-player rows.
{
  const now = new Date().toISOString();
  const api = createSocialApi({
    io: { sockets: { sockets: new Map() }, emit() {} },
    accountStore: {
      getMatchHistory: () => [{
        matchId: 'm1',
        completedAt: now,
        participants: [{ accountId: 'acct-gone' }, { accountId: 'acct-blocked' }, { accountId: 'acct-ok' }]
      }],
      getRecentClearedAt: () => null,
      getPublicAccountById: id => ({
        'acct-gone': { id, username: 'gone', displayName: 'Gone', accountDeactivated: true },
        'acct-blocked': { id, username: 'blocked', displayName: 'Blocked' },
        'acct-ok': { id, username: 'ok', displayName: 'OK' }
      }[id] || null)
    },
    socialStore: { areBlocked: (a, b) => [a, b].includes('acct-blocked') && [a, b].includes('acct-me') },
    matchStore: {}, achievementStore: {}
  });
  assert.deepEqual(api.recentPlayers('acct-me').map(player => player.id), ['acct-ok']);
  console.log('PASS deactivated and blocked accounts are not recent players');
}

// ---- handler fixtures ------------------------------------------------------

function account(id, extra = {}) {
  return { id, username: id.replace('acct-', ''), displayName: id.toUpperCase(), color: '#d74438', avatarGrid: null, privacy: { history: 'public', achievements: 'friends', friendRequests: 'everyone', roomInvites: 'friends' }, ...extra };
}

function socialHarness({ viewer = null, accounts = [], friendships = {}, friends = [], notifications = [], handshake = { address: '203.0.113.50', headers: {} }, privacy } = {}) {
  const byId = new Map(accounts.map(entry => [entry.id, entry]));
  const calls = { anonymous: [], social: [], leaderboard: 0, snapshot: 0, accept: 0, invites: 0, friendRequests: 0, recent: 0, notificationReads: 0 };
  let budget = Infinity;
  const accountStore = {
    accounts: new Map(accounts.map(entry => [entry.username, entry])),
    getAccountById: id => byId.get(id) || null,
    findAccountByUsername: name => accounts.find(entry => entry.username === name) || null,
    getPublicAccountById: id => byId.get(id) || null,
    getPublicMatchSummaries: () => { calls.recent += 1; return [{ matchId: 'm1' }]; },
    getLeaderboard: metric => { calls.leaderboard += 1; return privacy?.metrics?.[metric] || []; },
    getLeaderboardSnapshot: () => { calls.snapshot += 1; return { metrics: privacy?.metrics || { wins: [] } }; }
  };
  const socialStore = {
    areBlocked: () => false,
    friendshipBetween: (a, b) => friendships[`${a}|${b}`] || friendships[`${b}|${a}`] || null,
    listFor: id => ({ friends: id === viewer?.id ? friends : [], requests: [], outgoing: [], invites: [], notifications: id === viewer?.id ? notifications : [] }),
    getInvite: () => ({ id: 'inv-1', roomId: 'room-1' }),
    createInvite: () => { calls.invites += 1; return { success: true, invite: { id: 'inv-1' } }; },
    requestFriend: () => { calls.friendRequests += 1; return { success: true, friendship: { id: 'fr-1' } }; },
    respondInvite: () => ({ success: true }),
    blockPlayer: () => ({ success: true }),
    removeFriend: () => ({ success: true }),
    cancelFriendRequest: () => ({ success: true }),
    markNotificationRead: () => { calls.notificationReads += 1; return { success: true }; },
    reportPlayer: () => ({ success: true })
  };
  const handlers = new Map();
  const socket = { id: 'social-sock', data: {}, handshake, request: { socket: { remoteAddress: handshake.address } } };
  const runtime = {
    accountStore, socialStore, matchStore: { listForAccount: () => [] },
    social: {
      accountForSocket: () => viewer,
      allowAnonymousAction: (identity, action) => { calls.anonymous.push([identity, action]); return budget-- > 0; },
      allowSocialAction: (id, action) => { calls.social.push([id, action]); return budget-- > 0; },
      chatBlockedInRoom: () => false, chatRateLimited: () => false,
      emitSocialUpdate() {}, maxPlausiblePatrolScore: () => 0, notifyAccount() {},
      patrolAchievementCandidates: () => [], patrolRunError: () => null, patrolRunPlausible: () => true, prunePatrolRuns() {}, patrolRuns: new Map(),
      publicPlayerCard: (id, viewerId) => {
        const target = byId.get(id);
        if (target?.accountDeactivated === true && viewerId !== id) return { id: target.username, username: target.username, displayName: 'ACCOUNT DEACTIVATED', accountDeactivated: true };
        return { id: target.username, username: target.username, displayName: target.displayName, historyPrivate: false };
      },
      recentPlayers: () => [], recordVerifiedAchievement: () => false, socialSummary: () => ({})
    },
    roomManager: { getRoomBySocket: () => ({ game: { players: [] }, getPlayerBySocket: () => ({ accountId: viewer?.id }), publicId: 'room-1', roomCode: 'ROOM01', roomName: 'Room', visibility: 'private' }) },
    getRoomForSocket: () => ({ getPlayerBySocket: () => ({ accountId: viewer?.id }), publicId: 'room-1', roomCode: 'ROOM01', roomName: 'Room', visibility: 'private' }),
    acceptRoomInvite: () => { calls.accept += 1; return { success: true }; },
    io: { in: () => ({ emit() {} }) }
  };
  registerSocialSocketHandlers((event, handler) => handlers.set(event, handler), socket, runtime);
  const ask = (event, payload = {}) => { let ack; handlers.get(event)(payload, value => { ack = value; }); return ack; };
  return { ask, calls, setBudget: value => { budget = value; }, runtime };
}

// Cached rows are rechecked against live achievement privacy on every reply,
// including the rate-limited stale-cache path.
{
  const hidden = account('acct-cache-private');
  const open = account('acct-cache-open');
  const rows = [hidden, open].map((entry, index) => ({ accountId: entry.id, username: entry.username, displayName: entry.displayName, value: 10 - index, wins: 10 - index, achievements: 7, achievementScore: 70, mythical: 1 }));
  const h = socialHarness({ accounts: [hidden, open], privacy: { metrics: { wins: rows, achievements: rows } } });
  let cacheTime = 1000;
  h.runtime.now = () => cacheTime;
  const warmBoard = h.ask('get-leaderboard', { metric: 'wins', scope: 'all' });
  const warmSnapshot = h.ask('get-leaderboard-snapshot', { scope: 'all' });
  assert.equal(warmSnapshot.metrics.achievements.length, 2, 'warm snapshot contains both public accounts');
  hidden.privacy.achievements = 'private';
  const privateBoard = h.ask('get-leaderboard', { metric: 'wins', scope: 'all' });
  const privateSnapshot = h.ask('get-leaderboard-snapshot', { scope: 'all' });
  assert.equal(warmBoard.rows.find(row => row.accountId === 'cache-private').achievements, 7);
  assert.equal('achievements' in privateBoard.rows.find(row => row.accountId === 'cache-private'), false);
  assert.equal(privateSnapshot.metrics.wins.find(row => row.accountId === 'cache-private').achievementScore, undefined);
  assert.deepEqual(privateSnapshot.metrics.achievements.map(row => row.accountId), ['cache-open'], 'cached achievement boards remove newly private accounts');
  hidden.accountDeactivated = true;
  assert.equal(h.ask('get-leaderboard', { metric: 'wins', scope: 'all' }).rows.some(row => row.accountId === 'cache-private'), false, 'cached boards drop accounts deactivated after the computation');
  hidden.accountDeactivated = false;
  h.setBudget(0);
  cacheTime += 30_001;
  const stalePrivate = h.ask('get-leaderboard-snapshot', { scope: 'all' });
  assert.equal(stalePrivate.metrics.wins.find(row => row.accountId === 'cache-private').achievements, undefined, 'expired budget-limited cache still redacts private fields');
  assert.deepEqual(stalePrivate.metrics.achievements.map(row => row.accountId), ['cache-open']);
  assert.equal(h.calls.snapshot, 1, 'expired cache cannot recompute after the read budget is exhausted');
  hidden.privacy.achievements = 'friends';
  const fallback = h.ask('get-leaderboard-snapshot', { scope: 'all' });
  assert.equal(fallback.metrics.wins.find(row => row.accountId === 'cache-private').achievements, 7, 'stale fallback reflects privacy becoming public again');
  assert.deepEqual(fallback.metrics.achievements.map(row => row.accountId), ['cache-private', 'cache-open']);
  console.log('PASS cached leaderboard and stale fallback reflect current achievement privacy');
}

const PENDING = { success: false, code: 'ACCOUNT_DELETION_PENDING', error: 'Account deletion is pending.' };
const NOT_FOUND = { success: false, error: 'Player not found.' };

// S10-02: anonymous budgets key on the proxy-aware address, not the proxy's.
{
  const previous = process.env.POORUP_TRUST_PROXY_HOPS;
  process.env.POORUP_TRUST_PROXY_HOPS = '1';
  try {
    const target = account('acct-target');
    const h = socialHarness({ accounts: [target], handshake: { address: '172.18.0.2', headers: { 'x-forwarded-for': '198.51.100.7' } } });
    h.ask('get-public-player-card', { username: 'target' });
    h.ask('search-players', { query: 'target' });
    h.ask('get-leaderboard', { metric: 'wins', scope: 'all' });
    assert.deepEqual(h.calls.anonymous.map(([identity]) => identity), ['198.51.100.7', '198.51.100.7', '198.51.100.7']);
  } finally {
    if (previous === undefined) delete process.env.POORUP_TRUST_PROXY_HOPS; else process.env.POORUP_TRUST_PROXY_HOPS = previous;
  }
  console.log('PASS anonymous budgets use the proxy-aware client address');
}

// S10-01 / P0-2: leaderboards are cached, and recomputing is budgeted.
{
  const h = socialHarness();
  h.ask('get-leaderboard-snapshot', { scope: 'month' });
  h.ask('get-leaderboard-snapshot', { scope: 'month' });
  h.ask('get-leaderboard-snapshot', { scope: 'month' });
  assert.equal(h.calls.snapshot, 1, 'repeat month snapshots inside the TTL are served from the cache');
  h.ask('get-leaderboard', { metric: 'wins', scope: 'month' });
  h.ask('get-leaderboard', { metric: 'wins', scope: 'month' });
  assert.equal(h.calls.leaderboard, 1);
  const budgeted = socialHarness();
  budgeted.setBudget(0);
  const refused = budgeted.ask('get-leaderboard-snapshot', { scope: 'month' });
  assert.equal(refused.success, false, 'with no recompute budget and nothing cached the request is refused');
  assert.equal(budgeted.calls.snapshot, 0, 'a refused request does no work');
  const viewer = account('acct-viewer');
  const signedIn = socialHarness({ viewer, accounts: [viewer] });
  signedIn.ask('get-leaderboard-snapshot', { scope: 'all' });
  assert.deepEqual(signedIn.calls.social.map(([id, action]) => `${id}:${action}`), ['acct-viewer:leaderboard'], 'a signed-in viewer spends the account budget');
  console.log('PASS leaderboards are cached and recomputes are budgeted');
}

// S10-07: a private-achievements account is not ranked or described by achievements.
{
  const hidden = account('acct-hidden', { privacy: { history: 'public', achievements: 'private', friendRequests: 'everyone', roomInvites: 'friends' } });
  const open = account('acct-open');
  const rowFor = entry => ({ accountId: entry.id, username: entry.username, displayName: entry.displayName, value: 3, achievements: 4, achievementScore: 90, mythical: 1, wins: 2 });
  const h = socialHarness({ accounts: [hidden, open], privacy: { metrics: { wins: [rowFor(hidden), rowFor(open)], achievements: [rowFor(hidden), rowFor(open)], mythical: [rowFor(hidden)] } } });
  const ack = h.ask('get-leaderboard-snapshot', { scope: 'all' });
  assert.deepEqual(ack.metrics.achievements.map(row => row.accountId), ['open'], 'a private account drops out of the achievements ranking');
  assert.deepEqual(ack.metrics.mythical, []);
  const winsHidden = ack.metrics.wins.find(row => row.accountId === 'hidden');
  assert.equal(winsHidden.value, 3, 'other rankings still include the account');
  assert.equal('achievements' in winsHidden, false, 'its achievement count is not published');
  assert.equal('achievementScore' in winsHidden, false);
  assert.equal('mythical' in winsHidden, false);
  assert.equal(ack.metrics.wins.find(row => row.accountId === 'open').achievements, 4, 'others keep their numbers');
  console.log('PASS private achievements stay off the leaderboard');
}

// S10-03 / S10-18: a deactivated account takes no seat through invites, and is not a target.
{
  const deactivated = account('acct-gone', { accountDeactivated: true });
  const friend = account('acct-friend');
  const h = socialHarness({ viewer: deactivated, accounts: [deactivated, friend], friendships: { 'acct-gone|acct-friend': { status: 'accepted' } } });
  assert.deepEqual(h.ask('respond-room-invite', { inviteId: 'inv-1', accept: true }), PENDING);
  assert.equal(h.calls.accept, 0, 'the seat is never taken');
  assert.deepEqual(h.ask('send-room-invite', { targetAccountId: 'friend' }), PENDING);
  const active = account('acct-active');
  const sender = socialHarness({ viewer: active, accounts: [active, deactivated], friendships: { 'acct-active|acct-gone': { status: 'accepted' } } });
  assert.deepEqual(sender.ask('send-room-invite', { targetAccountId: 'gone' }), NOT_FOUND, 'a deactivated account cannot be invited');
  assert.deepEqual(sender.ask('send-friend-request', { username: 'gone' }), NOT_FOUND, 'nor sent a friend request');
  assert.equal(sender.calls.invites + sender.calls.friendRequests, 0);
  console.log('PASS deactivated accounts take no seat and receive no invites or requests');
}

// S10-05: a deactivated account's history and recent matches stay hidden.
{
  const deactivated = account('acct-gone', { accountDeactivated: true });
  const h = socialHarness({ accounts: [deactivated] });
  assert.deepEqual(h.ask('get-match-history', { accountId: 'gone' }), NOT_FOUND);
  const card = h.ask('get-public-player-card', { username: 'gone' });
  assert.deepEqual(card.player.recentMatches, [], 'the masked card carries no recent matches');
  assert.equal(h.calls.recent, 0);
  console.log('PASS a deactivated account\'s match history is not public');
}

// S10-06: history "private" holds on the player card for friends, as on get-match-history.
{
  const viewer = account('acct-viewer');
  const hidden = account('acct-hidden', { privacy: { history: 'private', achievements: 'friends', friendRequests: 'everyone', roomInvites: 'friends' } });
  const h = socialHarness({ viewer, accounts: [viewer, hidden], friendships: { 'acct-viewer|acct-hidden': { status: 'accepted' } } });
  const card = h.ask('get-public-player-card', { username: 'hidden' });
  assert.deepEqual(card.player.recentMatches, [], 'a friend does not read recent matches of a private history');
  assert.equal(card.player.historyPrivate, true);
  const friendsOnly = account('acct-friends', { privacy: { history: 'friends', achievements: 'friends', friendRequests: 'everyone', roomInvites: 'friends' } });
  const control = socialHarness({ viewer, accounts: [viewer, friendsOnly], friendships: { 'acct-viewer|acct-friends': { status: 'accepted' } } });
  assert.equal(control.ask('get-public-player-card', { username: 'friends' }).player.recentMatches.length, 1, 'friends still read a friends-only history');
  console.log('PASS the player card honours a private match history');
}

// S10-08: the moderation verbs are budgeted like the other social actions.
{
  const viewer = account('acct-viewer');
  const other = account('acct-other');
  const h = socialHarness({ viewer, accounts: [viewer, other] });
  for (const [event, payload] of [['block-player', { otherAccountId: 'other' }], ['report-player', { otherAccountId: 'other', reason: 'x' }], ['remove-friend', { otherAccountId: 'other' }], ['cancel-friend-request', { friendshipId: 'fr-1' }]]) {
    h.calls.social.length = 0;
    h.ask(event, payload);
    assert.equal(h.calls.social.length, 1, `${event} spends a social budget`);
  }
  h.setBudget(0);
  assert.equal(h.ask('report-player', { otherAccountId: 'other', reason: 'x' }).success, false, 'an exhausted budget refuses the report');
  console.log('PASS block, report, remove and cancel are budgeted');
}

// H8: notification reads spend the account budget, and an already-read
// notification is not rewritten.
{
  const viewer = account('acct-viewer');
  const fresh = socialHarness({ viewer, accounts: [viewer], notifications: [{ id: 'n1', title: 'NEW' }] });
  assert.equal(fresh.ask('mark-notification-read', { notificationId: 'n1' }).success, true);
  assert.equal(fresh.calls.notificationReads, 1);
  assert.deepEqual(fresh.calls.social.map(([id, action]) => `${id}:${action}`), ['acct-viewer:notification-read'], 'a notification read spends the account budget');
  const read = socialHarness({ viewer, accounts: [viewer], notifications: [{ id: 'n1', title: 'NEW', readAt: '2026-01-01T00:00:00.000Z' }] });
  assert.equal(read.ask('mark-notification-read', { notificationId: 'n1' }).success, true);
  assert.equal(read.calls.notificationReads, 0, 'an already-read notification is not rewritten');
  const exhausted = socialHarness({ viewer, accounts: [viewer], notifications: [{ id: 'n1' }] });
  exhausted.setBudget(0);
  assert.deepEqual(exhausted.ask('mark-notification-read', { notificationId: 'n1' }), { success: false, error: 'Too many requests. Try again in a minute.' });
  assert.equal(exhausted.calls.notificationReads, 0, 'a refused read does no store work');
  console.log('PASS notification reads are budgeted and already-read rows are left alone');
}

// H8: signed-in player-card reads spend the per-account bucket too.
{
  const viewer = account('acct-viewer');
  const target = account('acct-target');
  const h = socialHarness({ viewer, accounts: [viewer, target] });
  h.ask('get-public-player-card', { username: 'target' });
  assert.deepEqual(h.calls.social.map(([id, action]) => `${id}:${action}`), ['acct-viewer:player-card'], 'a signed-in card read spends the account budget');
  const exhausted = socialHarness({ viewer, accounts: [viewer, target] });
  exhausted.setBudget(0);
  assert.equal(exhausted.ask('get-public-player-card', { username: 'target' }).success, false, 'an exhausted budget refuses the card');
  console.log('PASS signed-in player-card reads are budgeted');
}

// H8: friends leaderboards recompute on demand, so each recompute is budgeted.
{
  const viewer = account('acct-viewer');
  const friend = account('acct-friend');
  const h = socialHarness({ viewer, accounts: [viewer, friend], friends: ['acct-friend'] });
  h.ask('get-leaderboard', { metric: 'wins', scope: 'friends' });
  h.ask('get-leaderboard-snapshot', { scope: 'friends' });
  assert.equal(h.calls.leaderboard, 1);
  assert.equal(h.calls.snapshot, 1);
  assert.deepEqual(h.calls.social.map(([id, action]) => `${id}:${action}`), ['acct-viewer:leaderboard', 'acct-viewer:leaderboard'], 'each friends ranking spends the account budget');
  const refused = socialHarness({ viewer, accounts: [viewer, friend], friends: ['acct-friend'] });
  refused.setBudget(0);
  assert.deepEqual(refused.ask('get-leaderboard', { metric: 'wins', scope: 'friends' }), { success: false, error: 'Rankings are busy. Try again shortly.' });
  assert.deepEqual(refused.ask('get-leaderboard-snapshot', { scope: 'friends' }), { success: false, error: 'Rankings are busy. Try again shortly.' });
  assert.equal(refused.calls.leaderboard + refused.calls.snapshot, 0, 'a refused friends ranking does no work');
  console.log('PASS friends leaderboard recomputes are budgeted');
}

// Friends-scope rankings still pass through the public privacy projection.
{
  const hidden = account('acct-friend-hidden', { privacy: { history: 'public', achievements: 'private', friendRequests: 'everyone', roomInvites: 'friends' } });
  const viewer = account('acct-friend-viewer');
  const row = { accountId: hidden.id, username: hidden.username, displayName: hidden.displayName, value: 8, wins: 8, achievements: 9, achievementScore: 90, mythical: 2, internalSecret: 'must-not-ship' };
  const h = socialHarness({ viewer, accounts: [hidden, viewer], friends: [hidden.id], privacy: { metrics: { wins: [row], achievements: [row], mythical: [row] } } });
  const board = h.ask('get-leaderboard', { metric: 'wins', scope: 'friends' });
  assert.deepEqual(board.rows.map(entry => entry.accountId), ['friend-hidden'], 'friend board uses the public username, not the internal account ID');
  assert.equal('achievements' in board.rows[0], false, 'private achievement fields are stripped on friend boards');
  assert.equal('internalSecret' in board.rows[0], false, 'friend board rows still receive public projection');
  const snapshot = h.ask('get-leaderboard-snapshot', { scope: 'friends' });
  assert.deepEqual(snapshot.metrics.achievements, [], 'private accounts are omitted from friends achievement rankings');
  assert.equal('internalSecret' in snapshot.metrics.wins[0], false, 'friend snapshot rows still receive public projection');
  console.log('PASS friends-scope leaderboard rows receive current privacy and public projection');
}

// Perf: a social summary builds the friendship lookup once instead of scanning
// the friendships collection for every friend card. Output must match the old
// per-card algorithm (a store without the index helper takes that path).
{
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { SocialStore } = await import('./socialStore.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-social-summary-'));
  const file = path.join(dir, 'social.json');
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ids = Array.from({ length: 400 }, (_, i) => `acct-${i}`);
  const friendships = [];
  const pairs = new Set();
  const addPair = (a, b, status) => {
    const key = [a, b].sort().join('|');
    if (a === b || pairs.has(key)) return;
    pairs.add(key);
    friendships.push({ id: `f-${friendships.length}`, requesterId: a, addresseeId: b, status, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  };
  for (let i = 1; i <= 200; i += 1) addPair(i % 2 ? 'viewer' : ids[i], i % 2 ? ids[i] : 'viewer', 'accepted');
  for (let i = 0; i < 1500; i += 1) addPair(ids[Math.floor(rand() * 400)], ids[Math.floor(rand() * 400)], 'accepted');
  for (let i = 300; i < 330; i += 1) addPair(ids[i], 'viewer', 'requested');
  for (let i = 330; i < 350; i += 1) addPair('viewer', ids[i], 'requested');
  for (let i = 350; i < 360; i += 1) addPair(ids[i], 'viewer', 'declined');
  fs.writeFileSync(file, JSON.stringify({ friendships }));
  const store = new SocialStore(file);
  store.invites.push({ id: 'inv-1', roomName: 'R', visibility: 'public', senderId: ids[5], recipientId: 'viewer', status: 'pending', expiresAt: new Date(Date.now() + 600000).toISOString() });
  const accountStore = {
    getAccountById: id => ({ id, username: id, privacy: id === ids[10] ? { achievements: 'private' } : {}, accountDeactivated: id === ids[12] }),
    getPublicPlayerCard: (id, options) => ({ id, displayName: id, achievements: options.includeAchievements ? ['a'] : [] }),
    getPublicAccountById: id => ({ id, displayName: id }),
    getRecentClearedAt: () => '',
    getMatchHistory: () => []
  };
  const build = backing => createSocialApi({ io: { sockets: { sockets: new Map() } }, accountStore, socialStore: backing, matchStore: { listForAccount: () => [] }, achievementStore: {} });
  const legacyView = new Proxy(store, { get: (target, key) => (key === 'friendshipIndex' ? undefined : Reflect.get(target, key, target)) });
  const expected = build(legacyView).socialSummary('viewer');
  assert.ok(expected.friends.length >= 190 && expected.friends.some(card => card.mutualFriends > 0), 'the seeded graph has mutual friends');
  let reads = 0;
  const held = store.friendships;
  Object.defineProperty(store, 'friendships', { get() { reads += 1; return held; }, set(value) { throw new Error(`unexpected write ${value}`); }, configurable: true });
  const actual = build(store).socialSummary('viewer');
  Object.defineProperty(store, 'friendships', { value: held, writable: true, configurable: true });
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), 'output is byte-identical to the per-card algorithm');
  assert.ok(reads <= 4, `friendships is scanned a bounded number of times per summary (saw ${reads})`);
  console.log('PASS social summary indexes friendships once');
}

console.log('social socket audit: 16 scenarios passed, 0 failed');
