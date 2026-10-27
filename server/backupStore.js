// Checksummed JSON backup helpers. Backups are opt-in through
// POORUP_BACKUP_DIR and never overwrite the live authoritative files.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isQuarantinedStore, STORE_DIRECTORY_MODE, STORE_FILE_MODE } from './storeIO.js';

// Tiered retention, per store: the newest DEFAULT_RETENTION verified copies
// always survive. Beyond them, the newest copy of each UTC hour survives for
// HOURLY_WINDOW_MS and the newest copy of each UTC day for DAILY_WINDOW_MS.
const DEFAULT_RETENTION = 7;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURLY_WINDOW_MS = 48 * HOUR_MS;
const DAILY_WINDOW_MS = 30 * DAY_MS;
// A candidate smaller than this share of the largest copy taken inside the
// hourly window looks like a truncated live file. Rotation pauses so the good
// copies are not pushed out; the candidate is still written for inspection.
const SHRINK_GUARD_RATIO = 0.5;
const shrinkWarned = new Set();

function safePath(value) {
  return typeof value === 'string' ? path.resolve(value) : '';
}

function checksumBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function checksumFile(filePath) {
  const absolute = safePath(filePath);
  if (!absolute || !fs.existsSync(absolute)) return null;
  return checksumBytes(fs.readFileSync(absolute));
}

function atomicWrite(filePath, bytes) {
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(temp, 'w', STORE_FILE_MODE);
    fs.writeFileSync(fd, bytes);
    fs.fchmodSync(fd, STORE_FILE_MODE);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, filePath);
  } catch (error) {
    // A leftover temp file holds the whole store, and nothing ever rotates or
    // erases it: it must not survive a failed write.
    try { if (fd !== null) fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.unlinkSync(temp); } catch { /* best effort */ }
    throw error;
  }
}

function backupName(filePath, stamp) {
  return `${path.basename(filePath)}.${stamp}.json`;
}

// The copy time comes from the name the copy was written under, not its
// mtime: anonymizing a backup rewrites the file and would move its mtime.
const STAMP_PATTERN = /\.(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/;

function copyTimestamp(file, directory) {
  const match = file.match(STAMP_PATTERN);
  const parsed = match ? Date.parse(`${match[1]}:${match[2]}:${match[3]}.${match[4]}Z`) : NaN;
  return Number.isFinite(parsed) ? parsed : fs.statSync(path.join(directory, file)).mtimeMs;
}

// Copies are immutable once written, so a copy whose size and mtime are
// unchanged keeps its earlier verification. Without this, every backup run
// would re-hash up to a full retention set on the synchronous request path.
const verificationCache = new Map();

function cachedVerification(file) {
  const stat = fs.statSync(file);
  const cached = verificationCache.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.result;
  const result = verifyBackup(file);
  verificationCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, result });
  return result;
}

// Verified copies of one store, newest first. Rotation must never treat a
// tampered or partial candidate as a valid backup, so invalid artifacts are
// left out of retention and kept for operator inspection.
function verifiedCopies(directory, prefix) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter(file => file.startsWith(prefix) && file.endsWith('.json'))
    // A directory in the way of a copy is not a copy: reading it would throw
    // and take the whole rotation down with it.
    .filter(file => fs.statSync(path.join(directory, file)).isFile())
    .filter(file => cachedVerification(path.join(directory, file)).success)
    .map(file => ({ file, takenAt: copyTimestamp(file, directory), size: fs.statSync(path.join(directory, file)).size }))
    .sort((a, b) => b.takenAt - a.takenAt);
}

// Every copy of one store, newest first, including rejected ones so an
// operator can see why. Used by scripts/restore-backup.mjs.
export function listBackupCopies(directory, storeFileName) {
  const dir = safePath(directory);
  if (!dir || !fs.existsSync(dir)) return [];
  const prefix = `${path.basename(String(storeFileName))}.`;
  return fs.readdirSync(dir)
    .filter(file => file.startsWith(prefix) && file.endsWith('.json'))
    .map(file => {
      const verified = verifyBackup(path.join(dir, file));
      return { file, path: path.join(dir, file), takenAt: copyTimestamp(file, dir), verified: verified.success, reason: verified.reason || null, checksum: verified.checksum || null };
    })
    .sort((a, b) => b.takenAt - a.takenAt);
}

