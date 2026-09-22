import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anonymizeAccountInBackups, backupJsonFile, verifyBackup } from './backupStore.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-backup-purge-'));
const source = path.join(root, 'accounts.json');
const backupDir = path.join(root, 'backups');
fs.writeFileSync(source, JSON.stringify([{ id: 'acct-1', username: 'owner', stats: { wins: 1 } }, { id: 'acct-2', username: 'other' }]));
const created = backupJsonFile(source, backupDir, { now: Date.UTC(2026, 0, 1) });
assert.equal(anonymizeAccountInBackups(backupDir, 'acct-1'), 1);
const backupPath = created.path;
assert.equal(verifyBackup(backupPath).success, true);
const content = fs.readFileSync(backupPath, 'utf8');
assert.equal(content.includes('acct-1'), false);
assert.equal(content.includes('owner'), false);
fs.rmSync(root, { recursive: true, force: true });
console.log('backup account purge: 4 passed, 0 failed');
