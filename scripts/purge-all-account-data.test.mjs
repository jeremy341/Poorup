import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
const safeOptions = { dataDir, backupDir, env: {}, repositoryRoot: path.resolve('.') };

const preview = purgeAccountData(safeOptions);
assert.equal(preview.mode, 'dry-run');
assert.ok(preview.stores.length >= 10);
assert.equal(preview.configuredAdminAllowlistEntries, 0);
const previewText = JSON.stringify(preview);
assert.doesNotMatch(previewText, /private-account-id|hidden_user|secret-hash|private-match|private-token/i);
for (const [name, bytes] of original) {
  const directory = name.includes('.json.') ? backupDir : dataDir;
  assert.deepEqual(fs.readFileSync(path.join(directory, name)), bytes, `${name} changed during dry-run`);
}

assert.throws(() => purgeAccountData({ ...safeOptions, dataDir: '' }), /POORUP_DATA_DIR/);
assert.throws(() => purgeAccountData({ ...safeOptions, dataDir: path.parse(dataDir).root }), /filesystem root/);
assert.throws(() => purgeAccountData({ ...safeOptions, dataDir: safeOptions.repositoryRoot }), /inside the repository/);
const otherRepository = path.join(root, 'other-repository');
const otherRepositoryData = path.join(otherRepository, 'server', 'data');
fs.mkdirSync(path.join(otherRepository, '.git'), { recursive: true });
fs.mkdirSync(otherRepositoryData, { recursive: true });
assert.throws(() => purgeAccountData({ ...safeOptions, dataDir: otherRepositoryData }), /inside a Git working tree/);
assert.throws(() => purgeAccountData({ ...safeOptions, apply: true, confirmation: 'wrong' }), /confirmation/);
const adminPreview = purgeAccountData({ ...safeOptions, env: { POORUP_ADMIN_ACCOUNT_IDS: 'old-admin-id, second-admin-id' } });
assert.equal(adminPreview.configuredAdminAllowlistEntries, 2);
assert.doesNotMatch(JSON.stringify(adminPreview), /old-admin-id|second-admin-id/);
assert.throws(() => purgeAccountData({
  ...safeOptions,
  env: { POORUP_ADMIN_ACCOUNT_IDS: 'old-admin-id' },
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: dataDir,
  adminAllowlistCleared: true
}), /Remove the old POORUP_ADMIN_ACCOUNT_IDS/);
assert.throws(() => purgeAccountData({
  ...safeOptions,
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: dataDir
}), /persistent admin allowlist was cleared/);
assert.throws(() => purgeAccountData({
  ...safeOptions,
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: path.join(dataDir, 'other')
}), /exactly match/);

const localRepository = path.join(root, 'local-repository');
const localDefaultData = path.join(localRepository, 'server', 'data');
fs.mkdirSync(path.join(localRepository, '.git'), { recursive: true });
fs.mkdirSync(localDefaultData, { recursive: true });
fs.writeFileSync(path.join(localRepository, '.gitignore'), 'server/data/\n');
const localAccountBytes = Buffer.from(JSON.stringify([{ id: 'local-private', username: 'local_user' }]));
fs.writeFileSync(path.join(localDefaultData, 'accounts.json'), localAccountBytes);
const localDefaultPreview = purgeAccountData({
  dataDir: localDefaultData,
  repositoryRoot: localRepository,
  previewRepositoryRoot: localRepository,
  env: {},
});
assert.equal(localDefaultPreview.mode, 'dry-run');
assert.equal(localDefaultPreview.stores.find(store => store.name === 'accounts').records, 1);
assert.doesNotMatch(JSON.stringify(localDefaultPreview), /local-private|local_user/);
assert.deepEqual(fs.readFileSync(path.join(localDefaultData, 'accounts.json')), localAccountBytes);
assert.throws(() => purgeAccountData({
  dataDir: localDefaultData,
  repositoryRoot: localRepository,
  previewRepositoryRoot: localRepository,
  env: {},
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: localDefaultData,
  adminAllowlistCleared: true,
}), /read-only preview/);

const extraDataDir = path.join(root, 'data-with-unknown-file');
fs.mkdirSync(extraDataDir);
fs.writeFileSync(path.join(extraDataDir, 'accounts.json'), '[]\n');
for (const name of ['__dbg.json', '__gold_acct.json', '__gold_matches.json']) {
  fs.writeFileSync(path.join(extraDataDir, name), JSON.stringify({ privatePayload: 'must not print' }));
}
fs.writeFileSync(path.join(extraDataDir, '__unclassified.json'), JSON.stringify({ privatePayload: 'must not print' }));
const extraFilePreview = purgeAccountData({ dataDir: extraDataDir, repositoryRoot: path.resolve('.'), env: {} });
assert.equal(extraFilePreview.unrecognizedDataFileCount, 1);
assert.equal(extraFilePreview.additionalAccountFilesToDelete, 3);
assert.doesNotMatch(JSON.stringify(extraFilePreview), /privatePayload|must not print/);
assert.throws(() => purgeAccountData({
  dataDir: extraDataDir,
  repositoryRoot: path.resolve('.'),
  env: {},
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: extraDataDir,
  adminAllowlistCleared: true,
}), /Unexpected data files must be classified/);

const classifiedDataDir = path.join(root, 'data-with-classified-files');
fs.mkdirSync(classifiedDataDir);
fs.writeFileSync(path.join(classifiedDataDir, 'accounts.json'), JSON.stringify(stores['accounts.json']));
for (const name of ['__dbg.json', '__gold_acct.json', '__gold_matches.json']) {
  fs.writeFileSync(path.join(classifiedDataDir, name), JSON.stringify({ privatePayload: 'must not print' }));
}
let failAdditionalRemovalOnce = true;
assert.throws(() => purgeAccountData({
  dataDir: classifiedDataDir,
  repositoryRoot: path.resolve('.'),
  env: {},
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: classifiedDataDir,
  adminAllowlistCleared: true,
  removeFile: filePath => {
    if (failAdditionalRemovalOnce && filePath.endsWith('__gold_acct.json')) {
      failAdditionalRemovalOnce = false;
      throw new Error('injected extra-file removal failure');
    }
    fs.unlinkSync(filePath);
  }
}), /rolled back/);
assert.equal(JSON.parse(fs.readFileSync(path.join(classifiedDataDir, 'accounts.json'), 'utf8'))[0].id, 'private-account-id');
for (const name of ['__dbg.json', '__gold_acct.json', '__gold_matches.json']) {
  assert.equal(fs.existsSync(path.join(classifiedDataDir, name)), true, `${name} was not restored after partial failure`);
}
const classifiedApplied = purgeAccountData({
  dataDir: classifiedDataDir,
  repositoryRoot: path.resolve('.'),
  env: {},
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: classifiedDataDir,
  adminAllowlistCleared: true,
});
assert.equal(classifiedApplied.additionalAccountFilesToDelete, 3);
assert.equal(classifiedApplied.stores.find(store => store.name === 'accounts').records, 1);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(classifiedDataDir, 'accounts.json'), 'utf8')), []);
for (const name of ['__dbg.json', '__gold_acct.json', '__gold_matches.json']) {
  assert.equal(fs.existsSync(path.join(classifiedDataDir, name)), false, `${name} remains after purge`);
}

let failOnce = true;
assert.throws(() => purgeAccountData({
  ...safeOptions,
  apply: true,
  confirmation: 'DELETE ALL POORUP ACCOUNT DATA',
  expectedDataDir: dataDir,
  adminAllowlistCleared: true,
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
  expectedDataDir: dataDir,
  adminAllowlistCleared: true
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
