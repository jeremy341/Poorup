import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SocialStore } from './socialStore.js';
import { MatchStore } from './matchStore.js';
import { AchievementStore } from './achievementStore.js';
import { CosmeticStore } from './cosmeticCatalog.js';

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

const cosmetics = new CosmeticStore(path.join(root, 'cosmetics.json'));
cosmetics.accounts.set('acct-1', { tokens: 1, owned: [], equipped: {}, claims: [], tokenClaims: [] });
assert.equal(cosmetics.purgeAccount('acct-1'), true);
assert.equal(cosmetics.accounts.has('acct-1'), false);

fs.rmSync(root, { recursive: true, force: true });
console.log('account-linked stores: 8 passed, 0 failed');
