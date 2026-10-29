// Boots the real server and checks the HTTP surface end to end: client errors,
// static files versus the rate limiter, compression and cache classes, the
// indexing gate, and a drain that survives a restart.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let nextPort = 20000 + (process.pid % 15000) * 2;

async function start(env = {}, { prepare } = {}) {
  const port = nextPort;
  nextPort += 1;
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-http-wire-'));
  prepare?.(dataDirectory);
  const child = spawn(process.execPath, [path.join(process.cwd(), 'server/server.js')], {
    env: { ...process.env, PORT: String(port), POORUP_DATA_DIR: dataDirectory, POORUP_BACKUP_DIR: '', POORUP_SHUTDOWN_DRAIN_MS: '1000', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}: ${output}`);
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* still starting */ }
    if (Date.now() > deadline) throw new Error('server did not start');
    await wait(100);
  }
  return {
    base,
    dataDirectory,
    output: () => output,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(3000)]);
      }
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
  };
}

function raw(base, pathname, { encoding, method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${base}${pathname}`, { method, headers: { ...(encoding === undefined ? {} : { 'accept-encoding': encoding }), ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end();
  });
}

const serverSource = fs.readFileSync(path.join(process.cwd(), 'server/server.js'), 'utf8');
await check('account erasure is wired to the recovery-token store', () => {
  assert.match(serverSource, /createAccountDeletionCoordinator\(\{[^}]*stores: \[accountRecovery\]/s);
});

const plain = await start({ POORUP_MAINTENANCE_TOKEN: '' });
try {
  await check('malformed and oversized request bodies are client errors, not 500s', async () => {
    const bad = await fetch(`${plain.base}/account/profile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).success, false);
    const big = await fetch(`${plain.base}/account/recovery/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(20_000) }) });
    assert.equal(big.status, 413);
    assert.equal((await raw(plain.base, '/%E0%A4%A')).status, 400);
    assert.equal((await raw(plain.base, '/about%zz')).status, 400);
  });

  await check('/internal/maintenance stays a 404 when unconfigured, whatever the body', async () => {
    const response = await fetch(`${plain.base}/internal/maintenance`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(response.status, 404);
  });

  await check('scripts, styles and pages are compressed and cached by class', async () => {
    const script = await raw(plain.base, '/main.js', { encoding: 'gzip, br' });
    assert.equal(script.status, 200);
    assert.equal(script.headers['content-encoding'], 'br');
    assert.match(script.headers.vary || '', /Accept-Encoding/i);
    assert.equal(script.headers['cache-control'], 'no-cache');
    const original = fs.readFileSync(path.join(process.cwd(), 'public/main.js'));
    assert.ok(script.body.length < original.length / 2);
    assert.equal(zlib.brotliDecompressSync(script.body).toString(), original.toString());
    const again = await raw(plain.base, '/main.js', { encoding: 'br', headers: { 'if-none-match': script.headers.etag } });
    assert.equal(again.status, 304);

    const home = await raw(plain.base, '/', { encoding: 'gzip' });
    assert.equal(home.status, 200);
    assert.equal(home.headers['content-encoding'], 'gzip');
    assert.equal(home.headers['cache-control'], 'no-cache');
    assert.match(zlib.gunzipSync(home.body).toString(), /name="robots"/);
    const homeIdentity = await raw(plain.base, '/');
    assert.equal(homeIdentity.headers['content-encoding'], undefined);
    assert.match(homeIdentity.body.toString(), /<\/head>/);
    const about = await raw(plain.base, '/about', { encoding: 'br' });
    assert.equal(about.headers['content-encoding'], 'br');

    const fontDirectory = path.join(process.cwd(), 'public/assets/fonts');
    const font = fs.readdirSync(fontDirectory).find(name => name.endsWith('.woff2'));
    const fontResponse = await raw(plain.base, `/assets/fonts/${font}`, { encoding: 'br' });
    assert.equal(fontResponse.headers['content-encoding'], undefined);
    assert.equal(fontResponse.headers['cache-control'], 'public, max-age=604800');
    assert.match(fontResponse.headers.etag || '', /^W\/"/);
  });

  await check('secrets and private routes are not served as static files', async () => {
    assert.equal((await raw(plain.base, '/.env', { encoding: 'br' })).status, 404);
    assert.equal((await raw(plain.base, '/%2e%2e/server/server.js', { encoding: 'br' })).status, 404);
  });

  await check('robots.txt disallows everything without a public origin', async () => {
    const robots = await (await fetch(`${plain.base}/robots.txt`)).text();
    assert.match(robots, /Disallow: \/\n/);
  });
} finally {
  await plain.stop();
}

const pending = await start({ POORUP_PUBLIC_ORIGIN: 'https://play.example' });
try {
  await check('an origin without the explicit policy keeps pages noindex, matching robots.txt', async () => {
    assert.match(await (await fetch(`${pending.base}/robots.txt`)).text(), /Disallow: \/\n/);
    for (const route of ['/', '/rules', '/about']) {
      const body = await (await fetch(`${pending.base}${route}`)).text();
      assert.match(body, /name="robots" content="noindex,nofollow"/, route);
      assert.doesNotMatch(body, /application\/ld\+json/, route);
    }
    assert.equal((await fetch(`${pending.base}/sitemap.xml`)).status, 404);
  });
} finally {
  await pending.stop();
}

const approved = await start({ POORUP_PUBLIC_ORIGIN: 'https://play.example', POORUP_INDEX_POLICY: 'index,follow' });
try {
  await check('with origin and policy both set, pages are indexable', async () => {
    assert.match(await (await fetch(`${approved.base}/robots.txt`)).text(), /Allow: \//);
    assert.match(await (await fetch(`${approved.base}/rules`)).text(), /name="robots" content="index,follow"/);
  });
} finally {
  await approved.stop();
}

const limited = await start({ POORUP_HTTP_RATE_LIMIT: '5', POORUP_HTTP_RATE_WINDOW_MS: '60000' });
try {
  await check('static files do not spend the HTTP rate limit, pages and APIs still do', async () => {
    for (let index = 0; index < 40; index += 1) {
      const response = await raw(limited.base, '/main.js', { encoding: 'br' });
      assert.equal(response.status, 200, `static request ${index}`);
    }
    const statuses = [];
    for (let index = 0; index < 8; index += 1) statuses.push((await raw(limited.base, '/rules')).status);
    assert.equal(statuses.filter(status => status === 200).length, 5, `statuses ${statuses}`);
    assert.equal(statuses.at(-1), 429);
    assert.equal((await raw(limited.base, '/main.js', { encoding: 'br' })).status, 200, 'a limited address still loads its scripts');
    assert.equal((await raw(limited.base, '/assets/fonts/' + fs.readdirSync(path.join(process.cwd(), 'public/assets/fonts')).find(name => name.endsWith('.woff2')))).status, 200);
    assert.equal((await raw(limited.base, '/healthz')).status, 200);
    assert.equal((await raw(limited.base, '/missing-script.js')).status, 429, 'a path that is not a file is counted');
  });
} finally {
  await limited.stop();
}

const futureDeadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const restored = await start({}, {
  prepare: directory => fs.writeFileSync(path.join(directory, 'maintenance.json'), JSON.stringify({ mode: 'draining', releaseId: 'deploy-1', message: 'MAINTENANCE WINDOW · INCOMING RELEASE', drainDeadline: futureDeadline, activeRounds: 0 }))
});
try {
  await check('an operator drain keeps its release id and deadline across a restart', async () => {
    const ready = await fetch(`${restored.base}/readyz`);
    const body = await ready.json();
    assert.equal(ready.status, 503);
    assert.equal(body.status, 'draining');
    assert.equal(body.releaseId, 'deploy-1');
  });
} finally {
  await restored.stop();
}

const expired = await start({}, {
  prepare: directory => fs.writeFileSync(path.join(directory, 'maintenance.json'), JSON.stringify({ mode: 'draining', releaseId: 'deploy-2', message: 'MAINTENANCE WINDOW', drainDeadline: new Date(Date.now() - 1000).toISOString(), activeRounds: 0 }))
});
try {
  await check('a restored drain whose deadline passed while the server was down ends in maintenance, persisted', async () => {
    let persisted = null;
    for (let attempt = 0; attempt < 30 && persisted?.mode !== 'maintenance'; attempt += 1) {
      await wait(100);
      persisted = JSON.parse(fs.readFileSync(path.join(expired.dataDirectory, 'maintenance.json'), 'utf8'));
    }
    assert.equal(persisted.mode, 'maintenance');
    assert.equal(persisted.releaseId, 'deploy-2');
    const body = await (await fetch(`${expired.base}/readyz`)).json();
    assert.equal(body.status, 'unavailable');
  });
} finally {
  await expired.stop();
}

console.log(failures ? `http surface wire: ${failures} failed` : 'http surface wire: all passed');
