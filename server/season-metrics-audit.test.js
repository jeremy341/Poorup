import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { SeasonStore, seasonMetricValue } from './seasonModule.js';

const store = new SeasonStore(path.join(os.tmpdir(), 'poorup-season-metrics-' + Date.now() + '.json'));
const record = {
  matchId: 'season-metric-match',
  participants: [{
    accountId: 'acct-metric',
    finalPlacement: 1,
    endingCash: 500,
    bankrupt: false,
    auctionWins: 2,
    rentCollected: 300,
    globalEventsSurvived: 3,
    casinoNet: -20,
    mythicalUnlocked: true
  }, {
    accountId: 'acct-other',
    finalPlacement: 2,
    endingCash: 100,
    bankrupt: true
  }],
  casino: [{ accountId: 'acct-metric', net: -20 }],
  market: [{ accountId: 'acct-metric', positions: { brazil: { realizedPnl: 45 } } }],
  playerContracts: [
    { fromAccountId: 'acct-metric', toAccountId: 'acct-other', kind: 'loan', status: 'paid' },
    { fromAccountId: 'acct-other', toAccountId: 'acct-metric', kind: 'equity', status: 'active' }
  ]
};
store.recordMatch(record);
const rows = store.standings({ metric: 'casino' }).rows;
const metricRow = rows.find(row => row.accountId === 'acct-metric');
assert.equal(metricRow.value, -20);
assert.equal(seasonMetricValue('rent', metricRow), 300);
assert.equal(seasonMetricValue('auctions', metricRow), 2);
assert.equal(seasonMetricValue('market', metricRow), 45);
assert.equal(seasonMetricValue('mythical', metricRow), 1);

console.log('season metrics audit: 1 passed, 0 failed');
