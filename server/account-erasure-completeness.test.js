import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAnalyticsRollupStore } from './analyticsRollupStore.js';
import { createPseudonymizer } from './analyticsPrivacy.js';
import { SocialStore } from './socialStore.js';
import { backupJsonFile, createBackupRetentionAdapter, verifyBackup } from './backupStore.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-erasure-'));
const clock = Date.parse('2026-10-12T12:00:00.000Z');

// E24-07: a purge removes the account's analytics actor rows, and the removal
// is on disk before the purge reports success.
{
  const pseudonymizer = createPseudonymizer({ key: 'erasure-test-key-0123456789' });
  const filePath = path.join(root, 'analytics-rollup.json');
  const scope = { seasonId: 'season-01', rulesetRevision: 1, balanceRevision: 2, boardVariant: 'standard-40', rulesetPreset: 'classic', marketComplexity: 'basic' };
  const rollup = createAnalyticsRollupStore({ filePath, now: () => clock, pseudonymizer });
  const record = accountId => rollup.record({ ...scope, kind: 'match-complete', createdAt: new Date(clock).toISOString(), accountId, data: { durationSeconds: 60, botOnly: false } });
  record('acct-gone');
  record('acct-kept');
  const goneActor = pseudonymizer.pseudonymize('acct-gone', scope);
  const keptActor = pseudonymizer.pseudonymize('acct-kept', scope);
  const actorIds = () => Object.values(rollup.query({}).actorRollups).map(actor => actor.pseudonymId);
  assert.ok(actorIds().includes(goneActor), 'the account has an actor row before the purge');

  const removed = await rollup.purgeAccount('acct-gone');
  assert.equal(removed, 1);
  assert.equal(actorIds().includes(goneActor), false, 'the purged account has no actor row left');
  assert.deepEqual(actorIds(), [keptActor], 'other accounts keep their actor rows');
  assert.equal(fs.readFileSync(filePath, 'utf8').includes(goneActor), false, 'the removal is persisted');
  assert.equal(await rollup.purgeAccount('acct-gone'), 0, 'a repeated purge is a no-op');
  rollup.close();
}

// E24-08: notifications other players received about the deleted account are
// removed, and its display name is redacted from any text that remains.
{
  const social = new SocialStore(path.join(root, 'social.json'));
  social.addNotification('acct-kept', { kind: 'friend-request', title: 'FRIEND REQUEST', body: 'Gone Name sent you a friend request.', metadata: { friendshipId: 'f1', accountId: 'acct-gone' } });
  social.addNotification('acct-kept', { kind: 'room-invite', title: 'ROOM INVITE', body: 'Gone Name invited you to Lamp Room.', metadata: { inviteId: 'inv-gone', roomName: 'Lamp Room' } });
  social.addNotification('acct-kept', { kind: 'system', title: 'NOTE', body: 'gone name left the table.', metadata: {} });
  social.addNotification('acct-kept', { kind: 'room-invite', title: 'ROOM INVITE', body: 'Other Name invited you to Dock Room.', metadata: { inviteId: 'inv-other' } });
  social.invites = [{ id: 'inv-gone', senderId: 'acct-gone', recipientId: 'acct-kept', roomName: 'Lamp Room', status: 'pending', expiresAt: new Date(clock + 60_000).toISOString() }];
  assert.equal(social.purgeAccount('acct-gone', { displayName: 'Gone Name' }), true);
  const kept = social.notifications.get('acct-kept');
  assert.deepEqual(kept.map(item => item.kind), ['room-invite', 'system'], 'id-linked and invite-linked notifications are dropped');
  assert.equal(kept.length, 2, 'the friend request and the invite for the deleted account are removed');
  assert.equal(kept.some(item => JSON.stringify(item).toLowerCase().includes('gone name')), false, 'no copy of the display name remains');
  assert.equal(kept.find(item => item.kind === 'system').body, 'A deleted player left the table.', 'the name is replaced in text that stays');
  assert.equal(kept.find(item => item.metadata.inviteId === 'inv-other').body, 'Other Name invited you to Dock Room.', 'unrelated notifications are untouched');
}

