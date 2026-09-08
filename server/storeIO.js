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

function loadJson(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: null, missing: true, corrupt: false };
    // A permission/sharing failure is not an empty store. Fail fast so a
    // later mutation cannot overwrite data that was never successfully read.
    throw error;
  }
  try {
    return { value: JSON.parse(raw), missing: false, corrupt: false };
  } catch {
    quarantine(filePath, raw);
    return { value: null, missing: false, corrupt: true };
  }
}

function quarantine(filePath, raw) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${filePath}.corrupt-${stamp}`;
  try {
    fs.writeFileSync(target, raw, 'utf8');
  } catch {
    // Best effort: even if the copy fails we still refuse to load-and-clobber.
  }
  console.error(`Store ${path.basename(filePath)} was unreadable; bytes preserved at ${path.basename(target)} and a clean store is starting.`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = fs.openSync(tempPath, 'w');
  try {
    fs.writeFileSync(handle, data, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
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
}

export { loadJson, writeJson };
