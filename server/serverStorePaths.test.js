import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProductionStoragePaths, resolveAuxiliaryStorePaths, resolveBackupDirectory, resolveDataDirectory, resolveRetiredStorePaths, resolveStorePaths } from './serverStorePaths.js';

const root = path.resolve('tmp', 'poorup-wire-data');
const paths = resolveStorePaths({ POORUP_DATA_DIR: `  ${root}  ` });

assert.deepEqual(paths, {
  accounts: path.join(root, 'accounts.json'),
  social: path.join(root, 'social.json'),
  matches: path.join(root, 'matches.json'),
  achievements: path.join(root, 'achievements.json')
});
assert.deepEqual(resolveStorePaths({}), { accounts: undefined, social: undefined, matches: undefined, achievements: undefined });
assert.deepEqual(resolveStorePaths({ POORUP_DATA_DIR: '   ' }), { accounts: undefined, social: undefined, matches: undefined, achievements: undefined });
assert.deepEqual(resolveAuxiliaryStorePaths({ POORUP_DATA_DIR: `  ${root}  ` }), {
  seasons: path.join(root, 'seasons.json'),
  cosmetics: path.join(root, 'cosmetics.json'),
  telemetry: path.join(root, 'telemetry.json'),
  analyticsRollup: path.join(root, 'analytics-rollup.json'),
  aiProviders: path.join(root, 'ai-providers.json')
});
assert.deepEqual(resolveAuxiliaryStorePaths({}), {
  seasons: undefined,
  cosmetics: undefined,
  telemetry: undefined,
  analyticsRollup: undefined,
  aiProviders: undefined
});
assert.deepEqual(resolveRetiredStorePaths({ POORUP_DATA_DIR: `  ${root}  ` }), {
  seasons: path.join(root, 'seasons.json'),
  cosmetics: path.join(root, 'cosmetics.json'),
});
assert.deepEqual(resolveRetiredStorePaths({}), {
  seasons: path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'seasons.json'),
  cosmetics: path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'cosmetics.json'),
});

// A relative POORUP_DATA_DIR (the .env.example default) must resolve to an
// absolute path, so every store, retired store and backup target agrees on it.
const relativeRoot = path.resolve('relative-poorup-data');
assert.equal(resolveDataDirectory({ POORUP_DATA_DIR: ' ./relative-poorup-data ' }), relativeRoot);
assert.equal(resolveDataDirectory({}), '');
assert.equal(resolveBackupDirectory({ POORUP_BACKUP_DIR: '../relative-poorup-backups' }), path.resolve('../relative-poorup-backups'));
assert.equal(resolveStorePaths({ POORUP_DATA_DIR: './relative-poorup-data' }).accounts, path.join(relativeRoot, 'accounts.json'));
assert.equal(resolveAuxiliaryStorePaths({ POORUP_DATA_DIR: './relative-poorup-data' }).telemetry, path.join(relativeRoot, 'telemetry.json'));
assert.equal(resolveRetiredStorePaths({ POORUP_DATA_DIR: './relative-poorup-data' }).seasons, path.join(relativeRoot, 'seasons.json'));
assert.ok(path.isAbsolute(resolveStorePaths({ POORUP_DATA_DIR: './relative-poorup-data' }).social));

