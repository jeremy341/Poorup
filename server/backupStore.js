// Checksummed JSON backup helpers. Backups are opt-in through
// POORUP_BACKUP_DIR and never overwrite the live authoritative files.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_RETENTION = 7;

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
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, filePath);
}

function backupName(filePath, stamp) {
  return `${path.basename(filePath)}.${stamp}.json`;
}

function rotate(directory, prefix, retention = DEFAULT_RETENTION) {
  const files = fs.readdirSync(directory)
    .filter(file => file.startsWith(prefix) && file.endsWith('.json'))
    .map(file => ({ file, mtime: fs.statSync(path.join(directory, file)).mtimeMs }))
    // Rotation must never treat a tampered or partial candidate as the newest
    // valid backup. Leave invalid artifacts for operator inspection.
    .filter(entry => verifyBackup(path.join(directory, entry.file)).success)
    .sort((a, b) => b.mtime - a.mtime);
  files.slice(Math.max(1, retention)).forEach(entry => {
    fs.unlinkSync(path.join(directory, entry.file));
    const sidecar = path.join(directory, entry.file + '.sha256');
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  });
}

export function backupJsonFile(sourcePath, backupDirectory, { retention = DEFAULT_RETENTION, now = Date.now() } = {}) {
  const source = safePath(sourcePath);
  const directory = safePath(backupDirectory);
  if (!source || !directory) return { success: false, error: 'Backup paths are required.' };
  if (!fs.existsSync(source)) return { success: false, error: 'Source store does not exist.' };
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const name = backupName(source, stamp);
  const destination = path.join(directory, name);
  const bytes = fs.readFileSync(source);
  const checksum = checksumBytes(bytes);
  atomicWrite(destination, bytes);
  atomicWrite(`${destination}.sha256`, `${checksum}  ${name}\n`, 'utf8');
  rotate(directory, path.basename(source) + '.', retention);
  return { success: true, path: destination, checksum, createdAt: new Date(now).toISOString() };
}

export function backupJsonStores(storePaths = {}, backupDirectory, options = {}) {
  const results = Object.entries(storePaths)
    .filter(([, filePath]) => typeof filePath === 'string')
    .map(([key, filePath]) => ({ key, ...backupJsonFile(filePath, backupDirectory, options) }));
  if (!results.length) return { success: false, error: 'No source stores are configured for backup.', results };
  return { success: results.every(result => result.success), results };
}

export function pruneBackupsByAge(backupDirectory, { olderThan = Date.now() - 30 * 86400000, quarantine = true } = {}) {
  const directory = safePath(backupDirectory);
  if (!directory || !fs.existsSync(directory)) return 0;
  let removed = 0;
  fs.readdirSync(directory).filter(file => file.endsWith('.json') && fs.statSync(path.join(directory, file)).mtimeMs < Number(olderThan)).forEach((file) => {
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
    const sidecar = `${target}.sha256`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    removed += 1;
  });
  return removed;
}

function scrubAccount(value, accountId) {
  if (Array.isArray(value)) return value.map(item => scrubAccount(item, accountId)).filter(item => item !== null);
  if (!value || typeof value !== 'object') return value;
  if (value.id === accountId && typeof value.username === 'string') return null;
  if (value.accountId === accountId) return { ...value, accountId: null, displayNameAtMatch: value.displayNameAtMatch ? 'ACCOUNT DEACTIVATED' : value.displayNameAtMatch };
  const output = {};
  Object.entries(value).forEach(([key, child]) => {
    if (key === accountId || key === 'sessionToken' || key === 'passwordHash' || key === 'passwordSalt') return;
    if (typeof child === 'string' && child === accountId && /account.?id|owner.?id|holder.?id|player.?id/i.test(key)) {
      output[key] = null;
      return;
    }
    output[key] = scrubAccount(child, accountId);
  });
  return output;
}

export function anonymizeAccountInBackups(backupDirectory, accountId) {
  const directory = safePath(backupDirectory);
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  if (!directory || !id || !fs.existsSync(directory)) return 0;
  let changed = 0;
  fs.readdirSync(directory).filter(file => file.endsWith('.json')).forEach((file) => {
    const target = path.join(directory, file);
    const verified = verifyBackup(target);
    if (!verified.success) return;
    const bytes = fs.readFileSync(target);
    let parsed;
    try { parsed = JSON.parse(bytes.toString('utf8')); } catch { return; }
    const scrubbed = scrubAccount(parsed, id);
    const nextBytes = Buffer.from(JSON.stringify(scrubbed, null, 2) + '\n', 'utf8');
    if (nextBytes.equals(bytes)) return;
    const checksum = checksumBytes(nextBytes);
    atomicWrite(target, nextBytes);
    atomicWrite(`${target}.sha256`, `${checksum}  ${path.basename(target)}\n`, 'utf8');
    changed += 1;
  });
  return changed;
}

export function createBackupRetentionAdapter(backupDirectory) {
  return {
    pruneByAge: options => pruneBackupsByAge(backupDirectory, options),
    anonymizeAccount: accountId => anonymizeAccountInBackups(backupDirectory, accountId)
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
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${process.pid}.${crypto.randomUUID()}.restore.tmp`;
  fs.copyFileSync(backup, temp);
  fs.renameSync(temp, destination);
  return { success: true, checksum: verified.checksum, path: destination };
}

export { DEFAULT_RETENTION, checksumFile };
