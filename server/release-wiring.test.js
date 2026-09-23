import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 8700 + (process.pid % 200);
const base = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(child) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await wait(100);
  }
  throw new Error('release wiring server did not start');
}

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-release-wiring-'));
const child = spawn(process.execPath, [path.join(process.cwd(), 'server/server.js')], {
  env: {
    ...process.env,
    PORT: String(port),
    POORUP_DATA_DIR: dataDirectory,
    POORUP_PUBLIC_ORIGIN: 'https://play.example',
    POORUP_INDEX_POLICY: 'index,follow',
    POORUP_ADMIN_ACCOUNT_IDS: 'release-admin',
    POORUP_SHUTDOWN_DRAIN_MS: '1000'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

try {
  await waitForServer(child);

  const robots = await fetch(`${base}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Allow: \/\n/);
  const sitemap = await fetch(`${base}/sitemap.xml`);
  assert.equal(sitemap.status, 200);
  assert.match(await sitemap.text(), /https:\/\/play\.example\//);

  const analytics = await fetch(`${base}/admin/analytics/balance`);
  assert.equal(analytics.status, 403);
  assert.equal(analytics.headers.get('cache-control'), 'no-store');
  const analyticsBody = await analytics.json();
  assert.equal(analyticsBody.success, false);

  const metadata = await fetch(`${base}/`);
  assert.equal(metadata.status, 200);
  const metadataBody = await metadata.text();
  assert.match(metadataBody, /name="robots" content="index,follow"/);
  assert.match(metadataBody, /rel="canonical" href="https:\/\/play\.example\//);
  assert.equal(metadata.headers.get('cache-control'), 'no-cache');
  assert.match(metadata.headers.get('content-security-policy') || '', /connect-src 'self' https:\/\/play\.example/);
  assert.match(metadata.headers.get('content-security-policy') || '', /form-action 'self'/);

  const ready = await fetch(`${base}/readyz`);
  const readyBody = await ready.json();
  assert.equal(ready.status, 200);
  assert.equal(readyBody.storeLoaded, true);
  assert.equal(readyBody.backupConfigured, false);
  assert.equal(readyBody.backupFresh, null);
  assert.equal(readyBody.analyticsRollup.loaded, true);

  assert.doesNotMatch(output, /UNCAUGHT EXCEPTION/);
  console.log('release wiring tests: passed');
} finally {
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      wait(3000)
    ]);
  }
  fs.rmSync(dataDirectory, { recursive: true, force: true });
}
