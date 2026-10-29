import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { cacheControlFor, createStaticAssets, pickEncoding } from './staticAssets.js';

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

check('encoding negotiation prefers br, then gzip, and honours q=0', () => {
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(''), null);
  assert.equal(pickEncoding(undefined), null);
  assert.equal(pickEncoding('*'), 'br');
  assert.equal(pickEncoding('*;q=0'), null);
});

check('cache control follows the asset class', () => {
  assert.equal(cacheControlFor('/main.js'), 'no-cache');
  assert.equal(cacheControlFor('/clientDom.js'), 'no-cache');
  assert.equal(cacheControlFor('/styles.css'), 'no-cache');
  assert.equal(cacheControlFor('/privacy.html'), 'no-cache');
  assert.equal(cacheControlFor('/assets/fonts/a.woff2'), 'public, max-age=604800');
  assert.equal(cacheControlFor('/assets/audio/theme.mp3'), 'public, max-age=604800');
  assert.equal(cacheControlFor('/favicon.svg'), 'public, max-age=604800');
  assert.equal(cacheControlFor('/assets/README.md'), 'public, max-age=3600');
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poorup-static-'));
const bigScript = `export const lines = [${Array.from({ length: 400 }, (_, index) => `'line ${index} of a module that compresses well'`).join(',')}];\n`;
fs.mkdirSync(path.join(root, 'assets', 'fonts'), { recursive: true });
fs.writeFileSync(path.join(root, 'main.js'), bigScript);
fs.writeFileSync(path.join(root, 'styles.css'), 'body{color:red}\n'.repeat(200));
fs.writeFileSync(path.join(root, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg">${'<path d="M0 0L10 10"/>'.repeat(60)}</svg>`);
fs.writeFileSync(path.join(root, 'assets', 'fonts', 'face.woff2'), Buffer.from('not really a font'));
fs.writeFileSync(path.join(root, '.secret.js'), 'export const secret = 1;\n');

const assets = createStaticAssets({ root });
const app = express();
app.use(assets.compressHtml);
app.use(assets.compressedText);
app.use(express.static(root, { index: false, maxAge: '1h', setHeaders: (res, file, stat) => assets.setStaticHeaders(res, file, stat) }));
const page = `<!doctype html><html><head><title>t</title></head><body>${'<p>hello parlor</p>'.repeat(200)}</body></html>`;
app.get('/page', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(page); });
app.get('/secret-page', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('html').send(page); });
app.get('/tiny', (_req, res) => { res.type('html').send('<p>tiny</p>'); });
app.get('/data', (_req, res) => res.json({ pad: 'x'.repeat(5000) }));

const server = http.createServer(app);
await new Promise(resolve => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;
// fetch() would transparently decode; request the raw bytes instead.
function raw(pathname, { encoding, headers = {}, method = 'GET' } = {}) {
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

try {
  await check('a script is served brotli-compressed with Vary and a revalidating cache policy', async () => {
    const response = await raw('/main.js', { encoding: 'gzip, deflate, br' });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-encoding'], 'br');
    assert.match(response.headers.vary || '', /Accept-Encoding/i);
    assert.equal(response.headers['cache-control'], 'no-cache');
    assert.match(response.headers['content-type'] || '', /javascript/);
    assert.ok(response.body.length < bigScript.length / 3, 'compressed body is much smaller');
    assert.equal(zlib.brotliDecompressSync(response.body).toString(), bigScript);
  });

  await check('gzip is used when br is not offered and identity when neither is', async () => {
    const gzip = await raw('/main.js', { encoding: 'gzip' });
    assert.equal(gzip.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(gzip.body).toString(), bigScript);
    const plain = await raw('/main.js', { encoding: 'identity' });
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.match(plain.headers.vary || '', /Accept-Encoding/i);
    assert.equal(plain.body.toString(), bigScript);
    const none = await raw('/main.js');
    assert.equal(none.body.toString(), bigScript);
  });

  await check('revalidation answers 304, per encoding', async () => {
    const first = await raw('/styles.css', { encoding: 'br' });
    assert.ok(first.headers.etag);
    const again = await raw('/styles.css', { encoding: 'br', headers: { 'if-none-match': first.headers.etag } });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    const other = await raw('/styles.css', { encoding: 'gzip', headers: { 'if-none-match': first.headers.etag } });
    assert.equal(other.status, 200, 'a br validator does not validate the gzip representation');
  });

  await check('a changed file is re-encoded and gets a new validator', async () => {
    const before = await raw('/styles.css', { encoding: 'br' });
    const changed = 'body{color:blue}\n'.repeat(200);
    fs.writeFileSync(path.join(root, 'styles.css'), changed);
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(root, 'styles.css'), future, future);
    const after = await raw('/styles.css', { encoding: 'br' });
    assert.notEqual(after.headers.etag, before.headers.etag);
    assert.equal(zlib.brotliDecompressSync(after.body).toString(), changed);
  });

  await check('svg is compressed and cached for a week', async () => {
    const response = await raw('/favicon.svg', { encoding: 'br' });
    assert.equal(response.headers['content-encoding'], 'br');
    assert.equal(response.headers['cache-control'], 'public, max-age=604800');
    assert.match(response.headers['content-type'] || '', /svg/);
  });

  await check('already-compressed font files are not re-encoded and carry a content ETag', async () => {
    const response = await raw('/assets/fonts/face.woff2', { encoding: 'br' });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-encoding'], undefined);
    assert.equal(response.headers['cache-control'], 'public, max-age=604800');
    assert.match(response.headers.etag || '', /^W\/"[A-Za-z0-9_-]+"$/);
    const again = await raw('/assets/fonts/face.woff2', { headers: { 'if-none-match': response.headers.etag } });
    assert.equal(again.status, 304);
  });

  await check('a content ETag survives a touched mtime', async () => {
    const file = path.join(root, 'assets', 'fonts', 'face.woff2');
    const before = await raw('/assets/fonts/face.woff2');
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(file, later, later);
    const after = await raw('/assets/fonts/face.woff2');
    assert.equal(after.headers.etag, before.headers.etag);
  });

  await check('dot files, traversal and missing files fall through unserved', async () => {
    assert.equal((await raw('/.secret.js', { encoding: 'br' })).status, 404);
    assert.equal((await raw('/%2e%2e/package.json', { encoding: 'br' })).status, 404);
    assert.equal((await raw('/..%2fserver.js', { encoding: 'br' })).status, 404);
    assert.ok((await raw('/%E0%A4%A.js', { encoding: 'br' })).status >= 400);
    assert.equal((await raw('/missing.js', { encoding: 'br' })).status, 404);
    assert.equal((await raw('/main.js%00.css', { encoding: 'br' })).status >= 400, true);
  });

  await check('HEAD requests are answered without a body', async () => {
    const response = await raw('/main.js', { encoding: 'br', method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 0);
    assert.equal(response.headers['content-encoding'], 'br');
  });

  await check('rendered HTML pages are compressed when cacheable', async () => {
    const response = await raw('/page', { encoding: 'br' });
    assert.equal(response.headers['content-encoding'], 'br');
    assert.match(response.headers.vary || '', /Accept-Encoding/i);
    assert.equal(response.headers['cache-control'], 'no-cache');
    assert.equal(zlib.brotliDecompressSync(response.body).toString(), page);
    const gzip = await raw('/page', { encoding: 'gzip' });
    assert.equal(zlib.gunzipSync(gzip.body).toString(), page);
    const plain = await raw('/page', { encoding: 'identity' });
    assert.equal(plain.body.toString(), page);
    const again = await raw('/page', { encoding: 'br', headers: { 'if-none-match': response.headers.etag } });
    assert.equal(again.status, 304);
  });

  await check('no-store pages, tiny pages and JSON are never compressed', async () => {
    for (const route of ['/secret-page', '/tiny', '/data']) {
      const response = await raw(route, { encoding: 'br' });
      assert.equal(response.status, 200, route);
      assert.equal(response.headers['content-encoding'], undefined, route);
    }
  });

  await check('compressed bytes are cached in memory, not recomputed per request', async () => {
    const before = assets.stats();
    for (let index = 0; index < 5; index += 1) await raw('/main.js', { encoding: 'br' });
    assert.deepEqual(assets.stats(), before);
    assert.ok(before.files >= 3);
  });
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `static assets: ${failures} failed` : 'static assets: all passed');
