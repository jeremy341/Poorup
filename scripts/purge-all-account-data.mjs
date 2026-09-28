import fs from 'node:fs';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { error as logError, log as logInfo } from 'node:console';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { normalizeAdminIds } from '../server/analyticsApi.js';
import { resolveAuxiliaryStorePaths, resolveStorePaths } from '../server/serverStorePaths.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..');
export const ACCOUNT_PURGE_CONFIRMATION = 'DELETE ALL POORUP ACCOUNT DATA';

const STORE_NAMES = {
  accounts: 'accounts.json',
  social: 'social.json',
  matches: 'matches.json',
  achievements: 'achievements.json',
  seasons: 'seasons.json',
  cosmetics: 'cosmetics.json',
  telemetry: 'telemetry.json',
  analyticsRollup: 'analytics-rollup.json',
  sessions: 'sessions.json',
  recoveryTokens: 'recovery-tokens.json'
};

const PURGED_BACKUP_PREFIXES = Object.entries(STORE_NAMES)
  .filter(([store]) => store !== 'analyticsRollup')
  .map(([, name]) => `${name}.`);
const PRESERVED_STORES = new Set(['analyticsRollup']);
const PRESERVED_DATA_FILES = new Set(['ai-providers.json', 'maintenance.json', 'rooms.json']);
const ADDITIONAL_ACCOUNT_FILES = ['__dbg.json', '__gold_acct.json', '__gold_matches.json'];

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function hasGitMarker(directory, io) {
  const marker = path.join(directory, '.git');
  try {
    const stats = io.lstatSync(marker);
    if (stats.isFile() || stats.isDirectory()) return true;
    throw new Error('Git metadata marker has an unsupported type.');
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw new Error('Cannot verify whether the data path is inside a Git working tree.', { cause: error });
  }
}

function hasGitAncestor(candidate, io = fs) {
  let current = candidate;
  while (true) {
    if (hasGitMarker(current, io)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function hasAbsolutePath(value) {
  return typeof value === 'string' && value.trim().length > 0 && path.isAbsolute(value.trim());
}

function isCanonicalRealDirectory(directory, stats, io) {
  if (stats.isSymbolicLink()) return false;
  if (!stats.isDirectory()) return false;
  return io.realpathSync(directory) === directory;
}

function assertRealDirectory(directory, io, missingMessage, invalidMessage) {
  let stats;
  try { stats = io.lstatSync(directory); } catch { throw new Error(missingMessage); }
  if (!isCanonicalRealDirectory(directory, stats, io)) throw new Error(invalidMessage);
  return stats;
}

function hasPreviewGitMetadata(directory, io) {
  const marker = path.join(directory, '.git');
  try {
    const markerStats = io.lstatSync(marker);
    if (!markerStats.isFile() && !markerStats.isDirectory()) throw new Error('Local repository preview root has invalid Git metadata.');
  } catch { throw new Error('Local repository preview root must contain Git metadata.'); }
}

function validatePreviewRepository(value, io) {
  if (!hasAbsolutePath(value)) throw new Error('Local repository preview requires an absolute repository root.');
  const resolved = path.resolve(value.trim());
  assertRealDirectory(resolved, io, 'Local repository preview root must exist.', 'Local repository preview root must be a real directory, not a symlink.');
  hasPreviewGitMetadata(resolved, io);
  return resolved;
}

function resolveDirectoryPath(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  if (!path.isAbsolute(value.trim())) throw new Error(`${name} must be an absolute path.`);
  const resolved = path.resolve(value.trim());
  if (resolved === path.parse(resolved).root) throw new Error(`${name} cannot be a filesystem root.`);
  return resolved;
}

function validateDirectoryScope(resolved, name, repositoryRoot, allowedRepositoryPath) {
  const allowedPreview = Boolean(allowedRepositoryPath && resolved === allowedRepositoryPath);
  if (inside(repositoryRoot, resolved) && !allowedPreview) throw new Error(`${name} cannot be inside the repository.`);
  return allowedPreview;
}

function validatedDirectory({ value, name, repositoryRoot, io = fs, allowedRepositoryPath = '' }) {
  const resolved = resolveDirectoryPath(value, name);
  const allowedPreview = validateDirectoryScope(resolved, name, repositoryRoot, allowedRepositoryPath);
  assertRealDirectory(resolved, io, `${name} must be an existing directory.`, `${name} must be a real directory, not a symlink.`);
  const actual = io.realpathSync(resolved);
  if (actual !== resolved) throw new Error(`${name} resolves through a symlink.`);
  if (hasGitAncestor(actual, io) && !allowedPreview) throw new Error(`${name} cannot be inside a Git working tree.`);
  return resolved;
}

function storePaths(dataDir) {
  const legacy = resolveStorePaths({ POORUP_DATA_DIR: dataDir });
  const auxiliary = resolveAuxiliaryStorePaths({ POORUP_DATA_DIR: dataDir });
  return {
    accounts: legacy.accounts,
    social: legacy.social,
    matches: legacy.matches,
    achievements: legacy.achievements,
    seasons: auxiliary.seasons,
    cosmetics: auxiliary.cosmetics,
    telemetry: auxiliary.telemetry,
    analyticsRollup: auxiliary.analyticsRollup,
    sessions: path.join(dataDir, STORE_NAMES.sessions),
    recoveryTokens: path.join(dataDir, STORE_NAMES.recoveryTokens)
  };
}

function parseStore(filePath, io) {
  const bytes = io.readFileSync(filePath);
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) }; }
  catch { throw new Error(`Configured store is not valid JSON: ${path.basename(filePath)}.`); }
}