function retainedCopies(copies, retention, now) {
  const keep = new Set(copies.slice(0, Math.max(1, retention)).map(copy => copy.file));
  const hours = new Set();
  const days = new Set();
  for (const copy of copies) {
    const age = now - copy.takenAt;
    const hour = Math.floor(copy.takenAt / HOUR_MS);
    const day = Math.floor(copy.takenAt / DAY_MS);
    if (age <= HOURLY_WINDOW_MS && !hours.has(hour)) {
      hours.add(hour);
      keep.add(copy.file);
    }
    if (age <= DAILY_WINDOW_MS && !days.has(day)) {
      days.add(day);
      keep.add(copy.file);
    }
  }
  return keep;
}

function rotate(directory, prefix, retention, now) {
  const copies = verifiedCopies(directory, prefix);
  const keep = retainedCopies(copies, retention, now);
  copies.filter(copy => !keep.has(copy.file)).forEach(copy => {
    fs.unlinkSync(path.join(directory, copy.file));
    verificationCache.delete(path.join(directory, copy.file));
    const sidecar = path.join(directory, copy.file + '.sha256');
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  });
}

// The largest copy taken inside the hourly window. A candidate far below it
// is a suspected truncation, so the guard compares against this size.
function largestRecentCopy(copies, now) {
  return copies
    .filter(copy => now - copy.takenAt <= HOURLY_WINDOW_MS)
    .reduce((best, copy) => (!best || copy.size > best.size ? copy : best), null);
}

export function backupJsonFile(sourcePath, backupDirectory, { retention = DEFAULT_RETENTION, now = Date.now() } = {}) {
  const source = safePath(sourcePath);
  const directory = safePath(backupDirectory);
  if (!source || !directory) return { success: false, error: 'Backup paths are required.' };
  if (!fs.existsSync(source)) return { success: false, error: 'Source store does not exist.' };
  if (isQuarantinedStore(source)) {
    // The live file is an empty stand-in for corrupt bytes. Copying it would
    // rotate the last good copies out within the retention window.
    console.error(`Backup skipped for ${path.basename(source)}: the store was quarantined as corrupt at load and will not be copied until the server restarts.`);
    return { success: false, skipped: true, reason: 'quarantined-at-load', path: null, checksum: null, createdAt: null };
  }
  fs.mkdirSync(directory, { recursive: true, mode: STORE_DIRECTORY_MODE });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const name = backupName(source, stamp);
  const destination = path.join(directory, name);
  const prefix = path.basename(source) + '.';
  const bytes = fs.readFileSync(source);
  const checksum = checksumBytes(bytes);
  const reference = largestRecentCopy(verifiedCopies(directory, prefix), now);
  const rotationSkipped = Boolean(reference) && bytes.length < reference.size * SHRINK_GUARD_RATIO;
  atomicWrite(destination, bytes);
  atomicWrite(`${destination}.sha256`, `${checksum}  ${name}\n`, 'utf8');
  if (rotationSkipped) {
    if (!shrinkWarned.has(source)) {
      shrinkWarned.add(source);
      console.warn(`Backup rotation paused for ${path.basename(source)}: the live copy is ${bytes.length} bytes, under half of a ${reference.size}-byte copy from the last 48 hours. Older verified copies are kept until that copy leaves the window; check the store.`);
    }
  } else {
    shrinkWarned.delete(source);
    rotate(directory, prefix, retention, now);
  }
  return { success: true, path: destination, checksum, createdAt: new Date(now).toISOString(), rotationSkipped };
}

