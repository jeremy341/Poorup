import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupJsonFile } from '../server/backupStore.js';
import { runRestore } from './restore-backup.mjs';

// Every path in this suite lives under a throwaway directory that is removed
// at the end. The live data directory is only ever a temp directory too.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-restore-test-'));
const backupDir = path.join(root, 'backups');
const liveDir = path.join(root, 'live-data');
const stagingDir = path.join(root, 'staging');
const sourceDir = path.join(root, 'source');
fs.mkdirSync(sourceDir, { recursive: true });
fs.mkdirSync(liveDir, { recursive: true });

const source = path.join(sourceDir, 'accounts.json');
const firstAt = Date.UTC(2026, 0, 1, 0, 0);
const secondAt = Date.UTC(2026, 0, 2, 0, 0);
const firstBytes = '[{"id":"first"}]';
const secondBytes = '[{"id":"second"}]';
fs.writeFileSync(source, firstBytes);
backupJsonFile(source, backupDir, { now: firstAt });
fs.writeFileSync(source, secondBytes);
backupJsonFile(source, backupDir, { now: secondAt });
const stampFor = ms => new Date(ms).toISOString().replace(/[:.]/g, '-');
const newestName = `accounts.json.${stampFor(secondAt)}.json`;

function capture() {
  const out = [];
  const err = [];
  return { out, err, stdout: line => out.push(String(line)), stderr: line => err.push(String(line)) };
}

function run(args, env = { POORUP_DATA_DIR: liveDir }) {
  const io = capture();
  const status = runRestore(args, { env, stdout: io.stdout, stderr: io.stderr });
  return { status, out: io.out.join('\n'), err: io.err.join('\n') };
}

// --list shows every copy with its verification state and writes nothing.
const listed = run(['--backup-dir', backupDir, '--store', 'accounts', '--list']);
assert.equal(listed.status, 0);
assert.match(listed.out, new RegExp(newestName.replace(/[.]/g, '\\.')));
assert.match(listed.out, /verified/);
assert.equal(fs.existsSync(path.join(stagingDir, 'accounts.json')), false);

// Default restore takes the newest verified copy into a staging directory.
const latest = run(['--backup-dir', backupDir, '--store', 'accounts', '--to', stagingDir]);
assert.equal(latest.status, 0, latest.err);
assert.equal(fs.readFileSync(path.join(stagingDir, 'accounts.json'), 'utf8'), secondBytes);
assert.match(latest.out, new RegExp(newestName.replace(/[.]/g, '\\.')));
assert.match(latest.out, /live data directory untouched/i);

// --at selects the newest copy taken at or before the timestamp.
const atFirst = path.join(root, 'at-first');
const earlier = run(['--backup-dir', backupDir, '--store', 'accounts', '--at', new Date(firstAt + 1000).toISOString(), '--to', atFirst]);
assert.equal(earlier.status, 0, earlier.err);
assert.equal(fs.readFileSync(path.join(atFirst, 'accounts.json'), 'utf8'), firstBytes);
const beforeAll = run(['--backup-dir', backupDir, '--store', 'accounts', '--at', '2025-01-01T00:00:00Z', '--to', path.join(root, 'none')]);
assert.equal(beforeAll.status, 1);
assert.match(beforeAll.err, /No backup copy was taken at or before/);

// A corrupt sidecar on the newest copy refuses restore instead of silently
// falling back to an older copy.
fs.writeFileSync(path.join(backupDir, `${newestName}.sha256`), `${'0'.repeat(64)}  ${newestName}\n`);
const corrupt = run(['--backup-dir', backupDir, '--store', 'accounts', '--to', path.join(root, 'corrupt-target')]);
assert.equal(corrupt.status, 1);
assert.match(corrupt.err, /fails verification/);
assert.equal(fs.existsSync(path.join(root, 'corrupt-target', 'accounts.json')), false);
const listedCorrupt = run(['--backup-dir', backupDir, '--store', 'accounts', '--list']);
assert.match(listedCorrupt.out, /INVALID/);
// The older copy is still restorable when the operator names it explicitly.
const recovered = path.join(root, 'recovered');
assert.equal(run(['--backup-dir', backupDir, '--store', 'accounts', '--at', new Date(firstAt).toISOString(), '--to', recovered]).status, 0);
assert.equal(fs.readFileSync(path.join(recovered, 'accounts.json'), 'utf8'), firstBytes);
// Put the newest copy back so later checks see a healthy set.
backupJsonFile(source, backupDir, { now: secondAt });

// Unknown store names are refused with the allow-list.
const unknown = run(['--backup-dir', backupDir, '--store', '../../etc/passwd', '--to', stagingDir]);
assert.equal(unknown.status, 2);
assert.match(unknown.err, /Unknown store/);
assert.match(unknown.err, /accounts/);
assert.equal(run(['--backup-dir', backupDir, '--store', 'sessions', '--to', stagingDir]).status, 2, 'sessions are not an allowed store');

