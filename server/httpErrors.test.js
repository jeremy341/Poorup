import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { asyncRoute, createHttpErrorHandler } from './httpErrors.js';

async function check(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}:`, error.message);
    process.exitCode = 1;
  }
}

const counted = [];
const logged = [];
const metrics = { incrementMetric: (name, labels) => counted.push({ name, labels }) };
const errorPage = (title, message) => `<html>${title}|${message}</html>`;
const app = express();
app.post('/account/json', express.json({ limit: '1kb' }), (_req, res) => res.json({ ok: true }));
app.post('/page', express.json({ limit: '1kb' }), (_req, res) => res.send('ok'));
app.get('/boom-async', asyncRoute(async () => { throw new Error('disk full'); }));
app.get('/boom-sync', asyncRoute(() => { throw new Error('sync failure'); }));
app.get('/fine', asyncRoute(async (_req, res) => { res.json({ ok: true }); }));
app.get('/late', asyncRoute(async (_req, res) => { res.write('partial'); throw new Error('after headers'); }));
app.get('/teapot', (_req, _res, next) => next(Object.assign(new Error('nope'), { status: 418 })));
app.use(createHttpErrorHandler({ metrics, errorPage, log: (...args) => logged.push(args.join(' ')) }));

let unhandled = 0;
process.on('unhandledRejection', () => { unhandled += 1; });

const server = http.createServer(app);
await new Promise(resolve => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (route, body, headers = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

try {
  await check('malformed and oversized JSON answer 400 and 413 without counting a server error', async () => {
    const bad = await post('/account/json', '{bad');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).success, false);
    const big = await post('/account/json', JSON.stringify({ pad: 'x'.repeat(4000) }));
    assert.equal(big.status, 413);
    const encoded = await post('/account/json', '{}', { 'content-encoding': 'br' });
    assert.equal(encoded.status, 415);
    assert.deepEqual(counted, []);
  });

  await check('page routes get an HTML client-error page', async () => {
    const response = await post('/page', '{bad');
    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type'), /html/);
    assert.match(await response.text(), /400 · Bad request/);
  });

  await check('an undecodable URL is a 400, not a server error', async () => {
    const response = await fetch(`${base}/teapot%E0%A4%A`);
    assert.equal(response.status, 404, 'no route matches, the router has nothing to decode');
    const decoded = express();
    decoded.get('/:name', (_req, res) => res.send('ok'));
    decoded.use(createHttpErrorHandler({ metrics, errorPage, log: () => {} }));
    const inner = http.createServer(decoded);
    await new Promise(resolve => inner.listen(0, resolve));
    try {
      const answer = await fetch(`http://127.0.0.1:${inner.address().port}/%E0%A4%A`);
      assert.equal(answer.status, 400);
    } finally {
      await new Promise(resolve => inner.close(resolve));
    }
    assert.deepEqual(counted, []);
  });

  await check('a rejected async handler becomes a counted 500 and the process keeps running', async () => {
    const response = await fetch(`${base}/boom-async`);
    assert.equal(response.status, 500);
    assert.match(await response.text(), /500 · Parlor unavailable/);
    const sync = await fetch(`${base}/boom-sync`);
    assert.equal(sync.status, 500);
    assert.deepEqual(counted.map(entry => entry.name), ['error-count', 'error-count']);
    assert.deepEqual(counted[0].labels, { source: 'http' });
    assert.equal(logged.length, 2);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(unhandled, 0, 'no unhandled rejection reaches the process crash guard');
    assert.equal((await fetch(`${base}/fine`)).status, 200);
  });

  await check('other 4xx statuses pass through and a failure after headers is left alone', async () => {
    const teapot = await fetch(`${base}/teapot`);
    assert.equal(teapot.status, 418);
    // Headers are already out, so the handler hands over to Express, which ends the connection.
    let late;
    try { late = await (await fetch(`${base}/late`)).text(); } catch { late = 'aborted'; }
    assert.ok(late === 'partial' || late === 'aborted');
    assert.equal((await fetch(`${base}/fine`)).status, 200);
  });
} finally {
  await new Promise(resolve => server.close(resolve));
}