export function backupJsonStores(storePaths = {}, backupDirectory, options = {}) {
  // One store that cannot be copied must not cost the stores after it their
  // backup for the cycle.
  const results = Object.entries(storePaths)
    .filter(([, filePath]) => typeof filePath === 'string')
    .map(([key, filePath]) => {
      try {
        return { key, ...backupJsonFile(filePath, backupDirectory, options) };
      } catch (error) {
        return { key, success: false, error: error?.code || error?.message || 'Backup failed.' };
      }
    });
  if (!results.length) return { success: false, error: 'No source stores are configured for backup.', results };
  return { success: results.every(result => result.success), results };
}

// The store a copy belongs to (its file name without the time stamp).
function storeGroup(file) {
  return STAMP_PATTERN.test(file) ? file.replace(STAMP_PATTERN, '') : '';
}

export function pruneBackupsByAge(backupDirectory, { olderThan = Date.now() - 30 * 86400000, quarantine = true } = {}) {
  const directory = safePath(backupDirectory);
  if (!directory || !fs.existsSync(directory)) return 0;
  let removed = 0;
  const files = fs.readdirSync(directory).filter(file => file.endsWith('.json') && fs.statSync(path.join(directory, file)).isFile());
  // The newest verified copy of each store is never aged out: if backups stop
  // being produced, the last good copy is exactly what a restore needs.
  const newest = new Map();
  files.forEach((file) => {
    if (!cachedVerification(path.join(directory, file)).success) return;
    const group = storeGroup(file);
    const takenAt = copyTimestamp(file, directory);
    if (!newest.has(group) || takenAt > newest.get(group).takenAt) newest.set(group, { file, takenAt });
  });
  const protectedFiles = new Set([...newest.values()].map(entry => entry.file));
  // Age comes from the time stamp in the name: a copy rewritten by an erasure
  // gets a new mtime but is not any younger.
  files.filter(file => !protectedFiles.has(file) && copyTimestamp(file, directory) < Number(olderThan)).forEach((file) => {
    const target = path.join(directory, file);
    const verified = verifyBackup(target);
    if (!verified.success) {
      // Quarantine instead of keeping forever: tampered/partial files leave
      // the live set but stay inspectable under quarantine/.
      if (quarantine) {
        const pen = path.join(directory, 'quarantine');
        fs.mkdirSync(pen, { recursive: true });
        fs.renameSync(target, path.join(pen, file));
        const sidecar = `${target}.sha256`;
        if (fs.existsSync(sidecar)) fs.renameSync(sidecar, path.join(pen, `${file}.sha256`));
        console.log(`Quarantined invalid backup: ${file}`);
      }
      return;
    }
    fs.unlinkSync(target);
    verificationCache.delete(target);
    const sidecar = `${target}.sha256`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    removed += 1;
  });
  return removed;
}

// The credential fields of an account record. A hash of a password, of a
// session token or of a recovery token is as good as the secret itself, so it
// never survives an erasure. The names are the ones the stores actually
// write: 'sessionToken' alone was never persisted ('sessionTokenHash' is).
const CREDENTIAL_KEYS = new Set([
  'passwordHash',
  'passwordSalt',
  'sessionToken',
  'sessionTokenHash',
  'pendingRecoveryEmailTokenHash',
  'tokenHash'
]);

function scrubAccount(value, accountId) {
  // Only an element that scrubbed to null (the erased record) is dropped;
  // genuine nulls keep their position.
  if (Array.isArray(value)) return value.map(item => scrubAccount(item, accountId)).filter((item, index) => !(item === null && value[index] !== null));
  if (!value || typeof value !== 'object') return value;
  if (value.id === accountId && typeof value.username === 'string') return null;
  // A record that belongs to the erased account keeps neither its id, nor its
  // name, nor its credentials. It is rebuilt field by field, so the same
  // credential rules apply to it as to any other record.
  const owned = value.accountId === accountId;
  const output = {};
  Object.entries(value).forEach(([key, child]) => {
    if (CREDENTIAL_KEYS.has(key)) return;
    if (key === accountId) return;
    if (owned && key === 'accountId') { output.accountId = null; return; }
    if (owned && key === 'username') { output.username = null; return; }
    if (owned && (key === 'displayName' || key === 'displayNameAtMatch')) { output[key] = child ? 'ACCOUNT DEACTIVATED' : child; return; }
    if (owned && (key === 'recoveryEmail' || key === 'pendingRecoveryEmail')) { output[key] = null; return; }
    if (typeof child === 'string' && child === accountId && /account.?id|owner.?id|holder.?id|player.?id/i.test(key)) {
      output[key] = null;
      return;
    }
    output[key] = scrubAccount(child, accountId);
  });
  return output;
}

