// Regression suite for the B-33 and B-34 economy-audit defects.
//
// B-34 (seasonModule.js / serverSocketSocial.js): the `get-season` socket
// whitelist accepts `metric: 'mastery'`, but seasonMetricValue() had no
// `mastery` key, so its own hasOwnProperty guard answered `row.points` --
// the server returned the SEASON-POINTS ladder while echoing
// `metric: 'mastery'`. `participation` was missing the same way, which also
// made claimReward() sort the `season-grinder` (track: 'participation')
// ladder by points. Both keys now exist. `achievements` stays as the
// long-shipped alias for the same mastery column.
//
// B-33 (serverSocketSocial.js): `claim-season-reward` never forwarded
// payload.seasonId, so claimReward() always resolved ensureCurrent(). After a
// rollover that is a fresh empty season: sortStandings() returns [], the row
// lookup misses, and every earned-then-unclaimed reward failed with
// 'Season reward requirements are not met.' permanently. The handler now
// forwards the id. That is additive -- an omitted or unknown seasonId still
// takes the pre-existing ensureCurrent() path byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SeasonStore, SEASON_LENGTH_MS, seasonIdFor, seasonMetricValue } from './seasonModule.js';
import { registerSocialSocketHandlers } from './serverSocketSocial.js';

const REQUIREMENTS_ERROR = 'Season reward requirements are not met.';
const UNAVAILABLE_ERROR = 'Season reward is unavailable.';

// Two pinned season windows. The store is pinned to the first one so nothing
// in this suite depends on the wall clock.
const SEASON_ONE_AT = Date.UTC(2026, 0, 6);
const SEASON_TWO_AT = SEASON_ONE_AT + SEASON_LENGTH_MS;
const SEASON_ONE_ID = seasonIdFor(SEASON_ONE_AT);
const SEASON_TWO_ID = seasonIdFor(SEASON_TWO_AT);

const openStores = [];
function seasonStore(label, now = SEASON_ONE_AT) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `poorup-${label}-`));
  openStores.push(dir);
  return new SeasonStore(path.join(dir, 'seasons.json'), now);
}

