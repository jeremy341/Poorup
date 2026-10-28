import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SocialStore } from './socialStore.js';
import { MatchStore } from './matchStore.js';
import { AchievementStore } from './achievementStore.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-account-linked-'));
const social = new SocialStore(path.join(root, 'social.json'));
social.friendships = [{ id: 'f', requesterId: 'acct-1', addresseeId: 'acct-2', status: 'accepted' }];
social.blocks = [{ blockerId: 'acct-1', blockedId: 'acct-3' }];
social.invites = [{ id: 'i', senderId: 'acct-2', recipientId: 'acct-1', status: 'pending' }];
social.notifications.set('acct-1', [{ id: 'n' }]);
assert.equal(social.purgeAccount('acct-1'), true);
assert.equal(social.friendships.length, 0);
assert.equal(social.blocks.length, 0);
assert.equal(social.invites.length, 0);
assert.equal(social.notifications.has('acct-1'), false);

const matches = new MatchStore(path.join(root, 'matches.json'));
matches.matches.set('m1', {
  matchId: 'm1',
  participants: [{ accountId: 'acct-1', displayNameAtMatch: 'Owner' }, { accountId: 'acct-2', displayNameAtMatch: 'Other' }],
  casino: [{ accountId: 'acct-1', bets: 2 }],
  market: [{ accountId: 'acct-1', positions: [] }],
  playerContracts: [{ id: 'c1', fromAccountId: 'acct-1', toAccountId: 'acct-2' }],
});
assert.equal(matches.anonymizeAccount('acct-1'), 1);
assert.equal(matches.get('m1').participants[0].accountId, null);
assert.equal(matches.get('m1').participants[0].displayNameAtMatch, 'ACCOUNT DEACTIVATED');
assert.equal(matches.get('m1').casino[0].accountId, null);
assert.equal(matches.get('m1').market[0].accountId, null);
assert.equal(matches.get('m1').playerContracts[0].fromAccountId, null);
assert.equal(matches.get('m1').playerContracts[0].toAccountId, 'acct-2');
assert.equal(JSON.stringify(matches.get('m1')).includes('acct-1'), false);

const achievements = new AchievementStore(path.join(root, 'achievements.json'));
achievements.records.set('acct-1:first', { accountId: 'acct-1', achievementId: 'first' });
assert.equal(achievements.purgeAccount('acct-1'), 1);

// The match store can be rolled back, so a purge that fails in a later
// store puts the erased matches back. A match recorded while the purge runs
// survives the rollback.
{
  const rollbackRoot = path.join(root, 'rollback');
  const rollback = new MatchStore(path.join(rollbackRoot, 'matches.json'));
  rollback.record({ matchId: 'm-1', completedAt: '2026-01-01T00:00:00.000Z', participants: [{ accountId: 'acct-1', displayNameAtMatch: 'Owner' }] });
  const snapshot = rollback.snapshot();
  assert.equal(rollback.anonymizeAccount('acct-1'), 1);
  assert.equal(rollback.get('m-1').participants[0].accountId, null);
  rollback.record({ matchId: 'm-2', completedAt: '2026-01-02T00:00:00.000Z', participants: [{ accountId: 'acct-2', displayNameAtMatch: 'Other' }] });
  assert.equal(rollback.restoreSnapshot(snapshot), true);
  assert.equal(rollback.get('m-1').participants[0].accountId, 'acct-1', 'the erased match is back');
  assert.equal(rollback.get('m-1').participants[0].displayNameAtMatch, 'Owner');
  assert.ok(rollback.get('m-2'), 'a match recorded during the purge survives the rollback');
  const onDisk = JSON.parse(fs.readFileSync(path.join(rollbackRoot, 'matches.json'), 'utf8'));
  assert.equal(onDisk.some(match => match.matchId === 'm-1' && match.participants[0].accountId === 'acct-1'), true, 'and so does its file');
}

fs.rmSync(root, { recursive: true, force: true });
console.log('account-linked stores: passed');
