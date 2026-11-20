// HTTP security policy: response headers, the CSP against the real client markup, CORS for HTTP and Socket.IO, the static-file guard,
// method and Host checks, request timeouts, and consistent error answers. Boots the real server twice (default, and trusted-proxy with a
// host allowlist). Policy write-up: docs/security-headers.md.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { buildContentSecurityPolicy, hardenHttpServer, securityHeaders, isAllowedMethod, isPrivateStaticPath, parseAllowedHosts } from './securityHeaders.js';

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
const root = process.cwd();
const publicDirectory = path.join(root, 'public');
let nextPort = 40000 + (process.pid % 7000) * 2;

// ---- Policy shape -------------------------------------------------------------------------------------------------------------------

const policy = buildContentSecurityPolicy(["'self'", 'https://play.example']);
const directives = Object.fromEntries(policy.split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

await check('the CSP forbids inline and eval scripts and every plugin, framing and base-URL escape', () => {
  assert.deepEqual(directives['script-src'], ["'self'"]);
  assert.deepEqual(directives['script-src-attr'], ["'none'"]);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['base-uri'], ["'self'"]);
  assert.deepEqual(directives['form-action'], ["'self'"]);
  assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
  assert.deepEqual(directives['frame-src'], ["'none'"]);
  assert.deepEqual(directives['worker-src'], ["'none'"]);
  assert.equal(policy.includes('unsafe-eval'), false);
  assert.equal(directives['script-src'].includes("'unsafe-inline'"), false);
});

await check('inline styles are allowed only as attributes; inline style elements are blocked', () => {
  assert.deepEqual(directives['style-src-elem'], ["'self'"]);
  assert.deepEqual(directives['style-src-attr'], ["'unsafe-inline'"]);
});

await check('connect-src carries the configured origin and the same-origin default', () => {
  assert.deepEqual(directives['connect-src'], ["'self'", 'https://play.example']);
  assert.deepEqual(directives['font-src'], ["'self'"]);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:']);
});

// ---- The policy must not break the client: scan the shipped markup and styles ------------------------------------------------------

function clientFiles() {
  return fs.readdirSync(publicDirectory)
    .filter(name => !/\.test\.m?js$/.test(name))
    .filter(name => /\.(?:html|js|css)$/.test(name))
    .map(name => ({ name, text: fs.readFileSync(path.join(publicDirectory, name), 'utf8') }));
}