test.after(() => {
  openStores.forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

// The whole social runtime needs far more surface than these two handlers
// touch, so the harness mirrors server/serverSocketSocial.test.js and supplies
// a real SeasonStore (that suite passes `seasonStore: null`, which is exactly
// why it never covered either defect). `profiles[0]` is the signed-in account.
const ACCOUNT = { id: 'acct-socket', username: 'socket-hero', displayName: 'Socket Hero', color: '#cfa75f', avatarGrid: null };
const RIVAL = { id: 'acct-rival', username: 'socket-rival', displayName: 'Socket Rival', color: '#8a8a8a', avatarGrid: null };

function socialRuntime(seasonStore, { profiles = [ACCOUNT, RIVAL] } = {}) {
  const handlers = new Map();
  const socket = { id: 'season-socket', data: {}, handshake: { address: '127.0.0.1' }, request: { socket: { remoteAddress: '127.0.0.1' } }, emit() {} };
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  const grants = [];
  const runtime = {
    accountStore: {
      accounts: new Map(profiles.map(profile => [profile.username, profile])),
      getAccountById: id => profileById.get(id) || null,
      findAccountByUsername: username => profiles.find(profile => profile.username === username) || null,
      getPublicAccountById: id => profileById.get(id) || null,
      getPublicMatchSummaries: () => [],
      getLeaderboard: () => [],
      getLeaderboardSnapshot: () => ({ metrics: {} })
    },
    socialStore: { areBlocked: () => false, friendshipBetween: () => null, listFor: () => ({ friends: [], requests: [], outgoing: [] }) },
    matchStore: { listForAccount: () => [] },
    cosmeticStore: {
      claim: (accountId, cosmeticId, options) => { grants.push(['cosmetic', accountId, cosmeticId, options.claimKey]); return { success: true }; },
      grantTokens: (accountId, amount, claimKey) => { grants.push(['tokens', accountId, amount, claimKey]); return { success: true }; },
      snapshot: () => ({ owned: [] })
    },
    telemetryStore: { record() {} },
    seasonStore,
    roomManager: { getRoomBySocket: () => null },
    getRoomForSocket: () => null,
    io: { in: () => ({ emit() {} }), emit() {} },
    social: {
      accountForSocket: () => profiles[0],
      allowAnonymousAction: () => true,
      allowSocialAction: () => true,
      chatBlockedInRoom: () => false,
      chatRateLimited: () => false,
      emitSocialUpdate() {},
      maxPlausiblePatrolScore: () => 100000,
      notifyAccount() {},
      patrolAchievementCandidates: () => [],
      patrolRunError: () => null,
      patrolRunPlausible: () => true,
      patrolRuns: new Map(),
      prunePatrolRuns() {},
      publicPlayerCard: () => null,
      recentPlayers: () => [],
      recordVerifiedAchievement: () => false,
      socialSummary: () => ({})
    }
  };
  registerSocialSocketHandlers((event, handler) => handlers.set(event, handler), socket, runtime);
  return { handlers, grants };
}

function emit(handlers, event, payload) {
  let ack;
  handlers.get(event)(payload, value => { ack = value; });
  assert.notEqual(ack, undefined, `${event} must always answer its ack`);
  return ack;
}

// A ten-seat table driven through the real recordMatch path, so every
// standings row in the B-34 fixtures is built by production scoring, not by
// hand-seeding internals. `overrides` is keyed by accountId.
function tenSeatRecord(matchId, at, overrides = {}) {
  const accounts = Array.from({ length: 10 }, (_, index) => `acct-seater-${index}`);
  return {
    matchId,
    completedAt: new Date(at).toISOString(),
    participants: accounts.map((accountId, index) => overrides[accountId] || {
      accountId,
      finalPlacement: index + 1,
      globalEventsSurvived: 0,
      bankLoanStatus: null,
      fairTrades: 0
    })
  };
}

// ------------------------------------------------------------------- B-34

test('B-34 the mastery metric returns mastery, not season points', () => {
  assert.equal(seasonMetricValue('mastery', { mastery: 500, points: 42 }), 500,
    'mastery 500 must not be answered with 42 season points');
  // The silent-wrong case: a row that has earned no mastery at all but has
  // banked points must report 0, not its points.
  assert.equal(seasonMetricValue('mastery', { mastery: 0, points: 900 }), 0,
    'a zero-mastery row must not borrow the points ladder');
});

test('B-34 the participation metric returns participation, not season points', () => {
  assert.equal(seasonMetricValue('participation', { participation: 8, points: 99 }), 8);
  assert.equal(seasonMetricValue('participation', { participation: 0, points: 99 }), 0);
});

test('B-34 achievements keeps resolving to the mastery column', () => {
  // public/clientSocialSurfaces.js lists "achievements" as a ranking metric and
  // SEASON_METRICS carries it; it is a wire alias, not dead weight.
  assert.equal(seasonMetricValue('achievements', { mastery: 500, points: 42 }), 500);
  assert.equal(seasonMetricValue('achievements', { mastery: 0, points: 900 }), 0);
});

test('B-34 an unknown metric still falls back to season points', () => {
  assert.equal(seasonMetricValue('not-a-metric', { mastery: 500, participation: 8, points: 42 }), 42);
  assert.equal(seasonMetricValue('points', { mastery: 500, points: 42 }), 42);
  assert.equal(seasonMetricValue(undefined, { points: 42 }), 42);
  assert.equal(seasonMetricValue('mastery', {}), undefined,
    'a bare row reports no mastery rather than borrowing points');
});

// A fixture whose two ladders disagree, so an answer that is really the points
// ladder cannot pass for mastery by coincidence.
//   grinder : 4th, 25 events survived -> 85 pts/match, 100 mastery/match
//   winner  : 1st, no evidence        -> 105 pts/match,   0 mastery/match
// Over four matches: grinder 340 pts / 400 mastery, winner 420 pts / 0 mastery.
const GRINDER = 'acct-seater-3';
const WINNER = 'acct-seater-0';
function crossedMasterySeason() {
  const store = seasonStore('b34-mastery');
  const record = tenSeatRecord('mastery-match', SEASON_ONE_AT, {
    [GRINDER]: { accountId: GRINDER, finalPlacement: 4, globalEventsSurvived: 25, bankLoanStatus: null, fairTrades: 0 },
    [WINNER]: { accountId: WINNER, finalPlacement: 1, globalEventsSurvived: 0, bankLoanStatus: null, fairTrades: 0 }
  });
  for (let index = 0; index < 4; index += 1) {
    store.recordMatch({ ...record, matchId: `mastery-match-${index}` }, SEASON_ONE_AT);
  }
  return store;
}

test('B-34 a mastery ladder is ranked by mastery, not by points', () => {
  const store = crossedMasterySeason();
  const rows = store.standings({ seasonId: SEASON_ONE_ID, metric: 'mastery' }).rows;
  // Precondition: the fixture really is crossed, so this ordering is only
  // reachable through a mastery key.
  assert.deepEqual(store.standings({ seasonId: SEASON_ONE_ID, metric: 'points' }).rows.map(row => row.accountId).slice(0, 2), [WINNER, GRINDER],
    'the points ladder puts the winner first');
  assert.equal(rows[0].accountId, GRINDER, 'mastery must put the grinder first');
  assert.equal(rows[0].mastery, 400);
  assert.equal(rows[0].points, 340);
  assert.equal(rows[0].value, 400, 'the projected value is the mastery, not the points');
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].value, 0, 'a zero-mastery row projects 0 even though it has 420 points');
  assert.equal(rows[1].points, 420);
});