// Usage errors and malformed timestamps exit 2.
assert.equal(run(['--store', 'accounts', '--to', stagingDir]).status, 2);
assert.equal(run(['--backup-dir', backupDir, '--store', 'accounts']).status, 2);
assert.equal(run(['--backup-dir', backupDir, '--store', 'accounts', '--at', 'yesterday', '--to', stagingDir]).status, 2);
assert.equal(run(['--backup-dir', backupDir, '--store', 'accounts', '--bogus', '--to', stagingDir]).status, 2);

// Missing backups fail without writing anything.
assert.equal(run(['--backup-dir', path.join(root, 'no-such-backups'), '--store', 'accounts', '--to', stagingDir]).status, 1);
const socialNone = run(['--backup-dir', backupDir, '--store', 'social', '--to', path.join(root, 'social')]);
assert.equal(socialNone.status, 1);
assert.match(socialNone.err, /No backup copies exist/);
assert.equal(fs.existsSync(path.join(root, 'social')), false);

// An existing target file is never overwritten without --force.
const existing = path.join(root, 'existing');
fs.mkdirSync(existing);
fs.writeFileSync(path.join(existing, 'accounts.json'), '[{"id":"keep"}]');
const refused = run(['--backup-dir', backupDir, '--store', 'accounts', '--to', existing]);
assert.equal(refused.status, 1);
assert.match(refused.err, /already exists/);
assert.equal(fs.readFileSync(path.join(existing, 'accounts.json'), 'utf8'), '[{"id":"keep"}]');
const forced = run(['--backup-dir', backupDir, '--store', 'accounts', '--to', existing, '--force']);
assert.equal(forced.status, 0, forced.err);
assert.equal(fs.readFileSync(path.join(existing, 'accounts.json'), 'utf8'), secondBytes);
assert.match(forced.out, /overwrote existing/i);

// The live data directory is off limits unless the target is exactly that
// directory and --force is passed. Subdirectories of it are always refused.
const liveRefused = run(['--backup-dir', backupDir, '--store', 'accounts', '--to', liveDir]);
assert.equal(liveRefused.status, 1);
assert.match(liveRefused.err, /live data directory/);
assert.equal(fs.existsSync(path.join(liveDir, 'accounts.json')), false);
const liveSub = run(['--backup-dir', backupDir, '--store', 'accounts', '--to', path.join(liveDir, 'nested'), '--force']);
assert.equal(liveSub.status, 1);
assert.match(liveSub.err, /live data directory/);
assert.equal(fs.existsSync(path.join(liveDir, 'nested')), false);
const liveForced = run(['--backup-dir', backupDir, '--store', 'accounts', '--to', liveDir, '--force']);
assert.equal(liveForced.status, 0, liveForced.err);
assert.equal(fs.readFileSync(path.join(liveDir, 'accounts.json'), 'utf8'), secondBytes);
assert.match(liveForced.out, /live data directory/);

// X6: the live data directory is protected even when POORUP_DATA_DIR is not
// set. The server then keeps its stores in <repo>/server/data, and a restore
// into the default live directory used to be allowed without --force.
{
  const defaultLive = path.join(root, 'default-live');
  fs.mkdirSync(defaultLive, { recursive: true });
  const io = capture();
  const status = runRestore(['--backup-dir', backupDir, '--store', 'accounts', '--to', defaultLive], { env: {}, stdout: io.stdout, stderr: io.stderr, defaultLiveDir: defaultLive });
  assert.equal(status, 1, 'a restore into the default live directory is refused');
  assert.match(io.err.join('\n'), /live data directory/);
  assert.equal(fs.existsSync(path.join(defaultLive, 'accounts.json')), false, 'nothing was written');
  const nestedIo = capture();
  const nested = path.join(defaultLive, 'nested');
  assert.equal(runRestore(['--backup-dir', backupDir, '--store', 'accounts', '--to', nested, '--force'], { env: {}, stdout: nestedIo.stdout, stderr: nestedIo.stderr, defaultLiveDir: defaultLive }), 1, 'a subdirectory of it is refused as well');
  assert.equal(fs.existsSync(nested), false);
  // A staging directory outside the live directory is still fine.
  const stagingIo = capture();
  assert.equal(runRestore(['--backup-dir', backupDir, '--store', 'accounts', '--to', path.join(root, 'staging-without-env')], { env: {}, stdout: stagingIo.stdout, stderr: stagingIo.stderr, defaultLiveDir: defaultLive }), 0, stagingIo.err.join('\n'));
}

fs.rmSync(root, { recursive: true, force: true });
console.log('restore backup tool: 45 passed, 0 failed');
