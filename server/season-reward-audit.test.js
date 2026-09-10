import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { SeasonStore } from './seasonModule.js';

const store = new SeasonStore(path.join(os.tmpdir(), 'poorup-season-audit-' + Date.now() + '.json'));
const season = store.getCurrent();
const source = store.seasons.get(season.id);
source.rewardTrack = [{ id: 'custom-reward', track: 'participation', threshold: 1, tokens: 5 }];
source.standings['acct-custom'] = { games: 1, wins: 1, participation: 1, points: 100 };
const claim = store.claimReward('acct-custom', 'custom-reward');
assert.equal(claim.success, true);
assert.equal(claim.reward.id, 'custom-reward');

console.log('season reward audit: 1 passed, 0 failed');
