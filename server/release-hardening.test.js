import assert from 'node:assert/strict';
import { isOriginAllowed, parseAllowedOrigins } from './serverConfig.js';
import { createSocketRateLimiter } from './socketRateLimiter.js';

assert.deepEqual(parseAllowedOrigins({ POORUP_ALLOWED_ORIGINS: ' https://poorup.example, https://play.example ' }), ['https://poorup.example', 'https://play.example']);
assert.deepEqual(parseAllowedOrigins({ POORUP_ALLOWED_ORIGINS: '' }), []);
assert.equal(isOriginAllowed(undefined, ['https://poorup.example']), true);
assert.equal(isOriginAllowed('https://poorup.example', ['https://poorup.example']), true);
assert.equal(isOriginAllowed('https://evil.example', ['https://poorup.example']), false);
assert.equal(isOriginAllowed('https://anything.example', []), true);

let now = 0;
const limiter = createSocketRateLimiter({ max: 2, windowMs: 1000, now: () => now });
assert.equal(limiter.allow('socket-a'), true);
assert.equal(limiter.allow('socket-a'), true);
assert.equal(limiter.allow('socket-a'), false);
assert.equal(limiter.allow('socket-b'), true);
now = 1001;
assert.equal(limiter.allow('socket-a'), true);
limiter.forget('socket-a');
assert.equal(limiter.allow('socket-a'), true);

console.log('release hardening tests: 11 passed, 0 failed');
