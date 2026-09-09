import assert from 'node:assert/strict';
import { createHttpRateLimiter } from './httpRateLimiter.js';

const limiter = createHttpRateLimiter({ max: 2, windowMs: 60_000 });
const make = () => ({ headers: {}, socket: { remoteAddress: '127.0.0.1' } });
const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, type() { return this; }, send(body) { this.body = body; } });
let nextCalls = 0;
limiter(make(), response(), () => { nextCalls += 1; });
limiter(make(), response(), () => { nextCalls += 1; });
const blocked = response();
limiter(make(), blocked, () => { nextCalls += 1; });
assert.equal(nextCalls, 2);
assert.equal(blocked.statusCode, 429);
assert.ok(blocked.headers['Retry-After']);
const trusted = createHttpRateLimiter({ max: 1, windowMs: 60_000, trustProxy: true });
const secondIp = { headers: { 'x-forwarded-for': '10.0.0.2, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
assert.doesNotThrow(() => trusted(secondIp, response(), () => {}));
console.log('http rate limiter: 4 passed, 0 failed');
