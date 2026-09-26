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

const BACKUP_PREFIXES = Object.values(STORE_NAMES).map(name => `${name}.`);
const PRESERVED_DATA_FILES = new Set(['ai-providers.json', 'maintenance.json', 'rooms.json']);
const ADDITIONAL_ACCOUNT_FILES = ['__dbg.json', '__gold_acct.json', '__gold_matches.json'];

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function hasGitAncestor(candidate, io = fs) {
  let current = candidate;
  while (true) {
    const marker = path.join(current, '.git');
    try {
      const stats = io.lstatSync(marker);
      if (stats.isFile() || stats.isDirectory()) return true;
      throw new Error('Git metadata marker has an unsupported type.');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('Cannot verify whether the data path is inside a Git working tree.', { cause: error });
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function validatePreviewRepository(value, io) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value.trim())) {
    throw new Error('Local repository preview requires an absolute repository root.');
  }
  const resolved = path.resolve(value.trim());
  let stats;
  try { stats = io.lstatSync(resolved); } catch { throw new Error('Local repository preview root must exist.'); }
  if (stats.isSymbolicLink() || !stats.isDirectory() || io.realpathSync(resolved) !== resolved) {
    throw new Error('Local repository preview root must be a real directory, not a symlink.');
  }
  const marker = path.join(resolved, '.git');
  try {
    const markerStats = io.lstatSync(marker);
    if (!markerStats.isFile() && !markerStats.isDirectory()) throw new Error('Local repository preview root has invalid Git metadata.');
  } catch { throw new Error('Local repository preview root must contain Git metadata.'); }
  return resolved;
}

function validatedDirectory(value, name, repositoryRoot, io = fs, { allowedRepositoryPath = '' } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  const resolved = path.resolve(value.trim());
  if (!path.isAbsolute(value.trim())) throw new Error(`${name} must be an absolute path.`);
  if (resolved === path.parse(resolved).root) throw new Error(`${name} cannot be a filesystem root.`);
  const allowedPreview = Boolean(allowedRepositoryPath && resolved === allowedRepositoryPath);
  if (inside(repositoryRoot, resolved) && !allowedPreview) throw new Error(`${name} cannot be inside the repository.`);
  let stats;
  try { stats = io.lstatSync(resolved); } catch { throw new Error(`${name} must be an existing directory.`); }
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${name} must be a real directory, not a symlink.`);
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

function backupInventory(directory, io) {
  if (!directory) return [];
  const entries = io.readdirSync(directory, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!BACKUP_PREFIXES.some(prefix => entry.name.startsWith(prefix)) || !(entry.name.endsWith('.json') || entry.name.endsWith('.json.sha256'))) continue;
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`Account-store backup is not a regular file: ${entry.name}.`);
    backups.push(path.join(directory, entry.name));
  }
  return backups.sort();
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

export function purgeAccountData({
  dataDir = process.env.POORUP_DATA_DIR,
  backupDir = process.env.POORUP_BACKUP_DIR || '',
  env = process.env,
  repositoryRoot = REPOSITORY_ROOT,
  previewRepositoryRoot = '',
  apply = false,
  confirmation = '',
  expectedDataDir = '',
  adminAllowlistCleared = false,
  replaceFile = atomicReplace,
  removeFile = filePath => fs.unlinkSync(filePath),
  io = fs
} = {}) {
  if (previewRepositoryRoot && apply) throw new Error('Local repository data is available for read-only preview only.');
  const previewRoot = previewRepositoryRoot ? validatePreviewRepository(previewRepositoryRoot, io) : '';
  const previewDataDir = previewRoot ? path.join(previewRoot, 'server', 'data') : '';
  if (previewRoot && dataDir && path.resolve(dataDir) !== previewDataDir) {
    throw new Error('Local repository preview only accepts its exact server/data directory.');
  }
  const dataPath = previewRoot ? previewDataDir : dataDir;
  const root = validatedDirectory(dataPath, 'POORUP_DATA_DIR', path.resolve(repositoryRoot), io, { allowedRepositoryPath: previewDataDir });
  const backupRoot = backupDir
    ? validatedDirectory(backupDir, 'POORUP_BACKUP_DIR', path.resolve(repositoryRoot), io)
    : '';
  const configuredAdminAllowlistEntries = normalizeAdminIds(env?.POORUP_ADMIN_ACCOUNT_IDS).length;
  if (apply) {
    if (confirmation !== ACCOUNT_PURGE_CONFIRMATION) throw new Error('Exact account purge confirmation is required.');
    if (path.resolve(expectedDataDir || '') !== root) throw new Error('Expected data directory must exactly match POORUP_DATA_DIR.');
    if (configuredAdminAllowlistEntries) throw new Error('Remove the old POORUP_ADMIN_ACCOUNT_IDS entries before applying an all-account reset.');
    if (!adminAllowlistCleared) throw new Error('Confirm the persistent admin allowlist was cleared before applying an all-account reset.');
  }

  const paths = storePaths(root);
  const parsed = new Map();
  const stores = Object.entries(paths).map(([name, filePath]) => {
    const exists = assertRegularFile(filePath, io);
    if (!exists) return { name, path: filePath, exists: false, records: 0 };
    const loaded = parseStore(filePath, io);
    parsed.set(name, loaded);
    return { name, path: filePath, exists: true, records: countRecords(loaded.value) };
  });
  const backups = backupInventory(backupRoot, io);
  const additionalFiles = additionalAccountFilePaths(root, io);
  const unrecognizedFiles = unrecognizedDataFileCount(root, io);
  const report = {
    mode: apply ? 'applied' : 'dry-run',
    stores,
    accountStoreBackups: backups.length,
    configuredAdminAllowlistEntries,
    additionalAccountFilesToDelete: additionalFiles.length,
    unrecognizedDataFileCount: unrecognizedFiles,
  };
  if (!apply) return report;
  if (unrecognizedFiles) throw new Error('Unexpected data files must be classified before applying an all-account reset.');

  const snapshots = stores
    .filter(store => store.exists)
    .map(store => [store.path, parsed.get(store.name).bytes]);
  snapshots.push(...additionalFiles.map(filePath => [filePath, io.readFileSync(filePath)]));
  const backupSnapshots = backups.map(filePath => [filePath, io.readFileSync(filePath)]);
  try {
    for (const store of stores) {
      if (!store.exists) continue;
      const previous = parsed.get(store.name)?.value;
      const bytes = Buffer.from(`${JSON.stringify(emptyStore(store.name, previous), null, 2)}\n`, 'utf8');
      replaceFile(store.path, bytes);
    }
    for (const filePath of additionalFiles) removeFile(filePath);
    for (const filePath of backups) removeFile(filePath);
  } catch {
    try { restoreFiles(snapshots, backupSnapshots); }
    catch { throw new Error('Account purge failed and automatic rollback was incomplete; keep the service drained and restore from the operator backup.'); }
    throw new Error('Account purge failed; all changed stores were rolled back.');
  }
  return report;
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
