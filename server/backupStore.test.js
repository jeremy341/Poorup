import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backupJsonFile, backupJsonStores, restoreJsonBackup, verifyBackup, pruneBackupsByAge } from './backupStore.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-backup-'));
const source = path.join(dir, 'accounts.json');
const backupDir = path.join(dir, 'backups');
fs.writeFileSync(source, '[{"id":"a"}]');
const result = backupJsonFile(source, backupDir, { now: Date.UTC(2026, 0, 1) });
assert.equal(result.success, true);
assert.equal(verifyBackup(result.path).success, true);
const destination = path.join(dir, 'restored.json');
assert.equal(restoreJsonBackup(result.path, destination).success, true);
assert.equal(fs.readFileSync(destination, 'utf8'), '[{"id":"a"}]');
assert.equal(backupJsonStores({ accounts: source, missing: path.join(dir, 'missing.json') }, backupDir).results.length, 2);
assert.equal(backupJsonStores({}, backupDir).success, false);
assert.match(backupJsonStores({}, backupDir).error, /source stores/i);
backupJsonFile(source, backupDir, { retention: 1, now: Date.UTC(2026, 0, 2) });
backupJsonFile(source, backupDir, { retention: 1, now: Date.UTC(2026, 0, 3) });
const retained = fs.readdirSync(backupDir);
assert.equal(retained.filter(name => name.endsWith('.json')).length, 1);
assert.equal(retained.filter(name => name.endsWith('.sha256')).length, 1);
// Destinations with .. segments and unlisted absolute roots are rejected.
const retainedPath = path.join(backupDir, retained.find(name => name.endsWith('.json')));
assert.equal(restoreJsonBackup(retainedPath, `${backupDir}/../escape.json`).success, false);
assert.equal(restoreJsonBackup(retainedPath, path.join(dir, 'ok.json'), { allowDirs: [backupDir] }).success, false);
assert.equal(restoreJsonBackup(retainedPath, path.join(dir, 'ok.json'), { allowDirs: [dir] }).success, true);
// Invalid aged backups quarantine instead of lingering forever.
fs.writeFileSync(path.join(backupDir, 'tampered.json'), '{"partial":');
assert.equal(pruneBackupsByAge(backupDir, { olderThan: Date.now() + 1000 }), 1);
assert.equal(fs.existsSync(path.join(backupDir, 'quarantine', 'tampered.json')), true);
fs.rmSync(dir, { recursive: true, force: true });
console.log('backup store: 8 passed, 0 failed');
