#!/usr/bin/env node
// Operator restore for the checksummed copies written by server/backupStore.js.
// Plain Node, no dependencies. Stop the server before restoring into a live
// data directory; restoring into a staging directory is always safe.
//
//   node scripts/restore-backup.mjs --backup-dir <dir> --store <name> --list
//   node scripts/restore-backup.mjs --backup-dir <dir> --store <name> [--at <ISO timestamp|latest>] --to <target-data-dir> [--force]
//
// Exit codes: 0 success, 1 operational failure (nothing written), 2 usage error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listBackupCopies, restoreJsonBackup } from '../server/backupStore.js';
import { KNOWN_STORE_FILE_NAMES, resolveCanonicalPath, resolveDataDirectory } from '../server/serverStorePaths.js';

const USAGE = 'Usage: node scripts/restore-backup.mjs --backup-dir <dir> --store <name> (--list | [--at <ISO timestamp|latest>] --to <target-data-dir> [--force])';
const VALUE_FLAG_KEYS = { '--backup-dir': 'backupDir', '--store': 'store', '--at': 'at', '--to': 'to' };
const VALUE_FLAGS = new Set(Object.keys(VALUE_FLAG_KEYS));
const BOOLEAN_FLAGS = new Set(['--force', '--list']);

// Without POORUP_DATA_DIR the server keeps its stores in <repo>/server/data,
// That directory is the live one and has to be protected just the same.
const DEFAULT_LIVE_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data');

class UsageError extends Error {}

