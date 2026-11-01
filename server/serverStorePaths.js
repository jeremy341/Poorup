import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLICATION_ROOT = path.resolve(__dirname, '..');

const STORE_FILES = {
  accounts: 'accounts.json',
  social: 'social.json',
  matches: 'matches.json',
  achievements: 'achievements.json'
};

const AUXILIARY_STORE_FILES = {
  seasons: 'seasons.json',
  cosmetics: 'cosmetics.json',
  telemetry: 'telemetry.json',
  analyticsRollup: 'analytics-rollup.json',
  aiProviders: 'ai-providers.json',
  botPersonas: 'bot-personas.json'
};

// Every configured data or backup location is resolved to an absolute path once, here. A relative value would otherwise resolve
// against whatever working directory PM2 starts the process in. Allow-list of store keys and file names for operator tooling
// (scripts/restore-backup.mjs). Retired stores are already in the auxiliary set.
export const KNOWN_STORE_FILE_NAMES = Object.freeze({ ...STORE_FILES, ...AUXILIARY_STORE_FILES, adminAudit: 'admin-audit.json' });

// Resolve aliases in every existing ancestor, while preserving descendants
// that have not been created yet. Lexical path checks alone miss junctions and
// symlinks when the final configured directory does not exist.
export function resolveCanonicalPath(value) {
  const absolute = path.resolve(value);
  let current = absolute;
  const missing = [];
  while (true) {
    try {
      const resolved = realpathSync.native(current);
      return path.resolve(resolved, ...missing.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      try {
        if (lstatSync(current).isSymbolicLink()) throw new Error(`Cannot resolve symbolic link or junction: ${current}`, { cause: error });
      } catch (statError) {
        if (statError?.code !== 'ENOENT' && statError?.code !== 'ENOTDIR') throw statError;
      }
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

export function resolveDataDirectory(env = process.env) {
  const raw = typeof env?.POORUP_DATA_DIR === 'string' ? env.POORUP_DATA_DIR.trim() : '';
  return raw ? path.resolve(raw) : '';
}

export function resolveBackupDirectory(env = process.env) {
  const raw = typeof env?.POORUP_BACKUP_DIR === 'string' ? env.POORUP_BACKUP_DIR.trim() : '';
  return raw ? path.resolve(raw) : '';
}

export function resolveStorePaths(env = process.env) {
  const root = resolveDataDirectory(env);
  return Object.fromEntries(Object.entries(STORE_FILES).map(([key, file]) => [key, root ? path.join(root, file) : undefined]));
}

// Expansion stores are a separate opt-in projection, so the legacy path contract stays stable for existing deployments and tests.
export function resolveAuxiliaryStorePaths(env = process.env) {
  const root = resolveDataDirectory(env);
  return Object.fromEntries(Object.entries(AUXILIARY_STORE_FILES).map(([key, file]) => [key, root ? path.join(root, file) : undefined]));
}

// Retired stores stay addressable for account export/deletion and backups.
// Resolving a path is inert: RetiredAccountStore only opens existing files
// when an explicit account-rights operation is requested.
export function resolveRetiredStorePaths(env = process.env) {
  const root = resolveDataDirectory(env);
  return {
    seasons: root ? path.join(root, 'seasons.json') : path.join(__dirname, 'data', 'seasons.json'),
    cosmetics: root ? path.join(root, 'cosmetics.json') : path.join(__dirname, 'data', 'cosmetics.json'),
  };
}

function isProductionRuntime(env) {
  return String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function isInsideDirectory(target, directory) {
  const relative = path.relative(directory, target);
  if (relative === '') return true;
  return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
}

function requireExternalDirectory(name, rawValue, appRoot) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!raw) throw new Error(`${name} is required when NODE_ENV=production; set it to an absolute path outside the application directory.`);
  if (!path.isAbsolute(raw)) throw new Error(`${name} must be an absolute path when NODE_ENV=production.`);
  const resolved = resolveCanonicalPath(raw);
  if (isInsideDirectory(resolved, resolveCanonicalPath(appRoot))) throw new Error(`${name} must be outside the application directory when NODE_ENV=production; the next release deploy would delete it.`);
  return resolved;
}

// Production refuses to boot without an explicit, absolute data and backup
// location outside the release directory. Stores that fall back to server/data
// live inside the release, and every deploy replaces that directory.
export function assertProductionStoragePaths(env = process.env, { appRoot = APPLICATION_ROOT } = {}) {
  if (!isProductionRuntime(env)) {
    return { enforced: false, dataDir: resolveDataDirectory(env), backupDir: resolveBackupDirectory(env) };
  }
  const dataDir = requireExternalDirectory('POORUP_DATA_DIR', env.POORUP_DATA_DIR, appRoot);
  const backupDir = requireExternalDirectory('POORUP_BACKUP_DIR', env.POORUP_BACKUP_DIR, appRoot);
  // The retention job ages out every .json file in the backup directory, so a
  // backup directory that is (or holds) the data directory would sweep live stores.
  if (isInsideDirectory(backupDir, dataDir) || isInsideDirectory(dataDir, backupDir)) {
    throw new Error('POORUP_DATA_DIR and POORUP_BACKUP_DIR must not overlap; backup retention would treat live store files as old backups.');
  }
  assertNoStrandedLegacyStores(dataDir);
  return { enforced: true, dataDir, backupDir };
}

function listKnownStoreFiles(directory) {
  const present = [];
  for (const file of Object.values(KNOWN_STORE_FILE_NAMES)) {
    if (existsSync(path.join(directory, file))) present.push(file);
  }
  return present;
}

// Older images kept the stores directly in the parent of today's data directory (/var/lib/poorup). Booting onto an empty data
// directory while the real stores sit one level up would silently show no accounts, so refuse. Nothing is moved: the operator relocates them.
function assertNoStrandedLegacyStores(dataDir) {
  const parentDir = path.dirname(dataDir);
  if (parentDir === dataDir) return;
  if (listKnownStoreFiles(dataDir).length > 0) return;
  const legacy = listKnownStoreFiles(parentDir);
  if (legacy.length === 0) return;
  throw new Error(
    `Found store files in ${parentDir} (${legacy.join(', ')}) but POORUP_DATA_DIR=${dataDir} has none; booting would show an empty game.\n`
    + `Stop the server, move those files into ${dataDir}, then restart. Nothing was moved or deleted.`
  );
}