test('B-34 get-season?metric=mastery answers with the mastery ladder end to end', () => {
  const store = crossedMasterySeason();
  const { handlers } = socialRuntime(store, { profiles: [{ ...ACCOUNT, id: GRINDER }, { ...RIVAL, id: WINNER }] });
  const ack = emit(handlers, 'get-season', { metric: 'mastery', seasonId: SEASON_ONE_ID });

  assert.equal(ack.success, true);
  assert.equal(ack.metric, 'mastery', 'the echoed metric matches the request');
  assert.equal(ack.season.id, SEASON_ONE_ID);
  assert.equal(ack.rows.length, 10);
  assert.equal(ack.rows[0].accountId, GRINDER, 'rows are ranked by mastery');
  assert.equal(ack.rows[1].accountId, WINNER);
  assert.equal(ack.rows[0].value, 400, 'the reported value is the mastery');
  assert.equal(ack.rows[0].points, 340);
  assert.notEqual(ack.rows[0].value, ack.rows[0].points, 'a points answer would be indistinguishable from a correct one otherwise');
  // Every row, including the eight rows that never accrued mastery, must
  // project its own mastery rather than its points.
  ack.rows.forEach(row => {
    assert.equal(row.value, row.mastery, `${row.accountId} projects its mastery`);
    assert.notEqual(row.value, row.points, `${row.accountId} does not project its points`);
  });
  assert.equal(ack.rows.find(row => row.accountId === GRINDER).username, 'socket-hero',
    'the public projection still decorates rows');
});

test('B-34 the get-season points metric is unchanged by the mastery fix', () => {
  const store = crossedMasterySeason();
  const { handlers } = socialRuntime(store);
  const ack = emit(handlers, 'get-season', { metric: 'points', seasonId: SEASON_ONE_ID });
  assert.equal(ack.metric, 'points');
  assert.equal(ack.rows[0].accountId, WINNER, 'the points ladder is untouched');
  assert.equal(ack.rows[0].value, ack.rows[0].points);
  ack.rows.forEach(row => assert.equal(row.value, row.points));
});

test('B-34 a whitelisted-but-unknown metric still degrades to points', () => {
  const store = crossedMasterySeason();
  const { handlers } = socialRuntime(store);
  const ack = emit(handlers, 'get-season', { metric: 'mythical', seasonId: SEASON_ONE_ID });
  assert.equal(ack.metric, 'points', 'mythical is outside the get-season whitelist');
  assert.equal(ack.rows[0].value, ack.rows[0].points);
});

