import assert from 'node:assert/strict';
import { assertProductionCors, createCorsOrigin, isOriginAllowed, parseAllowedOrigins, resolveRetentionToken, tokensMatch } from './serverConfig.js';
import { createSocketRateLimiter } from './socketRateLimiter.js';

// Operator tokens are compared in constant time, and the retention job falls
// back to the maintenance token only with a one-time warning.
assert.equal(tokensMatch('maintenance-secret', 'maintenance-secret'), true);
assert.equal(tokensMatch('maintenance-secreT', 'maintenance-secret'), false);
assert.equal(tokensMatch('', 'maintenance-secret'), false);
assert.equal(tokensMatch(undefined, 'maintenance-secret'), false);
assert.equal(tokensMatch('maintenance-secret', ''), false, 'an unset token never matches');
const retentionWarnings = [];
assert.equal(resolveRetentionToken({ POORUP_RETENTION_TOKEN: 'retention-secret', POORUP_MAINTENANCE_TOKEN: 'maintenance-secret' }, message => retentionWarnings.push(message)), 'retention-secret');
assert.equal(retentionWarnings.length, 0, 'a dedicated retention token needs no warning');
assert.equal(resolveRetentionToken({ POORUP_MAINTENANCE_TOKEN: 'maintenance-secret' }, message => retentionWarnings.push(message)), 'maintenance-secret');
assert.equal(resolveRetentionToken({ POORUP_MAINTENANCE_TOKEN: 'maintenance-secret' }, message => retentionWarnings.push(message)), 'maintenance-secret');
assert.equal(retentionWarnings.length, 1, 'the maintenance-token fallback warns exactly once');

assert.deepEqual(parseAllowedOrigins({ POORUP_ALLOWED_ORIGINS: ' https://poorup.example, https://play.example ' }), ['https://poorup.example', 'https://play.example']);
assert.deepEqual(parseAllowedOrigins({ POORUP_ALLOWED_ORIGINS: 'https://poorup.example/' }), ['https://poorup.example']);
assert.deepEqual(parseAllowedOrigins({ POORUP_ALLOWED_ORIGINS: '' }), []);
assert.equal(isOriginAllowed(undefined, ['https://poorup.example']), true);
assert.equal(isOriginAllowed('https://poorup.example', ['https://poorup.example']), true);
assert.equal(isOriginAllowed('https://evil.example', ['https://poorup.example']), false);
assert.equal(isOriginAllowed('https://anything.example', []), true);
let productionOriginResult = null;
createCorsOrigin({ NODE_ENV: 'production' })('https://unexpected.example', (_error, allowed) => { productionOriginResult = allowed; });
assert.equal(productionOriginResult, false);
createCorsOrigin({ NODE_ENV: 'production' })(undefined, (_error, allowed) => { productionOriginResult = allowed; });
assert.equal(productionOriginResult, true);
assert.throws(() => assertProductionCors({ NODE_ENV: 'production' }), /POORUP_ALLOWED_ORIGINS/);
assert.throws(() => assertProductionCors({ NODE_ENV: 'production', POORUP_ALLOWED_ORIGINS: 'not-an-origin' }), /valid origins/);
assert.equal(assertProductionCors({ NODE_ENV: 'production', POORUP_ALLOWED_ORIGINS: 'https://poorup.example' }), true);

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

console.log('release hardening tests: 28 passed, 0 failed');
