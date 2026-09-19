import assert from 'node:assert/strict';

const values = new Map();
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
const { persistAccountSession, loadAccountSession } = await import('./clientSanitize.js');
persistAccountSession({ sessionToken: 'secret-bearer', account: { id: 'acct-1', username: 'owner', displayName: 'Owner' } });
const stored = JSON.parse(values.get('poorup.account.session.v1'));
assert.equal(Object.prototype.hasOwnProperty.call(stored, 'sessionToken'), false, 'new persisted sessions contain no bearer token');
assert.equal(loadAccountSession().account.username, 'owner');
assert.equal(loadAccountSession().sessionToken, '');
console.log('client account session storage: 3 passed, 0 failed');