test('B-34 the placement lockout still ranks on the points ladder', () => {
  // B-07's guard is a rank gate over `points`. Guarding it here keeps the
  // mastery key from quietly re-pointing the placement rewards.
  const store = seasonStore('b34-placement');
  const accounts = Array.from({ length: 10 }, (_, index) => `acct-seater-${index}`);
  const match = matchId => ({
    matchId,
    completedAt: new Date(SEASON_ONE_AT).toISOString(),
    participants: accounts.map((accountId, index) => ({ accountId, finalPlacement: index + 1, globalEventsSurvived: 0, bankLoanStatus: null, fairTrades: 0 }))
  });
  store.recordMatch(match('placement-1'), SEASON_ONE_AT);
  ['season-bronze', 'season-silver', 'season-gold', 'season-top'].forEach(rewardId => {
    const claim = store.claimReward(accounts[0], rewardId, SEASON_ONE_AT);
    assert.equal(claim.success, false, `${rewardId} stays locked after one match`);
    assert.equal(claim.error, REQUIREMENTS_ERROR);
  });
  store.recordMatch(match('placement-2'), SEASON_ONE_AT);
  assert.equal(store.claimReward(accounts[0], 'season-bronze', SEASON_ONE_AT).success, true);
});

// ------------------------------------------------------------------- B-33

// A hero who clears the `season-master` ladder (5 matches x 100 mastery = 500)
// inside season one and never touches season two, plus a rival who records the
// same five matches but accrues no mastery at all. Ten seats so the placement
// ladder has a real population behind it.
const HERO = 'acct-seater-0';
const LOSER = 'acct-seater-1';
function heroSeason(now = SEASON_ONE_AT) {
  const store = seasonStore('b33-rollover', now);
  const match = matchId => ({
    matchId,
    completedAt: new Date(now).toISOString(),
    participants: Array.from({ length: 10 }, (_, index) => ({
      accountId: `acct-seater-${index}`,
      finalPlacement: index + 1,
      globalEventsSurvived: index === 1 ? 0 : 25,
      bankLoanStatus: null,
      fairTrades: 0
    }))
  });
  for (let index = 0; index < 5; index += 1) store.recordMatch(match(`hero-match-${index}`), now);
  return store;
}

// Rolls the store into season two WITHOUT consuming the claim under test. The
// eligibility preconditions are asserted off the standings instead, so each
// test starts from a genuinely unclaimed prior-season reward.
function rolledOverHeroStore() {
  const store = heroSeason();
  const row = store.standings({ seasonId: SEASON_ONE_ID, metric: 'mastery' }).rows.find(entry => entry.accountId === HERO);
  assert.equal(row.mastery, 500, 'precondition: the hero clears the 500 mastery threshold');
  assert.equal(row.participation, 5, 'precondition: five recorded matches');
  assert.equal(store.standings({ seasonId: SEASON_ONE_ID }).rows.find(entry => entry.accountId === LOSER).mastery, 0,
    'precondition: the rival accrued no mastery');
  assert.deepEqual(store.claimedRewards(HERO, SEASON_ONE_ID), [], 'precondition: nothing claimed yet');
  assert.equal(store.ensureCurrent(SEASON_TWO_AT).id, SEASON_TWO_ID, 'precondition: the season rolled over');
  assert.equal(store.getSeason(SEASON_ONE_ID).status, 'complete');
  assert.deepEqual(store.standings({ seasonId: SEASON_TWO_ID }).rows, [], 'precondition: season two is empty');
  return store;
}

test('B-33 a reward earned in season one is claimable after the rollover when the season is named', () => {
  const store = rolledOverHeroStore();
  const claim = store.claimReward(HERO, 'season-master', SEASON_TWO_AT, SEASON_ONE_ID);
  assert.equal(claim.success, true, 'the prior-season reward is reachable again');
  assert.equal(claim.created, true);
  assert.equal(claim.reward.id, 'season-master');
  assert.equal(claim.season.id, SEASON_ONE_ID, 'the claim lands on the named season');
  assert.deepEqual(store.claimedRewards(HERO, SEASON_ONE_ID), ['season-master']);
  assert.deepEqual(store.claimedRewards(HERO, SEASON_TWO_ID), [], 'season two is untouched');
});

test('B-33 the claim-season-reward socket forwards payload.seasonId', () => {
  const store = rolledOverHeroStore();
  const { handlers, grants } = socialRuntime(store, { profiles: [{ ...ACCOUNT, id: HERO }, { ...RIVAL, id: LOSER }] });
  const ack = emit(handlers, 'claim-season-reward', { rewardId: 'season-master', seasonId: SEASON_ONE_ID });
  assert.equal(ack.success, true, 'the socket path is what production uses, so it is the path that must work');
  assert.equal(ack.created, true);
  assert.equal(ack.reward.id, 'season-master');
  assert.equal(ack.season.id, SEASON_ONE_ID);
  assert.equal(ack.season.status, 'complete', 'the public summary reports the closed season');
  assert.equal(typeof ack.claimId, 'string', 'a fresh claim mints a claim id');
  assert.deepEqual(grants.map(grant => grant[0]), ['cosmetic', 'tokens'], 'the grant runs against the named season');
  assert.equal(grants[0][3], `season:${SEASON_ONE_ID}:season-master`, 'the claim key pins the season it was earned in');
});

