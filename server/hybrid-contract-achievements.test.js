// Hybrid contracts share the loan leg until conversion. They must therefore
// remain visible to player-loan achievements and leaderboard statistics.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { AchievementStore } from './achievementStore.js';

const achievementStore = new AchievementStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-hybrid-ach-')), 'achievements.json'));
const match = {
  matchId: 'hybrid-achievement-match',
  participants: [{ accountId: 'acct_a', finalPlacement: 1 }, { accountId: 'acct_b', finalPlacement: 2 }],
  playerContracts: [
    { kind: 'hybrid', status: 'paid', fromAccountId: 'acct_a', toAccountId: 'acct_b', collateralTileIndex: null },
    { kind: 'hybrid', status: 'defaulted', fromAccountId: 'acct_a', toAccountId: 'acct_b', collateralTileIndex: 3 }
  ],
  globalEvents: [],
  eventCombinations: []
};
const ids = achievementStore.evaluateMatch(match).filter(entry => entry.accountId === 'acct_a').map(entry => entry.achievementId);
assert.equal(ids.includes('generous-lender'), true);
assert.equal(ids.includes('silent-partner'), true);
assert.equal(ids.includes('collateral-damage'), true);

const crisisIds = achievementStore.evaluateMatch({
  matchId: 'crisis-achievement-match',
  participants: [{ accountId: 'acct_a', finalPlacement: 1, globalEventsExperienced: 1, bankrupt: false }],
  globalEvents: ['HOUSING BUBBLE POP'],
  eventCombinations: [],
  playerContracts: []
}).map(entry => entry.achievementId);
assert.equal(crisisIds.includes('crisis-manager'), true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-hybrid-stats-'));
const accounts = new AccountStore(path.join(dir, 'accounts.json'));
accounts.register({ username: 'hybridlender', displayName: 'Hybrid Lender', password: 'hunter2hunter2' });
accounts.register({ username: 'hybridborrower', displayName: 'Hybrid Borrower', password: 'hunter2hunter2' });
const lender = accounts.findAccountByUsername('hybridlender');
const borrower = accounts.findAccountByUsername('hybridborrower');
accounts.recordGameResults([
  { id: 'p1', accountId: lender.id, nickname: 'Hybrid Lender', cash: 1000, properties: [], bankrupt: false },
  { id: 'p2', accountId: borrower.id, nickname: 'Hybrid Borrower', cash: 900, properties: [], bankrupt: false }
], 'p1', {
  gameId: 'hybrid-stats-match', roomVisibility: 'public', playerContracts: [
    { kind: 'hybrid', status: 'paid', fromAccountId: lender.id, toAccountId: borrower.id },
    { kind: 'hybrid', status: 'defaulted', fromAccountId: lender.id, toAccountId: borrower.id },
    { kind: 'hybrid', status: 'converted', fromAccountId: lender.id, toAccountId: borrower.id }
  ]
});
assert.equal(lender.stats.playerLoansGiven, 2);
assert.equal(borrower.stats.playerLoansRepaid, 1);
assert.equal(borrower.stats.playerLoanDefaults, 1);
assert.equal(lender.stats.equityDeals, 1);
assert.equal(borrower.stats.equityDeals, 1);
console.log('hybrid contract achievements and stats: 3 passed, 0 failed');
