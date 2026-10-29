// Shared persistence seam for the JSON-backed stores. Two failure modes combined into silent, total data loss: persist() wrote straight
// onto the store file (a crash mid-write left truncated JSON), and load() treated both "file missing" and "file corrupt" as an empty
// store, so the next persist() overwrote the recoverable corrupt file. Every store gets one atomic write and one load that tells
// "missing" from "corrupt", quarantining corrupt bytes before anything overwrites them.
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

// Stores whose unreadable bytes were moved aside in this process. The store starts empty, so backups must not copy it until an
// operator has dealt with it. The in-memory set alone is not enough: a restart would forget it and treat the empty stand-in as healthy,
// so every quarantine also leaves a small marker file beside the store that survives restarts.
const quarantinedStores = new Set();
const QUARANTINE_MARKER_SUFFIX = '.quarantine-marker';

function quarantineMarkerPath(filePath) {
  return `${path.resolve(String(filePath))}${QUARANTINE_MARKER_SUFFIX}`;
}

/** The persisted record of a quarantine ({ store, at, preservedAs }), or null when the store was never quarantined. */
function readQuarantineMarker(filePath) {
  const fallback = { store: path.basename(String(filePath)), at: null, preservedAs: null };
  try {
    const record = JSON.parse(fs.readFileSync(quarantineMarkerPath(filePath), 'utf8'));
    return record && typeof record === 'object' ? record : fallback;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    // A marker that exists but cannot be read or parsed still means "quarantined".
    return fallback;
  }
}

/** For an operator or restore tooling, once the quarantined store has been dealt with. */
function clearQuarantineMarker(filePath) {
  quarantinedStores.delete(path.resolve(String(filePath)));
  try { fs.unlinkSync(quarantineMarkerPath(filePath)); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

function isQuarantinedStore(filePath) {
  return quarantinedStores.has(path.resolve(String(filePath))) || readQuarantineMarker(filePath) !== null;
}

function writeQuarantineMarker(filePath, record) {
  try {
    fs.writeFileSync(quarantineMarkerPath(filePath), `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: STORE_FILE_MODE });
  } catch (error) {
    // The corrupt bytes are already preserved; losing the marker only loses the restart memory.
    console.error(`Store ${path.basename(filePath)} quarantine marker could not be saved:`, error?.code || 'unknown error');
  }
}

// A quarantine copy never replaces an earlier one, even within the same millisecond.
function exclusiveCopy(filePath, stamp, raw) {
  for (let attempt = 0; ; attempt += 1) {
    const target = `${filePath}.corrupt-${stamp}${attempt ? `-${attempt}` : ''}`;
    try {
      // Owner-only: the bytes are account and session material.
      fs.writeFileSync(target, raw, { encoding: 'utf8', mode: STORE_FILE_MODE, flag: 'wx' });
      return target;
    } catch (error) {
      if (error?.code !== 'EEXIST' || attempt >= 50) throw error;
    }
  }
}

function quarantine(filePath, raw) {
  quarantinedStores.add(path.resolve(filePath));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let target;
  try {
    target = exclusiveCopy(filePath, stamp, raw);
  } catch (copyError) {
    // The copy failed, so move the original aside instead. If that fails too,
    // refuse to start: the next persist would overwrite the only copy of the
    // bytes.
    target = `${filePath}.corrupt-${stamp}-moved`;
    try {
      fs.renameSync(filePath, target);
    } catch {
      throw new Error(`Store ${path.basename(filePath)} is unreadable and its bytes could not be preserved; refusing to start over it.`, { cause: copyError });
    }
  }
  writeQuarantineMarker(filePath, {
    store: path.basename(filePath),
    at: new Date().toISOString(),
    preservedAs: path.basename(target),
    note: 'The store file was corrupt and its bytes were preserved. The live store started empty. Restore or review it, then delete this marker.',
  });
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
      // Also set the mode on the handle: the owner-only setting must not rest
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
    // the caller gets a failure, not a false durable success.
    console.error(`Store ${path.basename(filePath)} atomic rename failed; previous snapshot preserved.`, renameError);
    throw new Error(`Atomic store write failed for ${path.basename(filePath)}.`, { cause: renameError });
  }
  sweepStaleTempFiles(filePath);
}

export { clearQuarantineMarker, isQuarantinedStore, loadJson, readQuarantineMarker, STORE_DIRECTORY_MODE, STORE_FILE_MODE, writeJson };