test('B-33 the same claim after the rollover without a seasonId still fails with the existing error', () => {
  const store = rolledOverHeroStore();
  const claim = store.claimReward(HERO, 'season-master', SEASON_TWO_AT);
  assert.equal(claim.success, false, 'an unnamed claim still resolves the fresh empty season');
  assert.equal(claim.error, REQUIREMENTS_ERROR, 'no new error string is invented');
  assert.deepEqual(store.claimedRewards(HERO, SEASON_ONE_ID), [], 'nothing was credited to either season');
});

test('B-33 the socket without a seasonId answers the unchanged legacy failure', () => {
  const store = rolledOverHeroStore();
  const { handlers, grants } = socialRuntime(store, { profiles: [{ ...ACCOUNT, id: HERO }, { ...RIVAL, id: LOSER }] });
  const ack = emit(handlers, 'claim-season-reward', { rewardId: 'season-master' });
  assert.equal(ack.success, false);
  assert.equal(ack.error, REQUIREMENTS_ERROR, 'an existing client sees exactly the response it always saw');
  assert.deepEqual(grants, [], 'a failed claim grants nothing');
});

test('B-33 omitting seasonId is byte-for-byte the pre-change code path', () => {
  // Before the fix the handler called claimReward(accountId, rewardId) and
  // every default landed the same way. Both the 2-arg call and the 4-arg call
  // with a falsy seasonId must resolve ensureCurrent(now) identically.
  const live = heroSeason();
  const twoArg = live.claimReward(HERO, 'season-master', SEASON_ONE_AT);
  assert.equal(twoArg.success, true, 'precondition: a live-season claim still succeeds');
  assert.equal(twoArg.created, true);
  assert.equal(twoArg.season.id, SEASON_ONE_ID);
  const named = heroSeason().claimReward(HERO, 'season-master', SEASON_ONE_AT, SEASON_ONE_ID);
  assert.deepEqual(
    { success: named.success, created: named.created, season: named.season.id, reward: named.reward },
    { success: twoArg.success, created: twoArg.created, season: twoArg.season.id, reward: twoArg.reward },
    'naming the season the store would have resolved on its own changes nothing'
  );

  const { handlers, grants } = socialRuntime(heroSeason(Date.now()), { profiles: [{ ...ACCOUNT, id: HERO }, { ...RIVAL, id: LOSER }] });
  const ack = emit(handlers, 'claim-season-reward', { rewardId: 'season-master', seasonId: '' });
  assert.equal(ack.success, true, 'an empty seasonId is falsy and keeps the legacy path');
  assert.equal(ack.season.id, seasonIdFor(Date.now()), 'the live season is resolved by the store, as before');
  assert.equal(ack.created, true);
  assert.deepEqual(grants.map(grant => grant[0]), ['cosmetic', 'tokens']);
});

test('B-33 a replayed claim is still idempotent', () => {
  const store = rolledOverHeroStore();
  const first = store.claimReward(HERO, 'season-master', SEASON_TWO_AT, SEASON_ONE_ID);
  assert.equal(first.success, true);
  assert.equal(first.created, true);
  const replay = store.claimReward(HERO, 'season-master', SEASON_TWO_AT, SEASON_ONE_ID);
  assert.equal(replay.success, true, 'a replay still succeeds so the cosmetic/token seam stays retry-safe');
  assert.equal(replay.created, false, 'a replay creates nothing');
  assert.equal(replay.claimId, undefined, 'a replay mints no new claim id');
  assert.deepEqual(store.claimedRewards(HERO, SEASON_ONE_ID), ['season-master'], 'the claim list is not appended twice');

  const { handlers } = socialRuntime(store, { profiles: [{ ...ACCOUNT, id: HERO }, { ...RIVAL, id: LOSER }] });
  const replayAck = emit(handlers, 'claim-season-reward', { rewardId: 'season-master', seasonId: SEASON_ONE_ID });
  assert.equal(replayAck.success, true);
  assert.equal(replayAck.created, false);
});