function removeCopy(target) {
  fs.unlinkSync(target);
  verificationCache.delete(target);
  const sidecar = `${target}.sha256`;
  if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
}

// A verified copy is rewritten with the account removed and re-signed. If the
// account id survives the rewrite, the copy is deleted instead: erasure must
// not depend on the scrub having found every reference.
function scrubVerifiedCopy(target, id, counts) {
  const bytes = fs.readFileSync(target);
  if (!bytes.includes(id)) return;
  const scrubbed = scrubAccount(JSON.parse(bytes.toString('utf8')), id);
  const nextBytes = Buffer.from(JSON.stringify(scrubbed, null, 2) + '\n', 'utf8');
  if (nextBytes.includes(id)) {
    removeCopy(target);
    counts.deleted += 1;
    return;
  }
  if (nextBytes.equals(bytes)) return;
  const checksum = checksumBytes(nextBytes);
  atomicWrite(target, nextBytes);
  atomicWrite(`${target}.sha256`, `${checksum}  ${path.basename(target)}\n`, 'utf8');
  counts.scrubbed += 1;
}

// Copies that cannot be verified (rotation quarantine, store .corrupt-* files,
// tampered or sidecar-less backups) are not trusted for restore, so erasure
// deletes any that still name the account rather than rewriting them.
function removeUnverifiedCopy(target, id, counts) {
  if (!fs.readFileSync(target, 'utf8').includes(id)) return;
  removeCopy(target);
  counts.deleted += 1;
}

// The sidecars a store leaves next to itself: the bytes of a file that could
// not be parsed, the records moved aside at load, and the leftovers of a
// failed atomic write. They hold a whole store, so they are erased with it.
const STORE_SIDECAR_PATTERN = /^.+\.json\.(?:corrupt|rejected)-/;
const STORE_TEMP_PATTERN = /^.+\.json\..+\.tmp$/;

function storeSidecars(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(file => STORE_SIDECAR_PATTERN.test(file) || STORE_TEMP_PATTERN.test(file));
}

// Every sidecar in the directories of the given stores, not only the ones of
// the stores themselves: a store that is not part of the erasure list still
// left copies of its bytes behind, and those copies still name the account.
function storeCopies(storeFiles) {
  const directories = [...new Set(storeFiles.map(safePath).filter(Boolean).map(store => path.dirname(store)))];
  return directories.flatMap(directory => storeSidecars(directory).map(file => path.join(directory, file)));
}

// Erases one account from every backup copy this module can reach: the
// backup set, its quarantine/ folder, and the .corrupt-* copies written next
// to the given live store files. Copies that cannot be reached are counted in
// `skipped`, so the caller can keep the purge pending (E37-08, E24-11).
export function eraseAccountFromBackups(backupDirectory, accountId, { storeFiles = [] } = {}) {
  const counts = { scrubbed: 0, deleted: 0, skipped: 0 };
  const directory = safePath(backupDirectory);
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  if (!id) return counts;
  const copies = [];
  if (directory && fs.existsSync(directory)) {
    const pen = path.join(directory, 'quarantine');
    // A leftover temp file holds a whole copy and is never rotated or
    // verified, so it is erased like any other copy.
    const isCopy = file => file.endsWith('.json') || file.endsWith('.tmp');
    copies.push(...fs.readdirSync(directory).filter(isCopy).map(file => ({ target: path.join(directory, file), topLevel: true })));
    if (fs.existsSync(pen)) copies.push(...fs.readdirSync(pen).filter(isCopy).map(file => ({ target: path.join(pen, file), topLevel: false })));
  }
  copies.push(...storeCopies(Array.isArray(storeFiles) ? storeFiles : []).map(target => ({ target, topLevel: false })));
  for (const { target, topLevel } of copies) {
    try {
      if (topLevel && verifyBackup(target).success) scrubVerifiedCopy(target, id, counts);
      else removeUnverifiedCopy(target, id, counts);
    } catch {
      counts.skipped += 1;
    }
  }
  return counts;
}