await check('the shipped HTML has no inline script blocks and no event-handler attributes', () => {
  for (const { name, text } of clientFiles().filter(file => file.name.endsWith('.html'))) {
    assert.doesNotMatch(text, /<script(?![^>]*\ssrc=)[^>]*>\s*\S/i, `${name} has an inline script`);
    assert.doesNotMatch(text, /\son[a-z]+\s*=\s*["']/i, `${name} has an on* attribute`);
  }
});

await check('the client never builds inline event handlers or <style> elements at runtime', () => {
  for (const { name, text } of clientFiles().filter(file => file.name.endsWith('.js'))) {
    assert.doesNotMatch(text, /setAttribute\(\s*["'`]on/i, `${name} sets an on* attribute`);
    assert.doesNotMatch(text, /createElement\(\s*["']style["']/i, `${name} creates a style element`);
    assert.doesNotMatch(text, /<style[\s>]/i, `${name} writes a style element`);
  }
});

await check('the stylesheets and pages load nothing from another origin', () => {
  for (const { name, text } of clientFiles().filter(file => /\.(?:html|css)$/.test(file.name))) {
    assert.doesNotMatch(text, /(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:/i, `${name} loads an external resource`);
  }
});

// ---- Static guard, method and host helpers --------------------------------------------------------------------------------------------

await check('test files, source maps and editor copies are private; shipped files are not', () => {
  for (const blocked of ['/clientNightShift.test.js', '/clientX.test.mjs', '/main.js.map', '/%2e%2e/x.test.js', '/main.js.bak', '/main.js~', '/main.js.swp']) {
    assert.equal(isPrivateStaticPath(blocked), true, blocked);
  }
  for (const served of ['/main.js', '/test.js', '/assets/fonts/pixelify-sans-400.woff2', '/styles.css', '/%E0%A4%A']) {
    assert.equal(isPrivateStaticPath(served), false, served);
  }
});

await check('only the methods the routes use are allowed, and matching is case-sensitive', () => {
  for (const method of ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(isAllowedMethod(method), true, method);
  for (const method of ['PUT', 'TRACE', 'CONNECT', 'get']) assert.equal(isAllowedMethod(method), false, method);
});

await check('the host allowlist keeps hostnames only, without ports or case', () => {
  assert.deepEqual(parseAllowedHosts(' Play.Example , api.example:8443 '), ['play.example', 'api.example']);
  assert.deepEqual(parseAllowedHosts(''), []);
});

// ---- Timeouts: a slow client is cut off, and a slow response is not ----------------------------------------------------------------------

await check('the production timers are the ones this policy documents', () => {
  const server = hardenHttpServer(http.createServer(() => {}));
  assert.equal(server.headersTimeout, 15_000);
  assert.equal(server.requestTimeout, 30_000);
  assert.ok(server.headersTimeout <= server.requestTimeout);
  assert.equal(server.connectionsCheckingInterval, 5_000);
});

await check('a client that trickles its headers is disconnected', async () => {
  const server = hardenHttpServer(http.createServer((_req, res) => res.end('ok')), { headersTimeoutMs: 300, requestTimeoutMs: 600, checkIntervalMs: 50 });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const closed = await new Promise((resolve, reject) => {
      const socket = net.connect(server.address().port, '127.0.0.1', () => socket.write('GET / HTTP/1.1\r\nHost: x\r\n'));
      socket.on('close', () => resolve(true));
      socket.on('error', reject);
      socket.on('data', () => {});
      setTimeout(() => { socket.destroy(); resolve(false); }, 3000);
    });
    assert.equal(closed, true, 'the stalled connection is closed by the server');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

await check('a response that is still being produced is not cut off by the request timers', async () => {
  const server = hardenHttpServer(http.createServer((_req, res) => setTimeout(() => res.end('late but fine'), 800)), { headersTimeoutMs: 300, requestTimeoutMs: 600, checkIntervalMs: 50 });
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await response.text(), 'late but fine');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

// ---- Live server ------------------------------------------------------------------------------------------------------------------------

async function start(env = {}) {
  const port = nextPort;
  nextPort += 1;
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-http-headers-'));
  const child = spawn(process.execPath, [path.join(root, 'server/server.js')], {
    env: { ...process.env, PORT: String(port), POORUP_DATA_DIR: dataDirectory, POORUP_BACKUP_DIR: '', POORUP_SHUTDOWN_DRAIN_MS: '1000', POORUP_MAINTENANCE_TOKEN: '', ...env },
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
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(3000)]);
      }
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
  };
}

// Raw request: the Host, method and headers are sent exactly as given (fetch would normalise some of them).
function raw(base, pathname, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, base);
    const request = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end();
  });
}

const EXPECTED_CSP_PREFIX = "default-src 'self'; script-src 'self'; script-src-attr 'none';";

const main = await start({ POORUP_ALLOWED_ORIGINS: 'https://play.example' });
try {
  await check('every page carries the full header set and no X-Powered-By', async () => {
    const home = await raw(main.base, '/');
    assert.equal(home.status, 200);
    assert.ok(home.headers['content-security-policy'].startsWith(EXPECTED_CSP_PREFIX), home.headers['content-security-policy']);
    assert.match(home.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(home.headers['x-content-type-options'], 'nosniff');
    assert.equal(home.headers['x-frame-options'], 'DENY');
    assert.equal(home.headers['x-permitted-cross-domain-policies'], 'none');
    assert.equal(home.headers['referrer-policy'], 'same-origin');
    assert.equal(home.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(home.headers['cross-origin-resource-policy'], 'same-origin');
    assert.match(home.headers['permissions-policy'], /payment=\(\)/);
    assert.equal(home.headers['x-powered-by'], undefined);
    assert.equal(home.headers['strict-transport-security'], undefined, 'HSTS is not sent over plain HTTP');
  });

  await check('static files, JSON and 404 answers all carry the policy', async () => {
    for (const [pathname, status] of [['/main.js', 200], ['/healthz', 200], ['/account/session', 401], ['/nope', 404]]) {
      const response = await raw(main.base, pathname);
      assert.equal(response.status, status, pathname);
      assert.equal(response.headers['x-content-type-options'], 'nosniff', pathname);
      assert.ok(response.headers['content-security-policy'], pathname);
    }
  });

  await check('a forwarded HTTPS hop is ignored without a trusted proxy, so HSTS is not sent', async () => {
    const response = await raw(main.base, '/', { headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(response.headers['strict-transport-security'], undefined);
  });

  await check('test files and source maps are not served; shipped scripts still are', async () => {
    for (const pathname of ['/clientNightShift.test.js', '/clientAccountRights.test.js', '/main.js.map', '/main.js.bak']) {
      const response = await raw(main.base, pathname);
      assert.equal(response.status, 404, pathname);
      assert.doesNotMatch(response.body, /node:assert/, pathname);
    }
    assert.equal((await raw(main.base, '/main.js')).status, 200);
  });

  await check('directory listings and encoded traversal never return a file', async () => {
    assert.equal((await raw(main.base, '/assets/')).status, 404);
    const attempts = ['/%2e%2e/server/server.js', '/%252e%252e/server/server.js', '/..%5cserver%5cserver.js', '/main.js%00.txt', '/%2e%2e%2fserver%2fserver.js', '/.env'];
    for (const pathname of attempts) {
      const response = await raw(main.base, pathname);
      assert.notEqual(response.status, 200, pathname);
      assert.doesNotMatch(response.body, /import express|createStaticAssets/, pathname);
    }
  });

  await check('methods outside the allowlist get a 405 with an Allow header, on pages and APIs alike', async () => {
    for (const [method, pathname] of [['PUT', '/account/session'], ['TRACE', '/']]) {
      const response = await raw(main.base, pathname, { method });
      assert.equal(response.status, 405, `${method} ${pathname}`);
      assert.equal(response.headers.allow, 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
    }
    // CONNECT is a tunnel request: Node hands it to a 'connect' listener, and with none it drops the socket, so it never reaches a route.
    await assert.rejects(raw(main.base, '/', { method: 'CONNECT' }), /socket hang up|ECONNRESET/, 'CONNECT never reaches a route');
    const patch = await raw(main.base, '/admin/ai/providers/unknown', { method: 'PATCH' });
    assert.notEqual(patch.status, 405, 'PATCH stays allowed for the AI provider admin routes');
  });

  await check('unknown API paths answer with the JSON error shape; unknown pages keep the HTML page', async () => {
    const api = await raw(main.base, '/account/nope');
    assert.equal(api.status, 404);
    assert.match(api.headers['content-type'], /application\/json/);
    assert.deepEqual(JSON.parse(api.body), { success: false, error: 'Not found.' });
    const page = await raw(main.base, '/nope');
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.body, /404 · Table not found/);
    assert.doesNotMatch(page.body, /at \w+ \(|\/server\/|node_modules/, 'no stack trace or internal path');
  });

  await check('a malformed Host header is refused before any route runs', async () => {
    const response = await raw(main.base, '/', { headers: { host: 'bad/host' } });
    assert.equal(response.status, 400);
  });

  await check('an oversized header block is refused by Node before any handler runs', async () => {
    const response = await raw(main.base, '/', { headers: { 'x-pad': 'a'.repeat(20_000) } }).catch(error => ({ status: error.code }));
    assert.ok(response.status === 431 || response.status === 'ECONNRESET' || response.status === 'EPIPE', String(response.status));
  });

  await check('HTTP responses never carry CORS headers, not even for a foreign origin', async () => {
    for (const origin of ['https://evil.example', 'https://play.example']) {
      const response = await raw(main.base, '/healthz', { headers: { origin } });
      assert.equal(response.headers['access-control-allow-origin'], undefined, origin);
    }
  });

  await check('Socket.IO refuses a foreign origin with a 403 that still carries the headers', async () => {
    const response = await raw(main.base, '/socket.io/?EIO=4&transport=polling', { headers: { origin: 'https://evil.example' } });
    assert.equal(response.status, 403);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  });

  await check('Socket.IO reflects only the configured origin and never grants credentials or a wildcard', async () => {
    const response = await raw(main.base, '/socket.io/?EIO=4&transport=polling', { headers: { origin: 'https://play.example' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers['access-control-allow-origin'], 'https://play.example');
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  });
} finally {
  await main.stop();
}

const proxied = await start({ POORUP_TRUST_PROXY_HOPS: '1', POORUP_ALLOWED_HOSTS: 'play.example' });
try {
  await check('behind a trusted proxy that reports HTTPS, HSTS is sent', async () => {
    const response = await raw(proxied.base, '/', { headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(response.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
    const plain = await raw(proxied.base, '/');
    assert.equal(plain.headers['strict-transport-security'], undefined, 'a direct plain-HTTP request still gets no HSTS');
  });

  await check('with an allowlist, a foreign Host is refused on pages and APIs but health probes still answer', async () => {
    const page = await raw(proxied.base, '/', { headers: { host: 'play.example' } });
    assert.equal(page.status, 200);
    const wrong = await raw(proxied.base, '/', { headers: { host: 'evil.example' } });
    assert.equal(wrong.status, 421);
    const api = await raw(proxied.base, '/account/session', { headers: { host: 'evil.example' } });
    assert.equal(api.status, 421);
    assert.deepEqual(JSON.parse(api.body), { success: false, error: 'This host is not served here.' });
    const probe = await raw(proxied.base, '/healthz', { headers: { host: '10.0.0.7:8080' } });
    assert.equal(probe.status, 200);
  });
} finally {
  await proxied.stop();
}

await check('forceHsts sends HSTS even when the request is not seen as secure (production default), and the default does not', async () => {
  const run = options => {
    const headers = {};
    const res = { setHeader: (name, value) => { headers[name.toLowerCase()] = value; } };
    securityHeaders(options)({ secure: false }, res, () => {});
    return headers['strict-transport-security'];
  };
  assert.match(run({ forceHsts: true }), /max-age=31536000/);
  assert.equal(run({}), undefined);
});

console.log(failures ? `http security headers: ${failures} failed` : 'http security headers: all passed');
