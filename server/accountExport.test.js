import assert from 'node:assert/strict';
import { buildAccountExport } from './accountExport.js';

const document = buildAccountExport({
  account: {
    id: 'acct-secret', username: 'owner', displayName: 'Owner', color: '#123456',
    passwordHash: 'hash', passwordSalt: 'salt', sessionTokenHash: 'session-hash',
    recoveryEmail: 'owner@example.test', recoveryEmailToken: 'token',
    stats: { wins: 2 }, history: [{ matchId: 'm1' }], matchHistory: [{ matchId: 'm1', participants: [{ accountId: 'acct-secret' }] }],
    achievements: [{ id: 'first-deed' }], designs: [{ id: 'pf_1', designName: 'ONE' }]
  },
  social: { friends: ['acct-other'], requests: [{ accountId: 'acct-other' }], notifications: [{ body: 'hello' }] },
  cosmetics: [{ id: 'hat', owned: true }],
  matches: [{ matchId: 'm2', privateLoanTerms: 'secret', chat: 'raw chat' }],
  now: () => Date.parse('2026-09-17T12:00:00.000Z')
});
const serialized = JSON.stringify(document);
assert.equal(document.schemaVersion, 1);
assert.equal(document.profile.username, 'owner');
assert.equal(document.recoveryEmail.address, 'owner@example.test');
assert.equal(serialized.includes('passwordHash'), false);
assert.equal(serialized.includes('passwordSalt'), false);
assert.equal(serialized.includes('sessionToken'), false);
assert.equal(serialized.includes('acct-secret'), false);
assert.equal(serialized.includes('privateLoanTerms'), false);
assert.equal(serialized.includes('raw chat'), false);
assert.ok(document.statistics);
console.log('account export: 8 passed, 0 failed');