// Production must refuse to boot unless both persistent locations are absolute
// and outside the application directory. The release directory is replaced on
// deploy, so anything stored inside it is deleted by the next release.
const appRoot = path.join(os.tmpdir(), 'poorup-app-root');
const externalData = path.join(os.tmpdir(), 'poorup-external-data');
const externalBackups = path.join(os.tmpdir(), 'poorup-external-backups');
const production = { NODE_ENV: 'production', POORUP_DATA_DIR: externalData, POORUP_BACKUP_DIR: externalBackups };
assert.deepEqual(assertProductionStoragePaths(production, { appRoot }), { enforced: true, dataDir: path.resolve(externalData), backupDir: path.resolve(externalBackups) });
assert.deepEqual(assertProductionStoragePaths({ ...production, NODE_ENV: ' PRODUCTION ' }, { appRoot }).enforced, true);
assert.equal(assertProductionStoragePaths({ NODE_ENV: 'development' }, { appRoot }).enforced, false);
assert.equal(assertProductionStoragePaths({}, { appRoot }).enforced, false);
assert.throws(() => assertProductionStoragePaths({ ...production, POORUP_DATA_DIR: '' }, { appRoot }), /POORUP_DATA_DIR is required/);
assert.throws(() => assertProductionStoragePaths({ NODE_ENV: 'production', POORUP_BACKUP_DIR: externalBackups }, { appRoot }), /POORUP_DATA_DIR is required/);
assert.throws(() => assertProductionStoragePaths({ ...production, POORUP_BACKUP_DIR: undefined }, { appRoot }), /POORUP_BACKUP_DIR is required/);
assert.throws(() => assertProductionStoragePaths({ ...production, POORUP_DATA_DIR: './server/data' }, { appRoot }), /POORUP_DATA_DIR must be an absolute path/);
assert.throws(() => assertProductionStoragePaths({ ...production, POORUP_BACKUP_DIR: 'backups' }, { appRoot }), /POORUP_BACKUP_DIR must be an absolute path/);
assert.throws(() => assertProductionStoragePaths({ ...production, POORUP_DATA_DIR: appRoot }, { appRoot }), /POORUP_DATA_DIR must be outside the application directory/);
assert.throws(() => assertProductionStoragePaths({ ...production, POORUP_DATA_DIR: path.join(appRoot, 'server', 'data') }, { appRoot }), /outside the application directory/);
assert.throws(() => assertProductionStoragePaths({ ...production, POORUP_BACKUP_DIR: path.join(appRoot, 'backups') }, { appRoot }), /POORUP_BACKUP_DIR must be outside the application directory/);
// A sibling directory that merely shares the application prefix is outside.
assert.equal(assertProductionStoragePaths({ ...production, POORUP_DATA_DIR: `${appRoot}-data` }, { appRoot }).enforced, true);

// S12-M3: the backup set must not overlap the live data directory, or the
// retention job treats live store files as aged backups.
assert.throws(() => assertProductionStoragePaths({ ...production, POORUP_BACKUP_DIR: externalData }, { appRoot }), /must not overlap/);
assert.throws(() => assertProductionStoragePaths({ ...production, POORUP_BACKUP_DIR: path.join(externalData, 'backups') }, { appRoot }), /must not overlap/);
assert.throws(() => assertProductionStoragePaths({ ...production, POORUP_DATA_DIR: path.join(externalBackups, 'data') }, { appRoot }), /must not overlap/);
assert.equal(assertProductionStoragePaths({ ...production, POORUP_BACKUP_DIR: `${externalData}-backups` }, { appRoot }).enforced, true, 'a sibling that shares the prefix does not overlap');

// S1: the image's baked-in defaults must satisfy the same overlap guard as
// runtime configuration, or every container boots into the refusal below.
const dockerfile = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Dockerfile'), 'utf8');
const dockerEnv = (name) => {
  const match = dockerfile.match(new RegExp(`^ENV\\s+${name}=(\\S+)\\s*$`, 'm'));
  return match ? match[1] : '';
};
const imageDataDir = dockerEnv('POORUP_DATA_DIR');
const imageBackupDir = dockerEnv('POORUP_BACKUP_DIR');
assert.ok(imageDataDir, 'Dockerfile sets POORUP_DATA_DIR');
assert.ok(imageBackupDir, 'Dockerfile sets POORUP_BACKUP_DIR');
const nested = (parent, child) => {
  const relative = path.posix.relative(parent, child);
  return relative === '' || (!relative.startsWith('../') && !path.posix.isAbsolute(relative));
};
assert.equal(nested(imageDataDir, imageBackupDir), false, 'Docker default backup dir must not be inside the data dir');
assert.equal(nested(imageBackupDir, imageDataDir), false, 'Docker default data dir must not be inside the backup dir');
assert.deepEqual(
  assertProductionStoragePaths({ NODE_ENV: 'production', POORUP_DATA_DIR: imageDataDir, POORUP_BACKUP_DIR: imageBackupDir }, { appRoot }),
  { enforced: true, dataDir: path.resolve(imageDataDir), backupDir: path.resolve(imageBackupDir) },
  'Docker default storage paths must pass the production validator'
);

