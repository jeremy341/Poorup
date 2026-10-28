// Boots the real server.js against throwaway data and backup directories and checks the boot-time
// backup pass: healthy stores are copied, a store quarantined as corrupt at load is not, and readiness
// reports the backup as stale and unavailable, end to end.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverEntry = fileURLToPath(new URL('./server.js', import.meta.url));
const port = 9300 + (process.pid % 50);
const base = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(child, output) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${output()}`);
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {
      // still booting
    }
    await wait(100);
  }
  throw new Error(`server did not answer /healthz: ${output()}`);
}

function copiesOf(directory, store) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => name.startsWith(`${store}.`) && name.endsWith('.json'));
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-backup-wire-data-'));
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-backup-wire-copies-'));
fs.writeFileSync(path.join(dataDir, 'accounts.json'), '[]\n');
fs.writeFileSync(path.join(dataDir, 'social.json'), '{}\n');
fs.writeFileSync(path.join(dataDir, 'matches.json'), '{"broken":');

const env = { ...process.env };
for (const key of ['NODE_ENV', 'POORUP_MAINTENANCE_MODE', 'POORUP_RELEASE_ID', 'POORUP_MAINTENANCE_TOKEN']) delete env[key];
const child = spawn(process.execPath, [serverEntry], {
  env: { ...env, PORT: String(port), POORUP_DATA_DIR: dataDir, POORUP_BACKUP_DIR: backupDir, POORUP_SHUTDOWN_DRAIN_MS: '1000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
const exited = new Promise(resolve => child.once('exit', resolve));

let failure = null;
try {
  await waitForHealth(child, () => output);
  const ready = await fetch(`${base}/readyz`);
  const body = await ready.json();
  assert.equal(ready.status, 503, `readiness should reject the skipped required-store backup: ${JSON.stringify(body)}`);
  assert.equal(body.backupConfigured, true);
  assert.equal(body.backupFresh, false, `a skipped required-store backup should be stale: ${JSON.stringify(body)}`);

  assert.equal(copiesOf(backupDir, 'accounts.json').length, 1, 'the healthy accounts store is copied at boot');
  assert.equal(copiesOf(backupDir, 'social.json').length, 1, 'the healthy social store is copied at boot');
  assert.equal(copiesOf(backupDir, 'matches.json').length, 0, 'a store quarantined at load is not copied');
  assert.equal(fs.readdirSync(dataDir).some(name => name.startsWith('matches.json.corrupt-')), true, 'the corrupt bytes are preserved in the data directory');
  assert.equal(copiesOf(backupDir, 'sessions.json').length, 0, 'sessions are not part of the backup set');
  assert.equal(copiesOf(backupDir, 'recovery-tokens.json').length, 0, 'recovery tokens are not part of the backup set');
  assert.equal(fs.readdirSync(backupDir).filter(name => name.endsWith('.sha256')).length, 2, 'each copy has a checksum sidecar');
  console.log('backup wire checks: 10 passed, 0 failed');
} catch (error) {
  failure = error;
} finally {
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([exited, wait(15_000)]);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
}
if (failure) {
  console.error('backup wire checks failed:', failure.message);
  process.exitCode = 1;
}
