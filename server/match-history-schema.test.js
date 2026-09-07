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
  gameId: 'history-v2', roomVisibility: 'public', includeMatchDetails: true, playerCount: 2
});
assert.equal(record.playerCount, 2);
assert.deepEqual(record.participants[0].avatarAtMatch, grid);
assert.equal(record.participants[0].completedGroups, 1);
assert.deepEqual(record.participants[0].achievementsUnlocked, []);
assert.equal(record.participants[0].mythicalUnlocked, false);

annotateMatchAchievements(record, [{ accountId: alice.id, achievementId: '41st-tile', rarity: 'MYTHICAL' }]);
assert.deepEqual(record.participants[0].achievementsUnlocked, ['41st-tile']);
assert.equal(record.participants[0].mythicalUnlocked, true);

const matches = new MatchStore(path.join(dir, 'matches.json'));
assert.equal(matches.record(record).created, true);
const loaded = matches.get('history-v2');
assert.equal(loaded.playerCount, 2);
assert.deepEqual(loaded.participants[0].avatarAtMatch, grid);
assert.deepEqual(loaded.participants[0].achievementsUnlocked, ['41st-tile']);
assert.equal(loaded.participants[0].mythicalUnlocked, true);
console.log('match-history v2 schema and achievement annotation: 4 passed, 0 failed');