function readFlagValue(argv, index) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${argv[index]} needs a value.`);
  return value;
}

function assertValidAt(at) {
  if (at !== 'latest' && !Number.isFinite(Date.parse(at))) {
    throw new UsageError(`--at must be "latest" or an ISO-8601 timestamp, got "${at}".`);
  }
}

function parseArgs(argv) {
  const options = { backupDir: '', store: '', at: 'latest', to: '', force: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (BOOLEAN_FLAGS.has(arg)) {
      options[arg.slice(2)] = true;
    } else if (VALUE_FLAGS.has(arg)) {
      options[VALUE_FLAG_KEYS[arg]] = readFlagValue(argv, index);
      index += 1;
    } else {
      throw new UsageError(`Unknown argument: ${arg}`);
    }
  }
  assertValidAt(options.at);
  return options;
}

function isWithinDirectory(target, directory) {
  const relative = path.relative(directory, target);
  return relative === '' || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..');
}

function isSameDirectory(first, second) {
  return path.relative(first, second) === '';
}

// The directory the running server stores its data in. A missing
// POORUP_DATA_DIR falls back to the default live directory, so a restore into
// it still requires --force.
export function resolveLiveDataDirectory(env = process.env, { defaultLiveDir = DEFAULT_LIVE_DATA_DIR } = {}) {
  return resolveDataDirectory(env) || path.resolve(defaultLiveDir);
}

function chooseCopy(copies, at) {
  if (!copies.length) return { error: 'No backup copies exist for this store in the backup directory.' };
  const candidate = at === 'latest' ? copies[0] : copies.find(copy => copy.takenAt <= Date.parse(at));
  if (!candidate) return { error: `No backup copy was taken at or before ${new Date(Date.parse(at)).toISOString()}.` };
  if (!candidate.verified) {
    return { error: `${candidate.file} fails verification (${candidate.reason}); refusing to restore it. Run --list, then restore an older verified copy with --at <timestamp>.` };
  }
  return { copy: candidate };
}

function describeCopies(copies) {
  return copies.map(copy => (copy.verified
    ? `  verified  ${new Date(copy.takenAt).toISOString()}  ${copy.file}`
    : `  INVALID   ${new Date(copy.takenAt).toISOString()}  ${copy.file}  (${copy.reason})`));
}

function reportUsage(stderr, message) {
  stderr(message);
  stderr(USAGE);
  return 2;
}

// Returns an exit code when the store or the required flags are wrong, otherwise null.
function checkStoreOptions(options, stderr) {
  if (!options.backupDir || !options.store) return reportUsage(stderr, '--backup-dir and --store are required.');
  if (!Object.hasOwn(KNOWN_STORE_FILE_NAMES, options.store)) {
    stderr(`Unknown store "${options.store}". Allowed stores: ${Object.keys(KNOWN_STORE_FILE_NAMES).join(', ')}.`);
    return 2;
  }
  return null;
}

function printListing(store, backupDir, copies, stdout) {
  stdout(`${store} copies in ${backupDir} (newest first):`);
  describeCopies(copies).forEach(line => stdout(line));
  if (!copies.length) stdout('  (none)');
}

function resolveRestoreTarget(to, fileName, env, defaultLiveDir) {
  const targetDir = path.resolve(to);
  const configuredLiveDir = resolveLiveDataDirectory(env, { defaultLiveDir });
  const liveDir = resolveCanonicalPath(configuredLiveDir);
  const canonicalTargetDir = resolveCanonicalPath(targetDir);
  return {
    targetDir,
    destination: path.join(targetDir, fileName),
    configuredLiveDir,
    liveDir,
    canonicalTargetDir,
    targetIsLive: isWithinDirectory(canonicalTargetDir, liveDir),
  };
}

// True only for --force aimed at exactly the configured live directory.
function isForcedLiveTarget(target, force) {
  return force && isSameDirectory(target.configuredLiveDir, target.targetDir) && isSameDirectory(target.liveDir, target.canonicalTargetDir);
}

// Returns an exit code when the target is live and the write is not forced, otherwise null.
function checkLiveTarget(target, force, stderr) {
  if (!target.targetIsLive || isForcedLiveTarget(target, force)) return null;
  stderr(`Refusing to write into the live data directory ${target.liveDir}. Stop the server and restore into a staging directory, or pass --force with --to set to that exact directory.`);
  return 1;
}

function writeCopy(options, copy, target, stdout, stderr) {
  const exists = fs.existsSync(target.destination);
  if (exists && !options.force) {
    stderr(`${target.destination} already exists; pass --force to overwrite it.`);
    return 1;
  }
  const result = restoreJsonBackup(copy.path, target.destination, { allowDirs: [target.targetDir] });
  if (!result.success) {
    stderr(`Restore failed: ${result.error || result.reason || 'unknown error'}`);
    return 1;
  }
  stdout(`Restoring ${options.store} from ${copy.file} (sha256 ${result.checksum}).`);
  if (exists) stdout(`Overwrote existing ${target.destination}.`);
  stdout(`Wrote ${target.destination}.`);
  stdout(target.targetIsLive
    ? `Wrote into the live data directory ${target.liveDir} because --force was passed.`
    : 'Live data directory untouched.');
  return 0;
}

// Returns the process exit code. Output goes through the injected writers so
// the suite can drive every path with temporary directories.
export function runRestore(argv, { env = process.env, stdout = console.log, stderr = console.error, defaultLiveDir = DEFAULT_LIVE_DATA_DIR } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    return reportUsage(stderr, error.message);
  }
  const optionsExit = checkStoreOptions(options, stderr);
  if (optionsExit !== null) return optionsExit;
  const fileName = KNOWN_STORE_FILE_NAMES[options.store];
  const backupDir = path.resolve(options.backupDir);
  if (!fs.existsSync(backupDir)) {
    stderr(`Backup directory does not exist: ${backupDir}`);
    return 1;
  }
  const copies = listBackupCopies(backupDir, fileName);
  if (options.list) {
    printListing(options.store, backupDir, copies, stdout);
    return 0;
  }
  if (!options.to) return reportUsage(stderr, '--to is required unless --list is given.');
  const chosen = chooseCopy(copies, options.at);
  if (chosen.error) {
    stderr(chosen.error);
    return 1;
  }
  const target = resolveRestoreTarget(options.to, fileName, env, defaultLiveDir);
  const liveExit = checkLiveTarget(target, options.force, stderr);
  if (liveExit !== null) return liveExit;
  return writeCopy(options, chosen.copy, target, stdout, stderr);
}

const isEntryPoint = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) process.exitCode = runRestore(process.argv.slice(2));
