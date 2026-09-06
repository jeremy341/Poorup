import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountStore } from '../server/accountStore.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-capture-'));
const store = new AccountStore(path.join(dir, 'accounts.json'));
for (const username of ['alice', 'bob', 'carol']) {
  store.register({ username, displayName: username, password: 'hunter2hunter2' });
}
const byName = n => store.accounts.get(n);

const players = [
  { id: 'p1', accountId: byName('alice').id, cash: 1500, bankrupt: false, properties: [1, 5, 10], auctionWins: '2', rentCollected: 610, globalEventsSurvived: 3, bankLoanCount: 1, bankLoan: { status: 'paid' }, isBot: false },
  { id: 'p2', accountId: byName('bob').id, cash: 0, bankrupt: true, properties: [], auctionWins: -4, rentCollected: 'x', globalEventsSurvived: null, bankLoanCount: 0, bankLoan: { status: 'defaulted' } },
  { id: 'p3', accountId: byName('carol').id, cash: 500, bankrupt: false, properties: [7], auctionWins: 0, rentCollected: 0, globalEventsSurvived: 0, bankLoanCount: 2, bankLoan: { status: 'active' } },
  { id: 'p9', cash: 10 },
];
const matchMeta = {
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

const record = store.recordGameResults(players, 'p1', matchMeta);
const strip = a => ({ ...a, history: a.history.map(h => ({ ...h, playedAt: 'STRIPPED' })) });
const out = {
  participants: record.participants.map(p => `${p.finalPlacement}:${p.endingCash}:${p.propertyCount}:${p.bankrupt}`),
  recordKeys: { duration: record.durationSeconds, rounds: record.roundCount, vis: record.roomVisibility, ge: record.globalEvents.length, ec: record.eventCombinations.length, au: record.auctionsCompleted, tr: record.tradesCompleted, completedAt: record.completedAt, id: record.matchId },
  alice: { stats: store.accounts.get('alice').stats, history: strip(store.accounts.get('alice')).history, matches: store.accounts.get('alice').matchHistory.length },
  bob: { stats: store.accounts.get('bob').stats, history: strip(store.accounts.get('bob')).history },
  carol: { stats: store.accounts.get('carol').stats, history: strip(store.accounts.get('carol')).history }
};
console.log(JSON.stringify(out, null, 1));

