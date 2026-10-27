// Credential-bearing JSON stores (accounts, sessions, recovery tokens, AI
// provider profiles) and their backups must not be readable by other local
// users: directories are created 0700 and files 0600 (E37-09). Windows ignores
// POSIX mode bits, so the mode assertions only run on POSIX. The same write,
// quarantine, backup and restore code paths still run everywhere.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupJsonFile, restoreJsonBackup } from './backupStore.js';
import { loadJson, writeJson } from './storeIO.js';

const posix = process.platform !== 'win32';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-store-modes-'));
// A fully permissive umask means only the explicit modes can produce 0600/0700.
const previousUmask = process.umask(0o000);

function modeOf(target) {
  return fs.statSync(target).mode & 0o777;
}

function expectMode(target, expected, label) {
  if (posix) assert.equal(modeOf(target).toString(8), expected.toString(8), `${label} should be ${expected.toString(8)}`);
}

function quietly(run) {
  const original = console.error;
  console.error = () => {};
  try {
    return run();
  } finally {
    console.error = original;
  }
}

try {
  const accounts = path.join(root, 'data', 'nested', 'accounts.json');
  writeJson(accounts, [{ username: 'first' }]);
  assert.deepEqual(loadJson(accounts).value, [{ username: 'first' }]);
  expectMode(path.dirname(accounts), 0o700, 'new store directory');
  expectMode(accounts, 0o600, 'store file');

  // A world-readable file from an older release is replaced, not reused.
  if (posix) fs.chmodSync(accounts, 0o644);
  writeJson(accounts, [{ username: 'second' }]);
  assert.deepEqual(loadJson(accounts).value, [{ username: 'second' }]);
  expectMode(accounts, 0o600, 'rewritten store file');

  // Corrupt bytes are moved aside into a quarantine copy with the same mode.
  const corruptDir = path.join(root, 'corrupt');
  fs.mkdirSync(corruptDir, { recursive: true });
  const corruptStore = path.join(corruptDir, 'social.json');
  fs.writeFileSync(corruptStore, '{"broken":');
  assert.equal(quietly(() => loadJson(corruptStore, value => value && typeof value === 'object')).corrupt, true);
  const preserved = fs.readdirSync(corruptDir).find(name => name.includes('.corrupt-'));
  assert.ok(preserved, 'corrupt bytes are preserved');
  expectMode(path.join(corruptDir, preserved), 0o600, 'quarantine copy');

  // Backups and their checksum sidecars are credential-bearing copies too.
  const backups = path.join(root, 'backups', 'nested');
  const copy = backupJsonFile(accounts, backups, { now: Date.UTC(2026, 0, 1) });
  assert.equal(copy.success, true);
  expectMode(backups, 0o700, 'backup directory');
  expectMode(copy.path, 0o600, 'backup copy');
  expectMode(`${copy.path}.sha256`, 0o600, 'backup checksum sidecar');

  // Restores write the same kind of file into a new directory.
  const restored = path.join(root, 'restored', 'accounts.json');
  assert.equal(restoreJsonBackup(copy.path, restored).success, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(restored, 'utf8')), [{ username: 'second' }]);
  expectMode(path.dirname(restored), 0o700, 'restore directory');
  expectMode(restored, 0o600, 'restored store file');
  console.log(posix ? 'storage permissions: passed (POSIX mode bits verified)' : 'storage permissions: code paths passed; POSIX mode assertions skipped on win32');
} finally {
  process.umask(previousUmask);
  fs.rmSync(root, { recursive: true, force: true });
}
