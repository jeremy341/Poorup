// Shared persistence seam for the JSON-backed stores. Two failure modes used
// to combine into silent, total data loss:
//   1. persist() wrote with fs.writeFileSync straight onto the store file, so
//      a crash mid-write left a truncated JSON file.
//   2. load() wrapped the read+parse in a catch{} that started an EMPTY store
//      for both "file missing" and "file corrupt". The next persist() then
//      overwrote the (recoverable) corrupt file with the empty in-memory set.
// This module gives every store one atomic write and one load that can tell
// "missing" apart from "corrupt", quarantining corrupt bytes before we ever
// overwrite them.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Store files and their directories hold account and session credentials, so
// they are owner-only. Windows ignores POSIX mode bits; the calls still run.
const STORE_FILE_MODE = 0o600;
const STORE_DIRECTORY_MODE = 0o700;
// A temp file this old cannot belong to a write in flight (writes are
// synchronous), so it is the leftover of a failed rename.
const STALE_TEMP_MS = 10 * 60 * 1000;

function loadJson(filePath, shapeValidator = null) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: null, missing: true, corrupt: false };
    // A permission/sharing failure is not an empty store. Fail fast so a
    // later mutation cannot overwrite data that was never successfully read.
    throw error;
  }
  let value = null;
  let valid = true;
  try {
    // Windows editors and PowerShell 5 prepend a byte order mark; JSON.parse
    // rejects it, and that is not corruption.
    value = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    if (typeof shapeValidator === 'function' && !shapeValidator(value)) valid = false;
  } catch {
    valid = false;
  }
  if (!valid) {
    quarantine(filePath, raw);
    return { value: null, missing: false, corrupt: true };
  }
  return { value, missing: false, corrupt: false };
}

// Stores whose unreadable bytes were moved aside in this process. The store
// then starts empty, so backups must not copy it until the next restart.
const quarantinedStores = new Set();

function isQuarantinedStore(filePath) {
  return quarantinedStores.has(path.resolve(String(filePath)));
}

function quarantine(filePath, raw) {
  quarantinedStores.add(path.resolve(filePath));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${filePath}.corrupt-${stamp}`;
  try {
    // Owner-only: the bytes are account and session material.
    fs.writeFileSync(target, raw, { encoding: 'utf8', mode: STORE_FILE_MODE });
  } catch (copyError) {
    // The copy failed, so move the original aside instead. If that fails too,
    // refuse to start: the next persist would overwrite the only copy of the
    // bytes.
    try {
      fs.renameSync(filePath, target);
    } catch {
      throw new Error(`Store ${path.basename(filePath)} is unreadable and its bytes could not be preserved; refusing to start over it.`, { cause: copyError });
    }
  }
  console.error(`Store ${path.basename(filePath)} was unreadable; bytes preserved at ${path.basename(target)} and a clean store is starting.`);
}

// Leftover temp files from failed renames each hold a whole store, so they are
// removed once they are old enough that no write can still own them.
function sweepStaleTempFiles(filePath) {
  try {
    const directory = path.dirname(filePath);
    const prefix = `${path.basename(filePath)}.`;
    const cutoff = Date.now() - STALE_TEMP_MS;
    for (const name of fs.readdirSync(directory)) {
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
      const target = path.join(directory, name);
      try { if (fs.statSync(target).mtimeMs < cutoff) fs.unlinkSync(target); } catch { /* best effort */ }
    }
  } catch { /* the write itself succeeded */ }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: STORE_DIRECTORY_MODE });
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = fs.openSync(tempPath, 'w', STORE_FILE_MODE);
  try {
    try {
      fs.writeFileSync(handle, data, 'utf8');
      // Also set the mode on the handle: the owner-only guarantee must not rest
      // on the open call honouring its mode on every filesystem.
      fs.fchmodSync(handle, STORE_FILE_MODE);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
  } catch (error) {
    // A failed write/fsync cannot produce a recoverable snapshot. Remove the
    // partial temp file while preserving the previous destination file.
    try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
    throw error;
  }
  try {
    fs.renameSync(tempPath, filePath);
  } catch (renameError) {
    // Never truncate the previous snapshot after an atomic rename fails. The
    // fully-written temp file remains available for operator recovery, and
    // the caller receives a failure instead of a false durable success.
    console.error(`Store ${path.basename(filePath)} atomic rename failed; previous snapshot preserved.`, renameError);
    throw new Error(`Atomic store write failed for ${path.basename(filePath)}.`, { cause: renameError });
  }
  sweepStaleTempFiles(filePath);
}

export { isQuarantinedStore, loadJson, STORE_DIRECTORY_MODE, STORE_FILE_MODE, writeJson };
