// Regression: production cannot detect a proxy, so an undeclared posture must refuse to boot instead of silently keying every client
// on the proxy's address (one sign-in/join/operator-unlock budget for the whole site). A hop count, a trusted-proxy address list or
// the explicit POORUP_DIRECT_INTERNET opt-out is required. Development keeps the advisory and still boots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProxyPosture, assertTrustedProxyConfig, proxyTrustAdvisory } from './serverConfig.js';

test('production refuses to boot without a declared proxy posture', () => {
  for (const hops of [undefined, '', '0', 'nope']) {
    assert.throws(
      () => assertProxyPosture({ NODE_ENV: 'production', POORUP_TRUST_PROXY_HOPS: hops }),
      /Proxy posture is undeclared[\s\S]*POORUP_TRUST_PROXY_HOPS[\s\S]*POORUP_DIRECT_INTERNET/,
      `hops=${JSON.stringify(hops)} must refuse to boot`,
    );
  }
  assert.throws(() => assertProxyPosture({ NODE_ENV: 'production', POORUP_DIRECT_INTERNET: 'false' }), /Proxy posture is undeclared/);
});

test('production boots with a trusted hop count', () => {
  assert.equal(assertProxyPosture({ NODE_ENV: 'production', POORUP_TRUST_PROXY_HOPS: '1' }), true);
  assert.equal(assertProxyPosture({ NODE_ENV: 'production', POORUP_TRUST_PROXY_HOPS: ' 2 ' }), true);
});

test('production boots with a trusted-proxy address list', () => {
  assert.equal(assertProxyPosture({ NODE_ENV: 'production', POORUP_TRUSTED_PROXY_ADDRESSES: '10.0.0.1,2001:db8::1' }), true);
});

test('production boots only with the explicit direct-internet opt-out', () => {
  assert.equal(assertProxyPosture({ NODE_ENV: 'production', POORUP_DIRECT_INTERNET: 'true' }), true);
  assert.equal(assertProxyPosture({ NODE_ENV: 'production', POORUP_DIRECT_INTERNET: ' TRUE ' }), true);
});

test('development boots undeclared and warns about the production requirement', () => {
  assert.equal(assertProxyPosture({ NODE_ENV: 'development' }), true);
  assert.equal(assertProxyPosture({}), true);
  const message = proxyTrustAdvisory({ NODE_ENV: 'development' });
  assert.match(String(message), /POORUP_TRUST_PROXY_HOPS/);
  assert.match(String(message), /POORUP_DIRECT_INTERNET/);
});

test('the advisory stays quiet when a posture is declared, and production never reaches it', () => {
  assert.equal(proxyTrustAdvisory({ NODE_ENV: 'development', POORUP_TRUST_PROXY_HOPS: '1' }), null);
  assert.equal(proxyTrustAdvisory({ NODE_ENV: 'development', POORUP_TRUSTED_PROXY_ADDRESSES: '10.0.0.1' }), null);
  assert.equal(proxyTrustAdvisory({ NODE_ENV: 'development', POORUP_DIRECT_INTERNET: 'true' }), null);
  assert.equal(proxyTrustAdvisory({ NODE_ENV: 'production' }), null);
});

test('the existing trusted-proxy address validation still rejects non-IP entries', () => {
  assert.equal(assertTrustedProxyConfig({ POORUP_TRUSTED_PROXY_ADDRESSES: '10.0.0.1,2001:db8::1' }), true);
  assert.throws(() => assertTrustedProxyConfig({ POORUP_TRUSTED_PROXY_ADDRESSES: '10.0.0.0/8' }), /plain IP addresses/);
});
