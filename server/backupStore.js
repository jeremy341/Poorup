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

export function restoreJsonBackup(backupPath, destinationPath) {
  const backup = safePath(backupPath);
  const destination = safePath(destinationPath);
  if (!backup || !destination) return { success: false, error: 'Restore paths are required.' };
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
