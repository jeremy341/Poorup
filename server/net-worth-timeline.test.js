// Net-worth timeline: one snapshot per finished round, stored inside the match record so the
// profile history can chart how a round was won or lost. Snapshots are keyed by player id in the
// game and lined up with the participants in the stored record.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { ROUND_LIMIT } from './gameData.js';
import { netWorth } from './botTableBrain.js';
import { netWorthBreakdown } from './netWorth.js';
import { buildMatchRecordOptions, matchRecordNetWorthTimeline, summarizeMatchHistoryRecordForViewer } from './roomSetup.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { MatchStore, sanitizeMatch } from './matchStore.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-networth-'));

function startedTable(seats) {
  const manager = new RoomManager();
  const room = manager.createRoom({ rulesProfile: 'advanced', socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  for (let index = 1; index < seats; index += 1) {
    const letter = String.fromCharCode(97 + index);
    room.addOrReconnectPlayer({ socketId: `socket-${letter}`, clientId: `client-${letter}`, nickname: letter.toUpperCase() });
  }
  assert.equal(room.startGame().success, true);
  return room;
}

let passed = 0;
function check(name, run) {
  try {
    run();
    passed += 1;
  } catch (error) {
    console.error(`FAIL - ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

check('a new game starts with an empty timeline and a new game clears the old one', () => {
  const game = startedTable(2).game;
  assert.deepEqual(game.netWorthTimeline, []);
  game.advanceRound();
  assert.equal(game.netWorthTimeline.length, 1);
  game.resetForNewGame();
  assert.deepEqual(game.netWorthTimeline, []);
});

check('advancing a round records every seat at the round that just finished', () => {
  const game = startedTable(3).game;
  const [a, b, c] = game.players;
  a.cash = 1700; b.cash = 900; c.cash = 40;
  game.advanceRound();
  const [row] = game.netWorthTimeline;
  assert.equal(row.round, 1, 'labelled with the round that ended, not the one that began');
  assert.deepEqual(row.worth, { [a.id]: netWorth(game, a), [b.id]: netWorth(game, b), [c.id]: netWorth(game, c) });
  game.advanceRound();
  assert.deepEqual(game.netWorthTimeline.map(entry => entry.round), [1, 2]);
});

check('worth counts deeds and buildings through the shared netWorth helper', () => {
  const game = startedTable(2).game;
  const [a] = game.players;
  const before = netWorth(game, a);
  game.tiles[39].ownerId = a.id;
  a.properties.push(39);
  game.recordNetWorthSnapshot();
  assert.ok(game.netWorthTimeline[0].worth[a.id] > before, 'owning Marina Bay raises recorded worth');
});

check('an open default claim is worth one contract, owed by the borrower and held by the lender while collectable', () => {
  const game = startedTable(2).game;
  const [lender, borrower] = game.players;
  lender.cash = 5000;
  const offer = game.proposePlayerContract('socket-a', {
    toPlayerId: borrower.id, kind: 'loan', amount: 1000, premiumRate: 0, durationRounds: 1
  });
  assert.equal(offer.success, true);
  assert.equal(game.respondPlayerContract('socket-b', true, 'networth-default-accept').success, true);
  const contract = game.playerContractById(offer.contract.id);
  assert.equal(netWorthBreakdown(game, lender).contracts, 1000);
  assert.equal(netWorthBreakdown(game, borrower).contracts, -1000);

  for (let round = 0; round < 8 && contract.status !== 'defaulted'; round += 1) game.advanceRound();
  assert.equal(contract.status, 'defaulted');
  const claim = game.defaultClaims.find(entry => entry.contractId === contract.id);
  assert.notEqual(claim, undefined, 'the default files an open claim');
  assert.equal(claim.status, 'open');
  assert.equal(claim.remaining, 1000);

  const lenderParts = netWorthBreakdown(game, lender);
  const borrowerParts = netWorthBreakdown(game, borrower);
  assert.equal(lenderParts.contracts, 0, 'a defaulted contract leaves the contract book');
  assert.equal(borrowerParts.contracts, 0, 'a defaulted contract leaves the contract book');
  assert.equal(lenderParts.defaultClaims, 1000, 'the lender holds the open claim');
  assert.equal(borrowerParts.defaultClaims, -1000, 'the borrower still owes the open claim');

  borrower.inDebt = true;
  assert.equal(netWorthBreakdown(game, lender).defaultClaims, 0, 'an uncollectable claim is not a lender asset');
});

check('a repeated round number replaces its row instead of duplicating it', () => {
  const game = startedTable(2).game;
  game.recordNetWorthSnapshot();
  game.players[0].cash += 500;
  game.recordNetWorthSnapshot();
  assert.equal(game.netWorthTimeline.length, 1);
  assert.equal(game.netWorthTimeline[0].worth[game.players[0].id], netWorth(game, game.players[0]));
});

check('ending the game adds a final row taken after positions are settled', () => {
  const game = startedTable(2).game;
  game.advanceRound();
  game.roundNumber = 5;
  game.endGame(game.players[0]);
  const last = game.netWorthTimeline[game.netWorthTimeline.length - 1];
  assert.equal(last.round, 5);
  assert.equal(game.started, false);
});

check('the round limit still ends the table and keeps a bounded timeline', () => {
  const game = startedTable(2).game;
  game.roundNumber = ROUND_LIMIT - 1;
  for (let step = 0; step < 3 && game.started; step += 1) game.advanceRound();
  assert.equal(game.started, false);
  assert.ok(game.netWorthTimeline.length >= 2 && game.netWorthTimeline.length <= 400);
  for (let index = 0; index < 500; index += 1) { game.roundNumber = 1000 + index; game.recordNetWorthSnapshot(); }
  assert.ok(game.netWorthTimeline.length <= 400, 'the in-memory list is capped');
});

check('the stored timeline lines worth up with the players and marks departed seats null', () => {
  const game = startedTable(3).game;
  const [a, b, c] = game.players;
  game.netWorthTimeline = [
    { round: 1, worth: { [a.id]: 1500, [b.id]: 1500, [c.id]: 1500 } },
    { round: 2, worth: { [a.id]: 1700, [c.id]: 900.9 } },
  ];
  assert.deepEqual(matchRecordNetWorthTimeline(game), [
    { round: 1, worth: [1500, 1500, 1500] },
    { round: 2, worth: [1700, null, 900] },
  ]);
  assert.deepEqual(matchRecordNetWorthTimeline({ players: [], netWorthTimeline: undefined }), []);
  assert.deepEqual(matchRecordNetWorthTimeline(null), []);
});

check('long games are downsampled to at most 40 rows that still span first to last round', () => {
  const game = startedTable(2).game;
  const [a, b] = game.players;
  game.netWorthTimeline = Array.from({ length: 300 }, (_, index) => ({ round: index + 1, worth: { [a.id]: index, [b.id]: 300 - index } }));
  const stored = matchRecordNetWorthTimeline(game);
  assert.ok(stored.length <= 40, `kept ${stored.length}`);
  assert.equal(stored[0].round, 1);
  assert.equal(stored[stored.length - 1].round, 300);
  assert.deepEqual(stored.map(row => row.round), [...stored.map(row => row.round)].sort((x, y) => x - y));
});

check('the match record options carry the timeline for the detailed record', () => {
  const room = startedTable(2);
  room.game.advanceRound();
  const options = buildMatchRecordOptions(room);
  assert.equal(options.includeMatchDetails, true);
  assert.equal(options.netWorthTimeline.length, 1);
  assert.equal(options.netWorthTimeline[0].worth.length, 2);
});

check('the account store keeps the timeline on detailed records only', () => {
  const store = new AccountStore(path.join(dir, 'accounts.json'));
  const players = [{ id: 'p1', nickname: 'A', cash: 900, properties: [], bankrupt: false }, { id: 'p2', nickname: 'B', cash: 100, properties: [], bankrupt: false }];
  const timeline = [{ round: 1, worth: [1500, 1500] }, { round: 2, worth: [900, 100] }];
  const detailed = store.recordGameResults(players, 'p1', { gameId: 'detail-1', includeMatchDetails: true, netWorthTimeline: timeline });
  assert.deepEqual(detailed.netWorthTimeline, timeline);
  const plain = store.recordGameResults(players, 'p1', { gameId: 'plain-1', netWorthTimeline: timeline });
  assert.equal(Object.prototype.hasOwnProperty.call(plain, 'netWorthTimeline'), false, 'records without match details never grow the field');
});

check('the match sanitizer keeps a clean timeline, drops junk and omits the field when absent', () => {
  const clean = sanitizeMatch({
    matchId: 'm-timeline',
    netWorthTimeline: [
      { round: 3.9, worth: [1200.7, null, -5, 'x'] },
      { round: 'bad', worth: 'nope' },
      ...Array.from({ length: 60 }, (_, index) => ({ round: index, worth: [index] })),
    ],
  });
  assert.deepEqual(clean.netWorthTimeline[0], { round: 3, worth: [1200, null, 0, 0] });
  assert.deepEqual(clean.netWorthTimeline[1], { round: 0, worth: [] });
  assert.equal(clean.netWorthTimeline.length, 40);
  assert.equal(Object.prototype.hasOwnProperty.call(sanitizeMatch({ matchId: 'm-plain' }), 'netWorthTimeline'), false);
  assert.deepEqual(sanitizeMatch({ matchId: 'm-bad', netWorthTimeline: 'not a list' }).netWorthTimeline, []);
});

check('a stored timeline survives the match store round trip through disk', () => {
  const file = path.join(dir, 'matches.json');
  const matches = new MatchStore(file);
  matches.record({ matchId: 'm-disk', completedAt: '2026-10-19T10:00:00.000Z', participants: [], netWorthTimeline: [{ round: 1, worth: [1500, 1400] }, { round: 2, worth: [1600, null] }] });
  const reloaded = new MatchStore(file);
  assert.deepEqual(reloaded.matches.get('m-disk').netWorthTimeline, [{ round: 1, worth: [1500, 1400] }, { round: 2, worth: [1600, null] }]);
});

check('other viewers never receive the timeline, only the owner reads the full record', () => {
  const record = {
    matchId: 'm-private', completedAt: '2026-10-19T10:00:00.000Z', roundCount: 9, roomVisibility: 'public',
    participants: [{ accountId: 'owner', displayNameAtMatch: 'OWNER', finalPlacement: 1, propertyCount: 3, endingCash: 1500 }],
    netWorthTimeline: [{ round: 1, worth: [1500] }],
  };
  const friendView = summarizeMatchHistoryRecordForViewer(record, 'friend', 'owner');
  assert.equal(Object.prototype.hasOwnProperty.call(friendView, 'netWorthTimeline'), false);
  assert.equal(JSON.stringify(friendView).includes('worth'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(friendView.participants[0], 'endingCash'), false, 'the existing cash redaction still holds');
});

if (!process.exitCode) console.log(`net worth timeline tests: ${passed} passed, 0 failed`);
