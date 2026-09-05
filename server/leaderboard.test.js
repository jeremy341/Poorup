// Characterization suite for the leaderboard read model. It pins the exact
// rank order and value each metric yields for a fixed three-account fixture,
// captured from the pre-refactor getLeaderboard/getWindowStats. The metric
// ladder may be reshaped (ternary chain -> table) only while this stays green.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountStore } from './accountStore.js';

// username:value rows in leaderboard order, captured from the current build.
const GOLDEN = {
  wins: ['alice:6', 'carol:6', 'bob:3'],
  rate: ['carol:75', 'alice:60'],
  games: ['alice:10', 'carol:8', 'bob:4'],
  achievements: ['alice:1110', 'carol:60', 'bob:10'],
  mythical: ['alice:1', 'carol:0', 'bob:0'],
  bankruptcies: ['carol:2', 'alice:1', 'bob:0'],
  events: ['bob:5', 'alice:2', 'carol:0'],
  auctions: ['alice:3', 'carol:0', 'bob:0'],
  rent: ['alice:500', 'bob:200', 'carol:100'],
  casino: ['alice:120', 'carol:0', 'bob:-50'],
  market: ['alice:80', 'carol:20', 'bob:10'],
  playerloans: ['alice:4', 'carol:0', 'bob:0'],
  equity: ['alice:3', 'carol:1', 'bob:0'],
  loans: ['alice:5', 'carol:2', 'bob:0'],
  patrol: ['alice:900', 'bob:100', 'carol:50']
};

function buildStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-lb-'));
  const store = new AccountStore(path.join(dir, 'accounts.json'));
  seed(store, 'alice', { gamesPlayed: 10, wins: 6, bankruptcies: 1, auctionWins: 3, rentCollected: 500, eventSurvival: 2, casinoNet: 120, marketProfit: 80, playerLoansGiven: 4, playerLoansRepaid: 1, playerLoanDefaults: 2, equityDeals: 3, bankLoansTaken: 5, bankLoanRepayments: 4, bankLoanDefaults: 1, patrolBest: 900, patrolAceRuns: 3 }, ['first-deed', 'public-works', '41st-tile']);
  seed(store, 'bob', { gamesPlayed: 4, wins: 3, bankruptcies: 0, auctionWins: 0, rentCollected: 200, eventSurvival: 5, casinoNet: -50, marketProfit: 10, playerLoansGiven: 0, playerLoansRepaid: 2, playerLoanDefaults: 0, equityDeals: 0, bankLoansTaken: 0, bankLoanRepayments: 0, bankLoanDefaults: 3, patrolBest: 100, patrolAceRuns: 0 }, ['first-deed']);
  seed(store, 'carol', { gamesPlayed: 8, wins: 6, bankruptcies: 2, auctionWins: 0, rentCollected: 100, eventSurvival: 0, casinoNet: 0, marketProfit: 20, playerLoansGiven: 0, playerLoansRepaid: 1, playerLoanDefaults: 0, equityDeals: 1, bankLoansTaken: 1, bankLoanRepayments: 1, bankLoanDefaults: 0, patrolBest: 50, patrolAceRuns: 0 }, ['first-deed', 'auction-ghost']);
  return store;
}

function seed(store, username, stats, achievementIds) {
  store.register({ username, displayName: username[0].toUpperCase() + username.slice(1), password: 'hunter2hunter2' });
  const account = store.accounts.get(username);
  Object.assign(account.stats, stats);
  account.achievements = achievementIds.map((id, index) => ({ id, unlockedAt: `2026-01-0${index + 1}T00:00:00.000Z` }));
}

function rank(store, metric) {
  return store.getLeaderboard(metric).map(row => `${row.username}:${row.value}`);
}

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

const store = buildStore();
for (const metric of Object.keys(GOLDEN)) {
  check(`leaderboard metric ${metric}`, () => assert.deepStrictEqual(rank(store, metric), GOLDEN[metric]));
}
check('snapshot exposes the full metric set', () => {
  assert.deepStrictEqual(Object.keys(store.getLeaderboardSnapshot().metrics), Object.keys(GOLDEN));
});
check('window stats with no cutoff mirror stored stats', () => {
  const alice = store.accounts.get('alice');
  assert.deepStrictEqual(store.getWindowStats(alice, null), alice.stats);
});
check('window stats with empty history zero all but patrol', () => {
  const alice = store.accounts.get('alice');
  const since = Date.parse('2020-01-01T00:00:00.000Z');
  const windowed = store.getWindowStats(alice, since);
  assert.strictEqual(windowed.wins, 0, 'no matchHistory means no wins');
  assert.strictEqual(windowed.patrolBest, 900, 'patrol is copied from stored stats');
});

const failed = results.filter(ok => !ok).length;
console.log(`leaderboard tests: ${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