// E37-08 / E24-11: erasure reaches every backup copy. Unverifiable copies are
// deleted, quarantined copies are deleted, corrupt store copies are scrubbed or
// deleted, and any copy that cannot be reached is counted as skipped.
{
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'backups');
  fs.mkdirSync(dataDir, { recursive: true });
  const accountsPath = path.join(dataDir, 'accounts.json');
  fs.writeFileSync(accountsPath, JSON.stringify([{ id: 'acct-gone', username: 'gone01', stats: { wins: 1 } }, { id: 'acct-kept', username: 'kept01' }]));
  const created = backupJsonFile(accountsPath, backupDir, { now: Date.UTC(2026, 9, 1, 1) });
  const sample = path.basename(created.path);
  const unverifiable = path.join(backupDir, 'accounts.json.2026-10-01T02-00-00-000Z.json');
  fs.writeFileSync(unverifiable, JSON.stringify([{ id: 'acct-gone', username: 'gone01' }]));
  assert.equal(verifyBackup(unverifiable).success, false, 'a copy without a sidecar is unverifiable');
  fs.mkdirSync(path.join(backupDir, 'quarantine'), { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'quarantine', 'accounts.json.2026-09-01T01-00-00-000Z.json'), JSON.stringify([{ id: 'acct-gone' }]));
  fs.writeFileSync(path.join(dataDir, 'accounts.json.corrupt-2026-09-01T01-00-00-000Z'), '[{"id":"acct-gone","username":"gone01"');
  fs.writeFileSync(path.join(dataDir, 'accounts.json.corrupt-2026-09-02T01-00-00-000Z'), '[{"id":"acct-other"');

  const adapter = createBackupRetentionAdapter(backupDir, { storeFiles: [accountsPath] });
  const outcome = await adapter.anonymizeAccount('acct-gone');
  assert.equal(outcome.skipped, 0);
  assert.equal(fs.existsSync(unverifiable), false, 'an unverifiable backup is deleted');
  assert.equal(fs.existsSync(path.join(backupDir, 'quarantine', 'accounts.json.2026-09-01T01-00-00-000Z.json')), false, 'a quarantined copy is deleted');
  assert.equal(fs.existsSync(path.join(dataDir, 'accounts.json.corrupt-2026-09-01T01-00-00-000Z')), false, 'a corrupt copy that names the account is deleted');
  assert.equal(fs.existsSync(path.join(dataDir, 'accounts.json.corrupt-2026-09-02T01-00-00-000Z')), true, 'a corrupt copy without the account is left alone');
  assert.equal(verifyBackup(path.join(backupDir, sample)).success, true, 'a verified copy stays verified after scrubbing');
  assert.equal(fs.readFileSync(path.join(backupDir, sample), 'utf8').includes('acct-gone'), false);

  // Records moved aside at load (E37-07) hold raw account data too.
  fs.writeFileSync(path.join(dataDir, 'accounts.json.rejected-2026-09-03T01-00-00-000Z-abcdef12.json'), JSON.stringify([{ id: 'acct-gone', username: 'gone01' }]));
  await adapter.anonymizeAccount('acct-gone');
  assert.equal(fs.readdirSync(dataDir).some(name => name.startsWith('accounts.json.rejected-')), false, 'a rejected-record sidecar that names the account is deleted');

  // A copy that cannot be reached (here a directory named like a copy) is
  // reported as skipped so the purge can stay pending.
  fs.mkdirSync(path.join(backupDir, 'stuck.json'));
  fs.writeFileSync(path.join(backupDir, 'stuck.json', 'x'), '');
  const stuck = await adapter.anonymizeAccount('acct-gone');
  assert.equal(stuck.skipped >= 1, true, 'an unreachable copy is counted as skipped');
}

fs.rmSync(root, { recursive: true, force: true });
console.log('account erasure completeness: 22 passed, 0 failed');
