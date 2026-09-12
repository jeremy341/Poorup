// Match-history v2 keeps the safe visual identity and achievement facts that
// the profile/history UI needs, while preserving the older compact records.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from './accountStore.js';
import { MatchStore } from './matchStore.js';
import { annotateMatchAchievements } from './socketRuntime.js';

const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => '#f0d9ac'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-history-v2-'));
const accounts = new AccountStore(path.join(dir, 'accounts.json'));
accounts.register({ username: 'historyalice', displayName: 'History Alice', password: 'hunter2hunter2', avatarGrid: grid });
accounts.register({ username: 'historybob', displayName: 'History Bob', password: 'hunter2hunter2' });
const alice = accounts.findAccountByUsername('historyalice');
const bob = accounts.findAccountByUsername('historybob');
const players = [
  { id: 'p1', accountId: alice.id, nickname: 'History Alice', avatarGrid: grid, cash: 900, properties: [1], bankrupt: false, fullGroups: new Set(['Brown']) },
  { id: 'p2', accountId: bob.id, nickname: 'History Bob', avatarGrid: null, cash: 700, properties: [], bankrupt: false, fullGroups: new Set() }
];
const record = accounts.recordGameResults(players, 'p1', {
  gameId: 'history-v2', roomVisibility: 'public', includeMatchDetails: true, playerCount: 2,
  botDecisions: [{ sequence: 1, phase: 'pre-roll', provider: 'ai', fallback: false, actionId: 'roll', candidateIds: ['roll'], recordedAt: '2026-09-07T00:00:00.000Z' }]
});
assert.equal(record.playerCount, 2);
assert.deepEqual(record.participants[0].avatarAtMatch, grid);
assert.equal(record.participants[0].completedGroups, 1);
assert.deepEqual(record.participants[0].achievementsUnlocked, []);
assert.equal(record.participants[0].mythicalUnlocked, false);
assert.equal(record.botDecisions.length, 1);
assert.equal(record.botDecisions[0].provider, 'ai');

annotateMatchAchievements(record, [{ accountId: alice.id, achievementId: '41st-tile', rarity: 'MYTHICAL' }]);
assert.deepEqual(record.participants[0].achievementsUnlocked, ['41st-tile']);
assert.equal(record.participants[0].mythicalUnlocked, true);

const matches = new MatchStore(path.join(dir, 'matches.json'));
assert.equal(matches.record(record).created, true);
const loaded = matches.get('history-v2');
assert.equal(loaded.playerCount, 2);
assert.equal(loaded.botDecisions[0].actionId, 'roll');
assert.deepEqual(loaded.participants[0].avatarAtMatch, grid);
assert.deepEqual(loaded.participants[0].achievementsUnlocked, ['41st-tile']);
assert.equal(loaded.participants[0].mythicalUnlocked, true);

const persistedRecord = accounts.recordGameResults(players, 'p1', {
  gameId: 'history-reload',
  roomVisibility: 'public',
  includeMatchDetails: true,
  playerCount: 2
});
annotateMatchAchievements(persistedRecord, [{ accountId: alice.id, achievementId: '41st-tile', rarity: 'MYTHICAL' }]);
persistedRecord.seasonId = 'S20260912';
accounts.updateMatchRecord(persistedRecord);
const reloadedAccounts = new AccountStore(path.join(dir, 'accounts.json'));
const reloadedAlice = reloadedAccounts.findAccountByUsername('historyalice');
const reloadedMatch = reloadedAlice.matchHistory.find(entry => entry.matchId === 'history-reload');
assert.deepEqual(reloadedMatch.participants[0].achievementsUnlocked, ['41st-tile']);
assert.equal(reloadedMatch.participants[0].mythicalUnlocked, true);
assert.equal(reloadedMatch.seasonId, 'S20260912');
const gamesBeforeReplay = reloadedAlice.stats.gamesPlayed;
assert.equal(reloadedAccounts.updateMatchRecord(persistedRecord).updated, false);
assert.equal(reloadedAlice.stats.gamesPlayed, gamesBeforeReplay);
for (let index = 0; index < 510; index += 1) {
  matches.matches.set(`retention-${index}`, { matchId: `retention-${index}`, completedAt: new Date(index).toISOString(), participants: [] });
}
matches.persist();
assert.equal(matches.matches.size, 500);
console.log('match-history v2 schema and achievement annotation: 5 passed, 0 failed');