test('B-33 an unmet requirement still fails with the existing error', () => {
  const store = rolledOverHeroStore();
  const claim = store.claimReward(LOSER, 'season-master', SEASON_TWO_AT, SEASON_ONE_ID);
  assert.equal(claim.success, false, 'naming the season does not bypass the requirements');
  assert.equal(claim.error, REQUIREMENTS_ERROR);
  assert.deepEqual(store.claimedRewards(LOSER, SEASON_ONE_ID), []);

  const grinder = store.claimReward(HERO, 'season-grinder', SEASON_TWO_AT, SEASON_ONE_ID);
  assert.equal(grinder.success, false, 'five participations is short of the eight season-grinder wants');
  assert.equal(grinder.error, REQUIREMENTS_ERROR);

  // ...while the reward the hero DID earn is reachable, so the refusal above is
  // the threshold and not a broken season lookup.
  assert.equal(store.claimReward(HERO, 'season-bronze', SEASON_TWO_AT, SEASON_ONE_ID).success, true,
    'ten seats, five participations and first place clears the bronze band');
});

test('B-33 a named season that does not exist is refused, not defaulted forward', () => {
  const store = heroSeason();
  const unknown = store.claimReward(HERO, 'season-master', SEASON_ONE_AT, 'S29990101');
  assert.equal(unknown.success, false);
  assert.equal(unknown.error, UNAVAILABLE_ERROR, 'a bogus id must not silently fall back to the current season');
  const blank = store.claimReward(HERO, 'season-master', SEASON_ONE_AT, '   ');
  assert.equal(blank.success, false);
  assert.equal(blank.error, UNAVAILABLE_ERROR);
  const nonString = store.claimReward(HERO, 'season-master', SEASON_ONE_AT, { toString: () => SEASON_ONE_ID });
  assert.equal(nonString.success, false, 'safeSeasonId rejects a non-string id');
  assert.equal(nonString.error, UNAVAILABLE_ERROR);
  assert.deepEqual(store.claimedRewards(HERO, SEASON_ONE_ID), [], 'none of the refused claims credited anything');
});

test('B-33 every earned-then-unclaimed reward survives the rollover, not just mastery', () => {
  // The six REWARD_TRACK rewards: four placement, participation, mastery.
  // Participation is the one ladder the B-34 fix also re-pointed, so the two
  // defects meet on `season-grinder`.
  const store = seasonStore('b33-grinder');
  const accounts = Array.from({ length: 10 }, (_, index) => `acct-seater-${index}`);
  const match = matchId => ({
    matchId,
    completedAt: new Date(SEASON_ONE_AT).toISOString(),
    participants: accounts.map((accountId, index) => ({
      accountId,
      finalPlacement: index + 1,
      globalEventsSurvived: 25,
      bankLoanStatus: 'paid',
      fairTrades: 4
    }))
  });
  for (let index = 0; index < 8; index += 1) store.recordMatch(match(`grind-${index}`), SEASON_ONE_AT);
  store.ensureCurrent(SEASON_TWO_AT);
  // 8 participations clears season-grinder; 8x(40 mastery + 12 trades + 6 debt
  // -> 100 capped) = 800 mastery clears season-master; the rank bands clear with
  // a real ten-seat population behind them.
  const grind = store.claimReward(accounts[0], 'season-grinder', SEASON_TWO_AT, SEASON_ONE_ID);
  assert.equal(grind.success, true, `season-grinder after rollover: ${grind.error || ''}`);
  assert.equal(grind.created, true);
  const master = store.claimReward(accounts[0], 'season-master', SEASON_TWO_AT, SEASON_ONE_ID);
  assert.equal(master.success, true, `season-master after rollover: ${master.error || ''}`);
  const bronze = store.claimReward(accounts[0], 'season-bronze', SEASON_TWO_AT, SEASON_ONE_ID);
  assert.equal(bronze.success, true, `season-bronze after rollover: ${bronze.error || ''}`);
  assert.deepEqual(store.claimedRewards(accounts[0], SEASON_ONE_ID).sort(), ['season-bronze', 'season-grinder', 'season-master']);
});