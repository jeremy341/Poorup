import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SeasonStore, eligibleSeasonMatch, seasonIdFor } from './seasonModule.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-season-'));
const store = new SeasonStore(path.join(dir, 'seasons.json'), Date.UTC(2026, 0, 6));
assert.match(seasonIdFor(Date.UTC(2026, 0, 6)), /^S20260105$/);
assert.equal(store.getCurrent(Date.UTC(2026, 0, 6)).status, 'active');
const record = {
  matchId: 'm1',
  completedAt: new Date().toISOString(),
  participants: [
    { accountId: 'a', finalPlacement: 1, globalEventsSurvived: 2, bankLoanStatus: 'paid', fairTrades: 2 },
    { accountId: 'b', finalPlacement: 2, globalEventsSurvived: 0, bankLoanStatus: null, fairTrades: 0 },
    { accountId: 'c', finalPlacement: 3 }, { accountId: 'd', finalPlacement: 4 },
    { accountId: 'e', finalPlacement: 5 }, { accountId: 'f', finalPlacement: 6 },
    { accountId: 'g', finalPlacement: 7 }, { accountId: 'h', finalPlacement: 8 },
    { accountId: 'i', finalPlacement: 9 }, { accountId: 'j', finalPlacement: 10 }
  ]
};
assert.equal(eligibleSeasonMatch(record), true);
assert.equal(store.recordMatch(record).recorded, true);
assert.equal(store.recordMatch(record).recorded, false);
const standings = store.standings({ metric: 'points' });
assert.equal(standings.rows[0].accountId, 'a');
assert.equal(standings.rows[0].wins, 1);
assert.equal(standings.rows[0].games, 1);
const masteryBeforeSecondMatch = standings.rows.find(row => row.accountId === 'a').mastery;
assert.equal(store.recordMatch({ ...record, matchId: 'm2' }).recorded, true);
const masteryAfterSecondMatch = store.standings({ metric: 'points' }).rows.find(row => row.accountId === 'a').mastery;
assert.equal(masteryAfterSecondMatch - masteryBeforeSecondMatch, 20);
const currentSeason = store.seasons.get(store.getCurrent().id);
currentSeason.matches = Array.from({ length: 1000 }, (_, index) => `old-${index}`);
assert.equal(store.recordMatch(record).recorded, false);
assert.equal(store.claimReward('a', 'season-bronze').success, true);
assert.equal(store.claimReward('a', 'season-bronze').created, false);
assert.deepEqual(store.claimedRewards('a'), ['season-bronze']);
assert.equal(store.claimReward('b', 'season-master').success, false);
assert.equal(eligibleSeasonMatch({ matchId: 'bot', participants: [{ accountId: 'a' }, { accountId: 'b' }], botOnly: true }), false);
assert.equal(eligibleSeasonMatch({ matchId: 'afk', participants: [{ accountId: 'a' }, { accountId: 'b' }], afkOnly: true }), false);
const replayStore = new SeasonStore(path.join(dir, 'season-replay.json'), Date.UTC(2026, 0, 6));
const replayParticipants = Array.from({ length: 10 }, (_, index) => ({ accountId: `r-${index}`, finalPlacement: index + 1 }));
for (let index = 0; index <= 5000; index += 1) {
  assert.equal(replayStore.recordMatch({ matchId: `replay-${index}`, completedAt: new Date().toISOString(), participants: replayParticipants }).recorded, true);
}
assert.equal(replayStore.recordMatch({ matchId: 'replay-0', completedAt: new Date().toISOString(), participants: replayParticipants }).recorded, false);
fs.rmSync(dir, { recursive: true, force: true });
console.log('season module: 13 passed, 0 failed');
