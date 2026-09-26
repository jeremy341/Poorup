import assert from 'node:assert/strict';
import { log } from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { purgeAccountData } from './purge-all-account-data.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-account-purge-'));
const dataDir = path.join(root, 'data');
const backupDir = path.join(root, 'backups');
fs.mkdirSync(dataDir);
fs.mkdirSync(backupDir);

const stores = {
  'accounts.json': [{ id: 'private-account-id', username: 'hidden_user', passwordHash: 'secret-hash' }],
  'social.json': { friendships: [{ requesterId: 'private-account-id' }], blocks: [], invites: [], reports: [], notifications: { 'private-account-id': [{ body: 'private' }] } },
  'matches.json': [{ matchId: 'private-match', participants: [{ accountId: 'private-account-id' }] }],
  'achievements.json': [{ accountId: 'private-account-id', achievementId: 'first' }],
  'seasons.json': [{ id: 'season', standings: [{ accountId: 'private-account-id' }] }],
  'cosmetics.json': { 'private-account-id': { owned: ['hat'] } },
  'telemetry.json': [{ accountId: 'private-account-id', payload: 'private' }],
  'analytics-rollup.json': { schemaVersion: 1, buckets: { private: { actors: ['private-account-id'] } } },
  'sessions.json': [{ accountId: 'private-account-id', tokenHash: 'secret' }],
  'recovery-tokens.json': [{ accountId: 'private-account-id', tokenHash: 'secret' }],
  'ai-providers.json': { profiles: [{ id: 'global-provider-profile' }] },
  'maintenance.json': { mode: 'normal' }
};
for (const [name, value] of Object.entries(stores)) fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value));
fs.writeFileSync(path.join(backupDir, 'accounts.json.2026-09-26.json'), JSON.stringify(stores['accounts.json']));
fs.writeFileSync(path.join(backupDir, 'accounts.json.2026-09-26.json.sha256'), 'checksum');
fs.writeFileSync(path.join(backupDir, 'ai-providers.json.2026-09-26.json'), JSON.stringify(stores['ai-providers.json']));

const original = new Map([...Object.keys(stores), 'accounts.json.2026-09-26.json', 'accounts.json.2026-09-26.json.sha256', 'ai-providers.json.2026-09-26.json']
  .map(name => [name, fs.readFileSync(path.join(name.endsWith('.sha256') || name.includes('.json.') ? backupDir : dataDir, name))]));
const safeOptions = { dataDir, backupDir, repositoryRoot: path.resolve('.') };

const preview = purgeAccountData(safeOptions);
assert.equal(preview.mode, 'dry-run');
assert.ok(preview.stores.length >= 10);
const previewText = JSON.stringify(preview);
assert.doesNotMatch(previewText, /private-account-id|hidden_user|secret-hash|private-match|private-token/i);
for (const [name, bytes] of original) {
  const directory = name.includes('.json.') ? backupDir : dataDir;
  assert.deepEqual(fs.readFileSync(path.join(directory, name)), bytes, `${name} changed during dry-run`);
}

assert.throws(() => purgeAccountData({ ...safeOptions, dataDir: '' }), /POORUP_DATA_DIR/);
assert.throws(() => purgeAccountData({ ...safeOptions, dataDir: path.parse(dataDir).root }), /filesystem root/);
assert.throws(() => purgeAccountData({ ...safeOptions, dataDir: safeOptions.repositoryRoot }), /inside the repository/);
assert.throws(() => purgeAccountData({ ...safeOptions, apply: true, confirmation: 'wrong' }), /confirmation/);
assert.throws(() => purgeAccountData({
  ...safeOptions,
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: path.join(dataDir, 'other')
}), /exactly match/);

let failOnce = true;
assert.throws(() => purgeAccountData({
  ...safeOptions,
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: dataDir,
  replaceFile: (target, contents) => {
    if (failOnce && target.endsWith('social.json')) {
      failOnce = false;
      throw new Error('injected write failure');
    }
    const temporary = `${target}.test-tmp`;
    fs.writeFileSync(temporary, contents);
    fs.renameSync(temporary, target);
  }
}), /rolled back/);
for (const name of Object.keys(stores)) {
  assert.deepEqual(fs.readFileSync(path.join(dataDir, name)), original.get(name), `${name} was not restored after partial failure`);
}

const applied = purgeAccountData({
  ...safeOptions,
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: dataDir
});
assert.equal(applied.mode, 'applied');
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'accounts.json'), 'utf8')), []);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'social.json'), 'utf8')), {
  friendships: [], blocks: [], invites: [], reports: [], notifications: {}
});
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'analytics-rollup.json'), 'utf8')), { schemaVersion: 1, buckets: {} });
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'ai-providers.json'), 'utf8')), stores['ai-providers.json']);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'maintenance.json'), 'utf8')), stores['maintenance.json']);
assert.equal(fs.existsSync(path.join(backupDir, 'accounts.json.2026-09-26.json')), false);
assert.equal(fs.existsSync(path.join(backupDir, 'accounts.json.2026-09-26.json.sha256')), false);
assert.equal(fs.existsSync(path.join(backupDir, 'ai-providers.json.2026-09-26.json')), true);

fs.rmSync(root, { recursive: true, force: true });
log('all-account purge dry-run/apply fixture tests: passed');