function countRecords(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function emptyStore(name, previous) {
  if (name === 'social') return { friendships: [], blocks: [], invites: [], reports: [], notifications: {} };
  if (name === 'cosmetics') return {};
  if (name === 'analyticsRollup') {
    const version = Number.isInteger(previous?.schemaVersion) && previous.schemaVersion > 0 ? previous.schemaVersion : 1;
    return { schemaVersion: version, buckets: {} };
  }
  return [];
}

function assertRegularFile(filePath, io) {
  let stats;
  try { stats = io.lstatSync(filePath); } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw new Error(`Cannot inspect configured store: ${path.basename(filePath)}.`, { cause: error });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Configured store is not a regular file: ${path.basename(filePath)}.`);
  return true;
}

function isAccountBackup(entry) {
  const name = entry.name;
  const hasStorePrefix = PURGED_BACKUP_PREFIXES.some(prefix => name.startsWith(prefix));
  const hasSupportedSuffix = name.endsWith('.json') || name.endsWith('.json.sha256');
  return hasStorePrefix && hasSupportedSuffix;
}

function backupInventory(directory, io) {
  if (!directory) return [];
  const backups = io.readdirSync(directory, { withFileTypes: true }).filter(isAccountBackup);
  return backups.map(entry => {
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`Account-store backup is not a regular file: ${entry.name}.`);
    return path.join(directory, entry.name);
  }).sort();
}

function unrecognizedDataFileCount(directory, io) {
  const known = new Set([...Object.values(STORE_NAMES), ...PRESERVED_DATA_FILES, ...ADDITIONAL_ACCOUNT_FILES]);
  const entries = io.readdirSync(directory, { withFileTypes: true });
  if (entries.some(entry => entry.isSymbolicLink())) throw new Error('Data directory contains a symlink; reset is blocked.');
  return entries.filter(entry => entry.isFile() && !known.has(entry.name)).length;
}

function additionalAccountFilePaths(directory, io) {
  return ADDITIONAL_ACCOUNT_FILES
    .map(name => path.join(directory, name))
    .filter(filePath => assertRegularFile(filePath, io));
}

function atomicReplace(filePath, bytes) {
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.purge-tmp`;
  try {
    fs.writeFileSync(tempPath, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* preserve the original failure */ }
    throw error;
  }
}

function restoreFiles(snapshots, backups) {
  for (const [filePath, bytes] of snapshots) atomicReplace(filePath, bytes);
  for (const [filePath, bytes] of backups) {
    if (!fs.existsSync(filePath)) atomicReplace(filePath, bytes);
  }
}

function optionOrDefault(options, key, fallback) {
  return options[key] === undefined ? fallback : options[key];
}

function normalizePurgeOptions(options) {
  return {
    dataDir: optionOrDefault(options, 'dataDir', process.env.POORUP_DATA_DIR),
    backupDir: optionOrDefault(options, 'backupDir', process.env.POORUP_BACKUP_DIR || ''),
    env: optionOrDefault(options, 'env', process.env),
    repositoryRoot: optionOrDefault(options, 'repositoryRoot', REPOSITORY_ROOT),
    previewRepositoryRoot: optionOrDefault(options, 'previewRepositoryRoot', ''),
    apply: optionOrDefault(options, 'apply', false),
    confirmation: optionOrDefault(options, 'confirmation', ''),
    expectedDataDir: optionOrDefault(options, 'expectedDataDir', ''),
    adminAllowlistCleared: optionOrDefault(options, 'adminAllowlistCleared', false),
    replaceFile: optionOrDefault(options, 'replaceFile', atomicReplace),
    removeFile: optionOrDefault(options, 'removeFile', filePath => fs.unlinkSync(filePath)),
    io: optionOrDefault(options, 'io', fs),
  };
}

function previewDataDirectory(options) {
  if (!options.previewRepositoryRoot) return '';
  if (options.apply) throw new Error('Local repository data is available for read-only preview only.');
  const previewRoot = validatePreviewRepository(options.previewRepositoryRoot, options.io);
  const previewDataDir = path.join(previewRoot, 'server', 'data');
  if (!options.dataDir) return previewDataDir;
  if (path.resolve(options.dataDir) !== previewDataDir) throw new Error('Local repository preview only accepts its exact server/data directory.');
  return previewDataDir;
}

function resolvePurgeDirectories(options) {
  const previewDataDir = previewDataDirectory(options);
  const dataPath = previewDataDir || options.dataDir;
  const root = validatedDirectory({ value: dataPath, name: 'POORUP_DATA_DIR', repositoryRoot: path.resolve(options.repositoryRoot), io: options.io, allowedRepositoryPath: previewDataDir });
  const backupRoot = options.backupDir
    ? validatedDirectory({ value: options.backupDir, name: 'POORUP_BACKUP_DIR', repositoryRoot: path.resolve(options.repositoryRoot), io: options.io })
    : '';
  return { root, backupRoot };
}

function requirePurgeConfirmation(options) {
  if (options.confirmation !== ACCOUNT_PURGE_CONFIRMATION) throw new Error('Exact account purge confirmation is required.');
}

function requireExpectedDataPath(options, root) {
  if (path.resolve(options.expectedDataDir || '') !== root) throw new Error('Expected data directory must exactly match POORUP_DATA_DIR.');
}

function requireAdminAllowlistRemoved(configuredAdminAllowlistEntries) {
  if (configuredAdminAllowlistEntries) throw new Error('Remove the old POORUP_ADMIN_ACCOUNT_IDS entries before applying an all-account reset.');
}

function requireAllowlistRemovalConfirmed(options) {
  if (!options.adminAllowlistCleared) throw new Error('Confirm the persistent admin allowlist was cleared before applying an all-account reset.');
}

function assertPurgeAuthorized(options, root, configuredAdminAllowlistEntries) {
  if (!options.apply) return;
  requirePurgeConfirmation(options);
  requireExpectedDataPath(options, root);
  requireAdminAllowlistRemoved(configuredAdminAllowlistEntries);
  requireAllowlistRemovalConfirmed(options);
}

function readConfiguredStores(paths, io) {
  const parsed = new Map();
  const stores = Object.entries(paths).map(([name, filePath]) => {
    const exists = assertRegularFile(filePath, io);
    if (!exists) return { name, path: filePath, exists: false, records: 0 };
    const loaded = parseStore(filePath, io);
    parsed.set(name, loaded);
    return { name, path: filePath, exists: true, records: countRecords(loaded.value) };
  });
  return { parsed, stores };
}

function createPurgePlan(options) {
  const { root, backupRoot } = resolvePurgeDirectories(options);
  const configuredAdminAllowlistEntries = normalizeAdminIds(options.env?.POORUP_ADMIN_ACCOUNT_IDS).length;
  assertPurgeAuthorized(options, root, configuredAdminAllowlistEntries);
  const paths = storePaths(root);
  const { parsed, stores } = readConfiguredStores(paths, options.io);
  const backups = backupInventory(backupRoot, options.io);
  const additionalFiles = additionalAccountFilePaths(root, options.io);
  const unrecognizedFiles = unrecognizedDataFileCount(root, options.io);
  const report = {
    mode: options.apply ? 'applied' : 'dry-run',
    stores,
    accountStoreBackups: backups.length,
    configuredAdminAllowlistEntries,
    additionalAccountFilesToDelete: additionalFiles.length,
    unrecognizedDataFileCount: unrecognizedFiles,
  };
  return { ...options, root, paths, parsed, stores, backups, additionalFiles, unrecognizedFiles, report };
}

function purgeSnapshots(plan) {
  const snapshots = plan.stores
    .filter(store => store.exists)
    .map(store => [store.path, plan.parsed.get(store.name).bytes]);
  snapshots.push(...plan.additionalFiles.map(filePath => [filePath, plan.io.readFileSync(filePath)]));
  const backupSnapshots = plan.backups.map(filePath => [filePath, plan.io.readFileSync(filePath)]);
  return { snapshots, backupSnapshots };
}

function resetStores(plan) {
  for (const store of plan.stores) {
    if (!store.exists || PRESERVED_STORES.has(store.name)) continue;
    const previous = plan.parsed.get(store.name)?.value;
    const bytes = Buffer.from(`${JSON.stringify(emptyStore(store.name, previous), null, 2)}\n`, 'utf8');
    plan.replaceFile(store.path, bytes);
  }
}

function removePurgeFiles(plan) {
  for (const filePath of plan.additionalFiles) plan.removeFile(filePath);
  for (const filePath of plan.backups) plan.removeFile(filePath);
}

function applyPurgePlan(plan) {
  if (plan.unrecognizedFiles) throw new Error('Unexpected data files must be classified before applying an all-account reset.');
  const { snapshots, backupSnapshots } = purgeSnapshots(plan);
  try {
    resetStores(plan);
    removePurgeFiles(plan);
  } catch {
    try { restoreFiles(snapshots, backupSnapshots); }
    catch { throw new Error('Account purge failed and automatic rollback was incomplete; keep the service drained and restore from the operator backup.'); }
    throw new Error('Account purge failed; all changed stores were rolled back.');
  }
}

export function purgeAccountData(input = {}) {
  const plan = createPurgePlan(normalizePurgeOptions(input));
  if (plan.apply) applyPurgePlan(plan);
  return plan.report;
}

function cliOptions(args) {
  const options = { apply: false, confirmation: '', expectedDataDir: '', adminAllowlistCleared: false, previewRepositoryRoot: '' };
  for (const arg of args) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--admin-allowlist-cleared') options.adminAllowlistCleared = true;
    else if (arg.startsWith('--preview-repository-root=')) options.previewRepositoryRoot = arg.slice('--preview-repository-root='.length);
    else if (arg.startsWith('--confirm=')) options.confirmation = arg.slice('--confirm='.length);
    else if (arg.startsWith('--expect-data-dir=')) options.expectedDataDir = arg.slice('--expect-data-dir='.length);
    else throw new Error('Unknown account-purge option.');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = purgeAccountData(cliOptions(process.argv.slice(2)));
    logInfo(JSON.stringify(result, null, 2));
  } catch (error) {
    logError(error?.message || 'Account purge could not be completed.');
    process.exitCode = 1;
  }
}
