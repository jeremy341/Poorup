import assert from 'node:assert/strict';
import { assertProductionCors, isOriginAllowed, parseAllowedOrigins, resolveClientAddress } from './serverConfig.js';
import * as serverConfig from './serverConfig.js';
import * as httpRateLimiter from './httpRateLimiter.js';
import { createSocketRateLimiter } from './socketRateLimiter.js';

assert.equal(typeof serverConfig.isAllowedSocketOrigin, 'function');
assert.equal(serverConfig.isAllowedSocketOrigin('https://play.example', ['https://play.example']), true);
assert.equal(serverConfig.isAllowedSocketOrigin('https://evil.example', ['https://play.example']), false);
assert.equal(serverConfig.isAllowedSocketOrigin('ws://play.example', ['https://play.example']), false);
assert.equal(isOriginAllowed('https://evil.example', ['https://play.example']), false);
assert.equal(resolveClientAddress({ address: '127.0.0.1', headers: { 'x-forwarded-for': '10.0.0.2, 10.0.0.1' } }, 0), '127.0.0.1');
assert.equal(resolveClientAddress({ address: '127.0.0.1', headers: { 'x-forwarded-for': '10.0.0.2, 10.0.0.1' } }, 1), '10.0.0.2');
assert.deepEqual(parseAllowedOrigins({ POORUP_ALLOWED_ORIGINS: 'https://play.example,https://play.example/' }), ['https://play.example', 'https://play.example']);
assert.throws(() => assertProductionCors({ NODE_ENV: 'production', POORUP_ALLOWED_ORIGINS: 'https://play.example,ws://evil' }), /valid origins/);
assert.equal(typeof httpRateLimiter.assertRateLimitConfig, 'function');
assert.throws(() => httpRateLimiter.assertRateLimitConfig({ NODE_ENV: 'production', POORUP_HTTP_RATE_LIMIT: '0', POORUP_SOCKET_RATE_LIMIT: '0' }), /rate limit/i);
assert.equal(httpRateLimiter.assertRateLimitConfig({ NODE_ENV: 'development', POORUP_HTTP_RATE_LIMIT: '0', POORUP_SOCKET_RATE_LIMIT: '0' }).development, true);

const limiter = createSocketRateLimiter({ max: 0, windowMs: 1000 });
assert.equal(limiter.allow('socket-a'), false);

console.log('socket admission: 9 passed, 0 failed');
