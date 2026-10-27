import assert from "node:assert/strict";
import { PARLOR_PATROL_ENABLED } from "./accountStore.js";
import { projectPlayerCardAccess, publicLeaderboardRow, publicSearchProfile, registerSocialSocketHandlers } from "./serverSocketSocial.js";

const target = {
  id: "acct-secret",
  username: "alice",
  historyPrivate: true,
  historyFriendsOnly: false,
};
const card = { ...target, stats: { gamesPlayed: 4 } };
const privateView = projectPlayerCardAccess({
  card,
  target,
  canSeePrivateMatches: false,
  canSeeRecent: false,
  getRecentMatches: () => [{ matchId: "private-match" }],
});
assert.equal(privateView.id, "alice");
assert.deepEqual(privateView.recentMatches, []);
assert.equal(privateView.historyPrivate, true);

const publicView = projectPlayerCardAccess({
  card,
  target: { ...target, historyPrivate: false },
  canSeePrivateMatches: false,
  canSeeRecent: true,
  getRecentMatches: () => [{ matchId: "public-match" }],
});
assert.deepEqual(publicView.recentMatches, [{ matchId: "public-match" }]);

const searchProfile = publicSearchProfile({
  id: "acct-secret",
  username: "alice",
  displayName: "Alice",
  color: "#d74438",
  avatarGrid: null,
});
assert.equal(searchProfile.id, "alice");
assert.equal(searchProfile.accountId, undefined);

const leaderboardProfile = publicLeaderboardRow({
  accountId: "acct-secret",
  username: "alice",
  displayName: "Alice",
  value: 12,
});
assert.equal(leaderboardProfile.accountId, "alice");
assert.equal(leaderboardProfile.publicId, undefined);

const handlers = new Map();
const account = { id: "acct-secret", username: "alice", displayName: "Alice", color: "#d74438", avatarGrid: null, privacy: { history: "private" } };
const socket = { id: "social-test", handshake: { address: "127.0.0.1" }, request: { socket: { remoteAddress: "127.0.0.1" } } };
registerSocialSocketHandlers((event, handler) => handlers.set(event, handler), socket, {
  accountStore: {
    accounts: new Map([[account.username, account]]),
    getAccountById: id => id === account.id ? account : null,
    findAccountByUsername: username => username === account.username ? account : null,
    getPublicAccountById: id => id === account.id ? account : null,
    getPublicMatchSummaries: () => [{ matchId: "private-match" }],
    getLeaderboard: () => [{ accountId: account.id, username: account.username, displayName: account.displayName, value: 1 }],
    getLeaderboardSnapshot: () => ({ metrics: { wins: [{ accountId: account.id, username: account.username, displayName: account.displayName, value: 1 }] } }),
  },
  socialStore: { areBlocked: () => false, friendshipBetween: () => null },
  matchStore: { listForAccount: () => [] },
  social: {
    accountForSocket: () => null,
    allowAnonymousAction: () => true,
    allowSocialAction: () => true,
    chatBlockedInRoom: () => false,
    chatRateLimited: () => false,
    emitSocialUpdate: () => {},
    maxPlausiblePatrolScore: () => 0,
    notifyAccount: () => {},
    patrolAchievementCandidates: () => [],
    patrolRunError: (_socketId, currentAccount) => currentAccount ? null : 'Sign in to sync Parlor Patrol achievements.',
    patrolRunPlausible: () => true,
    prunePatrolRuns: () => {},
    patrolRuns: new Map(),
    publicPlayerCard: () => ({ ...card }),
    recentPlayers: () => [],
    recordVerifiedAchievement: () => false,
    socialSummary: () => ({}),
  },
  roomManager: { getRoomBySocket: () => null },
  io: { in: () => ({ emit: () => {} }) },
});

let response;
handlers.get("search-players")({ query: "alice", exact: true }, value => { response = value; });
assert.equal(response.players[0].id, "alice");
assert.equal(response.players[0].id, response.players[0].username);

handlers.get("get-leaderboard")({ metric: "wins", scope: "all" }, value => { response = value; });
assert.equal(response.rows[0].accountId, "alice");
assert.notEqual(response.rows[0].accountId, account.id);

handlers.get("get-leaderboard-snapshot")({ scope: "all" }, value => { response = value; });
assert.equal(response.metrics.wins[0].accountId, "alice");

handlers.get("get-leaderboard-snapshot")({ scope: "season" }, value => { response = value; });
assert.equal(response.scope, "all");
assert.equal(Object.hasOwn(response, "season"), false);
assert.equal(Object.hasOwn(response, "metrics"), true);

for (const event of ["get-season", "claim-season-reward", "get-cosmetics", "claim-cosmetic", "equip-cosmetic"]) {
  assert.equal(handlers.has(event), false, `${event} must not be registered`);
}

handlers.get("get-public-player-card")({ accountId: "alice" }, value => { response = value; });
assert.equal(response.player.id, "alice");
assert.deepEqual(response.player.recentMatches, []);

// An anonymous socket cannot start or settle a server-authoritative run.
assert.equal(PARLOR_PATROL_ENABLED, true);
for (const [event, payload] of [['start-patrol-run', {}], ['finish-patrol-run', { runToken: 'any', score: 9999 }]]) {
  response = null;
  handlers.get(event)(payload, value => { response = value; });
  assert.equal(response.success, false, `${event} must refuse an anonymous socket`);
  assert.equal(Object.hasOwn(response, 'runToken'), false);
}
handlers.get('get-leaderboard')({ metric: 'patrol', scope: 'all' }, value => { response = value; });
assert.equal(response.metric, 'patrol');
assert.equal(response.rows[0].accountId, 'alice', 'patrol rankings retain public identity projection');

console.log("server social privacy/public identity tests: passed");
