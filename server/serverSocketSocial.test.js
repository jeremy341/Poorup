import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const socialSource = readFileSync(new URL('./serverSocketSocial.js', import.meta.url), 'utf8');
assert.match(socialSource, /claimReward\(account\.id, payload\.rewardId, Date\.now\(\), payload\.seasonId\)/);

const handlers = new Map();
const account = { id: "acct-secret", username: "alice", displayName: "Alice", color: "#d74438", avatarGrid: null, privacy: { history: "private" } };
const socket = { id: "social-test", handshake: { address: "127.0.0.1" }, request: { socket: { remoteAddress: "127.0.0.1" } } };
registerSocialSocketHandlers((event, handler) => handlers.set(event, handler), socket, {
  accountStore: {
    accounts: new Map([[account.username, account]]),
    getAccountById: () => null,
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
    patrolRunError: () => null,
    patrolRunPlausible: () => true,
    prunePatrolRuns: () => {},
    patrolRuns: new Map(),
    publicPlayerCard: () => ({ ...card }),
    recentPlayers: () => [],
    recordVerifiedAchievement: () => false,
    socialSummary: () => ({}),
  },
  roomManager: { getRoomBySocket: () => null },
  seasonStore: null,
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

handlers.get("get-public-player-card")({ accountId: "alice" }, value => { response = value; });
assert.equal(response.player.id, "alice");
assert.deepEqual(response.player.recentMatches, []);

console.log("server social privacy/public identity tests: passed");
