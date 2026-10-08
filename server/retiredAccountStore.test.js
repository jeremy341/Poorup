import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RetiredAccountStore } from './retiredAccountStore.js';

const root = fs.mkdtempSync(path.join(process.cwd(), '.poorup-retired-account-'));
const seasonsPath = path.join(root, 'seasons.json');
const cosmeticsPath = path.join(root, 'cosmetics.json');

const empty = new RetiredAccountStore({ seasonsPath, cosmeticsPath });
assert.deepEqual(empty.exportForAccount('acct-1'), {});
assert.equal(empty.purgeAccount('acct-1'), false);
assert.equal(fs.existsSync(seasonsPath), false, 'rights lookup must not create a seasons file');
assert.equal(fs.existsSync(cosmeticsPath), false, 'rights lookup must not create a cosmetics file');

fs.writeFileSync(cosmeticsPath, JSON.stringify({
  'acct-1': { tokens: 75, owned: ['frame-copper'], equipped: { 'avatar-frame': 'frame-copper' }, claims: ['private-claim-key'] },
  'acct-2': { tokens: 20, owned: ['frame-silver'], equipped: {} },
}));
fs.writeFileSync(seasonsPath, JSON.stringify([
  { id: 'S20260105', standings: { 'acct-1': { games: 8, wins: 3, points: 45 }, 'acct-2': { games: 2, wins: 1, points: 11 } }, claims: { 'acct-1': ['season-bronze'], 'acct-2': ['season-silver'] } },
]));

const legacy = new RetiredAccountStore({ seasonsPath, cosmeticsPath });
assert.deepEqual(legacy.exportForAccount('acct-1'), {
  cosmetics: { tokens: 75, owned: ['frame-copper'], equipped: { 'avatar-frame': 'frame-copper' } },
  seasons: [{ id: 'S20260105', standing: { games: 8, wins: 3, points: 45 }, claimedRewardIds: ['season-bronze'] }],
});
assert.equal(JSON.stringify(legacy.exportForAccount('acct-1')).includes('private-claim-key'), false);
assert.equal(legacy.purgeAccount('acct-1'), true);
assert.equal(fs.existsSync(cosmeticsPath), true, 'account deletion must retain the legacy file');
assert.equal(fs.existsSync(seasonsPath), true, 'account deletion must retain the legacy file');
assert.equal(JSON.parse(fs.readFileSync(cosmeticsPath, 'utf8'))['acct-1'], undefined);
assert.deepEqual(JSON.parse(fs.readFileSync(cosmeticsPath, 'utf8'))['acct-2'], { tokens: 20, owned: ['frame-silver'], equipped: {} });
const remainingSeason = JSON.parse(fs.readFileSync(seasonsPath, 'utf8'))[0];
assert.equal(remainingSeason.standings['acct-1'], undefined);
assert.equal(remainingSeason.claims['acct-1'], undefined);
assert.equal(remainingSeason.standings['acct-2'].points, 11);

fs.rmSync(root, { recursive: true, force: true });
console.log('retired account data rights: passed');
