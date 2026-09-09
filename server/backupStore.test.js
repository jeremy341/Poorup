import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backupJsonFile, backupJsonStores, restoreJsonBackup, verifyBackup } from './backupStore.js';

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
fs.rmSync(dir, { recursive: true, force: true });
console.log('backup store: 7 passed, 0 failed');
