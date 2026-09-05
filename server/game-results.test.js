// Characterization suite for AccountStore.recordGameResults: pins placement
// order, matchRecord clipping/clamping, and the exact per-account stat deltas
// for a fixture that exercises every source (clamps, string numbers, NaN,
// missing accounts, casino/market/contract summaries). Goldens were captured
// from the pre-refactor implementation; the reducer-table extraction must
// keep them byte-identical.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountStore } from './accountStore.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-results-'));
const store = new AccountStore(path.join(dir, 'accounts.json'));
for (const username of ['alice', 'bob', 'carol']) {
  store.register({ username, displayName: username, password: 'hunter2hunter2' });
}
const byName = n => store.accounts.get(n);

function fixturePlayers() {
  return [
    { id: 'p1', accountId: byName('alice').id, cash: 1500, bankrupt: false, properties: [1, 5, 10], auctionWins: '2', rentCollected: 610, globalEventsSurvived: 3, bankLoanCount: 1, bankLoan: { status: 'paid' }, isBot: false },
    { id: 'p2', accountId: byName('bob').id, cash: 0, bankrupt: true, properties: [], auctionWins: -4, rentCollected: 'x', globalEventsSurvived: null, bankLoanCount: 0, bankLoan: { status: 'defaulted' } },
    { id: 'p3', accountId: byName('carol').id, cash: 500, bankrupt: false, properties: [7], auctionWins: 0, rentCollected: 0, globalEventsSurvived: 0, bankLoanCount: 2, bankLoan: { status: 'active' } },
    { id: 'p9', cash: 10 }
  ];
}

function fixtureMeta() {
  return {
    gameId: 'match-fixed',
    completedAt: '2026-01-01T00:00:00.000Z',
    durationSeconds: -5,
    roundCount: 12,
    roomVisibility: 'private',
    globalEvents: Array.from({ length: 25 }, (_, i) => 'event' + i),
    eventCombinations: Array.from({ length: 12 }, (_, i) => 'combo' + i),
    tradesCompleted: 3,
    auctionsCompleted: '2',
    casino: [
      { accountId: byName('alice').id, bets: 2, net: '-50' },
      { accountId: byName('bob').id, bets: 1, net: 'NaN' },
      { accountId: 'ghost', bets: 9, net: 9 }
    ],
    market: [
      { accountId: byName('alice').id, positions: { ACME: { quantity: 2, realizedPnl: '40' }, GLOBEX: { quantity: 1, realizedPnl: 50.5 } } },
      { accountId: byName('carol').id, positions: {} }
    ],
    playerContracts: [
      { id: 'c1', kind: 'loan', fromAccountId: byName('alice').id, toAccountId: byName('bob').id, status: 'paid' },
      { id: 'c2', kind: 'loan', fromAccountId: byName('bob').id, toAccountId: byName('alice').id, status: 'defaulted' },
      { id: 'c3', kind: 'equity', fromAccountId: byName('carol').id, toAccountId: byName('alice').id, status: 'active' },
      { id: 'c4', kind: 'equity', fromAccountId: 'ghost', toAccountId: 'ghost', status: 'paid' }
    ]
  };
}

const GOLDEN_ALICE = {
  gamesPlayed: 1, wins: 1, bankruptcies: 0, auctionWins: 2, rentCollected: 610,
  eventSurvival: 3, casinoNet: -50, marketProfit: 90.5, playerLoansGiven: 1,
  playerLoansRepaid: 0, playerLoanDefaults: 1, equityDeals: 1, bankLoansTaken: 1,
  bankLoanRepayments: 1, bankLoanDefaults: 0, patrolBest: 0, patrolAceRuns: 0
};
const GOLDEN_BOB = {
  gamesPlayed: 1, wins: 0, bankruptcies: 1, auctionWins: 0, rentCollected: 0,
  eventSurvival: 0, casinoNet: 0, marketProfit: 0, playerLoansGiven: 1,
  playerLoansRepaid: 1, playerLoanDefaults: 0, equityDeals: 0, bankLoansTaken: 0,
  bankLoanRepayments: 0, bankLoanDefaults: 1, patrolBest: 0, patrolAceRuns: 0
};
const GOLDEN_CAROL = {
  gamesPlayed: 1, wins: 0, bankruptcies: 0, auctionWins: 0, rentCollected: 0,
  eventSurvival: 0, casinoNet: 0, marketProfit: 0, playerLoansGiven: 0,
  playerLoansRepaid: 0, playerLoanDefaults: 0, equityDeals: 1, bankLoansTaken: 2,
  bankLoanRepayments: 0, bankLoanDefaults: 0, patrolBest: 0, patrolAceRuns: 0
};
const GOLDEN_PARTICIPANTS = ['1:1500:3:false', '4:0:0:true', '2:500:1:false', '3:10:0:false'];
const GOLDEN_RECORD = { durationSeconds: 0, roundCount: 12, roomVisibility: 'private', globalEvents: 20, eventCombinations: 10, auctionsCompleted: 2, tradesCompleted: 3, completedAt: '2026-01-01T00:00:00.000Z', matchId: 'match-fixed' };

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