// The image used to keep stores directly in /var/lib/poorup. An operator who
// still has that layout must not silently boot onto an empty nested data dir.
const legacyScratch = mkdtempSync(path.join(os.tmpdir(), 'poorup-legacy-layout-'));
try {
  const legacyParent = path.join(legacyScratch, 'poorup');
  const legacyData = path.join(legacyParent, 'data');
  const legacyBackups = path.join(legacyScratch, 'backups');
  const legacyEnv = { NODE_ENV: 'production', POORUP_DATA_DIR: legacyData, POORUP_BACKUP_DIR: legacyBackups };
  const expected = { enforced: true, dataDir: path.resolve(legacyData), backupDir: path.resolve(legacyBackups) };

  // Fresh install: no store files anywhere, data dir not created yet.
  mkdirSync(legacyParent, { recursive: true });
  assert.deepEqual(assertProductionStoragePaths(legacyEnv, { appRoot }), expected, 'fresh install boots');
  mkdirSync(legacyData);
  assert.deepEqual(assertProductionStoragePaths(legacyEnv, { appRoot }), expected, 'fresh install with an empty data dir boots');

  // Legacy layout: stores sit in the parent, the data dir has none.
  writeFileSync(path.join(legacyParent, 'accounts.json'), '{}');
  writeFileSync(path.join(legacyParent, 'telemetry.json'), '{}');
  writeFileSync(path.join(legacyParent, 'notes.json'), '{}');
  let legacyError;
  try { assertProductionStoragePaths(legacyEnv, { appRoot }); } catch (error) { legacyError = error; }
  assert.ok(legacyError, 'legacy layout refuses to boot');
  assert.ok(legacyError.message.includes(legacyParent), 'message names the parent directory');
  assert.ok(legacyError.message.includes('accounts.json') && legacyError.message.includes('telemetry.json'), 'message lists the legacy files found');
  assert.ok(!legacyError.message.includes('notes.json'), 'message lists only known store files');
  assert.ok(legacyError.message.includes(legacyData), 'message states the target data directory');
  assert.match(legacyError.message, /move/i);
  assert.match(legacyError.message, /restart/i);
  assert.ok(legacyError.message.split('\n').length <= 5, 'message stays short');
  assert.ok(existsSync(path.join(legacyParent, 'accounts.json')), 'the check never moves operator files');
  assert.deepEqual(assertProductionStoragePaths({ ...legacyEnv, NODE_ENV: 'development' }, { appRoot }).enforced, false, 'non-production never enforces');

  // Data dir already populated: booting is fine even if the parent still has copies.
  writeFileSync(path.join(legacyData, 'social.json'), '{}');
  assert.deepEqual(assertProductionStoragePaths(legacyEnv, { appRoot }), expected, 'populated data dir boots');

  // Unrelated data dir: its parent holds no stores, so nothing is stranded.
  const unrelatedData = path.join(legacyScratch, 'elsewhere', 'state');
  mkdirSync(unrelatedData, { recursive: true });
  assert.equal(assertProductionStoragePaths({ ...legacyEnv, POORUP_DATA_DIR: unrelatedData }, { appRoot }).enforced, true, 'unrelated data dir boots');
} finally {
  rmSync(legacyScratch, { recursive: true, force: true });
}

// End to end: the real entry point refuses to start in production without a
// data directory and names the variable. It throws before binding any port.
const serverEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.js');
const refused = spawnSync(process.execPath, [serverEntry], {
  env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '', NODE_ENV: 'production', POORUP_ALLOWED_ORIGINS: 'https://poorup.example', PORT: '0' },
  encoding: 'utf8',
  timeout: 20_000,
});
assert.equal(refused.status, 1, `production boot without storage should exit 1: ${refused.stderr}`);
assert.match(refused.stderr, /POORUP_DATA_DIR is required/);

console.log('server store paths: all assertions passed');
