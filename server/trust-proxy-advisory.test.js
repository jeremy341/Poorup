// Regression: production with POORUP_TRUST_PROXY_HOPS unset (or 0) keys every pre-auth budget on the proxy's own address when a reverse
// proxy sits in front. The boot advisory must say so; a configured hop count must stay silent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyTrustAdvisory } from './serverConfig.js';

test('production without a trusted proxy hop count gets a boot advisory', () => {
  for (const hops of [undefined, '', '0', 'nope']) {
    const env = { NODE_ENV: 'production', POORUP_TRUST_PROXY_HOPS: hops };
    const message = proxyTrustAdvisory(env);
    assert.match(String(message), /POORUP_TRUST_PROXY_HOPS/, `hops=${JSON.stringify(hops)} must be advised`);
    assert.match(String(message), /reverse proxy/i);
  }
});

test('a configured hop count in production is silent', () => {
  assert.equal(proxyTrustAdvisory({ NODE_ENV: 'production', POORUP_TRUST_PROXY_HOPS: '1' }), null);
  assert.equal(proxyTrustAdvisory({ NODE_ENV: 'production', POORUP_TRUST_PROXY_HOPS: ' 2 ' }), null);
});

test('outside production the advisory stays quiet', () => {
  assert.equal(proxyTrustAdvisory({ NODE_ENV: 'development' }), null);
  assert.equal(proxyTrustAdvisory({}), null);
});