const record = store.recordGameResults(fixturePlayers(), 'p1', fixtureMeta());

check('placement ladder: solvent by cash, bankrupt last', () => {
  assert.deepStrictEqual(
    record.participants.map(p => `${p.finalPlacement}:${p.endingCash}:${p.propertyCount}:${p.bankrupt}`),
    GOLDEN_PARTICIPANTS
  );
});

check('matchRecord clamps, slices, and honors fixed meta', () => {
  assert.strictEqual(record.durationSeconds, GOLDEN_RECORD.durationSeconds);
  assert.strictEqual(record.roundCount, GOLDEN_RECORD.roundCount);
  assert.strictEqual(record.roomVisibility, GOLDEN_RECORD.roomVisibility);
  assert.strictEqual(record.globalEvents.length, GOLDEN_RECORD.globalEvents);
  assert.strictEqual(record.eventCombinations.length, GOLDEN_RECORD.eventCombinations);
  assert.strictEqual(record.auctionsCompleted, GOLDEN_RECORD.auctionsCompleted);
  assert.strictEqual(record.tradesCompleted, GOLDEN_RECORD.tradesCompleted);
  assert.strictEqual(record.completedAt, GOLDEN_RECORD.completedAt);
  assert.strictEqual(record.matchId, GOLDEN_RECORD.matchId);
  assert.deepStrictEqual(record.casino.length, 3);
  assert.deepStrictEqual(record.market.length, 2);
  assert.deepStrictEqual(record.playerContracts.length, 4);
});

check('alice stat deltas', () => assert.deepStrictEqual(byName('alice').stats, GOLDEN_ALICE));
check('bob stat deltas (clamped negatives, NaN string, null survival)', () => assert.deepStrictEqual(byName('bob').stats, GOLDEN_BOB));
check('carol stat deltas', () => assert.deepStrictEqual(byName('carol').stats, GOLDEN_CAROL));

check('history entries pin result/won/cash/properties', () => {
  const shape = a => a.history.map(h => ({ ...h, playedAt: 'STRIPPED' }));
  assert.deepStrictEqual(shape(byName('alice')), [{ matchId: 'match-fixed', playedAt: 'STRIPPED', result: 'WIN', won: true, endingCash: 1500, properties: 3 }]);
  assert.deepStrictEqual(shape(byName('bob')), [{ matchId: 'match-fixed', playedAt: 'STRIPPED', result: 'ROUND', won: false, endingCash: 0, properties: 0 }]);
  assert.deepStrictEqual(shape(byName('carol')), [{ matchId: 'match-fixed', playedAt: 'STRIPPED', result: 'ROUND', won: false, endingCash: 500, properties: 1 }]);
});

const second = store.recordGameResults(fixturePlayers(), 'p1', fixtureMeta());
check('re-recording the same match dedupes history but doubles stats', () => {
  assert.strictEqual(byName('alice').matchHistory.length, 1);
  assert.strictEqual(byName('alice').matchHistory[0], second);
  assert.strictEqual(byName('alice').stats.gamesPlayed, 2);
  assert.strictEqual(byName('alice').stats.wins, 2);
  assert.strictEqual(byName('alice').stats.casinoNet, -100);
  assert.strictEqual(byName('alice').stats.marketProfit, 181);
  assert.strictEqual(byName('alice').stats.rentCollected, 1220);
  assert.strictEqual(byName('bob').stats.playerLoansRepaid, 2);
  assert.strictEqual(byName('carol').stats.equityDeals, 2);
});

check('null players do not crash placement', () => {
  store.recordGameResults([null, ...fixturePlayers()], 'p1', { ...fixtureMeta(), gameId: 'match-null' });
  assert.ok(true);
});

const failed = results.filter(r => !r).length;
console.log(`\nrecordGameResults tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
