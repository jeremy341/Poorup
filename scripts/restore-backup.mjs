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
import { KNOWN_STORE_FILE_NAMES, resolveDataDirectory } from '../server/serverStorePaths.js';

const USAGE = 'Usage: node scripts/restore-backup.mjs --backup-dir <dir> --store <name> (--list | [--at <ISO timestamp|latest>] --to <target-data-dir> [--force])';
const VALUE_FLAGS = new Set(['--backup-dir', '--store', '--at', '--to']);
const BOOLEAN_FLAGS = new Set(['--force', '--list']);

// Without POORUP_DATA_DIR the server keeps its stores in <repo>/server/data,
// so that directory is the live one and has to be protected just the same.
const DEFAULT_LIVE_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data');

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { backupDir: '', store: '', at: 'latest', to: '', force: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (BOOLEAN_FLAGS.has(arg)) {
      options[arg.slice(2)] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(arg)) throw new UsageError(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value.`);
    index += 1;
    if (arg === '--backup-dir') options.backupDir = value;
    if (arg === '--store') options.store = value;
    if (arg === '--at') options.at = value;
    if (arg === '--to') options.to = value;
  }
  if (options.at !== 'latest' && !Number.isFinite(Date.parse(options.at))) {
    throw new UsageError(`--at must be "latest" or an ISO-8601 timestamp, got "${options.at}".`);
  }
  return options;
}

function isWithinDirectory(target, directory) {
  const relative = path.relative(directory, target);
  return relative === '' || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..');
}

// The directory the running server stores its data in. A missing
// POORUP_DATA_DIR used to leave the guard blind, so a restore into the
// default live directory was allowed without --force (X6).
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

// Returns the process exit code. Output goes through the injected writers so
// the suite can drive every path with temporary directories.
export function runRestore(argv, { env = process.env, stdout = console.log, stderr = console.error, defaultLiveDir = DEFAULT_LIVE_DATA_DIR } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr(error.message);
    stderr(USAGE);
    return 2;
  }
  if (!options.backupDir || !options.store) {
    stderr('--backup-dir and --store are required.');
    stderr(USAGE);
    return 2;
  }
  if (!Object.hasOwn(KNOWN_STORE_FILE_NAMES, options.store)) {
    stderr(`Unknown store "${options.store}". Allowed stores: ${Object.keys(KNOWN_STORE_FILE_NAMES).join(', ')}.`);
    return 2;
  }
  const fileName = KNOWN_STORE_FILE_NAMES[options.store];
  const backupDir = path.resolve(options.backupDir);
  if (!fs.existsSync(backupDir)) {
    stderr(`Backup directory does not exist: ${backupDir}`);
    return 1;
  }
  const copies = listBackupCopies(backupDir, fileName);
  if (options.list) {
    stdout(`${options.store} copies in ${backupDir} (newest first):`);
    describeCopies(copies).forEach(line => stdout(line));
    if (!copies.length) stdout('  (none)');
    return 0;
  }
  if (!options.to) {
    stderr('--to is required unless --list is given.');
    stderr(USAGE);
    return 2;
  }
  const chosen = chooseCopy(copies, options.at);
  if (chosen.error) {
    stderr(chosen.error);
    return 1;
  }

  const targetDir = path.resolve(options.to);
  const destination = path.join(targetDir, fileName);
  const liveDir = resolveLiveDataDirectory(env, { defaultLiveDir });
  const targetIsLive = isWithinDirectory(targetDir, liveDir);
  if (targetIsLive && !(targetDir === liveDir && options.force)) {
    stderr(`Refusing to write into the live data directory ${liveDir}. Stop the server and restore into a staging directory, or pass --force with --to set to that exact directory.`);
    return 1;
  }
  const exists = fs.existsSync(destination);
  if (exists && !options.force) {
    stderr(`${destination} already exists; pass --force to overwrite it.`);
    return 1;
  }

  const result = restoreJsonBackup(chosen.copy.path, destination, { allowDirs: [targetDir] });
  if (!result.success) {
    stderr(`Restore failed: ${result.error || result.reason || 'unknown error'}`);
    return 1;
  }
  stdout(`Restoring ${options.store} from ${chosen.copy.file} (sha256 ${result.checksum}).`);
  if (exists) stdout(`Overwrote existing ${destination}.`);
  stdout(`Wrote ${destination}.`);
  stdout(targetIsLive
    ? `Wrote into the live data directory ${liveDir} because --force was passed.`
    : 'Live data directory untouched.');
  return 0;
}

const isEntryPoint = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) process.exitCode = runRestore(process.argv.slice(2));