export function anonymizeAccountInBackups(backupDirectory, accountId) {
  return eraseAccountFromBackups(backupDirectory, accountId).scrubbed;
}

export function createBackupRetentionAdapter(backupDirectory, { storeFiles = [] } = {}) {
  return {
    pruneByAge: options => pruneBackupsByAge(backupDirectory, options),
    anonymizeAccount: accountId => eraseAccountFromBackups(backupDirectory, accountId, { storeFiles })
  };
}

export function verifyBackup(backupPath) {
  const file = safePath(backupPath);
  if (!file || !fs.existsSync(file)) return { success: false, valid: false, reason: 'Backup does not exist.', error: 'Backup does not exist.' };
  const bytes = fs.readFileSync(file);
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { return { success: false, valid: false, reason: 'Backup is not valid JSON.', error: 'Backup is not valid JSON.' }; }
  const digest = checksumBytes(bytes);
  const sidecarPath = `${file}.sha256`;
  if (!fs.existsSync(sidecarPath)) return { success: false, valid: false, reason: 'Backup checksum sidecar is missing.', digest, checksum: digest, error: 'Backup checksum sidecar is missing.' };
  const sidecar = fs.readFileSync(sidecarPath, 'utf8').trim();
  const match = sidecar.match(/^([a-f0-9]{64})\s+(.+)$/i);
  if (!match || match[1].toLowerCase() !== digest || path.basename(match[2].trim()) !== path.basename(file)) {
    return { success: false, valid: false, reason: 'Backup checksum does not match its sidecar.', digest, checksum: digest, error: 'Backup checksum does not match its sidecar.' };
  }
  return { success: true, valid: true, reason: null, digest, checksum: digest, recordType: Array.isArray(parsed) ? 'array' : typeof parsed };
}

export function restoreJsonBackup(backupPath, destinationPath, { allowDirs = [] } = {}) {
  const backup = safePath(backupPath);
  const destination = safePath(destinationPath);
  if (!backup || !destination) return { success: false, error: 'Restore paths are required.' };
  // Jail the write: raw '..' segments never resolve inside, and configured
  // allow-lists (e.g. the live data dir) bound absolute destinations.
  if (String(destinationPath).split(/[\\/]/).includes('..')) return { success: false, error: 'Restore destination is invalid.' };
  const roots = (Array.isArray(allowDirs) ? allowDirs : [])
    .filter(value => typeof value === 'string')
    .map(value => safePath(value))
    .filter(Boolean);
  if (roots.length && !roots.some(root => destination === root || destination.startsWith(root + path.sep))) {
    return { success: false, error: 'Restore destination is outside the allowed directories.' };
  }
  const verified = verifyBackup(backup);
  if (!verified.success) return verified;
  if (path.dirname(destination) !== path.dirname(backup) && path.basename(destination).includes('..')) return { success: false, error: 'Restore destination is invalid.' };
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: STORE_DIRECTORY_MODE });
  const temp = `${destination}.${process.pid}.${crypto.randomUUID()}.restore.tmp`;
  fs.copyFileSync(backup, temp);
  fs.chmodSync(temp, STORE_FILE_MODE);
  fs.renameSync(temp, destination);
  return { success: true, checksum: verified.checksum, path: destination };
}

export { DEFAULT_RETENTION, checksumFile };
