import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupJsonFile, restoreJsonBackup, verifyBackup } from './backupStore.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-backup-integrity-'));
const source = path.join(root, 'accounts.json');
const backupDir = path.join(root, 'backups');
fs.writeFileSync(source, '{"accounts":[{"id":"a"}]}', 'utf8');
const created = backupJsonFile(source, backupDir, { now: Date.UTC(2026, 0, 1) });
assert.equal(created.success, true);

const sidecar = `${created.path}.sha256`;
fs.writeFileSync(sidecar, `${'0'.repeat(64)}  ${path.basename(created.path)}\n`, 'utf8');
assert.equal(verifyBackup(created.path).success, false);
assert.equal(restoreJsonBackup(created.path, path.join(root, 'restored.json')).success, false);

const original = fs.readFileSync(created.path, 'utf8');
fs.writeFileSync(created.path, `${original} `, 'utf8');
assert.equal(verifyBackup(created.path).success, false);

fs.rmSync(root, { recursive: true, force: true });
console.log('backup restore integrity: 4 passed, 0 failed');
